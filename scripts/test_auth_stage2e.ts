import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.DISABLE_AUTO_LISTEN = '1';
process.env.ALLOW_TEST_FIREBASE_OVERRIDES = '1';

import {
  FULL_ADMIN_DELIVERY_PERMISSIONS,
  OFFICIAL_APP_MODULES,
  hashPasswordScrypt,
} from '../src/server/authCrypto.js';
import {
  app,
  __setTestFirebaseAdminServices,
  __resetAuthRateLimitersForTests,
} from '../src/server/app.js';
import {
  assertSafeCliArgs,
  formatReadOnlyAuditReport,
  runReadOnlyUserAudit,
  type ReadOnlyAuthClient,
  type ReadOnlyAuthUserRecord,
  type ReadOnlyFirestoreClient,
} from './audit_users_readonly.js';

// ---------------------------------------------------------------------------
// In-Memory Firestore & Firebase Admin Auth Simulator (Zero Production Touch)
// ---------------------------------------------------------------------------
type DocData = Record<string, any>;

class SimulatedFirestore {
  private readonly store = new Map<string, Map<string, DocData>>();
  private txChain: Promise<unknown> = Promise.resolve();
  public failNextTransactionWrite: string | null = null;

  public clearAll(): void {
    this.store.clear();
    this.failNextTransactionWrite = null;
  }

  public getRaw(col: string, id: string): DocData | undefined {
    const val = this.store.get(col)?.get(id);
    return val ? structuredClone(val) : undefined;
  }

  public setRaw(col: string, id: string, data: DocData): void {
    if (!this.store.has(col)) this.store.set(col, new Map());
    this.store.get(col)!.set(id, structuredClone(data));
  }

  public countCollection(col: string): number {
    return this.store.get(col)?.size || 0;
  }

  public collection(name: string) {
    const self = this;
    const ensureCol = () => {
      if (!self.store.has(name)) self.store.set(name, new Map());
      return self.store.get(name)!;
    };

    const makeDocRef = (id: string) => ({
      id,
      _col: name,
      async get() {
        const val = ensureCol().get(id);
        return {
          id,
          exists: val !== undefined,
          data: () => (val !== undefined ? structuredClone(val) : undefined),
        };
      },
      async set(data: DocData, opts?: { merge?: boolean }) {
        const col = ensureCol();
        if (opts?.merge && col.has(id)) {
          col.set(id, { ...structuredClone(col.get(id)!), ...structuredClone(data) });
        } else {
          col.set(id, structuredClone(data));
        }
      },
      async delete() {
        ensureCol().delete(id);
      },
    });

    const buildQuery = (filters: Array<{ field: string; op: string; value: any }>, maxLimit?: number) => ({
      where(field: string, op: string, value: any) {
        return buildQuery([...filters, { field, op, value }], maxLimit);
      },
      limit(n: number) {
        return buildQuery(filters, n);
      },
      async get() {
        const col = ensureCol();
        const docs: Array<{ id: string; exists: boolean; data: () => DocData }> = [];
        for (const [id, raw] of col.entries()) {
          let match = true;
          for (const f of filters) {
            if (f.op === '==' && raw[f.field] !== f.value) {
              match = false;
              break;
            }
          }
          if (match) {
            docs.push({ id, exists: true, data: () => structuredClone(raw) });
            if (maxLimit !== undefined && docs.length >= maxLimit) break;
          }
        }
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach(cb: (d: { id: string; exists: boolean; data: () => DocData }) => void) {
            docs.forEach(cb);
          },
        };
      },
    });

    return {
      doc: makeDocRef,
      where(field: string, op: string, value: any) {
        return buildQuery([{ field, op, value }]);
      },
      limit(n: number) {
        return buildQuery([], n);
      },
      async get() {
        return buildQuery([]).get();
      },
    };
  }

  public async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const stagedOps: Array<
        | { type: 'set'; col: string; id: string; data: DocData; merge: boolean }
        | { type: 'delete'; col: string; id: string }
      > = [];
      let hasWritten = false;

      const tx = {
        get: async (docRef: { _col: string; id: string }) => {
          // Enforce real Firestore rule: all reads must happen before any writes
          if (hasWritten) {
            throw new Error('Firestore transactions require all reads to be executed before all writes.');
          }
          const val = this.store.get(docRef._col)?.get(docRef.id);
          return {
            id: docRef.id,
            exists: val !== undefined,
            data: () => (val !== undefined ? structuredClone(val) : undefined),
          };
        },
        set: (docRef: { _col: string; id: string }, data: DocData, opts?: { merge?: boolean }) => {
          hasWritten = true;
          stagedOps.push({
            type: 'set',
            col: docRef._col,
            id: docRef.id,
            data: structuredClone(data),
            merge: Boolean(opts?.merge),
          });
        },
        delete: (docRef: { _col: string; id: string }) => {
          hasWritten = true;
          stagedOps.push({ type: 'delete', col: docRef._col, id: docRef.id });
        },
      };

      const result = await fn(tx);

      if (this.failNextTransactionWrite) {
        const msg = this.failNextTransactionWrite;
        this.failNextTransactionWrite = null;
        throw new Error(msg);
      }

      for (const op of stagedOps) {
        if (!this.store.has(op.col)) this.store.set(op.col, new Map());
        const col = this.store.get(op.col)!;
        if (op.type === 'delete') {
          col.delete(op.id);
        } else if (op.merge && col.has(op.id)) {
          col.set(op.id, { ...col.get(op.id)!, ...op.data });
        } else {
          col.set(op.id, op.data);
        }
      }

      return result;
    };

    const next = this.txChain.then(run, run);
    this.txChain = next.catch(() => {});
    return next;
  }
}

interface SimAuthUser {
  uid: string;
  displayName?: string;
  disabled: boolean;
  email?: string;
  customClaims?: Record<string, any>;
  providerData?: Array<{ providerId: string }>;
  tokensRevokedAt?: number;
}

class SimulatedAdminAuth {
  public readonly users = new Map<string, SimAuthUser>();
  public readonly tokens = new Map<string, { uid: string; email?: string; role?: string }>();
  public failNextUpdateUser: { message: string; code?: string } | null = null;
  public failNextCreateUser: { message: string; code?: string } | null = null;
  public failNextSetCustomClaims: string | null = null;
  public failNextRevokeTokens: string | null = null;

  public clearAll(): void {
    this.users.clear();
    this.tokens.clear();
    this.failNextUpdateUser = null;
    this.failNextCreateUser = null;
    this.failNextSetCustomClaims = null;
    this.failNextRevokeTokens = null;
  }

  public async createUser(props: { uid?: string; displayName?: string; disabled?: boolean; email?: string }) {
    if (this.failNextCreateUser) {
      const { message, code } = this.failNextCreateUser;
      this.failNextCreateUser = null;
      const err: any = new Error(message);
      if (code) err.code = code;
      throw err;
    }
    const uid = props.uid || `uid-${crypto.randomBytes(6).toString('hex')}`;
    if (this.users.has(uid)) {
      const err: any = new Error('The user with the provided uid already exists.');
      err.code = 'auth/uid-already-exists';
      throw err;
    }
    const user: SimAuthUser = {
      uid,
      displayName: props.displayName,
      disabled: Boolean(props.disabled),
      email: props.email,
    };
    this.users.set(uid, user);
    return { uid, displayName: user.displayName, disabled: user.disabled };
  }

  public async updateUser(uid: string, props: { displayName?: string; disabled?: boolean }) {
    if (this.failNextUpdateUser) {
      const { message, code } = this.failNextUpdateUser;
      this.failNextUpdateUser = null;
      const err: any = new Error(message);
      if (code) err.code = code;
      throw err;
    }
    const u = this.users.get(uid);
    if (!u) {
      const err: any = new Error('There is no user record corresponding to the provided identifier.');
      err.code = 'auth/user-not-found';
      throw err;
    }
    if (props.displayName !== undefined) u.displayName = props.displayName;
    if (props.disabled !== undefined) u.disabled = props.disabled;
    return u;
  }

  public async deleteUser(uid: string) {
    if (!this.users.has(uid)) {
      const err: any = new Error('auth/user-not-found');
      err.code = 'auth/user-not-found';
      throw err;
    }
    this.users.delete(uid);
  }

  public async setCustomUserClaims(uid: string, claims: Record<string, any>) {
    if (this.failNextSetCustomClaims) {
      const msg = this.failNextSetCustomClaims;
      this.failNextSetCustomClaims = null;
      throw new Error(msg);
    }
    const u = this.users.get(uid);
    if (!u) {
      const err: any = new Error('auth/user-not-found');
      err.code = 'auth/user-not-found';
      throw err;
    }
    u.customClaims = { ...claims };
  }

  public async revokeRefreshTokens(uid: string) {
    if (this.failNextRevokeTokens) {
      const msg = this.failNextRevokeTokens;
      this.failNextRevokeTokens = null;
      throw new Error(msg);
    }
    const u = this.users.get(uid);
    if (u) u.tokensRevokedAt = Date.now();
  }

  public async createCustomToken(uid: string) {
    if (!this.users.has(uid)) {
      const err: any = new Error('auth/user-not-found');
      err.code = 'auth/user-not-found';
      throw err;
    }
    const token = `custom-tok-${uid}-${crypto.randomBytes(4).toString('hex')}`;
    this.tokens.set(token, { uid });
    return token;
  }

  public async verifyIdToken(token: string) {
    const entry = this.tokens.get(token);
    if (!entry) throw new Error('Invalid token');
    const u = this.users.get(entry.uid);
    return {
      uid: entry.uid,
      email: entry.email || u?.email || '',
      role: entry.role || u?.customClaims?.role,
    };
  }
}

async function main() {
  const simDb = new SimulatedFirestore();
  const simAuth = new SimulatedAdminAuth();

  __setTestFirebaseAdminServices({
    adminDb: simDb as any,
    adminAuth: simAuth as any,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  async function api(method: string, route: string, body?: any) {
    const res = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  const VALID_KEY = 'amandita-test-recovery-key-stage2e-2026';

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✓ [PASS] ${name}`);
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(err);
    }
  }

  console.log('\n==============================================================================');
  console.log('TESTES ETAPA 2E — RECUPERAÇÃO ADMINISTRATIVA E INVENTÁRIO SOMENTE LEITURA');
  console.log('==============================================================================');

  try {
    // -----------------------------------------------------------------------
    // TAREFA 1 — POST /api/auth/admin-recovery
    // -----------------------------------------------------------------------
    await test('1. Recuperação de admin legado mantendo o MESMO username cria auth_usernames, staff_credentials e configs/auth_setup e libera login', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();
      process.env.ADMIN_RECOVERY_KEY = VALID_KEY;

      const legacyUid = 'legacy-admin-uid-001';
      await simAuth.createUser({ uid: legacyUid, displayName: 'Amanda Titular', disabled: false });
      simDb.setRaw('users', legacyUid, {
        id: legacyUid,
        name: 'Amanda Titular',
        username: 'amanda_titular',
        phone: '83991112222',
        role: 'ADMINISTRADOR',
        status: 'ATIVO',
        allowedModules: [...OFFICIAL_APP_MODULES],
        deliveryPermissions: { ...FULL_ADMIN_DELIVERY_PERMISSIONS },
        createdAt: '2025-01-10T10:00:00.000Z',
      });

      // Before recovery: login MUST fail (no auth_usernames, no staff_credentials)
      const preLogin = await api('POST', '/api/auth/login', {
        username: 'amanda_titular',
        password: 'NovaSenhaAdmin#2026',
      });
      assert.equal(preLogin.status, 401);

      // Recovery WITHOUT changing username (same username!)
      const rec = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        currentUsername: 'amanda_titular',
        newPassword: 'NovaSenhaAdmin#2026',
      });
      assert.equal(rec.status, 200);
      assert.equal(rec.data.success, true);
      assert.equal(rec.data.user.id, legacyUid);
      assert.equal(rec.data.user.username, 'amanda_titular');
      assert.equal(rec.data.user.role, 'ADMINISTRADOR');
      assert.equal(rec.data.user.status, 'ATIVO');
      assert.equal(rec.data.user.allowedModules.length, OFFICIAL_APP_MODULES.length);

      // Verify ALL required collections were consolidated
      const unDoc = simDb.getRaw('auth_usernames', 'amanda_titular');
      assert.equal(unDoc?.uid, legacyUid);
      assert.equal(unDoc?.status, 'ACTIVE');

      const credDoc = simDb.getRaw('staff_credentials', legacyUid);
      assert.equal(credDoc?.hashAlgo, 'scrypt');
      assert.equal(credDoc?.provisioningState, 'ACTIVE');
      assert.equal(credDoc?.failedAttempts, 0);

      const setupDoc = simDb.getRaw('configs', 'auth_setup');
      assert.equal(setupDoc?.initialized, true);
      assert.equal(setupDoc?.status, 'COMPLETED');
      assert.equal(setupDoc?.stage, 'COMPLETED');
      assert.equal(setupDoc?.initialAdminUid, legacyUid);
      assert.equal(setupDoc?.recoveredAdminUid, legacyUid);
      assert.equal(setupDoc?.username, 'amanda_titular');

      // Verify Firebase Auth claims & token revocation
      assert.equal(simAuth.users.get(legacyUid)?.customClaims?.role, 'ADMINISTRADOR');
      assert.ok(simAuth.users.get(legacyUid)?.tokensRevokedAt);
      assert.equal(simAuth.users.size, 1, 'Não deve criar segundo administrador');
      assert.equal(simDb.countCollection('users'), 1);

      // Login now MUST SUCCEED
      const postLogin = await api('POST', '/api/auth/login', {
        username: 'amanda_titular',
        password: 'NovaSenhaAdmin#2026',
      });
      assert.equal(postLogin.status, 200);
      assert.ok(postLogin.data.customToken);
      assert.equal(postLogin.data.user.id, legacyUid);
    });

    await test('2. Repetição idempotente da recuperação preserva UID, completedAt e permissões sem duplicar admin', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();
      process.env.ADMIN_RECOVERY_KEY = VALID_KEY;

      const adminUid = 'admin-idempotent-uid';
      await simAuth.createUser({ uid: adminUid, displayName: 'Amanda Idempotente', disabled: false });
      simDb.setRaw('users', adminUid, {
        id: adminUid,
        name: 'Amanda Idempotente',
        username: 'amanda_idem',
        phone: '83992223333',
        role: 'ADMINISTRADOR',
        status: 'ATIVO',
        allowedModules: [...OFFICIAL_APP_MODULES],
        deliveryPermissions: { ...FULL_ADMIN_DELIVERY_PERMISSIONS },
      });

      const r1 = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'PasswordUm#2026',
      });
      assert.equal(r1.status, 200);
      const firstCompletedAt = simDb.getRaw('configs', 'auth_setup')?.completedAt;
      assert.ok(firstCompletedAt);

      // Repeat with same username and updated password
      const r2 = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'PasswordDois#2026',
      });
      assert.equal(r2.status, 200);
      assert.equal(r2.data.user.id, adminUid);
      assert.equal(simDb.getRaw('configs', 'auth_setup')?.completedAt, firstCompletedAt);
      assert.equal(simAuth.users.size, 1);
      assert.equal(simDb.countCollection('users'), 1);
      assert.equal(simDb.countCollection('auth_usernames'), 1);

      // Repeat rotating username
      const r3 = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        currentUsername: 'amanda_idem',
        newUsername: 'amanda_idem_v2',
        newPassword: 'PasswordTres#2026',
      });
      assert.equal(r3.status, 200);
      assert.equal(simDb.getRaw('auth_usernames', 'amanda_idem'), undefined);
      assert.equal(simDb.getRaw('auth_usernames', 'amanda_idem_v2')?.uid, adminUid);
      assert.equal(simDb.getRaw('configs', 'auth_setup')?.username, 'amanda_idem_v2');

      assert.equal(
        (await api('POST', '/api/auth/login', { username: 'amanda_idem', password: 'PasswordTres#2026' })).status,
        401
      );
      const okLogin = await api('POST', '/api/auth/login', {
        username: 'amanda_idem_v2',
        password: 'PasswordTres#2026',
      });
      assert.equal(okLogin.status, 200);
      assert.equal(okLogin.data.user.id, adminUid);
    });

    await test('3. Quando UID de destino existe no Firestore mas NÃO existe no Firebase Auth, cria no Auth preservando o UID exato', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();
      process.env.ADMIN_RECOVERY_KEY = VALID_KEY;

      const orphanDocUid = 'firestore-only-admin-uid-777';
      simDb.setRaw('users', orphanDocUid, {
        id: orphanDocUid,
        name: 'Amanda Legado Firestore',
        username: 'amanda_legado',
        phone: '83994445555',
        role: 'ADMINISTRADOR',
        status: 'ATIVO',
        allowedModules: [...OFFICIAL_APP_MODULES],
        deliveryPermissions: { ...FULL_ADMIN_DELIVERY_PERMISSIONS },
      });
      assert.equal(simAuth.users.has(orphanDocUid), false);

      const rec = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'SenhaPreservada#2026',
      });
      assert.equal(rec.status, 200);
      assert.equal(rec.data.user.id, orphanDocUid);

      // Exact UID MUST now exist in Firebase Auth (enabled, with ADMINISTRADOR claim)
      assert.equal(simAuth.users.size, 1);
      const authUser = simAuth.users.get(orphanDocUid);
      assert.ok(authUser, 'Usuário deve ter sido criado no Firebase Auth com o MESMO UID');
      assert.equal(authUser?.disabled, false);
      assert.equal(authUser?.customClaims?.role, 'ADMINISTRADOR');

      const loginRes = await api('POST', '/api/auth/login', {
        username: 'amanda_legado',
        password: 'SenhaPreservada#2026',
      });
      assert.equal(loginRes.status, 200);
      assert.equal(loginRes.data.user.id, orphanDocUid);
    });

    await test('4. Erros no Firebase Authentication NÃO são ignorados e não corrompem o Firestore (incluindo rollback de Auth recém-criado)', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();
      process.env.ADMIN_RECOVERY_KEY = VALID_KEY;

      const uid = 'admin-auth-err-uid';
      await simAuth.createUser({ uid, displayName: 'Amanda Erro', disabled: false });
      simDb.setRaw('users', uid, {
        id: uid,
        name: 'Amanda Erro',
        username: 'amanda_erro',
        phone: '83995556666',
        role: 'ADMINISTRADOR',
        status: 'ATIVO',
      });

      // Case A: updateUser fails with non-user-not-found error -> 502 AUTH_SYNC_FAILED, Firestore untouched
      simAuth.failNextUpdateUser = { message: 'Firebase Auth service unavailable', code: 'auth/internal-error' };
      const resA = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'SenhaQualquer#2026',
      });
      assert.equal(resA.status, 502);
      assert.equal(resA.data.code, 'AUTH_SYNC_FAILED');
      assert.equal(simDb.getRaw('staff_credentials', uid), undefined);
      assert.equal(simDb.getRaw('auth_usernames', 'amanda_erro'), undefined);
      assert.equal(simDb.getRaw('configs', 'auth_setup'), undefined);

      // Case B: setCustomUserClaims fails -> 502 AUTH_SYNC_FAILED, Firestore untouched
      simAuth.failNextSetCustomClaims = 'Claims write failed';
      const resB = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'SenhaQualquer#2026',
      });
      assert.equal(resB.status, 502);
      assert.equal(resB.data.code, 'AUTH_SYNC_FAILED');
      assert.equal(simDb.getRaw('staff_credentials', uid), undefined);

      // Case C: Missing Auth user fails createUser -> 502 AUTH_SYNC_FAILED
      await simAuth.deleteUser(uid);
      simAuth.failNextCreateUser = { message: 'Quota exceeded', code: 'auth/quota-exceeded' };
      const resC = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'SenhaQualquer#2026',
      });
      assert.equal(resC.status, 502);
      assert.equal(resC.data.code, 'AUTH_SYNC_FAILED');
      assert.equal(simAuth.users.size, 0);
      assert.equal(simDb.getRaw('staff_credentials', uid), undefined);

      // Case D: Missing Auth user is created, then Firestore tx fails -> newly created Auth user is rolled back!
      __resetAuthRateLimitersForTests();
      simDb.failNextTransactionWrite = 'Simulated Firestore commit failure';
      const resD = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'SenhaQualquer#2026',
      });
      assert.equal(resD.status, 500);
      assert.equal(simAuth.users.has(uid), false, 'Usuário Auth recém-criado deve ser revertido se Firestore falhar');
      assert.equal(simDb.getRaw('staff_credentials', uid), undefined);
    });

    await test('5. Condições de segurança e inconsistências: bloqueia chave inválida, sem admin, admin bloqueado/desativado, login inválido e conflito de username', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();

      // 5a. Disabled when key missing or < 16 chars
      process.env.ADMIN_RECOVERY_KEY = 'short-key';
      assert.equal(
        (await api('POST', '/api/auth/admin-recovery', { recoveryKey: 'short-key', newPassword: 'ValidPassword1' })).status,
        503
      );

      process.env.ADMIN_RECOVERY_KEY = VALID_KEY;

      // 5b. Wrong recovery key -> 403
      assert.equal(
        (await api('POST', '/api/auth/admin-recovery', { recoveryKey: 'wrong-key-1234567890', newPassword: 'ValidPassword1' })).status,
        403
      );

      // 5c. Zero admins in Firestore -> 404 (NEVER creates an admin automatically!)
      const noAdmin = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'ValidPassword1',
      });
      assert.equal(noAdmin.status, 404);
      assert.equal(noAdmin.data.code, 'ADMIN_NOT_FOUND');
      assert.equal(simAuth.users.size, 0);
      assert.equal(simDb.countCollection('users'), 0);

      // 5d. Blocked/Disabled admin CANNOT be silently reactivated via recovery
      __resetAuthRateLimitersForTests();
      simDb.setRaw('users', 'blocked-adm', {
        id: 'blocked-adm',
        name: 'Admin Bloqueado',
        username: 'admin_bloqueado',
        role: 'ADMINISTRADOR',
        status: 'BLOQUEADO',
      });
      const blockedRes = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        currentUsername: 'admin_bloqueado',
        newPassword: 'ValidPassword1',
      });
      assert.equal(blockedRes.status, 403);
      assert.equal(blockedRes.data.code, 'ACCOUNT_BLOCKED');
      assert.equal(simDb.getRaw('users', 'blocked-adm')?.status, 'BLOQUEADO');

      // 5e. Legacy admin with invalid (email-like) username and no newUsername -> 400 INVALID_USERNAME
      simDb.clearAll();
      __resetAuthRateLimitersForTests();
      simDb.setRaw('users', 'bad-uname-adm', {
        id: 'bad-uname-adm',
        name: 'Admin Email Legado',
        username: 'admin@gmail.com',
        role: 'ADMINISTRADOR',
        status: 'ATIVO',
      });
      const badUname = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'ValidPassword1',
      });
      assert.equal(badUname.status, 400);
      assert.equal(badUname.data.code, 'INVALID_USERNAME');

      // 5f. Username already owned by another active user -> 409 USERNAME_TAKEN (zero Auth mutation)
      simDb.setRaw('auth_usernames', 'outro_login', {
        username: 'outro_login',
        uid: 'other-staff-uid',
        status: 'ACTIVE',
      });
      const takenRes = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newUsername: 'outro_login',
        newPassword: 'ValidPassword1',
      });
      assert.equal(takenRes.status, 409);
      assert.equal(takenRes.data.code, 'USERNAME_TAKEN');
      assert.equal(simAuth.users.size, 0, 'Não deve tocar no Firebase Auth quando username já está em uso');

      // 5g. Multiple active admins without currentUsername -> 400 ADMIN_TARGET_AMBIGUOUS
      __resetAuthRateLimitersForTests();
      simDb.setRaw('users', 'adm-1', { id: 'adm-1', name: 'Admin 1', username: 'admin_um', role: 'ADMINISTRADOR', status: 'ATIVO' });
      simDb.setRaw('users', 'adm-2', { id: 'adm-2', name: 'Admin 2', username: 'admin_dois', role: 'ADMINISTRADOR', status: 'ATIVO' });
      const ambigRes = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newPassword: 'ValidPassword1',
      });
      assert.equal(ambigRes.status, 400);
      assert.equal(ambigRes.data.code, 'ADMIN_TARGET_AMBIGUOUS');
    });

    // -----------------------------------------------------------------------
    // TAREFA 2 — scripts/audit_users_readonly.ts
    // -----------------------------------------------------------------------
    await test('6. Inventário somente leitura identifica correspondências, órfãos, duplicidades, papéis legados, lockout e histórico operacional sem vazar segredos', async () => {
      const secretHash = await hashPasswordScrypt('SuperSecretPass#2026');

      const mockAuthUsers: ReadOnlyAuthUserRecord[] = [
        {
          uid: 'uid-admin-legacy',
          displayName: 'Amanda Legado',
          email: 'dono.amandita@gmail.com',
          disabled: false,
          providerData: [{ providerId: 'google.com' }],
        },
        {
          uid: 'uid-caixa-ok',
          displayName: 'Carlos Caixa',
          disabled: false,
          customClaims: { role: 'CAIXA' },
          providerData: [{ providerId: 'custom' }],
        },
        {
          uid: 'uid-auth-only',
          displayName: 'Conta Antiga Google',
          email: 'antigo@gmail.com',
          disabled: false,
          providerData: [{ providerId: 'google.com' }],
        },
        {
          uid: 'uid-status-mismatch',
          displayName: 'Entregador Bloqueado',
          disabled: false, // Mismatch: Firestore says BLOQUEADO
          providerData: [{ providerId: 'password' }],
        },
      ];

      const collections: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {
        users: [
          {
            id: 'uid-admin-legacy',
            data: {
              id: 'uid-admin-legacy',
              name: 'Amanda Legado',
              username: 'amanda_admin',
              role: 'ADMINISTRADOR',
              status: 'ATIVO',
              allowedModules: [...OFFICIAL_APP_MODULES],
              deliveryPermissions: { ...FULL_ADMIN_DELIVERY_PERMISSIONS },
              password: 'PLAIN_LEAK_SHOULD_NEVER_APPEAR',
            },
          },
          {
            id: 'uid-caixa-ok',
            data: {
              id: 'uid-caixa-ok',
              firebaseUid: 'uid-caixa-ok',
              name: 'Carlos Caixa',
              username: 'carlos_caixa',
              phone: '83991234567',
              role: 'CAIXA',
              status: 'ATIVO',
              allowedModules: ['pdv', 'caixa'],
              provisioningState: 'ACTIVE',
            },
          },
          {
            id: 'uid-firestore-only-driver',
            data: {
              id: 'uid-firestore-only-driver',
              name: 'Pedro Moto',
              username: 'carlos_caixa', // Duplicate username!
              role: 'entregador', // Lowercase legacy role!
              status: 'ATIVO',
            },
          },
          {
            id: 'uid-status-mismatch',
            data: {
              id: 'uid-status-mismatch',
              name: 'Entregador Bloqueado',
              username: 'bad@email.com', // Invalid email username!
              phone: '123', // Invalid phone!
              role: 'ENTREGADOR',
              status: 'BLOQUEADO',
            },
          },
        ],
        auth_usernames: [
          { id: 'carlos_caixa', data: { username: 'carlos_caixa', uid: 'uid-caixa-ok', status: 'ACTIVE' } },
          { id: 'ghost_user', data: { username: 'ghost_user', uid: 'uid-nonexistent', status: 'ACTIVE' } },
        ],
        staff_credentials: [
          {
            id: 'uid-caixa-ok',
            data: {
              uid: 'uid-caixa-ok',
              ...secretHash,
              provisioningState: 'ACTIVE',
              failedAttempts: 0,
              lockedUntil: null,
            },
          },
          {
            id: 'uid-orphan-cred',
            data: {
              uid: 'uid-orphan-cred',
              ...secretHash,
              provisioningState: 'ACTIVE',
            },
          },
        ],
        configs: [],
        orders: [
          { id: 'ord-1', data: { deliveryPerson: { id: 'uid-firestore-only-driver', name: 'Pedro Moto' } } },
          { id: 'ord-2', data: { deliveryPerson: { id: 'uid-historical-deleted', name: 'Ex Moto' } } },
        ],
        delivery_shifts: [
          { id: 'sh-1', data: { openedBy: { userId: 'uid-admin-legacy' }, closedBy: { userId: 'uid-caixa-ok' } } },
        ],
        access_logs: [
          { id: 'log-1', data: { userId: 'uid-admin-legacy', action: 'LOGIN_SUCESSO' } },
        ],
      };

      const readOnlyAuth: ReadOnlyAuthClient = {
        async listUsers() {
          return { users: mockAuthUsers };
        },
      };

      const readOnlyDb: ReadOnlyFirestoreClient = {
        collection(colName: string) {
          const rows = collections[colName] || [];
          return {
            async get() {
              return {
                docs: rows.map((r) => ({
                  id: r.id,
                  exists: true,
                  data: () => structuredClone(r.data),
                })),
              };
            },
            doc(docId: string) {
              return {
                async get() {
                  const found = rows.find((r) => r.id === docId);
                  return {
                    id: docId,
                    exists: Boolean(found),
                    data: () => (found ? structuredClone(found.data) : undefined),
                  };
                },
              };
            },
          };
        },
      };

      const report = await runReadOnlyUserAudit({
        adminAuth: readOnlyAuth,
        adminDb: readOnlyDb,
        projectId: 'test-project-readonly',
      });

      assert.equal(report.executed, true);
      assert.equal(report.readOnlyVerified, true);
      assert.equal(report.summary.firebaseAuthUsers, 4);
      assert.equal(report.summary.firestoreUsers, 4);
      assert.equal(report.summary.authUsernames, 2);
      assert.equal(report.summary.staffCredentials, 2);
      assert.equal(report.summary.authSetupExists, false);
      assert.equal(report.summary.matchedAuthAndFirestore, 3);
      assert.equal(report.summary.firestoreOnlyOrphans, 1);
      assert.equal(report.summary.authOnlyOrphans, 1);
      assert.equal(report.summary.orphanedUsernames, 1);
      assert.equal(report.summary.orphanedCredentials, 1);
      assert.equal(report.summary.duplicateUsernames, 1);
      assert.equal(report.summary.invalidUsernames, 1);
      assert.equal(report.summary.nonNormalizedRoles, 1);
      assert.equal(report.summary.statusAuthMismatches, 1);
      assert.equal(report.summary.activeAdministrators, 1);
      assert.equal(report.summary.administratorsReadyForNewLogin, 0);
      assert.equal(report.summary.lockoutRiskIfDeployedNow, true);
      assert.equal(report.summary.accountsReadyForNewLogin, 1);
      assert.equal(report.anomalies.unmappedOperationalUids.length, 1);
      assert.equal(report.anomalies.unmappedOperationalUids[0].uid, 'uid-historical-deleted');

      const driverAcc = report.accounts.find((a) => a.uid === 'uid-firestore-only-driver');
      assert.equal(driverAcc?.operationalRefs.ordersAsDriverCount, 1);
      assert.equal(driverAcc?.operationalRefs.mustPreserveUid, true);

      // STRICT ZERO-SECRET LEAKAGE CHECK on BOTH JSON and formatted text report
      const jsonOut = JSON.stringify(report);
      const textOut = formatReadOnlyAuditReport(report);
      for (const output of [jsonOut, textOut]) {
        assert.ok(!output.includes(secretHash.passwordHash), 'passwordHash NUNCA pode aparecer no relatório');
        assert.ok(!output.includes(secretHash.passwordSalt), 'passwordSalt NUNCA pode aparecer no relatório');
        assert.ok(!output.includes('SuperSecretPass#2026'), 'Senha NUNCA pode aparecer no relatório');
        assert.ok(!output.includes('PLAIN_LEAK_SHOULD_NEVER_APPEAR'), 'Campo password acidental NUNCA pode vazar');
        assert.ok(!output.includes('dono.amandita@gmail.com'), 'E-mail completo deve permanecer mascarado');
      }
    });

    await test('7. Auditoria estática e CLI do scripts/audit_users_readonly.ts: zero escritas, rejeita segredos na CLI e informa ausência de credenciais sem simular dados', async () => {
      const scriptPath = path.resolve(process.cwd(), 'scripts/audit_users_readonly.ts');
      const source = fs.readFileSync(scriptPath, 'utf8');

      // Static verification: zero Firebase/Firestore write methods in audit_users_readonly.ts
      const forbiddenWriteCalls = [
        /\.set\s*\(/,
        /\.add\s*\(/,
        /\.update\s*\(/,
        /\.delete\s*\(/,
        /\.createUser\s*\(/,
        /\.updateUser\s*\(/,
        /\.deleteUser\s*\(/,
        /\.setCustomUserClaims\s*\(/,
        /\.revokeRefreshTokens\s*\(/,
        /\.runTransaction\s*\(/,
        /\.batch\s*\(/,
      ];
      for (const regex of forbiddenWriteCalls) {
        // Ignore Map.set() / Set.add() / Map.delete() — verify only Firestore/Auth write calls aren't present
        if (regex.source.includes('\\.set') || regex.source.includes('\\.add') || regex.source.includes('\\.delete')) {
          const matches = source.match(new RegExp(`[A-Za-z0-9_$.]+${regex.source}`, 'g')) || [];
          for (const m of matches) {
            const isInMemoryCollection =
              /(Map|Set|ByUid|ByName|ToUids|Uids|opRefsMap)\.(set|add|delete)\s*\(/.test(m) ||
              /firestoreUids\.add\s*\(/.test(m);
            assert.ok(isInMemoryCollection, `Chamada potencialmente mutante não autorizada encontrada: ${m}`);
          }
        } else {
          assert.equal(regex.test(source), false, `Chamada de escrita proibida encontrada: ${regex}`);
        }
      }

      // CLI arg validator unit checks
      assert.equal(assertSafeCliArgs([]).ok, true);
      assert.equal(assertSafeCliArgs(['--json']).ok, true);
      assert.equal(assertSafeCliArgs(['--private-key=abc']).ok, false);
      assert.equal(assertSafeCliArgs(['--token=xyz']).ok, false);
      assert.equal(assertSafeCliArgs(['{"client_email":"a@b"}']).ok, false);

      // Run CLI in clean env without Firebase credentials -> MUST report NO_ENVIRONMENT_CREDENTIALS (exit 2)
      const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
      delete cleanEnv.FIREBASE_SERVICE_ACCOUNT;
      delete cleanEnv.FIREBASE_SERVICE_ACCOUNT_KEY;
      delete cleanEnv.FIREBASE_CLIENT_EMAIL;
      delete cleanEnv.FIREBASE_PRIVATE_KEY;
      delete cleanEnv.GOOGLE_APPLICATION_CREDENTIALS;

      const noCredRun = spawnSync('npx', ['tsx', 'scripts/audit_users_readonly.ts', '--json'], {
        cwd: process.cwd(),
        env: cleanEnv,
        encoding: 'utf8',
        timeout: 20000,
      });
      assert.equal(noCredRun.status, 2);
      const parsed = JSON.parse(noCredRun.stdout);
      assert.equal(parsed.executed, false);
      assert.equal(parsed.reason, 'NO_ENVIRONMENT_CREDENTIALS');
      assert.equal(parsed.readOnlyVerified, true);

      // Run CLI with forbidden secret flag -> MUST refuse (exit 3)
      const secretArgRun = spawnSync('npx', ['tsx', 'scripts/audit_users_readonly.ts', '--secret=12345'], {
        cwd: process.cwd(),
        env: cleanEnv,
        encoding: 'utf8',
        timeout: 20000,
      });
      assert.equal(secretArgRun.status, 3);
      assert.ok(secretArgRun.stderr.includes('Segurança'));
    });

    await test('8. Seleção inequívoca por targetUid: bloqueia ambiguidade entre múltiplos admins e recupera somente o UID escolhido', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();
      process.env.ADMIN_RECOVERY_KEY = VALID_KEY;

      const uidPrimary = 'admin-uid-primary-1';
      const uidOtherA = 'admin-uid-other-2';
      const uidOtherB = 'admin-uid-other-3';

      for (const uid of [uidPrimary, uidOtherA, uidOtherB]) {
        await simAuth.createUser({ uid, disabled: false });
        simDb.setRaw('users', uid, {
          id: uid,
          name: 'Amanda Silveira (Administradora)',
          username: 'admin',
          role: 'ADMINISTRADOR',
          status: 'ATIVO',
          allowedModules: [...OFFICIAL_APP_MODULES],
        });
      }

      // 8a. Sem targetUid e sem currentUsername -> 400 ADMIN_TARGET_AMBIGUOUS
      const ambigNoArgs = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        newUsername: 'amanda_oficial',
        newPassword: 'SenhaSegura#2026',
      });
      assert.equal(ambigNoArgs.status, 400);
      assert.equal(ambigNoArgs.data.code, 'ADMIN_TARGET_AMBIGUOUS');

      // 8b. Apenas currentUsername='admin' quando 3 admins compartilham 'admin' -> 400 ADMIN_TARGET_AMBIGUOUS
      const ambigByUser = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        currentUsername: 'admin',
        newUsername: 'amanda_oficial',
        newPassword: 'SenhaSegura#2026',
      });
      assert.equal(ambigByUser.status, 400);
      assert.equal(ambigByUser.data.code, 'ADMIN_TARGET_AMBIGUOUS');
      assert.equal(simDb.getRaw('staff_credentials', uidPrimary), undefined);
      assert.equal(simDb.getRaw('staff_credentials', uidOtherA), undefined);
      assert.equal(simDb.getRaw('staff_credentials', uidOtherB), undefined);

      // 8c. targetUid inexistente ou incompatível com currentUsername -> 404 ADMIN_NOT_FOUND
      const wrongUid = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        targetUid: 'uid-nao-existe',
        newUsername: 'amanda_oficial',
        newPassword: 'SenhaSegura#2026',
      });
      assert.equal(wrongUid.status, 404);
      assert.equal(wrongUid.data.code, 'ADMIN_NOT_FOUND');

      const mismatchUser = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        targetUid: uidPrimary,
        currentUsername: 'outro_login',
        newUsername: 'amanda_oficial',
        newPassword: 'SenhaSegura#2026',
      });
      assert.equal(mismatchUser.status, 404);
      assert.equal(mismatchUser.data.code, 'ADMIN_NOT_FOUND');

      // 8d. targetUid exato -> recupera EXCLUSIVAMENTE uidPrimary e mantém uidOtherA e uidOtherB intactos
      __resetAuthRateLimitersForTests();
      const okRec = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: VALID_KEY,
        targetUid: uidPrimary,
        newUsername: 'amanda_oficial',
        newPassword: 'SenhaSegura#2026',
      });
      assert.equal(okRec.status, 200);
      assert.equal(okRec.data.user.id, uidPrimary);
      assert.equal(okRec.data.user.username, 'amanda_oficial');
      assert.equal(okRec.data.user.role, 'ADMINISTRADOR');

      // Outras duas contas 100% preservadas sem qualquer mutação
      assert.equal(simDb.getRaw('users', uidOtherA)?.username, 'admin');
      assert.equal(simDb.getRaw('users', uidOtherB)?.username, 'admin');
      assert.equal(simDb.getRaw('staff_credentials', uidOtherA), undefined);
      assert.equal(simDb.getRaw('staff_credentials', uidOtherB), undefined);
      assert.equal(simAuth.users.get(uidOtherA)?.customClaims?.role, undefined);
      assert.equal(simAuth.users.get(uidOtherB)?.customClaims?.role, undefined);

      // Conta recuperada faz login com sucesso preservando UID e permissões
      const loginOk = await api('POST', '/api/auth/login', {
        username: 'amanda_oficial',
        password: 'SenhaSegura#2026',
      });
      assert.equal(loginOk.status, 200);
      assert.equal(loginOk.data.user.id, uidPrimary);
      assert.equal(loginOk.data.user.role, 'ADMINISTRADOR');
      assert.equal(loginOk.data.user.allowedModules.length, OFFICIAL_APP_MODULES.length);
    });
  } finally {
    delete process.env.ADMIN_RECOVERY_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('==============================================================================');
  console.log(`RESULTADO ETAPA 2E: ${passed}/${total} cenários aprovados`);
  console.log('==============================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
