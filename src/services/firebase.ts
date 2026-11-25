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
  signInWithCustomToken,
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
  hasProjectId: boolean;
  hasAuthDomain: boolean;
  hasStorageBucket: boolean;
  hasMessagingSenderId: boolean;
  maskedApiKey: string;
  maskedAppId: string;
  configOrigin: 'build_env' | 'local_storage' | 'none';
  buildTime: string;
  errorMessage?: string;
}

// Target Project Configuration for Amandita Sabores
const TARGET_PROJECT_ID = 'amandita-sabores';
const TARGET_REGION = 'southamerica-east1';
const TARGET_DATABASE_ID = '(default)';

// Declare global build time injected by vite.config.ts define
declare const __APP_BUILD_TIME__: string | undefined;
const appBuildTime = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : new Date().toISOString();

// Helper to mask sensitive keys for UI diagnostic inspection without leaks
function maskSecret(val: string): string {
  if (!val || !val.trim()) return 'Não configurada (vazia)';
  const trimmed = val.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

// Helper to resolve environment variable from compile-time Vite or runtime Node
const getEnvVar = (viteVal: string | undefined, procKey: string): string | undefined => {
  if (typeof viteVal === 'string' && viteVal.trim() !== '') return viteVal.trim();
  if (typeof process !== 'undefined' && process.env && typeof process.env[procKey] === 'string' && process.env[procKey].trim() !== '') {
    return process.env[procKey].trim();
  }
  return undefined;
};

// Check for device-specific localStorage contingency configuration
let customConfig: Record<string, string> | null = null;
if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem('gf_firebase_custom_config');
    if (raw) customConfig = JSON.parse(raw);
  } catch {
    // fallback
  }
}

// Direct static member references for Vite AST compile-time replacement
const rawViteApiKey = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_FIREBASE_API_KEY : undefined;
const rawViteAppId = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_FIREBASE_APP_ID : undefined;
const rawViteProjectId = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_FIREBASE_PROJECT_ID : undefined;
const rawViteAuthDomain = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_FIREBASE_AUTH_DOMAIN : undefined;
const rawViteStorageBucket = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_FIREBASE_STORAGE_BUCKET : undefined;
const rawViteSenderId = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined;

const envApiKey = getEnvVar(rawViteApiKey, 'VITE_FIREBASE_API_KEY');
const envAppId = getEnvVar(rawViteAppId, 'VITE_FIREBASE_APP_ID');
const envProjectId = getEnvVar(rawViteProjectId, 'VITE_FIREBASE_PROJECT_ID');
const envAuthDomain = getEnvVar(rawViteAuthDomain, 'VITE_FIREBASE_AUTH_DOMAIN');
const envStorageBucket = getEnvVar(rawViteStorageBucket, 'VITE_FIREBASE_STORAGE_BUCKET');
const envSenderId = getEnvVar(rawViteSenderId, 'VITE_FIREBASE_MESSAGING_SENDER_ID');

// Determine configuration source
const configOrigin: 'build_env' | 'local_storage' | 'none' = envApiKey
  ? 'build_env'
  : (customConfig?.apiKey ? 'local_storage' : 'none');

// Final resolved variables (Preserving project defaults for amandita-sabores)
const apiKey = envApiKey || customConfig?.apiKey || '';
const appId = envAppId || customConfig?.appId || '';
const projectId = envProjectId || customConfig?.projectId || TARGET_PROJECT_ID;
const authDomain = envAuthDomain || customConfig?.authDomain || `${TARGET_PROJECT_ID}.firebaseapp.com`;
const storageBucket = envStorageBucket || customConfig?.storageBucket || `${TARGET_PROJECT_ID}.firebasestorage.app`;
const messagingSenderId = envSenderId || customConfig?.messagingSenderId || '';

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

// Only initialize if minimum valid API key is present (minimum 15 characters, not placeholder)
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

    // Try enabling offline cache persistence safely without throwing on tab contention
    if (typeof window !== 'undefined') {
      enableIndexedDbPersistence(dbInstance).catch((err) => {
        // Multi-tab or browser constraint is non-fatal
        console.info('[Firebase] Modo de persistência local:', err.code || err.message);
      });
    }
  } catch (err: unknown) {
    initError = err instanceof Error ? err.message : String(err);
    console.error('[Firebase Init Error]:', initError);
  }
} else {
  console.info('[Firebase] Executando em modo cache local resiliente. Para conectar ao Firestore de produção amandita-sabores, defina VITE_FIREBASE_API_KEY no Vercel ou via painel de status.');
}

export const db = dbInstance;
export const auth = authInstance;

export interface TestFirebaseClientAuthBridge {
  isReady: () => boolean;
  getCurrentUser: () => FirebaseUser | null;
  signInWithCustomToken: (customToken: string) => Promise<FirebaseUser>;
  signOut: () => Promise<void>;
  subscribeToAuthChanges: (callback: (user: FirebaseUser | null) => void) => () => void;
  waitForAuthReady?: () => Promise<void>;
}

let testClientAuthBridge: TestFirebaseClientAuthBridge | null = null;

/**
 * Strictly test-gated hook (active ONLY when DISABLE_AUTO_LISTEN=1 and ALLOW_TEST_FIREBASE_OVERRIDES=1)
 * to validate Custom Token client auth & session recovery end-to-end without touching production Firebase.
 */
export function __setTestFirebaseClientAuthBridge(bridge: TestFirebaseClientAuthBridge | null): void {
  const procEnv = typeof process !== 'undefined' ? process.env : undefined;
  if (!procEnv || procEnv.DISABLE_AUTO_LISTEN !== '1' || procEnv.ALLOW_TEST_FIREBASE_OVERRIDES !== '1') {
    throw new Error('Test Firebase client auth overrides are strictly disabled outside test harness.');
  }
  testClientAuthBridge = bridge;
}

export function isFirebaseReady(): boolean {
  if (testClientAuthBridge) return testClientAuthBridge.isReady();
  return Boolean(app && dbInstance && authInstance);
}

export function isFirebaseAuthAvailable(): boolean {
  if (testClientAuthBridge) return testClientAuthBridge.isReady();
  return Boolean(authInstance);
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
    hasApiKey: Boolean(apiKey && apiKey.trim().length > 10),
    hasAppId: Boolean(appId && appId.trim().length > 5),
    hasProjectId: Boolean(projectId),
    hasAuthDomain: Boolean(authDomain),
    hasStorageBucket: Boolean(storageBucket),
    hasMessagingSenderId: Boolean(messagingSenderId),
    maskedApiKey: maskSecret(apiKey),
    maskedAppId: maskSecret(appId),
    configOrigin,
    buildTime: appBuildTime,
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

// Validate Connection to Firestore with getDocFromServer distinguishing permission vs network vs missing config
export async function testFirestoreConnection(): Promise<{ success: boolean; message: string; details?: string }> {
  if (!dbInstance) {
    if (!hasValidConfig) {
      return {
        success: false,
        message: 'Firebase não inicializado: credenciais ausentes no pacote compilado deste dispositivo.',
        details: 'As variáveis de ambiente VITE_FIREBASE_* não foram detectadas no JavaScript baixado pelo navegador. Realize um Redeploy SEM cache na Vercel ou utilize a configuração direta abaixo.'
      };
    }
    return {
      success: false,
      message: 'Falha na inicialização do Firebase App.',
      details: initError || 'Erro interno na inicialização do SDK Firebase.'
    };
  }

  try {
    await getDocFromServer(doc(dbInstance, 'configs', 'restaurant'));
    return {
      success: true,
      message: 'Servidor Firestore alcançado com sucesso (amandita-sabores).',
      details: 'Conexão ativa e documento de configuração consultado com sucesso.'
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const code = (error as any)?.code || '';

    // If client is offline or network request failed
    if (msg.includes('the client is offline') || msg.includes('network') || msg.includes('unavailable') || code === 'unavailable') {
      const isActuallyOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      return {
        success: false,
        message: isActuallyOffline ? 'Dispositivo desconectado da internet.' : 'Aguardando estabilização da conexão com a nuvem.',
        details: isActuallyOffline
          ? 'O aparelho está sem conexão Wi-Fi ou dados móveis no momento. A sincronização será restabelecida automaticamente assim que o sinal retornar.'
          : 'O aplicativo estava suspenso em segundo plano e está restabelecendo o canal com o Cloud Firestore.'
      };
    }

    // Permission-denied means Google reached the database, but rules in Firebase Console reject operations
    if (code === 'permission-denied' || msg.includes('Missing or insufficient permissions') || msg.includes('permission-denied')) {
      return {
        success: false,
        message: 'Acesso Rejeitado pelas Regras do Firebase (Permission Denied).',
        details: 'O servidor do Google (amandita-sabores) foi alcançado com sucesso, mas as regras ativas no Console do Firebase (aba Rules) estão bloqueando as operações. Publique o conteúdo do arquivo firestore.rules no Console do Firebase para liberar a sincronização.'
      };
    }

    if (code === 'not-found') {
      return {
        success: true,
        message: 'Servidor Firestore alcançado com sucesso (amandita-sabores).',
        details: 'Instância alcançada com sucesso (o documento de teste ainda não foi gravado).'
      };
    }

    return {
      success: false,
      message: `Erro na comunicação com o Firestore: ${code || 'falha'}`,
      details: msg
    };
  }
}

export async function waitForFirebaseAuthStateReady(): Promise<void> {
  if (testClientAuthBridge?.waitForAuthReady) {
    await testClientAuthBridge.waitForAuthReady();
    return;
  }
  if (authInstance && typeof (authInstance as any).authStateReady === 'function') {
    try {
      await (authInstance as any).authStateReady();
    } catch {
      // non-fatal
    }
  }
}

export async function signInWithFirebaseCustomToken(customToken: string): Promise<FirebaseUser> {
  const cleanToken = typeof customToken === 'string' ? customToken.trim() : '';
  if (!cleanToken) {
    throw new Error('Token de autenticação inválido ou vazio.');
  }
  if (testClientAuthBridge) {
    return testClientAuthBridge.signInWithCustomToken(cleanToken);
  }
  if (!authInstance) {
    throw new Error('Firebase Auth não inicializado neste dispositivo.');
  }
  const creds = await signInWithCustomToken(authInstance, cleanToken);
  return creds.user;
}

export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  await waitForFirebaseAuthStateReady();
  const current = getCurrentFirebaseUser();
  if (!current) return null;
  try {
    const token = await current.getIdToken(forceRefresh);
    return token && token.trim() ? token : null;
  } catch {
    return null;
  }
}

export function getCurrentFirebaseUser(): FirebaseUser | null {
  if (testClientAuthBridge) {
    return testClientAuthBridge.getCurrentUser();
  }
  return authInstance?.currentUser || null;
}

export function formatFirebaseAuthError(error: unknown): string {
  if (!error) return 'Erro desconhecido na autenticação.';
  const code = String((error as any)?.code || (error instanceof Error ? error.message : String(error)));

  if (code.includes('invalid-custom-token') || code.includes('custom-token-mismatch')) {
    return 'Token de autenticação inválido ou expirado. Tente entrar novamente.';
  }
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'Nome de login ou senha incorretos.';
  }
  if (code.includes('user-disabled')) {
    return 'Esta conta de usuário foi bloqueada ou desativada pelo administrador.';
  }
  if (code.includes('too-many-requests')) {
    return 'Muitas tentativas consecutivas. Aguarde alguns instantes antes de tentar novamente.';
  }
  if (code.includes('network-request-failed')) {
    return 'Falha de comunicação com o servidor Firebase. Verifique sua conexão de rede.';
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Legacy compatibility stub — Google authentication has been permanently disabled.
 * Never authenticates or opens a Google OAuth popup.
 */
export async function signInWithGoogle(): Promise<FirebaseUser | null> {
  throw new Error('O login com Google foi desativado por segurança. Utilize seu nome de login e senha.');
}

/**
 * Legacy compatibility stub — direct client email/password login has been disabled in favor of
 * server-verified username + password with Firebase Custom Token.
 */
export async function signInWithEmail(_email: string, _pass: string): Promise<FirebaseUser> {
  throw new Error('O login direto por e-mail foi desativado. Utilize seu nome de login e senha.');
}

/**
 * Legacy compatibility stub — direct client user creation has been disabled.
 */
export async function createUserWithEmail(_email: string, _pass: string): Promise<FirebaseUser> {
  throw new Error('A criação direta de conta no cliente foi desativada. Utilize o painel do Administrador.');
}

export async function signOutFirebase(): Promise<void> {
  if (testClientAuthBridge) {
    await testClientAuthBridge.signOut();
    return;
  }
  if (authInstance) {
    await fbSignOut(authInstance);
  }
}

export function subscribeToAuthChanges(callback: (user: FirebaseUser | null) => void) {
  if (testClientAuthBridge) {
    return testClientAuthBridge.subscribeToAuthChanges(callback);
  }
  if (!authInstance) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(authInstance, callback);
}

