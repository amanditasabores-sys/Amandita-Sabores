import { initializeApp as initClientApp, getApps as getClientApps, getApp as getClientApp, type FirebaseApp } from 'firebase/app';
import { getFirestore as getClientFirestore, type Firestore as ClientFirestore } from 'firebase/firestore';
import { initializeApp as initAdminApp, cert, getApps as getAdminApps, type App as AdminApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';

export interface FirebaseServerInstances {
  projectId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  adminApp: AdminApp | null;
  adminDb: AdminFirestore | null;
  adminAuth: AdminAuth | null;
  clientApp: FirebaseApp | null;
  clientDb: ClientFirestore | null;
  hasAdminSdk: boolean;
  hasClientSdk: boolean;
}

interface ParsedServiceAccountResult {
  serviceAccount: ServiceAccount | null;
  projectIdFromAccount: string;
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
    return { serviceAccount: null, projectIdFromAccount: '' };
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
    return { serviceAccount: null, projectIdFromAccount: '' };
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
    return { serviceAccount: null, projectIdFromAccount };
  }

  return {
    serviceAccount: {
      ...(projectIdFromAccount ? { projectId: projectIdFromAccount } : {}),
      clientEmail,
      privateKey,
    },
    projectIdFromAccount,
  };
}

let cachedInstances: FirebaseServerInstances | null = null;

export function getFirebaseServerInstances(): FirebaseServerInstances {
  if (cachedInstances) {
    return cachedInstances;
  }

  const envProjectId = (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const rawServiceAccount = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const parsedAccount = parseServiceAccountFromEnv(rawServiceAccount);

  if (rawServiceAccount && !parsedAccount.serviceAccount) {
    console.warn('[Server Admin] Credencial FIREBASE_SERVICE_ACCOUNT inválida ou incompleta.');
  }

  const projectId = envProjectId || parsedAccount.projectIdFromAccount || 'amandita-sabores';
  const apiKey = (process.env.VITE_FIREBASE_API_KEY || '').trim();
  const authDomain = (process.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`).trim();
  const storageBucket = (process.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`).trim();
  const messagingSenderId = (process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim();
  const appId = (process.env.VITE_FIREBASE_APP_ID || '').trim();

  let adminApp: AdminApp | null = null;
  let adminDb: AdminFirestore | null = null;
  let adminAuth: AdminAuth | null = null;

  try {
    const existingAdminApps = getAdminApps();
    if (existingAdminApps.length > 0) {
      adminApp = existingAdminApps.find((app) => app.name === 'server-admin') || existingAdminApps[0];
      adminDb = getAdminFirestore(adminApp);
      adminAuth = getAdminAuth(adminApp);
    } else {
      let credential = null;
      if (parsedAccount.serviceAccount) {
        credential = cert({
          ...parsedAccount.serviceAccount,
          projectId: parsedAccount.serviceAccount.projectId || projectId,
        });
      } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL.trim();
        const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
        if (clientEmail && privateKey && privateKey.includes('PRIVATE KEY')) {
          credential = cert({
            projectId,
            clientEmail,
            privateKey,
          });
        }
      }

      if (credential) {
        adminApp = initAdminApp({ credential, projectId }, 'server-admin');
        adminDb = getAdminFirestore(adminApp);
        adminAuth = getAdminAuth(adminApp);
        console.log('[Server Firebase] Firebase Admin SDK inicializado com credenciais administrativas seguras.');
      }
    }
  } catch (adminErr) {
    adminApp = null;
    adminDb = null;
    adminAuth = null;
    const errMsg = adminErr instanceof Error ? adminErr.message : String(adminErr);
    console.warn('[Server Firebase] Admin SDK indisponível:', errMsg);
  }

  let clientApp: FirebaseApp | null = null;
  let clientDb: ClientFirestore | null = null;

  if (apiKey) {
    try {
      const existingClientApps = getClientApps();
      clientApp = existingClientApps.length > 0
        ? (existingClientApps.find((app) => app.name === 'server-client') || getClientApp())
        : initClientApp(
            {
              apiKey,
              authDomain,
              projectId,
              storageBucket,
              messagingSenderId,
              appId,
            },
            'server-client'
          );
      clientDb = getClientFirestore(clientApp);
    } catch (clientErr) {
      clientApp = null;
      clientDb = null;
      const errMsg = clientErr instanceof Error ? clientErr.message : String(clientErr);
      console.warn('[Server Firebase] Client SDK indisponível:', errMsg);
    }
  }

  cachedInstances = {
    projectId,
    apiKey,
    authDomain,
    storageBucket,
    messagingSenderId,
    appId,
    adminApp,
    adminDb,
    adminAuth,
    clientApp,
    clientDb,
    hasAdminSdk: Boolean(adminDb),
    hasClientSdk: Boolean(clientDb),
  };

  return cachedInstances;
}
