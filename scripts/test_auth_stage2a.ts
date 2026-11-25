import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.DISABLE_AUTO_LISTEN = '1';
process.env.ALLOW_TEST_FIREBASE_OVERRIDES = '1';

import {
  hashPasswordScrypt,
  verifyPasswordScrypt,
  timingSafeStringEqual,
  validateAndNormalizeUsername,
  validateFullName,
  validateAndNormalizePhone,
  validatePasswordStrength,
  OFFICIAL_APP_MODULES,
} from '../src/server/authCrypto.js';
import { app, __setTestFirebaseAdminServices, __resetAuthRateLimitersForTests } from '../src/server/app.js';

// ---------------------------------------------------------------------------
// In-Memory Firestore & Firebase Admin Auth Simulator (Zero Production Touch)
// ---------------------------------------------------------------------------
type DocData = Record<string, any>;

class SimulatedFirestore {
  private readonly store = new Map<string, Map<string, DocData>>();
  private txChain: Promise<unknown> = Promise.resolve();
  public failNextTransactionWrite: { stageMatch?: string; message?: string } | null = null;

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
    // Serialize transactions accurately just like Firestore optimistic/pessimistic isolation
    const run = async (): Promise<T> => {
      const stagedOps: Array<
        | { type: 'set'; col: string; id: string; data: DocData; merge: boolean }
        | { type: 'delete'; col: string; id: string }
      > = [];

      const tx = {
        get: async (docRef: { _col: string; id: string }) => {
          const val = this.store.get(docRef._col)?.get(docRef.id);
          return {
            id: docRef.id,
            exists: val !== undefined,
            data: () => (val !== undefined ? structuredClone(val) : undefined),
          };
        },
        set: (docRef: { _col: string; id: string }, data: DocData, opts?: { merge?: boolean }) => {
          stagedOps.push({ type: 'set', col: docRef._col, id: docRef.id, data: structuredClone(data), merge: Boolean(opts?.merge) });
        },
        delete: (docRef: { _col: string; id: string }) => {
          stagedOps.push({ type: 'delete', col: docRef._col, id: docRef.id });
        },
      };

      const result = await fn(tx);

      if (this.failNextTransactionWrite) {
        const match = this.failNextTransactionWrite.stageMatch;
        const shouldFail =
          !match ||
          stagedOps.some(
            (op) =>
              op.type === 'set' &&
              (op.data.stage === match || op.data.status === match || op.data.provisioningState === match)
          );
        if (shouldFail) {
          const msg = this.failNextTransactionWrite.message || 'Simulated Firestore transaction failure';
          this.failNextTransactionWrite = null;
          throw new Error(msg);
        }
      }

      // Commit staged ops atomically
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
  tokensRevokedAt?: number;
}

class SimulatedAdminAuth {
  public readonly users = new Map<string, SimAuthUser>();
  public readonly tokens = new Map<string, { uid: string; email?: string; role?: string }>();
  public createEvents: Array<{ uid: string; disabled: boolean }> = [];
  public failNextCreateUser: string | null = null;
  public failNextEnableUser: string | null = null;
  public createDelayMs = 0;

  public clearAll(): void {
    this.users.clear();
    this.tokens.clear();
    this.createEvents = [];
    this.failNextCreateUser = null;
    this.failNextEnableUser = null;
    this.createDelayMs = 0;
  }

  public async createUser(props: { displayName?: string; disabled?: boolean; email?: string }) {
    if (this.createDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.createDelayMs));
    }
    if (this.failNextCreateUser) {
      const msg = this.failNextCreateUser;
      this.failNextCreateUser = null;
      throw new Error(msg);
    }
    const uid = `uid-${crypto.randomBytes(6).toString('hex')}`;
    const user: SimAuthUser = {
      uid,
      displayName: props.displayName,
      disabled: Boolean(props.disabled),
      email: props.email,
    };
    this.users.set(uid, user);
    this.createEvents.push({ uid, disabled: user.disabled });
    return { uid, displayName: user.displayName, disabled: user.disabled };
  }

  public async updateUser(uid: string, props: { displayName?: string; disabled?: boolean }) {
    if (props.disabled === false && this.failNextEnableUser) {
      const msg = this.failNextEnableUser;
      this.failNextEnableUser = null;
      throw new Error(msg);
    }
    const u = this.users.get(uid);
    if (!u) {
      const err: any = new Error('auth/user-not-found');
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
    const u = this.users.get(uid);
    if (u) u.customClaims = { ...claims };
  }

  public async revokeRefreshTokens(uid: string) {
    const u = this.users.get(uid);
    if (u) u.tokensRevokedAt = Date.now();
  }

  public async createCustomToken(uid: string) {
    const token = `custom-tok-${uid}-${crypto.randomBytes(4).toString('hex')}`;
    this.tokens.set(token, { uid });
    return token;
  }

  public registerBearerToken(token: string, info: { uid: string; email?: string; role?: string }) {
    this.tokens.set(token, info);
  }

  public async verifyIdToken(token: string) {
    const entry = this.tokens.get(token);
    if (!entry) {
      throw new Error('Invalid Firebase token');
    }
    const u = this.users.get(entry.uid);
    return {
      uid: entry.uid,
      email: entry.email || u?.email || '',
      role: entry.role || u?.customClaims?.role,
    };
  }
}

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------
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

  async function api(
    method: string,
    path: string,
    body?: any,
    token?: string,
    extraHeaders?: Record<string, string>
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders || {}),
    };
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

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
  console.log('TESTES ETAPA 2A — NÚCLEO DE AUTENTICAÇÃO, PROVISIONAMENTO EM ETAPAS E RBAC');
  console.log('==============================================================================');

  try {
    await test('1. Núcleo criptográfico scrypt gera salt aleatório, não armazena texto puro e valida em tempo constante', async () => {
      const h1 = await hashPasswordScrypt('Senh@Forte2026');
      const h2 = await hashPasswordScrypt('Senh@Forte2026');
      assert.equal(h1.hashAlgo, 'scrypt');
      assert.notEqual(h1.passwordSalt, h2.passwordSalt, 'Cada hash deve ter salt único');
      assert.notEqual(h1.passwordHash, h2.passwordHash, 'Mesma senha deve gerar hashes distintos');
      assert.ok(!h1.passwordHash.includes('Senh@Forte2026'));
      assert.equal(await verifyPasswordScrypt('Senh@Forte2026', h1), true);
      assert.equal(await verifyPasswordScrypt('senha-errada', h1), false);
      assert.equal(await verifyPasswordScrypt('Senh@Forte2026', { ...h1, hashParams: { N: 99999999, r: 8, p: 1, keyLen: 64 } }), false);
      assert.equal(timingSafeStringEqual('chave-secreta-123456', 'chave-secreta-123456'), true);
      assert.equal(timingSafeStringEqual('chave-secreta-123456', 'chave-secreta-123457'), false);
    });

    await test('2. Validadores rejeitam e-mail no login e exigem nome completo, contato e senha >= 6', async () => {
      assert.equal(validateAndNormalizeUsername('amanda@gmail.com').valid, false);
      assert.equal(validateAndNormalizeUsername('admin@amanditasabores.com.br').valid, false);
      assert.equal(validateAndNormalizeUsername('joao silva').valid, false);
      assert.equal(validateAndNormalizeUsername('ab').valid, false);
      assert.deepEqual(validateAndNormalizeUsername('  Amanda_Gestao.01  '), { valid: true, value: 'amanda_gestao.01' });
      assert.equal(validateFullName('A').valid, false);
      assert.equal(validateAndNormalizePhone('12345').valid, false);
      assert.equal(validateAndNormalizePhone('(83) 99988-7766').value, '83999887766');
      assert.equal(validatePasswordStrength('12345').valid, false);
      assert.equal(validatePasswordStrength('      ').valid, false);
      assert.equal(validatePasswordStrength('amandita2026').valid, true);
    });

    await test('3. Primeiro acesso: bootstrap-status indica setup_required em base limpa e fail-closed sem Admin SDK', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();

      const st1 = await api('GET', '/api/auth/bootstrap-status');
      assert.equal(st1.status, 200);
      assert.equal(st1.data.initialized, false);
      assert.equal(st1.data.mode, 'setup_required');

      // Fail-closed when Admin SDK is missing
      __setTestFirebaseAdminServices({ adminDb: null, adminAuth: null });
      const st2 = await api('GET', '/api/auth/bootstrap-status');
      assert.equal(st2.status, 503);
      assert.equal(st2.data.initialized, true);
      __setTestFirebaseAdminServices({ adminDb: simDb as any, adminAuth: simAuth as any });
    });

    await test('4. Provisionamento em etapas do 1º admin: cria Auth desabilitado -> grava Firestore -> habilita -> confirma ACTIVE', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();

      const res = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Silveira',
        username: 'amanda_gestao',
        phone: '(83) 99123-4567',
        password: 'SenhaSegura#2026',
        idempotencyKey: 'boot-op-0001',
      });

      assert.equal(res.status, 201);
      assert.equal(res.data.success, true);
      assert.ok(res.data.customToken);
      assert.equal(res.data.user.username, 'amanda_gestao');
      assert.equal(res.data.user.role, 'ADMINISTRADOR');
      assert.equal(res.data.user.phone, '83991234567');
      assert.equal(res.data.user.password, undefined);
      assert.equal(res.data.user.passwordHash, undefined);
      assert.equal(res.data.user.passwordSalt, undefined);

      // Verify Firebase Auth was created disabled FIRST and only enabled later
      assert.equal(simAuth.createEvents.length, 1);
      assert.equal(simAuth.createEvents[0].disabled, true, 'Auth deve ser criado inicialmente desabilitado');
      const authUser = simAuth.users.get(res.data.user.id);
      assert.equal(authUser?.disabled, false, 'Auth deve estar habilitado após confirmação');

      // Verify persisted states
      const setupDoc = simDb.getRaw('configs', 'auth_setup');
      assert.equal(setupDoc?.status, 'COMPLETED');
      assert.equal(setupDoc?.initialized, true);

      const unDoc = simDb.getRaw('auth_usernames', 'amanda_gestao');
      assert.equal(unDoc?.status, 'ACTIVE');
      assert.equal(unDoc?.uid, res.data.user.id);

      const credDoc = simDb.getRaw('staff_credentials', res.data.user.id);
      assert.equal(credDoc?.hashAlgo, 'scrypt');
      assert.equal(credDoc?.provisioningState, 'ACTIVE');
      assert.ok(!JSON.stringify(credDoc).includes('SenhaSegura#2026'));

      // Idempotent replay with SAME idempotencyKey returns 200 without creating second Auth user
      const replay = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Silveira',
        username: 'amanda_gestao',
        phone: '(83) 99123-4567',
        password: 'SenhaSegura#2026',
        idempotencyKey: 'boot-op-0001',
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.data.idempotentReplay, true);
      assert.equal(simAuth.users.size, 1);

      // Second attempt with DIFFERENT operationId is permanently blocked (409)
      const second = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Invasor',
        username: 'outro_admin',
        phone: '83999990000',
        password: 'Password123',
        idempotencyKey: 'boot-op-0002',
      });
      assert.equal(second.status, 409);
      assert.equal(second.data.code, 'BOOTSTRAP_ALREADY_COMPLETED');

      const stAfter = await api('GET', '/api/auth/bootstrap-status');
      assert.equal(stAfter.data.initialized, true);
      assert.equal(stAfter.data.mode, 'login');
    });

    await test('5. Concorrência no 1º acesso: 2 solicitações simultâneas só permitem 1 vencedor', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();
      simAuth.createDelayMs = 40;

      const [r1, r2] = await Promise.all([
        api('POST', '/api/auth/bootstrap-admin', {
          name: 'Admin Um',
          username: 'admin_um',
          phone: '83991112222',
          password: 'PasswordA1',
          idempotencyKey: 'race-op-1111',
        }),
        api('POST', '/api/auth/bootstrap-admin', {
          name: 'Admin Dois',
          username: 'admin_dois',
          phone: '83993334444',
          password: 'PasswordB2',
          idempotencyKey: 'race-op-2222',
        }),
      ]);

      simAuth.createDelayMs = 0;
      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      assert.deepEqual(statuses, [201, 409], `Esperado [201, 409], recebido ${JSON.stringify(statuses)}`);
      assert.equal(simAuth.users.size, 1, 'Apenas 1 usuário Firebase Auth deve existir');
    });

    await test('6. Recuperação após falha na Etapa 4 (enableUser) reverte conta parcial no Auth e Firestore e permite retentativa', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();

      simAuth.failNextEnableUser = 'Simulated transient Auth enable error';
      const failed = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Recuperavel',
        username: 'amanda_rec',
        phone: '83991234567',
        password: 'SenhaRecuperavel1',
        idempotencyKey: 'fail-stage4-op1',
      });

      assert.equal(failed.status, 500);
      assert.equal(failed.data.code, 'PROVISIONING_ENABLE_FAILED');
      // Compensating rollback MUST have removed partial Auth user and Firestore docs
      assert.equal(simAuth.users.size, 0, 'Conta Auth parcial deve ter sido removida no rollback');
      assert.equal(simDb.getRaw('configs', 'auth_setup'), undefined, 'auth_setup deve ter sido revertido');
      assert.equal(simDb.getRaw('auth_usernames', 'amanda_rec'), undefined, 'Reserva de username deve ter sido liberada');

      // Login MUST NOT work
      const tryLogin = await api('POST', '/api/auth/login', {
        username: 'amanda_rec',
        password: 'SenhaRecuperavel1',
      });
      assert.equal(tryLogin.status, 401);

      // Retry succeeds cleanly now
      const retry = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Recuperavel',
        username: 'amanda_rec',
        phone: '83991234567',
        password: 'SenhaRecuperavel1',
        idempotencyKey: 'fail-stage4-op2',
      });
      assert.equal(retry.status, 201);
      assert.equal(simAuth.users.size, 1);
    });

    await test('7. Recuperação de lease expirado (queda no meio do provisionamento) limpa órfão e impede acesso a conta incompleta', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();

      // Simulate crashed setup leaving a disabled Auth user + expired lease + FINALIZING docs
      const orphan = await simAuth.createUser({ displayName: 'Orphan', disabled: true });
      const expiredIso = new Date(Date.now() - 120_000).toISOString();
      simDb.setRaw('configs', 'auth_setup', {
        status: 'FINALIZING',
        stage: 'DB_STAGED',
        initialized: false,
        operationId: 'crashed-op-9999',
        username: 'amanda_crash',
        uid: orphan.uid,
        leaseExpiresAt: expiredIso,
      });
      simDb.setRaw('auth_usernames', 'amanda_crash', {
        username: 'amanda_crash',
        uid: orphan.uid,
        status: 'FINALIZING',
        operationId: 'crashed-op-9999',
        leaseExpiresAt: expiredIso,
      });
      simDb.setRaw('users', orphan.uid, {
        id: orphan.uid,
        username: 'amanda_crash',
        role: 'ADMINISTRADOR',
        status: 'ATIVO',
        provisioningState: 'FINALIZING',
        provisioningOperationId: 'crashed-op-9999',
      });
      const orphanHash = await hashPasswordScrypt('OrphanPass123');
      simDb.setRaw('staff_credentials', orphan.uid, {
        uid: orphan.uid,
        ...orphanHash,
        provisioningState: 'FINALIZING',
        provisioningOperationId: 'crashed-op-9999',
      });

      // Partial account MUST NOT be able to log in or access protected API
      const loginPartial = await api('POST', '/api/auth/login', {
        username: 'amanda_crash',
        password: 'OrphanPass123',
      });
      assert.equal(loginPartial.status, 401);

      simAuth.registerBearerToken('tok-orphan', { uid: orphan.uid });
      const staffPartial = await api('GET', '/api/auth/staff', undefined, 'tok-orphan');
      assert.equal(staffPartial.status, 403);

      // Fresh bootstrap recovers expired lease, cleans orphaned Auth user, and succeeds!
      const recovered = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Nova',
        username: 'amanda_crash',
        phone: '83988776655',
        password: 'NovaSenhaValida1',
        idempotencyKey: 'recovery-lease-op1',
      });
      assert.equal(recovered.status, 201);
      assert.equal(simAuth.users.has(orphan.uid), false, 'Usuário Auth órfão antigo deve ser removido');
      assert.equal(simAuth.users.size, 1);
    });

    await test('8. Login seguro, rejeição de e-mail, força bruta (lockout após 5 falhas) e remoção de backdoor Gmail', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();

      const boot = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Oficial',
        username: 'amanda_chefe',
        phone: '83999001122',
        password: 'AdminPassword!99',
        idempotencyKey: 'boot-login-test',
      });
      assert.equal(boot.status, 201);

      // Reject email format on login
      const emailLogin = await api('POST', '/api/auth/login', {
        username: 'dvrmercadinho@gmail.com',
        password: 'AdminPassword!99',
      });
      assert.equal(emailLogin.status, 400);
      assert.equal(emailLogin.data.code, 'INVALID_USERNAME');

      // Hardcoded Gmail bearer token WITHOUT active Firestore users/{uid} MUST BE REJECTED
      simAuth.registerBearerToken('tok-gmail-legacy', {
        uid: 'uid-gmail-no-profile',
        email: 'dvrmercadinho@gmail.com',
      });
      const gmailBypass = await api('GET', '/api/auth/staff', undefined, 'tok-gmail-legacy');
      assert.equal(gmailBypass.status, 403, 'Gmail hardcoded não pode mais autorizar acesso administrativo');

      // Valid login succeeds
      const okLogin = await api('POST', '/api/auth/login', {
        username: 'amanda_chefe',
        password: 'AdminPassword!99',
      });
      assert.equal(okLogin.status, 200);
      assert.ok(okLogin.data.customToken);
      assert.equal(okLogin.data.user.role, 'ADMINISTRADOR');

      // Brute-force: 5 wrong passwords trigger ACCOUNT_TEMPORARILY_LOCKED (429)
      for (let i = 1; i <= 4; i++) {
        const fail = await api('POST', '/api/auth/login', {
          username: 'amanda_chefe',
          password: `errada-${i}`,
        });
        assert.equal(fail.status, 401);
      }
      const fifth = await api('POST', '/api/auth/login', {
        username: 'amanda_chefe',
        password: 'errada-5',
      });
      assert.equal(fifth.status, 429);
      assert.equal(fifth.data.code, 'ACCOUNT_TEMPORARILY_LOCKED');

      // Even correct password is blocked while account lockout is active
      const lockedCorrect = await api('POST', '/api/auth/login', {
        username: 'amanda_chefe',
        password: 'AdminPassword!99',
      });
      assert.equal(lockedCorrect.status, 429);
    });

    await test('9. Somente ADMINISTRADOR gerencia funcionários; GERENTE e demais cargos recebem 403', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();

      const boot = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Admin',
        username: 'amanda_adm',
        phone: '83991110000',
        password: 'AdminPassword!1',
        idempotencyKey: 'boot-rbac-test',
      });
      const adminToken = boot.data.customToken;
      const adminUid = boot.data.user.id;

      // Admin registers GERENTE
      const createGerente = await api(
        'POST',
        '/api/auth/register-staff',
        {
          name: 'Juliana Castro',
          username: 'juliana_gerente',
          phone: '(83) 98888-1111',
          password: 'GerentePassword1',
          role: 'GERENTE',
          idempotencyKey: 'staff-gerente-1',
        },
        adminToken
      );
      assert.equal(createGerente.status, 201);
      const gerenteUid = createGerente.data.user.id;

      // Trying to grant 'usuarios' module to GERENTE is rejected (400)
      const badModule = await api(
        'POST',
        '/api/auth/register-staff',
        {
          name: 'Carlos Caixa',
          username: 'carlos_caixa',
          phone: '83988882222',
          password: 'CaixaPassword1',
          role: 'CAIXA',
          allowedModules: ['pdv', 'caixa', 'usuarios'],
        },
        adminToken
      );
      assert.equal(badModule.status, 400);
      assert.equal(badModule.data.code, 'INVALID_MODULES');

      // Duplicate username rejected on server (409)
      const dupUser = await api(
        'POST',
        '/api/auth/register-staff',
        {
          name: 'Outra Juliana',
          username: 'juliana_gerente',
          phone: '83988883333',
          password: 'OutroPassword1',
          role: 'CAIXA',
        },
        adminToken
      );
      assert.equal(dupUser.status, 409);
      assert.equal(dupUser.data.code, 'USERNAME_TAKEN');

      // Gerente logs in and tries EVERY admin staff endpoint -> ALL MUST RETURN 403
      const gerenteLogin = await api('POST', '/api/auth/login', {
        username: 'juliana_gerente',
        password: 'GerentePassword1',
      });
      assert.equal(gerenteLogin.status, 200);
      const gerenteToken = gerenteLogin.data.customToken;

      assert.equal((await api('GET', '/api/auth/staff', undefined, gerenteToken)).status, 403);
      assert.equal(
        (
          await api(
            'POST',
            '/api/auth/register-staff',
            {
              name: 'Pedro Motoboy',
              username: 'pedro_moto',
              phone: '83977776666',
              password: 'MotoPassword1',
              role: 'ENTREGADOR',
            },
            gerenteToken
          )
        ).status,
        403
      );
      assert.equal(
        (
          await api(
            'PUT',
            `/api/auth/update-staff/${gerenteUid}`,
            {
              name: 'Juliana Hack',
              username: 'juliana_gerente',
              phone: '83988881111',
              role: 'ADMINISTRADOR',
              status: 'ATIVO',
            },
            gerenteToken
          )
        ).status,
        403
      );
      assert.equal(
        (
          await api(
            'POST',
            '/api/auth/reset-password',
            { targetUid: adminUid, newPassword: 'HackedPassword1' },
            gerenteToken
          )
        ).status,
        403
      );
      assert.equal(
        (
          await api(
            'POST',
            '/api/auth/toggle-status',
            { targetUid: adminUid, status: 'BLOQUEADO' },
            gerenteToken
          )
        ).status,
        403
      );
      assert.equal((await api('DELETE', `/api/auth/delete-staff/${adminUid}`, undefined, gerenteToken)).status, 403);

      // Admin cannot block/delete themselves or last admin
      assert.equal(
        (await api('POST', '/api/auth/toggle-status', { targetUid: adminUid, status: 'BLOQUEADO' }, adminToken)).status,
        403
      );
      assert.equal((await api('DELETE', `/api/auth/delete-staff/${adminUid}`, undefined, adminToken)).status, 403);

      // Admin blocks gerente -> Auth disabled, tokens revoked, login rejected (403)
      const blockRes = await api(
        'POST',
        '/api/auth/toggle-status',
        { targetUid: gerenteUid, status: 'BLOQUEADO' },
        adminToken
      );
      assert.equal(blockRes.status, 200);
      assert.equal(simAuth.users.get(gerenteUid)?.disabled, true);
      assert.ok(simAuth.users.get(gerenteUid)?.tokensRevokedAt);
      const blockedLogin = await api('POST', '/api/auth/login', {
        username: 'juliana_gerente',
        password: 'GerentePassword1',
      });
      assert.equal(blockedLogin.status, 403);
      assert.equal(blockedLogin.data.code, 'ACCOUNT_BLOCKED');

      // Admin unblocks and resets password
      assert.equal(
        (await api('POST', '/api/auth/toggle-status', { targetUid: gerenteUid, status: 'ATIVO' }, adminToken)).status,
        200
      );
      assert.equal(
        (
          await api(
            'POST',
            '/api/auth/reset-password',
            { targetUid: gerenteUid, newPassword: 'NovaSenhaGerente9' },
            adminToken
          )
        ).status,
        200
      );
      assert.equal(
        (await api('POST', '/api/auth/login', { username: 'juliana_gerente', password: 'GerentePassword1' })).status,
        401
      );
      assert.equal(
        (await api('POST', '/api/auth/login', { username: 'juliana_gerente', password: 'NovaSenhaGerente9' })).status,
        200
      );
    });

    await test('10. Administrador altera próprio login e senha preservando cargo ADMINISTRADOR e todas as permissões', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();

      const boot = await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Inicial',
        username: 'amanda_v1',
        phone: '83991112233',
        password: 'InitialPassword1',
        idempotencyKey: 'boot-self-cred',
      });
      const adminToken = boot.data.customToken;

      // Wrong current password rejected
      const wrongCur = await api(
        'POST',
        '/api/auth/account/credentials',
        { currentPassword: 'WrongPassword', newUsername: 'amanda_v2' },
        adminToken
      );
      assert.equal(wrongCur.status, 401);

      // Valid credential rotation
      const rotated = await api(
        'POST',
        '/api/auth/account/credentials',
        {
          currentPassword: 'InitialPassword1',
          newUsername: 'amanda_v2',
          newPassword: 'RotatedPassword2',
          name: 'Amanda Silveira Atualizada',
          phone: '83999887766',
        },
        adminToken
      );
      assert.equal(rotated.status, 200);
      assert.equal(rotated.data.user.username, 'amanda_v2');
      assert.equal(rotated.data.user.role, 'ADMINISTRADOR');
      assert.equal(rotated.data.user.status, 'ATIVO');
      assert.equal(rotated.data.user.allowedModules.length, OFFICIAL_APP_MODULES.length);

      // Old username fails; new username + new password works
      assert.equal((await api('POST', '/api/auth/login', { username: 'amanda_v1', password: 'InitialPassword1' })).status, 401);
      assert.equal((await api('POST', '/api/auth/login', { username: 'amanda_v2', password: 'InitialPassword1' })).status, 401);
      const okNew = await api('POST', '/api/auth/login', { username: 'amanda_v2', password: 'RotatedPassword2' });
      assert.equal(okNew.status, 200);
      assert.equal(okNew.data.user.role, 'ADMINISTRADOR');
      assert.equal(okNew.data.user.allowedModules.length, OFFICIAL_APP_MODULES.length);

      // Re-verify password endpoint works
      const verifyOk = await api('POST', '/api/auth/verify-password', { password: 'RotatedPassword2' }, okNew.data.customToken);
      assert.equal(verifyOk.status, 200);
      const verifyBad = await api('POST', '/api/auth/verify-password', { password: 'WrongPassword' }, okNew.data.customToken);
      assert.equal(verifyBad.status, 401);
    });

    await test('11. Recuperação emergencial administrativa via ADMIN_RECOVERY_KEY (sem Gmail)', async () => {
      simDb.clearAll();
      simAuth.clearAll();
      __resetAuthRateLimitersForTests();
      delete process.env.ADMIN_RECOVERY_KEY;

      await api('POST', '/api/auth/bootstrap-admin', {
        name: 'Amanda Recovery',
        username: 'amanda_master',
        phone: '83991112233',
        password: 'LostPassword123',
        idempotencyKey: 'boot-recovery-test',
      });

      // Disabled by default when env var is not configured
      const disabledRes = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: 'any-key',
        newPassword: 'RecoveredPass123',
      });
      assert.equal(disabledRes.status, 503);
      assert.equal(disabledRes.data.code, 'RECOVERY_DISABLED');

      // Enable key temporarily in server env
      process.env.ADMIN_RECOVERY_KEY = 'amandita-emergency-recovery-2026-secret';

      // Wrong key rejected (403)
      const wrongKey = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: 'wrong-key-value-1234567890',
        newPassword: 'RecoveredPass123',
      });
      assert.equal(wrongKey.status, 403);

      // Valid key recovers password and rotates username
      const okRec = await api('POST', '/api/auth/admin-recovery', {
        recoveryKey: 'amandita-emergency-recovery-2026-secret',
        currentUsername: 'amanda_master',
        newUsername: 'amanda_recuperada',
        newPassword: 'RecoveredPass#2026',
      });
      assert.equal(okRec.status, 200);
      assert.equal(okRec.data.user.username, 'amanda_recuperada');
      assert.equal(okRec.data.user.role, 'ADMINISTRADOR');

      const loginRecovered = await api('POST', '/api/auth/login', {
        username: 'amanda_recuperada',
        password: 'RecoveredPass#2026',
      });
      assert.equal(loginRecovered.status, 200);
      delete process.env.ADMIN_RECOVERY_KEY;
    });
  } finally {
    delete process.env.ADMIN_RECOVERY_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('==============================================================================');
  console.log(`RESULTADO ETAPA 2A: ${passed}/${total} cenários aprovados`);
  console.log('==============================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
