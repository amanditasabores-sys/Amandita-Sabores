import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applicationDefault,
  getApps as getAdminApps,
  initializeApp as initAdminApp,
  type App as AdminApp,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminInstances } from '../src/server/firebaseAdmin.js';
import {
  OFFICIAL_APP_MODULES,
  validateAndNormalizePhone,
  validateAndNormalizeUsername,
} from '../src/server/authCrypto.js';

// ============================================================================
// STRICTLY READ-ONLY TYPES (Compile-time guarantee: zero write methods exposed)
// ============================================================================
export interface ReadOnlyAuthUserRecord {
  uid: string;
  displayName?: string;
  email?: string;
  disabled?: boolean;
  customClaims?: Record<string, unknown>;
  providerData?: Array<{ providerId?: string }>;
  metadata?: {
    creationTime?: string;
    lastSignInTime?: string;
  };
}

export interface ReadOnlyAuthClient {
  listUsers(
    maxResults?: number,
    pageToken?: string
  ): Promise<{
    users: ReadOnlyAuthUserRecord[];
    pageToken?: string;
  }>;
}

export interface ReadOnlyDocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface ReadOnlyQuerySnapshot {
  docs: ReadOnlyDocSnapshot[];
}

export interface ReadOnlyFirestoreClient {
  collection(name: string): {
    get(): Promise<ReadOnlyQuerySnapshot>;
    doc(id: string): {
      get(): Promise<ReadOnlyDocSnapshot>;
    };
  };
}

export interface ReadOnlyAuditDeps {
  adminAuth: ReadOnlyAuthClient;
  adminDb: ReadOnlyFirestoreClient;
  projectId: string;
  now?: Date;
}

export interface OperationalUidReferences {
  uid: string;
  ordersAsDriverCount: number;
  deliveryShiftsCount: number;
  accessLogsCount: number;
  totalReferences: number;
  mustPreserveUid: boolean;
}

export interface AuditedAuthOnlyUser {
  uid: string;
  displayName: string | null;
  maskedEmail: string | null;
  disabled: boolean;
  providerIds: string[];
  customClaimRole: string | null;
  creationTime: string | null;
  lastSignInTime: string | null;
  operationalRefs: OperationalUidReferences;
}

export interface AuditedAccountRecord {
  uid: string;
  docId: string;
  idField: string | null;
  firebaseUidField: string | null;
  name: string | null;
  rawUsername: string | null;
  normalizedUsername: string | null;
  usernameValid: boolean;
  phone: string | null;
  phoneValid: boolean;
  rawRole: string | null;
  normalizedRole: string | null;
  roleIsOfficialUppercase: boolean;
  rawStatus: string | null;
  normalizedStatus: string;
  allowedModules: string[];
  deliveryPermissions: Record<string, boolean> | null;
  authProvider: string | null;
  provisioningState: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  inFirebaseAuth: boolean;
  authDisabled: boolean | null;
  authProviderIds: string[];
  authCustomClaimRole: string | null;
  authMaskedEmail: string | null;
  hasActiveUsernameMapping: boolean;
  usernameMappingUid: string | null;
  hasStaffCredentialDoc: boolean;
  hasScryptCredential: boolean;
  credentialProvisioningState: string | null;
  credentialFailedAttempts: number;
  credentialTemporarilyLocked: boolean;
  readyForNewLogin: boolean;
  issues: string[];
  operationalRefs: OperationalUidReferences;
}

export interface AuditedAuthSetupState {
  exists: boolean;
  initialized: boolean;
  status: string | null;
  stage: string | null;
  initialAdminUid: string | null;
  recoveredAdminUid: string | null;
  username: string | null;
  completedAt: string | null;
  lastRecoveredAt: string | null;
  updatedAt: string | null;
}

export interface ReadOnlyAuditReport {
  executed: true;
  readOnlyVerified: true;
  projectId: string;
  auditedAt: string;
  summary: {
    firebaseAuthUsers: number;
    firestoreUsers: number;
    authUsernames: number;
    staffCredentials: number;
    authSetupExists: boolean;
    authSetupInitialized: boolean;
    matchedAuthAndFirestore: number;
    firestoreOnlyOrphans: number;
    authOnlyOrphans: number;
    orphanedUsernames: number;
    orphanedCredentials: number;
    duplicateUsernames: number;
    invalidUsernames: number;
    missingPhoneUsers: number;
    nonNormalizedRoles: number;
    statusAuthMismatches: number;
    uidFieldMismatches: number;
    activeAdministrators: number;
    inactiveAdministrators: number;
    administratorsReadyForNewLogin: number;
    legacyAccountsMissingNewAuth: number;
    accountsReadyForNewLogin: number;
    lockoutRiskIfDeployedNow: boolean;
  };
  authSetup: AuditedAuthSetupState;
  administrators: {
    active: AuditedAccountRecord[];
    inactive: AuditedAccountRecord[];
    readyForNewLogin: string[];
    missingNewAuth: string[];
    lockoutRiskIfDeployedNow: boolean;
  };
  accounts: AuditedAccountRecord[];
  anomalies: {
    firestoreOnlyOrphans: string[];
    authOnlyOrphans: AuditedAuthOnlyUser[];
    orphanedUsernames: Array<{
      username: string;
      uid: string | null;
      status: string | null;
      reason: string;
    }>;
    orphanedCredentials: Array<{
      uid: string;
      hashAlgo: string;
      provisioningState: string | null;
      reason: string;
    }>;
    duplicateUsernames: Array<{
      normalizedUsername: string;
      uids: string[];
    }>;
    invalidUsernames: Array<{
      uid: string;
      rawUsername: string | null;
      reason: string;
    }>;
    missingPhoneUsers: string[];
    nonNormalizedRoles: Array<{
      uid: string;
      rawRole: string | null;
      normalizedRole: string | null;
    }>;
    statusAuthMismatches: Array<{
      uid: string;
      firestoreStatus: string;
      authDisabled: boolean;
    }>;
    uidFieldMismatches: Array<{
      docId: string;
      idField: string | null;
      firebaseUidField: string | null;
    }>;
    legacyAccountsMissingNewAuth: Array<{
      uid: string;
      username: string | null;
      role: string | null;
      missing: string[];
    }>;
    unmappedOperationalUids: OperationalUidReferences[];
  };
  operationalPreservation: {
    scannedCollections: {
      orders: { readable: boolean; scannedDocs: number };
      delivery_shifts: { readable: boolean; scannedDocs: number };
      access_logs: { readable: boolean; scannedDocs: number };
    };
    uidsWithOperationalHistory: OperationalUidReferences[];
  };
  localStorageNote: string;
}

const OFFICIAL_ROLES = new Set([
  'ADMINISTRADOR',
  'GERENTE',
  'CAIXA',
  'COZINHA',
  'ENTREGADOR',
  'ATENDENTE',
]);

const ROLE_ALIASES: Record<string, string> = {
  ADMIN: 'ADMINISTRADOR',
  ADMINISTRADOR: 'ADMINISTRADOR',
  GERENTE: 'GERENTE',
  CAIXA: 'CAIXA',
  COZINHA: 'COZINHA',
  ENTREGADOR: 'ENTREGADOR',
  ATENDENTE: 'ATENDENTE',
};

const ALLOWED_CLI_FLAGS = new Set(['--json', '--help', '-h']);

const FORBIDDEN_ARG_PATTERNS = [
  /private[_-]?key/i,
  /service[_-]?account/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /token/i,
  /credential/i,
  /api[_-]?key/i,
  /recovery[_-]?key/i,
  /-----BEGIN/i,
  /AIza[0-9A-Za-z_-]{10,}/,
  /^\s*\{.*"client_email".*\}\s*$/i,
];

export function assertSafeCliArgs(argv: string[]): {
  ok: boolean;
  jsonMode: boolean;
  helpMode: boolean;
  error?: string;
} {
  let jsonMode = false;
  let helpMode = false;

  for (const arg of argv) {
    for (const pattern of FORBIDDEN_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        return {
          ok: false,
          jsonMode: false,
          helpMode: false,
          error:
            'Segurança: este script NÃO aceita credenciais, chaves privadas, tokens ou senhas por linha de comando. Utilize apenas variáveis de ambiente seguras no servidor/estação autorizada.',
        };
      }
    }

    if (arg === '--json') {
      jsonMode = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      helpMode = true;
      continue;
    }
    if (!ALLOWED_CLI_FLAGS.has(arg)) {
      return {
        ok: false,
        jsonMode: false,
        helpMode: false,
        error: `Argumento não permitido: "${arg}". Opções aceitas: --json, --help.`,
      };
    }
  }

  return { ok: true, jsonMode, helpMode };
}

function maskEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0) return null;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (!domain) return null;
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}

function normalizeRoleCandidate(raw: unknown): {
  rawRole: string | null;
  normalizedRole: string | null;
  isOfficialUppercase: boolean;
} {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { rawRole: null, normalizedRole: null, isOfficialUppercase: false };
  }
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const mapped = ROLE_ALIASES[upper] || upper;
  return {
    rawRole: trimmed,
    normalizedRole: mapped,
    isOfficialUppercase: OFFICIAL_ROLES.has(trimmed),
  };
}

function normalizeStatusCandidate(raw: unknown): {
  rawStatus: string | null;
  normalizedStatus: string;
} {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { rawStatus: null, normalizedStatus: 'ATIVO' };
  }
  const trimmed = raw.trim();
  return { rawStatus: trimmed, normalizedStatus: trimmed.toUpperCase() };
}

function sanitizeDeliveryPermissions(raw: unknown): Record<string, boolean> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeAllowedModules(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const validSet = new Set<string>(OFFICIAL_APP_MODULES);
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      const cleaned = item.trim();
      if (validSet.has(cleaned) || cleaned.length <= 40) {
        out.push(cleaned);
      }
    }
  }
  return Array.from(new Set(out));
}

function isFutureIso(value: unknown, nowMs: number): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > nowMs;
}

function extractDriverUidFromOrder(data: Record<string, unknown>): string | null {
  const dp = data.deliveryPerson;
  if (dp && typeof dp === 'object' && !Array.isArray(dp)) {
    const id = (dp as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) {
      return id.trim();
    }
  }
  if (typeof data.driverId === 'string' && data.driverId.trim()) {
    return data.driverId.trim();
  }
  return null;
}

function extractShiftUserIds(data: Record<string, unknown>): string[] {
  const uids: string[] = [];
  for (const key of ['openedBy', 'closedBy', 'reopenedBy'] as const) {
    const actor = data[key];
    if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
      const uid = (actor as Record<string, unknown>).userId;
      if (typeof uid === 'string' && uid.trim()) {
        uids.push(uid.trim());
      }
    }
  }
  return uids;
}

function emptyOperationalRef(uid: string): OperationalUidReferences {
  return {
    uid,
    ordersAsDriverCount: 0,
    deliveryShiftsCount: 0,
    accessLogsCount: 0,
    totalReferences: 0,
    mustPreserveUid: false,
  };
}

async function listAllAuthUsersReadOnly(
  adminAuth: ReadOnlyAuthClient
): Promise<ReadOnlyAuthUserRecord[]> {
  const all: ReadOnlyAuthUserRecord[] = [];
  let pageToken: string | undefined = undefined;
  let guard = 0;

  while (guard < 500) {
    guard++;
    const page = await adminAuth.listUsers(1000, pageToken);
    if (Array.isArray(page.users)) {
      all.push(...page.users);
    }
    if (!page.pageToken) {
      break;
    }
    pageToken = page.pageToken;
  }

  return all;
}

export async function runReadOnlyUserAudit(
  deps: ReadOnlyAuditDeps
): Promise<ReadOnlyAuditReport> {
  const now = deps.now || new Date();
  const nowMs = now.getTime();
  const auditedAt = now.toISOString();

  // 1. Read core authentication sources (STRICTLY READ-ONLY)
  const [authUsers, usersSnap, usernamesSnap, credsSnap, setupSnap] = await Promise.all([
    listAllAuthUsersReadOnly(deps.adminAuth),
    deps.adminDb.collection('users').get(),
    deps.adminDb.collection('auth_usernames').get(),
    deps.adminDb.collection('staff_credentials').get(),
    deps.adminDb.collection('configs').doc('auth_setup').get(),
  ]);

  // 2. Read operational collections to map UIDs tied to operational history (non-fatal if empty/restricted)
  const opRefsMap = new Map<string, OperationalUidReferences>();
  const touchOpRef = (uid: string): OperationalUidReferences => {
    const existing = opRefsMap.get(uid);
    if (existing) return existing;
    const created = emptyOperationalRef(uid);
    opRefsMap.set(uid, created);
    return created;
  };

  const scannedCollections = {
    orders: { readable: false, scannedDocs: 0 },
    delivery_shifts: { readable: false, scannedDocs: 0 },
    access_logs: { readable: false, scannedDocs: 0 },
  };

  try {
    const ordersSnap = await deps.adminDb.collection('orders').get();
    scannedCollections.orders = { readable: true, scannedDocs: ordersSnap.docs.length };
    for (const doc of ordersSnap.docs) {
      const data = doc.data() || {};
      const driverUid = extractDriverUidFromOrder(data);
      if (driverUid) {
        const ref = touchOpRef(driverUid);
        ref.ordersAsDriverCount++;
        ref.totalReferences++;
        ref.mustPreserveUid = true;
      }
    }
  } catch {
    scannedCollections.orders.readable = false;
  }

  try {
    const shiftsSnap = await deps.adminDb.collection('delivery_shifts').get();
    scannedCollections.delivery_shifts = { readable: true, scannedDocs: shiftsSnap.docs.length };
    for (const doc of shiftsSnap.docs) {
      const data = doc.data() || {};
      for (const uid of extractShiftUserIds(data)) {
        const ref = touchOpRef(uid);
        ref.deliveryShiftsCount++;
        ref.totalReferences++;
        ref.mustPreserveUid = true;
      }
    }
  } catch {
    scannedCollections.delivery_shifts.readable = false;
  }

  try {
    const logsSnap = await deps.adminDb.collection('access_logs').get();
    scannedCollections.access_logs = { readable: true, scannedDocs: logsSnap.docs.length };
    for (const doc of logsSnap.docs) {
      const data = doc.data() || {};
      if (typeof data.userId === 'string' && data.userId.trim()) {
        const ref = touchOpRef(data.userId.trim());
        ref.accessLogsCount++;
        ref.totalReferences++;
        ref.mustPreserveUid = true;
      }
    }
  } catch {
    scannedCollections.access_logs.readable = false;
  }

  // 3. Index Firebase Auth users by UID
  const authByUid = new Map<string, ReadOnlyAuthUserRecord>();
  for (const u of authUsers) {
    authByUid.set(u.uid, u);
  }

  // 4. Index auth_usernames by docId (username) and by uid
  const usernameDocByName = new Map<
    string,
    { username: string; uid: string | null; status: string | null }
  >();
  const activeUsernamesByUid = new Map<string, string[]>();
  for (const doc of usernamesSnap.docs) {
    const data = doc.data() || {};
    const uid = typeof data.uid === 'string' && data.uid.trim() ? data.uid.trim() : null;
    const status = typeof data.status === 'string' && data.status.trim() ? data.status.trim() : null;
    usernameDocByName.set(doc.id, { username: doc.id, uid, status });
    if (uid && status === 'ACTIVE') {
      const arr = activeUsernamesByUid.get(uid) || [];
      arr.push(doc.id);
      activeUsernamesByUid.set(uid, arr);
    }
  }

  // 5. Index staff_credentials metadata ONLY (NEVER read/store/expose passwordHash or passwordSalt)
  const credMetaByUid = new Map<
    string,
    {
      uid: string;
      hasPasswordHash: boolean;
      hasPasswordSalt: boolean;
      hashAlgo: 'scrypt' | 'OTHER' | 'MISSING';
      provisioningState: string | null;
      failedAttempts: number;
      isTemporarilyLocked: boolean;
    }
  >();
  for (const doc of credsSnap.docs) {
    const data = doc.data() || {};
    const hasPasswordHash =
      typeof data.passwordHash === 'string' && data.passwordHash.trim().length > 0;
    const hasPasswordSalt =
      typeof data.passwordSalt === 'string' && data.passwordSalt.trim().length > 0;
    const rawAlgo = typeof data.hashAlgo === 'string' ? data.hashAlgo.trim().toLowerCase() : '';
    const hashAlgo: 'scrypt' | 'OTHER' | 'MISSING' =
      rawAlgo === 'scrypt' ? 'scrypt' : rawAlgo ? 'OTHER' : 'MISSING';
    const provisioningState =
      typeof data.provisioningState === 'string' ? data.provisioningState.trim() : null;
    const failedAttempts =
      typeof data.failedAttempts === 'number' && Number.isFinite(data.failedAttempts)
        ? data.failedAttempts
        : 0;
    const isTemporarilyLocked = isFutureIso(data.lockedUntil, nowMs);

    credMetaByUid.set(doc.id, {
      uid: doc.id,
      hasPasswordHash,
      hasPasswordSalt,
      hashAlgo,
      provisioningState,
      failedAttempts,
      isTemporarilyLocked,
    });
  }

  // 6. Inspect configs/auth_setup
  const setupRaw = setupSnap.exists ? setupSnap.data() || {} : {};
  const authSetup: AuditedAuthSetupState = {
    exists: setupSnap.exists,
    initialized: setupRaw.initialized === true && setupRaw.status === 'COMPLETED',
    status: typeof setupRaw.status === 'string' ? setupRaw.status : null,
    stage: typeof setupRaw.stage === 'string' ? setupRaw.stage : null,
    initialAdminUid: typeof setupRaw.initialAdminUid === 'string' ? setupRaw.initialAdminUid : null,
    recoveredAdminUid:
      typeof setupRaw.recoveredAdminUid === 'string' ? setupRaw.recoveredAdminUid : null,
    username: typeof setupRaw.username === 'string' ? setupRaw.username : null,
    completedAt: typeof setupRaw.completedAt === 'string' ? setupRaw.completedAt : null,
    lastRecoveredAt: typeof setupRaw.lastRecoveredAt === 'string' ? setupRaw.lastRecoveredAt : null,
    updatedAt: typeof setupRaw.updatedAt === 'string' ? setupRaw.updatedAt : null,
  };

  // 7. Inspect Firestore users and cross-reference
  const firestoreUids = new Set<string>();
  const usernameToUids = new Map<string, string[]>();
  const accounts: AuditedAccountRecord[] = [];
  const firestoreOnlyOrphans: string[] = [];
  const invalidUsernames: Array<{ uid: string; rawUsername: string | null; reason: string }> = [];
  const missingPhoneUsers: string[] = [];
  const nonNormalizedRoles: Array<{
    uid: string;
    rawRole: string | null;
    normalizedRole: string | null;
  }> = [];
  const statusAuthMismatches: Array<{
    uid: string;
    firestoreStatus: string;
    authDisabled: boolean;
  }> = [];
  const uidFieldMismatches: Array<{
    docId: string;
    idField: string | null;
    firebaseUidField: string | null;
  }> = [];
  const legacyAccountsMissingNewAuth: Array<{
    uid: string;
    username: string | null;
    role: string | null;
    missing: string[];
  }> = [];

  for (const doc of usersSnap.docs) {
    const uid = doc.id;
    firestoreUids.add(uid);
    const data = doc.data() || {};

    const idField = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : null;
    const firebaseUidField =
      typeof data.firebaseUid === 'string' && data.firebaseUid.trim()
        ? data.firebaseUid.trim()
        : null;
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null;
    const rawUsername =
      typeof data.username === 'string' && data.username.trim() ? data.username.trim() : null;

    const usernameCheck = rawUsername
      ? validateAndNormalizeUsername(rawUsername)
      : { valid: false, error: 'Nome de login ausente.' };
    const normalizedUsername =
      usernameCheck.valid && usernameCheck.value ? usernameCheck.value : null;

    const rawPhone = typeof data.phone === 'string' && data.phone.trim() ? data.phone.trim() : null;
    const phoneCheck = rawPhone
      ? validateAndNormalizePhone(rawPhone)
      : { valid: false, error: 'Telefone ausente.' };

    const roleInfo = normalizeRoleCandidate(data.role);
    const statusInfo = normalizeStatusCandidate(data.status);

    const authUser = authByUid.get(uid);
    const inFirebaseAuth = Boolean(authUser);
    const authDisabled = authUser ? Boolean(authUser.disabled) : null;
    const authProviderIds = authUser?.providerData
      ? Array.from(
          new Set(
            authUser.providerData
              .map((p) => (typeof p?.providerId === 'string' ? p.providerId : ''))
              .filter(Boolean)
          )
        )
      : [];
    const authCustomClaimRole =
      typeof authUser?.customClaims?.role === 'string' ? authUser.customClaims.role : null;
    const authMaskedEmail = maskEmail(authUser?.email);

    const usernameMapping = normalizedUsername ? usernameDocByName.get(normalizedUsername) : undefined;
    const hasActiveUsernameMapping = Boolean(
      usernameMapping && usernameMapping.status === 'ACTIVE' && usernameMapping.uid === uid
    );

    const credMeta = credMetaByUid.get(uid);
    const hasStaffCredentialDoc = Boolean(credMeta);
    const hasScryptCredential = Boolean(
      credMeta &&
        credMeta.hashAlgo === 'scrypt' &&
        credMeta.hasPasswordHash &&
        credMeta.hasPasswordSalt &&
        (!credMeta.provisioningState || credMeta.provisioningState === 'ACTIVE')
    );

    const provisioningState =
      typeof data.provisioningState === 'string' ? data.provisioningState.trim() : null;
    const isProvisioningActive = !provisioningState || provisioningState === 'ACTIVE';

    const issues: string[] = [];
    const missingNewAuth: string[] = [];

    if (!inFirebaseAuth) {
      firestoreOnlyOrphans.push(uid);
      issues.push('MISSING_FIREBASE_AUTH_USER');
      missingNewAuth.push('firebase_auth_uid');
    }

    if (!usernameCheck.valid || !normalizedUsername) {
      invalidUsernames.push({
        uid,
        rawUsername,
        reason: usernameCheck.error || 'Nome de login inválido.',
      });
      issues.push('INVALID_OR_MISSING_USERNAME');
    } else {
      const bucket = usernameToUids.get(normalizedUsername) || [];
      bucket.push(uid);
      usernameToUids.set(normalizedUsername, bucket);
    }

    if (!phoneCheck.valid) {
      missingPhoneUsers.push(uid);
      issues.push('MISSING_OR_INVALID_PHONE');
    }

    if (!roleInfo.isOfficialUppercase) {
      nonNormalizedRoles.push({
        uid,
        rawRole: roleInfo.rawRole,
        normalizedRole: roleInfo.normalizedRole,
      });
      issues.push('NON_NORMALIZED_ROLE');
    }

    if ((idField && idField !== uid) || (firebaseUidField && firebaseUidField !== uid)) {
      uidFieldMismatches.push({ docId: uid, idField, firebaseUidField });
      issues.push('UID_FIELD_MISMATCH');
    }

    if (inFirebaseAuth && authDisabled !== null) {
      const shouldBeDisabled = statusInfo.normalizedStatus !== 'ATIVO';
      if (authDisabled !== shouldBeDisabled) {
        statusAuthMismatches.push({
          uid,
          firestoreStatus: statusInfo.normalizedStatus,
          authDisabled,
        });
        issues.push('STATUS_AUTH_DISABLED_MISMATCH');
      }
    }

    if (!hasActiveUsernameMapping) {
      issues.push('MISSING_AUTH_USERNAME_MAPPING');
      missingNewAuth.push('auth_usernames');
    }

    if (!hasScryptCredential) {
      issues.push('MISSING_SCRYPT_CREDENTIAL');
      missingNewAuth.push('staff_credentials_scrypt');
    }

    if (!isProvisioningActive) {
      issues.push(`PROVISIONING_STATE_${provisioningState}`);
    }

    if (missingNewAuth.length > 0) {
      legacyAccountsMissingNewAuth.push({
        uid,
        username: normalizedUsername || rawUsername,
        role: roleInfo.normalizedRole,
        missing: missingNewAuth,
      });
    }

    const readyForNewLogin =
      inFirebaseAuth &&
      authDisabled === false &&
      statusInfo.normalizedStatus === 'ATIVO' &&
      isProvisioningActive &&
      Boolean(normalizedUsername) &&
      hasActiveUsernameMapping &&
      hasScryptCredential;

    const opRef = opRefsMap.get(uid) || emptyOperationalRef(uid);

    accounts.push({
      uid,
      docId: uid,
      idField,
      firebaseUidField,
      name,
      rawUsername,
      normalizedUsername,
      usernameValid: Boolean(usernameCheck.valid && normalizedUsername),
      phone: phoneCheck.valid && phoneCheck.value ? phoneCheck.value : rawPhone,
      phoneValid: Boolean(phoneCheck.valid),
      rawRole: roleInfo.rawRole,
      normalizedRole: roleInfo.normalizedRole,
      roleIsOfficialUppercase: roleInfo.isOfficialUppercase,
      rawStatus: statusInfo.rawStatus,
      normalizedStatus: statusInfo.normalizedStatus,
      allowedModules: sanitizeAllowedModules(data.allowedModules),
      deliveryPermissions: sanitizeDeliveryPermissions(data.deliveryPermissions),
      authProvider: typeof data.authProvider === 'string' ? data.authProvider : null,
      provisioningState,
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
      lastLoginAt: typeof data.lastLoginAt === 'string' ? data.lastLoginAt : null,
      inFirebaseAuth,
      authDisabled,
      authProviderIds,
      authCustomClaimRole,
      authMaskedEmail,
      hasActiveUsernameMapping,
      usernameMappingUid: usernameMapping?.uid || null,
      hasStaffCredentialDoc,
      hasScryptCredential,
      credentialProvisioningState: credMeta?.provisioningState || null,
      credentialFailedAttempts: credMeta?.failedAttempts || 0,
      credentialTemporarilyLocked: Boolean(credMeta?.isTemporarilyLocked),
      readyForNewLogin,
      issues,
      operationalRefs: opRef,
    });
  }

  // 8. Identify duplicate usernames across users
  const duplicateUsernames: Array<{ normalizedUsername: string; uids: string[] }> = [];
  for (const [uname, uids] of usernameToUids.entries()) {
    if (uids.length > 1) {
      duplicateUsernames.push({ normalizedUsername: uname, uids });
      for (const acc of accounts) {
        if (acc.normalizedUsername === uname && !acc.issues.includes('DUPLICATE_USERNAME')) {
          acc.issues.push('DUPLICATE_USERNAME');
        }
      }
    }
  }

  // 9. Identify Firebase Auth users without matching Firestore users/{uid}
  const authOnlyOrphans: AuditedAuthOnlyUser[] = [];
  for (const authUser of authUsers) {
    if (!firestoreUids.has(authUser.uid)) {
      authOnlyOrphans.push({
        uid: authUser.uid,
        displayName: authUser.displayName || null,
        maskedEmail: maskEmail(authUser.email),
        disabled: Boolean(authUser.disabled),
        providerIds: authUser.providerData
          ? Array.from(
              new Set(
                authUser.providerData
                  .map((p) => (typeof p?.providerId === 'string' ? p.providerId : ''))
                  .filter(Boolean)
              )
            )
          : [],
        customClaimRole:
          typeof authUser.customClaims?.role === 'string' ? authUser.customClaims.role : null,
        creationTime: authUser.metadata?.creationTime || null,
        lastSignInTime: authUser.metadata?.lastSignInTime || null,
        operationalRefs: opRefsMap.get(authUser.uid) || emptyOperationalRef(authUser.uid),
      });
    }
  }

  // 10. Identify orphaned auth_usernames and orphaned staff_credentials
  const accountByUid = new Map(accounts.map((a) => [a.uid, a]));
  const orphanedUsernames: Array<{
    username: string;
    uid: string | null;
    status: string | null;
    reason: string;
  }> = [];
  for (const entry of usernameDocByName.values()) {
    if (!entry.uid) {
      orphanedUsernames.push({
        username: entry.username,
        uid: null,
        status: entry.status,
        reason: 'Documento em auth_usernames sem UID vinculado.',
      });
      continue;
    }
    const target = accountByUid.get(entry.uid);
    if (!target) {
      orphanedUsernames.push({
        username: entry.username,
        uid: entry.uid,
        status: entry.status,
        reason: 'UID vinculado em auth_usernames não existe em users.',
      });
    } else if (target.normalizedUsername && target.normalizedUsername !== entry.username) {
      orphanedUsernames.push({
        username: entry.username,
        uid: entry.uid,
        status: entry.status,
        reason: `Username em auth_usernames diverge de users/${entry.uid}.username (${target.normalizedUsername}).`,
      });
    }
  }

  const orphanedCredentials: Array<{
    uid: string;
    hashAlgo: string;
    provisioningState: string | null;
    reason: string;
  }> = [];
  for (const cred of credMetaByUid.values()) {
    if (!accountByUid.has(cred.uid)) {
      orphanedCredentials.push({
        uid: cred.uid,
        hashAlgo: cred.hashAlgo,
        provisioningState: cred.provisioningState,
        reason: 'Credencial em staff_credentials sem perfil correspondente em users.',
      });
    }
  }

  // 11. Administrators inventory & lockout detection
  const adminAccounts = accounts.filter((a) => a.normalizedRole === 'ADMINISTRADOR');
  const activeAdmins = adminAccounts.filter((a) => a.normalizedStatus === 'ATIVO');
  const inactiveAdmins = adminAccounts.filter((a) => a.normalizedStatus !== 'ATIVO');
  const adminsReady = activeAdmins.filter((a) => a.readyForNewLogin).map((a) => a.uid);
  const adminsMissingNewAuth = activeAdmins.filter((a) => !a.readyForNewLogin).map((a) => a.uid);

  // Lockout risk if at least one active admin exists in users (so bootstrap-status returns 'login')
  // AND zero active admins are ready to log in with the new username + scrypt + custom token flow.
  const lockoutRiskIfDeployedNow =
    (activeAdmins.length > 0 || authSetup.initialized) && adminsReady.length === 0;

  // 12. Operational UIDs referencing accounts that no longer exist in users OR Auth
  const unmappedOperationalUids: OperationalUidReferences[] = [];
  const uidsWithOperationalHistory: OperationalUidReferences[] = [];
  for (const ref of opRefsMap.values()) {
    if (ref.totalReferences > 0) {
      uidsWithOperationalHistory.push(ref);
      if (!firestoreUids.has(ref.uid) && !authByUid.has(ref.uid)) {
        unmappedOperationalUids.push(ref);
      }
    }
  }

  const matchedAuthAndFirestore = accounts.filter((a) => a.inFirebaseAuth).length;
  const accountsReadyForNewLogin = accounts.filter((a) => a.readyForNewLogin).length;

  return {
    executed: true,
    readOnlyVerified: true,
    projectId: deps.projectId,
    auditedAt,
    summary: {
      firebaseAuthUsers: authUsers.length,
      firestoreUsers: usersSnap.docs.length,
      authUsernames: usernamesSnap.docs.length,
      staffCredentials: credsSnap.docs.length,
      authSetupExists: authSetup.exists,
      authSetupInitialized: authSetup.initialized,
      matchedAuthAndFirestore,
      firestoreOnlyOrphans: firestoreOnlyOrphans.length,
      authOnlyOrphans: authOnlyOrphans.length,
      orphanedUsernames: orphanedUsernames.length,
      orphanedCredentials: orphanedCredentials.length,
      duplicateUsernames: duplicateUsernames.length,
      invalidUsernames: invalidUsernames.length,
      missingPhoneUsers: missingPhoneUsers.length,
      nonNormalizedRoles: nonNormalizedRoles.length,
      statusAuthMismatches: statusAuthMismatches.length,
      uidFieldMismatches: uidFieldMismatches.length,
      activeAdministrators: activeAdmins.length,
      inactiveAdministrators: inactiveAdmins.length,
      administratorsReadyForNewLogin: adminsReady.length,
      legacyAccountsMissingNewAuth: legacyAccountsMissingNewAuth.length,
      accountsReadyForNewLogin,
      lockoutRiskIfDeployedNow,
    },
    authSetup,
    administrators: {
      active: activeAdmins,
      inactive: inactiveAdmins,
      readyForNewLogin: adminsReady,
      missingNewAuth: adminsMissingNewAuth,
      lockoutRiskIfDeployedNow,
    },
    accounts,
    anomalies: {
      firestoreOnlyOrphans,
      authOnlyOrphans,
      orphanedUsernames,
      orphanedCredentials,
      duplicateUsernames,
      invalidUsernames,
      missingPhoneUsers,
      nonNormalizedRoles,
      statusAuthMismatches,
      uidFieldMismatches,
      legacyAccountsMissingNewAuth,
      unmappedOperationalUids,
    },
    operationalPreservation: {
      scannedCollections,
      uidsWithOperationalHistory,
    },
    localStorageNote:
      'As chaves legadas gf_users e gf_user_passwords residem exclusivamente no localStorage dos navegadores físicos da loja e NÃO são lidas, apagadas ou alteradas por este script de servidor.',
  };
}

export function formatReadOnlyAuditReport(report: ReadOnlyAuditReport): string {
  const s = report.summary;
  const lines: string[] = [
    '==============================================================================',
    'AMANDITA SABORES — INVENTÁRIO SOMENTE LEITURA DE CONTAS (FIREBASE)',
    '==============================================================================',
    `Projeto: ${report.projectId}`,
    `Data da leitura: ${report.auditedAt}`,
    `Modo: SOMENTE LEITURA (zero gravações, zero hashes/salts/segredos expostos)`,
    '',
    '1. RESUMO QUANTITATIVO',
    `   - Usuários no Firebase Authentication : ${s.firebaseAuthUsers}`,
    `   - Documentos em Firestore/users       : ${s.firestoreUsers}`,
    `   - Documentos em auth_usernames        : ${s.authUsernames}`,
    `   - Documentos em staff_credentials     : ${s.staffCredentials} (somente metadados estruturais)`,
    `   - configs/auth_setup existe           : ${s.authSetupExists ? 'SIM' : 'NÃO'} (initialized=${s.authSetupInitialized})`,
    `   - Correspondentes (Auth == users)     : ${s.matchedAuthAndFirestore}`,
    `   - Órfãos apenas no Firestore (users)  : ${s.firestoreOnlyOrphans}`,
    `   - Órfãos apenas no Firebase Auth      : ${s.authOnlyOrphans}`,
    `   - Contas prontas para o novo login    : ${s.accountsReadyForNewLogin}/${s.firestoreUsers}`,
    `   - Contas antigas sem novo registro    : ${s.legacyAccountsMissingNewAuth}`,
    '',
    '2. SITUAÇÃO ADMINISTRATIVA',
    `   - Administradores ativos              : ${s.activeAdministrators}`,
    `   - Administradores inativos            : ${s.inactiveAdministrators}`,
    `   - Admins prontos para novo login      : ${s.administratorsReadyForNewLogin}`,
    `   - RISCO DE LOCKOUT SE PUBLICAR AGORA  : ${s.lockoutRiskIfDeployedNow ? 'ALTO (SIM — migrar antes do deploy!)' : 'BAIXO (NÃO)'}`,
    '',
    '3. INCONSISTÊNCIAS E QUALIDADE',
    `   - Usernames duplicados                : ${s.duplicateUsernames}`,
    `   - Usernames inválidos ou ausentes     : ${s.invalidUsernames}`,
    `   - Perfis sem telefone válido          : ${s.missingPhoneUsers}`,
    `   - Papéis fora do padrão caixa alta    : ${s.nonNormalizedRoles}`,
    `   - Divergência status × Auth.disabled  : ${s.statusAuthMismatches}`,
    `   - Divergência docId × id/firebaseUid  : ${s.uidFieldMismatches}`,
    `   - auth_usernames órfãos/divergentes   : ${s.orphanedUsernames}`,
    `   - staff_credentials órfãos            : ${s.orphanedCredentials}`,
    '',
    '4. PRESERVAÇÃO DE UIDs E HISTÓRICO OPERACIONAL',
    `   - Pedidos verificados (orders)        : ${report.operationalPreservation.scannedCollections.orders.scannedDocs}`,
    `   - Turnos de entrega (delivery_shifts) : ${report.operationalPreservation.scannedCollections.delivery_shifts.scannedDocs}`,
    `   - Logs de acesso (access_logs)        : ${report.operationalPreservation.scannedCollections.access_logs.scannedDocs}`,
    `   - UIDs com vínculo histórico ativo    : ${report.operationalPreservation.uidsWithOperationalHistory.length}`,
    `   - UIDs históricos sem conta atual     : ${report.anomalies.unmappedOperationalUids.length}`,
    '',
    '5. OBSERVAÇÃO SOBRE DADOS LOCAIS',
    `   - ${report.localStorageNote}`,
    '==============================================================================',
  ];
  return lines.join('\n');
}

function getEnvCredentialStatus(): {
  hasServiceAccountEnv: boolean;
  hasSplitKeyEnv: boolean;
  hasGoogleApplicationCredentials: boolean;
  hasAnyCredential: boolean;
  projectId: string;
} {
  const hasServiceAccountEnv = Boolean((process.env.FIREBASE_SERVICE_ACCOUNT || '').trim());
  const hasSplitKeyEnv = Boolean(
    (process.env.FIREBASE_CLIENT_EMAIL || '').trim() &&
      (process.env.FIREBASE_PRIVATE_KEY || '').trim()
  );
  const gacPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  const hasGoogleApplicationCredentials = Boolean(gacPath && fs.existsSync(gacPath));
  const projectId = (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'amandita-sabores'
  ).trim();

  return {
    hasServiceAccountEnv,
    hasSplitKeyEnv,
    hasGoogleApplicationCredentials,
    hasAnyCredential: hasServiceAccountEnv || hasSplitKeyEnv || hasGoogleApplicationCredentials,
    projectId,
  };
}

function resolveReadOnlyFirebaseClients(): {
  adminAuth: ReadOnlyAuthClient | null;
  adminDb: ReadOnlyFirestoreClient | null;
  projectId: string;
  error: string | null;
} {
  const envStatus = getEnvCredentialStatus();
  if (!envStatus.hasAnyCredential) {
    return {
      adminAuth: null,
      adminDb: null,
      projectId: envStatus.projectId,
      error: null,
    };
  }

  // Prefer the application's standard server env loader (FIREBASE_SERVICE_ACCOUNT or CLIENT_EMAIL+PRIVATE_KEY)
  if (envStatus.hasServiceAccountEnv || envStatus.hasSplitKeyEnv) {
    const instances = getFirebaseAdminInstances();
    if (instances.hasAdminSdk && instances.adminAuth && instances.adminDb) {
      return {
        adminAuth: instances.adminAuth as unknown as ReadOnlyAuthClient,
        adminDb: instances.adminDb as unknown as ReadOnlyFirestoreClient,
        projectId: instances.projectId,
        error: null,
      };
    }
    return {
      adminAuth: null,
      adminDb: null,
      projectId: instances.projectId,
      error: instances.adminError || 'Falha ao inicializar Firebase Admin SDK com as variáveis do ambiente.',
    };
  }

  // Fallback: standard GOOGLE_APPLICATION_CREDENTIALS file configured in the OS environment
  try {
    const existing = getAdminApps().find((a) => a.name === 'readonly-audit');
    const app: AdminApp =
      existing ||
      initAdminApp(
        {
          credential: applicationDefault(),
          projectId: envStatus.projectId,
        },
        'readonly-audit'
      );
    return {
      adminAuth: getAdminAuth(app) as unknown as ReadOnlyAuthClient,
      adminDb: getAdminFirestore(app) as unknown as ReadOnlyFirestoreClient,
      projectId: envStatus.projectId,
      error: null,
    };
  } catch (err: unknown) {
    return {
      adminAuth: null,
      adminDb: null,
      projectId: envStatus.projectId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const argCheck = assertSafeCliArgs(process.argv.slice(2));
  if (!argCheck.ok) {
    console.error(`[ERRO DE SEGURANÇA] ${argCheck.error}`);
    process.exit(3);
  }

  if (argCheck.helpMode) {
    console.log(
      [
        'Uso: npx tsx scripts/audit_users_readonly.ts [--json]',
        '',
        'Executa inventário 100% SOMENTE LEITURA das contas do Amandita Sabores no Firebase.',
        'Credenciais devem ser fornecidas exclusivamente via variáveis de ambiente seguras:',
        '  - FIREBASE_SERVICE_ACCOUNT (JSON ou base64)',
        '  - ou FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (+ FIREBASE_PROJECT_ID)',
        '  - ou GOOGLE_APPLICATION_CREDENTIALS (caminho de arquivo seguro no ambiente)',
        '',
        'Nunca passe chaves, tokens ou senhas por argumentos de linha de comando.',
      ].join('\n')
    );
    return;
  }

  const envStatus = getEnvCredentialStatus();
  if (!envStatus.hasAnyCredential) {
    const payload = {
      executed: false,
      readOnlyVerified: true,
      reason: 'NO_ENVIRONMENT_CREDENTIALS',
      message:
        'INVENTÁRIO REAL NÃO EXECUTADO: nenhuma credencial segura do Firebase Admin encontrada no ambiente de execução.',
      environmentCheck: {
        FIREBASE_SERVICE_ACCOUNT: 'AUSENTE',
        FIREBASE_CLIENT_EMAIL_AND_PRIVATE_KEY: 'AUSENTE',
        GOOGLE_APPLICATION_CREDENTIALS: 'AUSENTE',
      },
      guarantees: [
        'Nenhuma conta real foi acessada ou alterada.',
        'Nenhuma contagem simulada ou fictícia foi gerada.',
        'Nenhuma operação de gravação foi executada no Firebase.',
      ],
    };

    if (argCheck.jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log('==============================================================================');
      console.log('AMANDITA SABORES — INVENTÁRIO SOMENTE LEITURA DE CONTAS');
      console.log('==============================================================================');
      console.log('STATUS: INVENTÁRIO REAL NÃO EXECUTADO');
      console.log(
        'Motivo: nenhuma credencial segura do Firebase Admin foi encontrada nas variáveis de ambiente.'
      );
      console.log('');
      console.log('Variáveis verificadas (somente presença, sem exibir valores):');
      console.log('  - FIREBASE_SERVICE_ACCOUNT                  : AUSENTE');
      console.log('  - FIREBASE_CLIENT_EMAIL + PRIVATE_KEY       : AUSENTE');
      console.log('  - GOOGLE_APPLICATION_CREDENTIALS            : AUSENTE');
      console.log('');
      console.log('Garantias:');
      console.log('  - Nenhuma contagem fictícia ou simulada foi gerada.');
      console.log('  - Nenhuma operação de leitura ou escrita foi enviada ao Firebase.');
      console.log('  - Execute este script somente em ambiente seguro com credenciais configuradas.');
      console.log('==============================================================================');
    }
    process.exitCode = 2;
    return;
  }

  const clients = resolveReadOnlyFirebaseClients();
  if (!clients.adminAuth || !clients.adminDb) {
    console.error(
      `[ERRO] Inventário real não executado: não foi possível inicializar o acesso somente leitura ao Firebase (${clients.error || 'erro desconhecido'}).`
    );
    process.exitCode = 2;
    return;
  }

  const report = await runReadOnlyUserAudit({
    adminAuth: clients.adminAuth,
    adminDb: clients.adminDb,
    projectId: clients.projectId,
  });

  if (argCheck.jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReadOnlyAuditReport(report));
  }
}

const isDirectExecution = (() => {
  try {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const self = path.resolve(fileURLToPath(import.meta.url));
    return entry === self;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ERRO] Falha durante inventário somente leitura: ${msg}`);
    process.exit(1);
  });
}
