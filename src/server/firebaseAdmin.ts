import { createPrivateKey } from 'crypto';
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

function unwrapQuotes(value: string): string {
  let current = value.replace(/^\uFEFF/, '').trim();
  for (let i = 0; i < 3; i++) {
    if (current.startsWith('"') && current.endsWith('"')) {
      try {
        const parsed = JSON.parse(current);
        if (typeof parsed === 'string') {
          current = parsed.trim();
          continue;
        }
      } catch {
        // Fall through to simple quote stripping
      }
      current = current.slice(1, -1).trim();
      continue;
    }
    if (current.startsWith("'") && current.endsWith("'")) {
      current = current.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return current;
}

function canonicalizePem(text: string): string {
  const pemMatch = text.match(
    /-{4,5}\s*BEGIN\s+([A-Z0-9 ]+?)\s*-{4,5}([\s\S]*?)-{4,5}\s*END\s+([A-Z0-9 ]+?)\s*-{4,5}/
  );
  if (!pemMatch) {
    return text;
  }

  const beginLabel = pemMatch[1].replace(/\s+/g, ' ').trim();
  const endLabel = pemMatch[3].replace(/\s+/g, ' ').trim();
  let body = pemMatch[2];

  // Remove any leftover escaped line breaks (\n, \r, \\n, \\r) and all whitespace inside the base64 body
  body = body.replace(/\\+[rn]/g, '');
  body = body.replace(/[\s\u00A0\uFEFF]+/g, '');
  body = body.replace(/[\\'"]/g, '');

  if (!body) {
    return text;
  }

  // Fix missing base64 '=' padding if slightly trimmed
  const mod4 = body.length % 4;
  if (mod4 === 2) body += '==';
  else if (mod4 === 3) body += '=';

  const wrappedBody = body.match(/.{1,64}/g)?.join('\n') || body;
  return `-----BEGIN ${beginLabel}-----\n${wrappedBody}\n-----END ${endLabel}-----\n`;
}

export function normalizePrivateKey(rawKey: string): string {
  if (!rawKey) return '';
  let current = unwrapQuotes(rawKey);

  // Support URL-encoded PEM strings if pasted from an encoded query/env source
  if (!current.includes('PRIVATE KEY') && current.includes('%20') && current.includes('PRIVATE%20KEY')) {
    try {
      current = decodeURIComponent(current);
    } catch {
      // ignore invalid URI encoding
    }
  } else if (current.includes('-----BEGIN') && /%[0-9A-Fa-f]{2}/.test(current)) {
    try {
      current = decodeURIComponent(current);
    } catch {
      // ignore
    }
  }

  // Convert escaped newlines (including double-escaped \\n or \\r\\n) into actual newlines
  current = current
    .replace(/\\+r\\+n/g, '\n')
    .replace(/\\+n/g, '\n')
    .replace(/\\+r/g, '\n')
    .replace(/\r\n?/g, '\n')
    .trim();

  // Support base64-encoded PEM passed in FIREBASE_PRIVATE_KEY or private_key
  if (!current.includes('PRIVATE KEY')) {
    const compact = current.replace(/\s+/g, '');
    if (compact.length > 64 && /^[A-Za-z0-9+/=_-]+$/.test(compact)) {
      try {
        const normalizedB64 = compact.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(normalizedB64, 'base64').toString('utf8').trim();
        if (decoded.includes('PRIVATE KEY')) {
          current = decoded
            .replace(/\\+r\\+n/g, '\n')
            .replace(/\\+n/g, '\n')
            .replace(/\\+r/g, '\n')
            .replace(/\r\n?/g, '\n')
            .trim();
        }
      } catch {
        // Ignore base64 decode failure
      }
    }
  }

  const canonical = canonicalizePem(current);
  try {
    createPrivateKey(canonical);
    return canonical;
  } catch {
    // Attempt DER recovery when PEM headers are mismatched (e.g. PKCS#1 key labeled as PRIVATE KEY)
    const pemMatch = canonical.match(/-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/);
    const b64 = (pemMatch ? pemMatch[1] : canonical).replace(/[^A-Za-z0-9+/=]/g, '');
    if (b64.length >= 64) {
      try {
        const derBuf = Buffer.from(b64, 'base64');
        for (const keyType of ['pkcs8', 'pkcs1', 'sec1'] as const) {
          try {
            const keyObj = createPrivateKey({ key: derBuf, format: 'der', type: keyType });
            return keyObj.export({ type: 'pkcs8', format: 'pem' }).toString();
          } catch {
            // Try next DER private key type
          }
        }
      } catch {
        // Ignore DER decode failure
      }
    }
    return canonical;
  }
}

function validatePrivateKeyParseable(pemKey: string): string | null {
  try {
    createPrivateKey(pemKey);
    return null;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const candidates = [raw];
  if (raw.includes('\\"') && !raw.startsWith('{"')) {
    candidates.push(raw.replace(/\\"/g, '"'));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'string') {
        const inner = JSON.parse(parsed);
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          return inner as Record<string, unknown>;
        }
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fallback for multi-line private_key pasted with literal unescaped newlines inside JSON string
      try {
        const sanitized = candidate.replace(
          /"private_key"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/,
          (_match, keyBody: string) => `"private_key":"${keyBody.replace(/\r\n|\r|\n/g, '\\n')}"`
        );
        const parsed = JSON.parse(sanitized);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Continue to next candidate
      }
    }
  }
  return null;
}

function parseServiceAccountFromEnv(rawInput: string): ParsedServiceAccountResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { serviceAccount: null, projectIdFromAccount: '', parseError: null };
  }

  const unwrapped = unwrapQuotes(trimmed);
  let parsed = unwrapped.startsWith('{') ? tryParseJsonObject(unwrapped) : null;

  // Optional base64-encoded service account JSON support
  if (!parsed && !unwrapped.startsWith('{') && /^[A-Za-z0-9+/=_-]+$/.test(unwrapped)) {
    try {
      const normalizedB64 = unwrapped.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = Buffer.from(normalizedB64, 'base64').toString('utf8').trim();
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
      const candidates: Array<{ source: string; account: ServiceAccount }> = [];

      if (parsedAccount.serviceAccount) {
        candidates.push({
          source: 'FIREBASE_SERVICE_ACCOUNT',
          account: {
            ...parsedAccount.serviceAccount,
            projectId: parsedAccount.serviceAccount.projectId || projectId,
          },
        });
      }
      if (rawClientEmail && rawPrivateKey) {
        const privateKey = normalizePrivateKey(rawPrivateKey);
        if (privateKey && privateKey.includes('PRIVATE KEY')) {
          candidates.push({
            source: 'FIREBASE_PRIVATE_KEY',
            account: {
              projectId,
              clientEmail: rawClientEmail,
              privateKey,
            },
          });
        } else if (!adminError) {
          adminError = 'Variável FIREBASE_PRIVATE_KEY inválida ou incompleta.';
        }
      }

      for (const candidate of candidates) {
        const keyPem = candidate.account.privateKey || '';
        const keyErr = validatePrivateKeyParseable(keyPem);
        if (keyErr) {
          adminError = `Falha ao validar private key (${candidate.source}): ${keyErr}`;
          continue;
        }
        credential = cert(candidate.account);
        adminError = null;
        break;
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
