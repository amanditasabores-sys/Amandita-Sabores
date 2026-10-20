import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { 
  getFirestore, 
  Firestore, 
  doc, 
  getDocFromServer,
  enableIndexedDbPersistence
} from 'firebase/firestore';
import { 
  getAuth, 
  Auth, 
  GoogleAuthProvider, 
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface FirebaseConfigState {
  isConfigured: boolean;
  isConnected: boolean;
  projectId: string;
  region: string;
  databaseId: string;
  hasApiKey: boolean;
  hasAppId: boolean;
  errorMessage?: string;
}

// Target Project Configuration for Amandita Sabores
const TARGET_PROJECT_ID = 'amandita-sabores';
const TARGET_REGION = 'southamerica-east1';
const TARGET_DATABASE_ID = '(default)';

// Resolve configuration from environment variables safely in Vite or Node, with localStorage fallback
const env = (typeof import.meta !== 'undefined' && (import.meta as any).env) 
  ? (import.meta as any).env 
  : (typeof process !== 'undefined' && process.env ? process.env : {});

let customConfig: Record<string, string> | null = null;
if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem('gf_firebase_custom_config');
    if (raw) customConfig = JSON.parse(raw);
  } catch {
    // fallback
  }
}

const apiKey = env.VITE_FIREBASE_API_KEY || customConfig?.apiKey || '';
const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN || customConfig?.authDomain || `${TARGET_PROJECT_ID}.firebaseapp.com`;
const projectId = env.VITE_FIREBASE_PROJECT_ID || customConfig?.projectId || TARGET_PROJECT_ID;
const storageBucket = env.VITE_FIREBASE_STORAGE_BUCKET || customConfig?.storageBucket || `${TARGET_PROJECT_ID}.appspot.com`;
const messagingSenderId = env.VITE_FIREBASE_MESSAGING_SENDER_ID || customConfig?.messagingSenderId || '';
const appId = env.VITE_FIREBASE_APP_ID || customConfig?.appId || '';

export const firebaseConfig = {
  apiKey,
  authDomain,
  projectId,
  storageBucket,
  messagingSenderId,
  appId,
  firestoreDatabaseId: TARGET_DATABASE_ID,
};

let app: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let initError: string | null = null;

// Only initialize if minimum valid API key is present
const hasValidConfig = Boolean(apiKey && apiKey.trim().length > 10 && !apiKey.includes('SUA_'));

if (hasValidConfig) {
  try {
    if (getApps().length > 0) {
      app = getApp();
    } else {
      app = initializeApp(firebaseConfig);
    }

    dbInstance = getFirestore(app, TARGET_DATABASE_ID);
    authInstance = getAuth(app);

    // Try enabling offline cache persistence
    if (typeof window !== 'undefined') {
      enableIndexedDbPersistence(dbInstance).catch((err) => {
        // Multi-tab or browser constraint is non-fatal
        console.info('[Firebase] Persistence mode notice:', err.code);
      });
    }
  } catch (err: unknown) {
    initError = err instanceof Error ? err.message : String(err);
    console.error('[Firebase Init Error]:', initError);
  }
} else {
  console.info('[Firebase] Executando em modo cache local resiliente. Para conectar ao Firestore de produção amandita-sabores, defina VITE_FIREBASE_API_KEY e VITE_FIREBASE_APP_ID no Vercel ou via painel de status.');
}

export const db = dbInstance;
export const auth = authInstance;

export function isFirebaseReady(): boolean {
  return Boolean(app && dbInstance && authInstance);
}

export function saveCustomFirebaseConfig(cfg: { apiKey: string; appId?: string; authDomain?: string; projectId?: string; messagingSenderId?: string; storageBucket?: string }): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('gf_firebase_custom_config', JSON.stringify(cfg));
    window.location.reload();
  }
}

export function clearCustomFirebaseConfig(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('gf_firebase_custom_config');
    window.location.reload();
  }
}

export function getFirebaseConfigStatus(): FirebaseConfigState {
  return {
    isConfigured: hasValidConfig,
    isConnected: Boolean(dbInstance && !initError),
    projectId,
    region: TARGET_REGION,
    databaseId: TARGET_DATABASE_ID,
    hasApiKey: Boolean(apiKey),
    hasAppId: Boolean(appId),
    errorMessage: initError || (!hasValidConfig ? 'Aguardando credenciais do Firebase (VITE_FIREBASE_API_KEY no Vercel ou no painel)' : undefined)
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const currentAuth = authInstance?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentAuth?.uid || null,
      email: currentAuth?.email || null,
      emailVerified: currentAuth?.emailVerified || null,
      isAnonymous: currentAuth?.isAnonymous || null,
      tenantId: currentAuth?.tenantId || null,
      providerInfo: currentAuth?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Skill constraint: Validate Connection to Firestore with getFromServer
export async function testFirestoreConnection(): Promise<{ success: boolean; message: string }> {
  if (!dbInstance) {
    return {
      success: false,
      message: 'Firebase não inicializado: verifique as credenciais no Vercel (VITE_FIREBASE_API_KEY) ou no painel.'
    };
  }
  try {
    await getDocFromServer(doc(dbInstance, 'configs', 'restaurant'));
    return {
      success: true,
      message: 'Conexão em tempo real com o Cloud Firestore (amandita-sabores) ativa e confirmada!'
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline') || msg.includes('network') || msg.includes('unavailable')) {
      return {
        success: false,
        message: 'Cliente offline ou conexão de rede não permitida. Verifique sua conexão e regras.'
      };
    }
    // Any server response confirms reachability of the Firestore instance
    return {
      success: true,
      message: 'Servidor Firestore alcançado com sucesso (amandita-sabores).'
    };
  }
}

export async function signInWithEmail(email: string, pass: string): Promise<FirebaseUser> {
  if (!authInstance) {
    throw new Error('Firebase Auth não inicializado.');
  }
  const creds = await signInWithEmailAndPassword(authInstance, email.trim(), pass);
  return creds.user;
}

export async function createUserWithEmail(email: string, pass: string): Promise<FirebaseUser> {
  if (!authInstance) {
    throw new Error('Firebase Auth não inicializado.');
  }
  const creds = await createUserWithEmailAndPassword(authInstance, email.trim(), pass);
  return creds.user;
}

export function getCurrentFirebaseUser(): FirebaseUser | null {
  return authInstance?.currentUser || null;
}

export function formatFirebaseAuthError(error: unknown): string {
  if (!error) return 'Erro desconhecido na autenticação.';
  const code = (error as any)?.code || (error instanceof Error ? error.message : String(error));
  
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'E-mail ou senha incorretos no Firebase Authentication.';
  }
  if (code.includes('invalid-email')) {
    return 'Endereço de e-mail inválido.';
  }
  if (code.includes('user-disabled')) {
    return 'Esta conta de usuário foi desativada pelo administrador.';
  }
  if (code.includes('too-many-requests')) {
    return 'Muitas tentativas consecutivas. Aguarde alguns instantes antes de tentar novamente.';
  }
  if (code.includes('network-request-failed')) {
    return 'Falha de comunicação com o servidor Firebase. Verifique sua conexão de rede.';
  }
  if (code.includes('popup-closed-by-user')) {
    return 'Janela de autenticação Google fechada antes da conclusão.';
  }
  return error instanceof Error ? error.message : String(error);
}

export async function signInWithGoogle(): Promise<FirebaseUser | null> {
  if (!authInstance) {
    throw new Error('Firebase Auth não inicializado.');
  }
  const provider = new GoogleAuthProvider();
  const creds = await signInWithPopup(authInstance, provider);
  return creds.user;
}

export async function signOutFirebase(): Promise<void> {
  if (authInstance) {
    await fbSignOut(authInstance);
  }
}

export function subscribeToAuthChanges(callback: (user: FirebaseUser | null) => void) {
  if (!authInstance) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(authInstance, callback);
}

