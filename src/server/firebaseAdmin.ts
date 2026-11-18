import {
  initializeApp as initAdminApp,
  cert,
  getApps as getAdminApps,
  type App as AdminApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';

export interface FirebaseAdminInstances {
  projectId: string;
  adminApp: AdminApp | null;
  adminDb: AdminFirestore | null;
  adminAuth: AdminAuth | null;
  hasAdminSdk: boolean;
  adminConfigured: boolean;
  adminError: string | null;
}

export interface FirebaseClientConfigStatus {
  configured: boolean;
  clientSdkInitialized: false;
  projectId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  hasApiKey: boolean;
  hasAppId: boolean;
  hasAuthDomain: boolean;
  hasStorageBucket: boolean;
  hasMessagingSenderId: boolean;
}

interface ParsedServiceAccountResult {
  serviceAccount: ServiceAccount | null;
  projectIdFromAccount: string;
  parseError: string | null;
}

function normalizePrivateKey(rawKey: string): string {
  return rawKey
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fallback for multi-line private_key pasted with literal unescaped newlines inside JSON string
    try {
      const sanitized = raw.replace(
        /"private_key"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/,
        (_match, keyBody: string) => `"private_key":"${keyBody.replace(/\r?\n/g, '\\n')}"`
      );
      const parsed = JSON.parse(sanitized);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function parseServiceAccountFromEnv(rawInput: string): ParsedServiceAccountResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { serviceAccount: null, projectIdFromAccount: '', parseError: null };
  }

  const unwrapped =
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && !trimmed.startsWith('{"'))
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  let parsed = unwrapped.startsWith('{') ? tryParseJsonObject(unwrapped) : null;

  // Optional base64-encoded service account JSON support
  if (!parsed && !unwrapped.startsWith('{') && /^[A-Za-z0-9+/=_-]+$/.test(unwrapped)) {
    try {
      const decoded = Buffer.from(unwrapped, 'base64').toString('utf8').trim();
      if (decoded.startsWith('{')) {
        parsed = tryParseJsonObject(decoded);
      }
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    return {
      serviceAccount: null,
      projectIdFromAccount: '',
      parseError: 'Credencial FIREBASE_SERVICE_ACCOUNT inválida: JSON malformado.',
    };
  }

  const rawEmail = typeof parsed.client_email === 'string'
    ? parsed.client_email
    : typeof parsed.clientEmail === 'string'
      ? parsed.clientEmail
      : '';
  const rawPrivateKey = typeof parsed.private_key === 'string'
    ? parsed.private_key
    : typeof parsed.privateKey === 'string'
      ? parsed.privateKey
      : '';
  const rawProjectId = typeof parsed.project_id === 'string'
    ? parsed.project_id
    : typeof parsed.projectId === 'string'
      ? parsed.projectId
      : '';

  const clientEmail = rawEmail.trim();
  const privateKey = normalizePrivateKey(rawPrivateKey);
  const projectIdFromAccount = rawProjectId.trim();

  if (!clientEmail || !privateKey || !privateKey.includes('PRIVATE KEY')) {
    return {
      serviceAccount: null,
      projectIdFromAccount,
      parseError: 'Credencial FIREBASE_SERVICE_ACCOUNT incompleta: client_email ou private_key ausente.',
    };
  }

  return {
    serviceAccount: {
      ...(projectIdFromAccount ? { projectId: projectIdFromAccount } : {}),
      clientEmail,
      privateKey,
    },
    projectIdFromAccount,
    parseError: null,
  };
}

let cachedAdminInstances: FirebaseAdminInstances | null = null;

export function getFirebaseAdminInstances(): FirebaseAdminInstances {
  if (cachedAdminInstances) {
    return cachedAdminInstances;
  }

  const envProjectId = (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const rawServiceAccount = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const rawClientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const rawPrivateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();

  const parsedAccount = parseServiceAccountFromEnv(rawServiceAccount);
  const adminConfigured = Boolean(rawServiceAccount || (rawClientEmail && rawPrivateKey));

  let adminError: string | null = parsedAccount.parseError;
  if (adminError) {
    console.warn('[Server Admin]', adminError);
  }

  const projectId = envProjectId || parsedAccount.projectIdFromAccount || 'amandita-sabores';

  let adminApp: AdminApp | null = null;
  let adminDb: AdminFirestore | null = null;
  let adminAuth: AdminAuth | null = null;

  try {
    const existingAdminApps = getAdminApps();
    if (existingAdminApps.length > 0) {
      adminApp = existingAdminApps.find((app) => app.name === 'server-admin') || existingAdminApps[0];
      adminDb = getAdminFirestore(adminApp);
      adminAuth = getAdminAuth(adminApp);
      adminError = null;
    } else {
      let credential = null;
      if (parsedAccount.serviceAccount) {
        credential = cert({
          ...parsedAccount.serviceAccount,
          projectId: parsedAccount.serviceAccount.projectId || projectId,
        });
      } else if (rawClientEmail && rawPrivateKey) {
        const privateKey = normalizePrivateKey(rawPrivateKey);
        if (privateKey && privateKey.includes('PRIVATE KEY')) {
          credential = cert({
            projectId,
            clientEmail: rawClientEmail,
            privateKey,
          });
        } else {
          adminError = 'Variável FIREBASE_PRIVATE_KEY inválida ou incompleta.';
        }
      }

      if (credential) {
        adminApp = initAdminApp({ credential, projectId }, 'server-admin');
        adminDb = getAdminFirestore(adminApp);
        adminAuth = getAdminAuth(adminApp);
        adminError = null;
        console.log('[Server Firebase] Firebase Admin SDK inicializado com credenciais administrativas seguras.');
      }
    }
  } catch (adminErr) {
    adminApp = null;
    adminDb = null;
    adminAuth = null;
    adminError = adminErr instanceof Error ? adminErr.message : String(adminErr);
    console.warn('[Server Firebase] Falha ao inicializar Admin SDK:', adminError);
  }

  cachedAdminInstances = {
    projectId,
    adminApp,
    adminDb,
    adminAuth,
    hasAdminSdk: Boolean(adminDb && adminAuth),
    adminConfigured,
    adminError,
  };

  return cachedAdminInstances;
}

export function getFirebaseClientConfigStatus(resolvedProjectId?: string): FirebaseClientConfigStatus {
  const envProjectId = (process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim();
  const projectId = resolvedProjectId || envProjectId || 'amandita-sabores';
  const apiKey = (process.env.VITE_FIREBASE_API_KEY || '').trim();
  const appId = (process.env.VITE_FIREBASE_APP_ID || '').trim();
  const authDomain = (process.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`).trim();
  const storageBucket = (process.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`).trim();
  const messagingSenderId = (process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim();

  const hasApiKey = Boolean(apiKey && apiKey.length > 10 && !apiKey.includes('SUA_'));
  const hasAppId = Boolean(appId && appId.length > 5);

  return {
    configured: hasApiKey,
    clientSdkInitialized: false,
    projectId,
    apiKey,
    authDomain,
    storageBucket,
    messagingSenderId,
    appId,
    hasApiKey,
    hasAppId,
    hasAuthDomain: Boolean(process.env.VITE_FIREBASE_AUTH_DOMAIN?.trim()),
    hasStorageBucket: Boolean(process.env.VITE_FIREBASE_STORAGE_BUCKET?.trim()),
    hasMessagingSenderId: Boolean(messagingSenderId),
  };
}
