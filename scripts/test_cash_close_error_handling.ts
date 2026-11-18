/**
 * Suite Específica — Tratamento de Erros HTTP/HTML/Incerto no Fechamento do Caixa
 * e Demais Operações Financeiras (Amandita Sabores)
 *
 * Cobre integralmente os 8 cenários obrigatórios + métodos financeiros irmãos
 * em `src/services/store.ts` sem tocar em dados reais de produção no Firestore.
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

process.env.DISABLE_AUTO_LISTEN = '1';
process.env.ALLOW_TEST_FIREBASE_OVERRIDES = '1';
delete process.env.VITE_FIREBASE_API_KEY;
process.env.FIREBASE_PROJECT_ID = 'amandita-sabores';

const storageMap = new Map<string, string>();
const dispatchedEvents: Array<{ type: string; detail?: unknown }> = [];

(globalThis as any).localStorage = {
  getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
  setItem: (k: string, v: string) => storageMap.set(k, String(v)),
  removeItem: (k: string) => storageMap.delete(k),
  clear: () => storageMap.clear(),
};

(globalThis as any).CustomEvent = class MockCustomEvent {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

(globalThis as any).window = {
  location: { origin: 'http://127.0.0.1', search: '', hash: '', pathname: '/' },
  dispatchEvent: (ev: { type: string; detail?: unknown }) => {
    dispatchedEvents.push(ev);
    return true;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    onLine: true,
    userAgent: 'AmanditaCashCloseErrorTest/1.0',
  },
});

const tmpTombstonePath = path.join(process.cwd(), '.deleted_orders_cache.json');
const hadExistingTombstoneFile = fs.existsSync(tmpTombstonePath);
const existingTombstoneBackup = hadExistingTombstoneFile ? fs.readFileSync(tmpTombstonePath, 'utf8') : null;

const tmpPushCachePath = path.join(process.cwd(), '.push_dispatches_cache.json');
const hadExistingPushCacheFile = fs.existsSync(tmpPushCachePath);
const existingPushCacheBackup = hadExistingPushCacheFile ? fs.readFileSync(tmpPushCachePath, 'utf8') : null;

interface StoredDoc {
  data: Record<string, any>;
  version: number;
}

function deepClone<T>(val: T): T {
  return val === undefined ? (undefined as any) : JSON.parse(JSON.stringify(val));
}

class TransactionalFirestoreSimulator {
  private cols = new Map<string, Map<string, StoredDoc>>();
  private colVersions = new Map<string, number>();

  private ensureCol(name: string): Map<string, StoredDoc> {
    let m = this.cols.get(name);
    if (!m) {
      m = new Map();
      this.cols.set(name, m);
      this.colVersions.set(name, 1);
    }
    return m;
  }

  public seedDoc(colName: string, docId: string, data: Record<string, any>): void {
    const col = this.ensureCol(colName);
    const prev = col.get(docId);
    col.set(docId, { data: deepClone(data), version: (prev?.version || 0) + 1 });
    this.colVersions.set(colName, (this.colVersions.get(colName) || 1) + 1);
  }

  public clearCollection(colName: string): void {
    this.cols.set(colName, new Map());
    this.colVersions.set(colName, (this.colVersions.get(colName) || 1) + 1);
  }

  public getRawDoc(colName: string, docId: string): Record<string, any> | undefined {
    const entry = this.cols.get(colName)?.get(docId);
    return entry ? deepClone(entry.data) : undefined;
  }

  private makeDocSnapshot(colName: string, docId: string, ref: any) {
    const entry = this.cols.get(colName)?.get(docId);
    return {
      exists: Boolean(entry),
      id: docId,
      ref,
      data: () => (entry ? deepClone(entry.data) : undefined),
    };
  }

  private runQuerySync(colName: string, filters: Array<{ field: string; op: string; value: any }>, limitNum?: number) {
    const col = this.ensureCol(colName);
    let entries = Array.from(col.entries()).filter(([, entry]) => {
      for (const f of filters) {
        if (f.op === '==' && entry.data[f.field] !== f.value) return false;
      }
      return true;
    });
    if (typeof limitNum === 'number' && limitNum >= 0) {
      entries = entries.slice(0, limitNum);
    }
    const docs = entries.map(([id, entry]) => ({
      exists: true,
      id,
      ref: this.docRef(colName, id),
      data: () => deepClone(entry.data),
    }));
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (cb: (d: any) => void) => docs.forEach(cb),
    };
  }

  private docRef(colName: string, docId: string): any {
    const self = this;
    return {
      __kind: 'docRef',
      colName,
      id: docId,
      path: `${colName}/${docId}`,
      async get() {
        return self.makeDocSnapshot(colName, docId, this);
      },
      async set(data: Record<string, any>, opts?: { merge?: boolean }) {
        const col = self.ensureCol(colName);
        const existing = col.get(docId);
        const nextData = opts?.merge && existing ? { ...deepClone(existing.data), ...deepClone(data) } : deepClone(data);
        col.set(docId, { data: nextData, version: (existing?.version || 0) + 1 });
        self.colVersions.set(colName, (self.colVersions.get(colName) || 1) + 1);
      },
      async update(partial: Record<string, any>) {
        const col = self.ensureCol(colName);
        const existing = col.get(docId);
        if (!existing) throw new Error(`NOT_FOUND: ${colName}/${docId}`);
        col.set(docId, { data: { ...deepClone(existing.data), ...deepClone(partial) }, version: existing.version + 1 });
        self.colVersions.set(colName, (self.colVersions.get(colName) || 1) + 1);
      },
      async delete() {
        const col = self.ensureCol(colName);
        col.delete(docId);
        self.colVersions.set(colName, (self.colVersions.get(colName) || 1) + 1);
      },
    };
  }

  private queryRef(colName: string, filters: Array<{ field: string; op: string; value: any }> = [], limitNum?: number): any {
    const self = this;
    return {
      __kind: 'queryRef',
      colName,
      filters,
      limitNum,
      where(field: string, op: string, value: any) {
        return self.queryRef(colName, [...filters, { field, op, value }], limitNum);
      },
      limit(n: number) {
        return self.queryRef(colName, filters, n);
      },
      async get() {
        return self.runQuerySync(colName, filters, limitNum);
      },
    };
  }

  public collection(colName: string): any {
    const self = this;
    const baseQuery = this.queryRef(colName);
    return {
      ...baseQuery,
      doc: (docId: string) => self.docRef(colName, docId),
    };
  }

  public async runTransaction<T>(updateFn: (tx: any) => Promise<T>): Promise<T> {
    const readDocVersions = new Map<string, number>();
    const pendingOps: Array<{ type: 'set' | 'update' | 'delete'; ref: any; data?: any; merge?: boolean }> = [];
    const tx = {
      get: async (target: any) => {
        if (target?.__kind === 'queryRef') {
          this.ensureCol(target.colName);
          return this.runQuerySync(target.colName, target.filters, target.limitNum);
        }
        const key = `${target.colName}/${target.id}`;
        if (!readDocVersions.has(key)) {
          readDocVersions.set(key, this.cols.get(target.colName)?.get(target.id)?.version || 0);
        }
        return this.makeDocSnapshot(target.colName, target.id, target);
      },
      set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
        pendingOps.push({ type: 'set', ref, data: deepClone(data), merge: opts?.merge });
        return tx;
      },
      update: (ref: any, partial: Record<string, any>) => {
        pendingOps.push({ type: 'update', ref, data: deepClone(partial) });
        return tx;
      },
      delete: (ref: any) => {
        pendingOps.push({ type: 'delete', ref });
        return tx;
      },
    };
    const result = await updateFn(tx);
    for (const op of pendingOps) {
      if (op.type === 'set') await op.ref.set(op.data, { merge: op.merge });
      else if (op.type === 'update') await op.ref.update(op.data);
      else if (op.type === 'delete') await op.ref.delete();
    }
    return result;
  }
}

async function run() {
  const realFetch = globalThis.fetch.bind(globalThis);
  const simDb = new TransactionalFirestoreSimulator();

  const staffTokens: Record<string, { uid: string; email: string; role: string; status: string }> = {
    'tok-admin': { uid: 'uid-admin', email: 'dvrmercadinho@gmail.com', role: 'ADMINISTRADOR', status: 'ATIVO' },
    'tok-caixa': { uid: 'uid-caixa', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
  };

  let activeTestToken = 'tok-caixa';

  const mockAdminAuth = {
    async verifyIdToken(token: string) {
      const hit = staffTokens[token];
      if (!hit) throw new Error('INVALID_TOKEN');
      return { uid: hit.uid, email: hit.email };
    },
  };

  const { default: app, __setTestFirebaseAdminServices } = await import('../server');
  __setTestFirebaseAdminServices({
    adminDb: simDb as any,
    adminAuth: mockAdminAuth as any,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  const expressBaseUrl = `http://127.0.0.1:${address.port}`;

  type FetchInterceptor = (
    urlStr: string,
    init: RequestInit | undefined,
    callLog: Array<{ method: string; url: string }>
  ) => Promise<Response | null> | Response | null;

  const callLog: Array<{ method: string; url: string }> = [];
  let activeInterceptor: FetchInterceptor | null = null;

  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = String(init?.method || 'GET').toUpperCase();
    callLog.push({ method, url: rawUrl });

    const headers = new Headers(init?.headers || {});
    if (!headers.has('Authorization') && activeTestToken) {
      headers.set('Authorization', `Bearer ${activeTestToken}`);
    }

    if (activeInterceptor) {
      const intercepted = await activeInterceptor(rawUrl, { ...init, headers }, callLog);
      if (intercepted) return intercepted;
    }

    const fullUrl = rawUrl.startsWith('/') ? `${expressBaseUrl}${rawUrl}` : rawUrl;
    return realFetch(fullUrl, { ...init, headers });
  };

  const { store } = await import('../src/services/store');
  store.setServerAtomicPaymentMode(true);

  const seedDefaultUsers = () => {
    const users = [
      { id: 'uid-admin', name: 'Admin', username: 'admin', email: 'dvrmercadinho@gmail.com', role: 'ADMINISTRADOR', status: 'ATIVO', allowedModules: ['pdv', 'caixa', 'pedidos', 'cardapio', 'config', 'relatorios'], createdAt: new Date().toISOString() },
      { id: 'uid-caixa', name: 'Caixa', username: 'caixa', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO', allowedModules: ['pdv', 'caixa', 'pedidos'], createdAt: new Date().toISOString() },
    ];
    localStorage.setItem('gf_users', JSON.stringify(users));
    for (const u of users) simDb.seedDoc('users', u.id, u);
  };

  const setLoggedUser = (role: 'ADMINISTRADOR' | 'CAIXA') => {
    activeTestToken = role === 'ADMINISTRADOR' ? 'tok-admin' : 'tok-caixa';
    const users = JSON.parse(localStorage.getItem('gf_users') || '[]');
    const found = users.find((u: any) => u.role === role);
    localStorage.setItem('gf_current_user', JSON.stringify(found));
  };

  const seedOpenShift = (shiftId: string, initialBalance = 150) => {
    const shift = {
      id: shiftId,
      openedAt: '2026-11-17T08:00:00.000Z',
      status: 'ABERTO',
      openedBy: 'Caixa',
      initialBalance,
      movements: [
        {
          id: 'mov-supr-1',
          timestamp: '2026-11-17T08:15:00.000Z',
          type: 'SUPRIMENTO',
          amount: 50,
          paymentMethod: 'DINHEIRO',
          description: 'Troco inicial',
          author: 'Caixa',
        },
        {
          id: 'mov-sang-1',
          timestamp: '2026-11-17T09:00:00.000Z',
          type: 'SANGRIA',
          amount: 40,
          paymentMethod: 'DINHEIRO',
          description: 'Compra gelo',
          author: 'Caixa',
        },
        {
          id: 'cash-sale-ord-1',
          timestamp: '2026-11-17T10:00:00.000Z',
          type: 'VENDA',
          amount: 21,
          paymentMethod: 'DINHEIRO',
          description: 'Venda #101',
          orderId: 'ord-1',
          orderNumber: '#101',
          author: 'Caixa',
        },
      ],
    };
    simDb.seedDoc('cash_shifts', shiftId, shift);
    localStorage.setItem('gf_current_cash_shift', JSON.stringify(shift));
    return shift;
  };

  const resetAllState = () => {
    storageMap.clear();
    dispatchedEvents.length = 0;
    callLog.length = 0;
    activeInterceptor = null;
    __setTestFirebaseAdminServices({
      adminDb: simDb as any,
      adminAuth: mockAdminAuth as any,
    });
    simDb.clearCollection('orders');
    simDb.clearCollection('cash_shifts');
    simDb.clearCollection('users');
    seedDefaultUsers();
    store.setServerAtomicPaymentMode(true);
    setLoggedUser('CAIXA');
  };

  let passed = 0;
  let total = 0;
  const runScenario = async (name: string, fn: () => Promise<void>) => {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✓ [PASS] ${name}`);
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(err);
    }
  };

  try {
    console.log('\n==============================================================================');
    console.log('TESTES DE TRATAMENTO DE ERROS HTTP/HTML/INCERTO NO FECHAMENTO DE CAIXA');
    console.log('==============================================================================\n');

    await runScenario('1. HTTP 200 com JSON de sucesso fecha o turno corretamente e atualiza histórico', async () => {
      resetAllState();
      seedOpenShift('shift-s1', 150);

      // 150 + 21 + 50 - 40 = 181.00
      const res = await store.closeCashRegisterAsync(181, 'Caixa', 'Conferido OK', { shiftId: 'shift-s1' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.synced, true);
      assert.strictEqual(res.shift?.id, 'shift-s1');
      assert.strictEqual(res.shift?.status, 'FECHADO');
      assert.strictEqual(res.shift?.finalCalculatedBalance, 181);
      assert.strictEqual(res.shift?.finalCountedCash, 181);
      assert.strictEqual(res.shift?.difference, 0);
      assert.strictEqual(store.getCurrentCashShift(), null);
      assert.strictEqual(store.getCashShiftHistory().length, 1);
    });

    await runScenario('2. HTTP 200 com HTML inesperado (Proxy Nginx 503->200) é detectado sem false-success e identifica hasAdminSdk: false', async () => {
      resetAllState();
      seedOpenShift('shift-s2a', 150);

      const nginxWarmupHtml = '<!DOCTYPE html><html><head><title>Service Unavailable</title></head><body>App warming up...</body></html>';
      activeInterceptor = (url) => {
        if (url.includes('/close')) {
          return new Response(nginxWarmupHtml, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        if (url.includes('/api/health')) {
          return new Response(JSON.stringify({ ok: true, hasAdminSdk: false, storageMode: 'resilient_client_cache' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return null;
      };

      const resA = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s2a' });
      assert.strictEqual(resA.success, false);
      assert.strictEqual(resA.synced, false);
      assert.strictEqual(resA.rejected, true);
      assert.ok(resA.error?.includes('HTTP 200'), `Deve preservar HTTP 200 na mensagem: ${resA.error}`);
      assert.ok(resA.error?.includes('hasAdminSdk: false'), `Deve informar hasAdminSdk: false: ${resA.error}`);
      assert.ok(resA.error?.includes('HTML'), `Deve mencionar HTML inesperado: ${resA.error}`);
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO');
      assert.strictEqual(simDb.getRawDoc('cash_shifts', 'shift-s2a')?.status, 'ABERTO');

      // Subcaso B: Proxy retornando HTML com HTTP 200 mesmo com hasAdminSdk: true -> consulta /state e confirma que permaneceu ABERTO
      resetAllState();
      seedOpenShift('shift-s2b', 150);
      activeInterceptor = (url) => {
        if (url.includes('/close')) {
          return new Response(nginxWarmupHtml, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        return null; // /api/health (hasAdminSdk: true) e /state vão para o Express real
      };
      const resB = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s2b' });
      assert.strictEqual(resB.success, false);
      assert.strictEqual(resB.uncertain, false);
      assert.ok(resB.error?.includes('HTML') && resB.error?.includes('HTTP 200'), resB.error);
      assert.ok(callLog.some((c) => c.method === 'GET' && c.url.includes('/api/cash-shifts/shift-s2b/state')));
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO');
    });

    await runScenario('3. HTTP 503 com JSON de erro (ADMIN_SDK_UNAVAILABLE) preserva status HTTP 503 e bloqueia fechamento local', async () => {
      resetAllState();
      setLoggedUser('ADMINISTRADOR');
      seedOpenShift('shift-s3', 150);
      __setTestFirebaseAdminServices({
        adminDb: null,
        adminAuth: mockAdminAuth as any,
      });

      const res = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s3' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.rejected, true);
      assert.ok(res.error?.includes('HTTP 503'), `Deve preservar HTTP 503: ${res.error}`);
      assert.ok(res.error?.toLowerCase().includes('admin sdk'), `Deve mencionar Admin SDK: ${res.error}`);
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO');
      assert.strictEqual(simDb.getRawDoc('cash_shifts', 'shift-s3')?.status, 'ABERTO');
    });

    await runScenario('4. HTTP 200 com JSON sem os campos obrigatórios (ou JSON inválido) NÃO trata como sucesso', async () => {
      resetAllState();
      seedOpenShift('shift-s4', 150);

      // Subcaso A: HTTP 200 com { success: true } sem objeto shift + /state confirma ABERTO
      activeInterceptor = (url) => {
        if (url.includes('/close')) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return null;
      };

      const resIncomplete = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s4' });
      assert.strictEqual(resIncomplete.success, false);
      assert.strictEqual(resIncomplete.synced, false);
      assert.ok(resIncomplete.error?.includes('HTTP 200'), resIncomplete.error);
      assert.ok(resIncomplete.error?.includes('incompleta'), resIncomplete.error);
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO');
      assert.strictEqual(store.getCashShiftHistory().length, 0);

      // Subcaso B: HTTP 200 com JSON corrompido/inválido
      activeInterceptor = (url) => {
        if (url.includes('/close')) {
          return new Response('{corrompido', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return null;
      };
      const resInvalidJson = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s4' });
      assert.strictEqual(resInvalidJson.success, false);
      assert.ok(resInvalidJson.error?.includes('HTTP 200') && resInvalidJson.error?.includes('JSON inválida'), resInvalidJson.error);
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO');
    });

    await runScenario('5. Falha de conexão mantém turno ABERTO e marca resultado como incerto sem converter em sucesso', async () => {
      resetAllState();
      seedOpenShift('shift-s5', 150);

      activeInterceptor = (url) => {
        if (url.includes('/close') || url.includes('/state') || url.includes('/api/health')) {
          throw new TypeError('Failed to fetch');
        }
        return null;
      };

      const res = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s5' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.uncertain, true);
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO');
      assert.strictEqual(store.getCashShiftHistory().length, 0);
      assert.ok(res.error?.toLowerCase().includes('conexão'), res.error);
    });

    await runScenario('6. Timeout: recupera fechamento confirmado via /state e reporta uncertain se /state também expirar', async () => {
      resetAllState();
      seedOpenShift('shift-s6a', 150);

      // Subcaso A: servidor concluiu o fechamento, mas a resposta atrasou > timeoutMs
      activeInterceptor = async (url, init) => {
        if (url.includes('/close')) {
          const fullUrl = `${expressBaseUrl}${url}`;
          await realFetch(fullUrl, { method: init?.method, headers: init?.headers, body: init?.body });
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        return null;
      };

      const recovered = await store.closeCashRegisterAsync(181, 'Caixa', 'Timeout recovery', { shiftId: 'shift-s6a' });
      assert.strictEqual(recovered.success, true);
      assert.strictEqual(recovered.synced, true);
      assert.strictEqual(recovered.recoveredFromTimeout, true);
      assert.strictEqual(recovered.shift?.status, 'FECHADO');
      assert.strictEqual(store.getCurrentCashShift(), null);
      assert.strictEqual(store.getCashShiftHistory().length, 1);

      // Subcaso B: Timeout tanto no /close quanto no /state
      resetAllState();
      seedOpenShift('shift-s6b', 150);
      activeInterceptor = (url) => {
        if (url.includes('/close') || url.includes('/state') || url.includes('/api/health')) {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        return null;
      };

      const timedOut = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s6b' });
      assert.strictEqual(timedOut.success, false);
      assert.strictEqual(timedOut.uncertain, true);
      assert.ok(timedOut.error?.toLowerCase().includes('tempo esgotado'), timedOut.error);
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO');
    });

    await runScenario('7. Turno já fechado retorna HTTP 409 (SHIFT_ALREADY_CLOSED) preservando HTTP 409 e bloqueando mutação', async () => {
      resetAllState();
      const closedShift = {
        ...seedOpenShift('shift-s7', 150),
        status: 'FECHADO',
        closedAt: '2026-11-17T12:00:00.000Z',
        closedBy: 'Gerente',
        finalCalculatedBalance: 181,
        finalCountedCash: 181,
        difference: 0,
      };
      simDb.seedDoc('cash_shifts', 'shift-s7', closedShift);

      const res = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s7' });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.rejected, true);
      assert.ok(res.error?.includes('HTTP 409'), `Deve preservar HTTP 409: ${res.error}`);
      assert.ok(res.error?.includes('FECHADO'), res.error);
    });

    await runScenario('8. Resultado desconhecido após falha de comunicação: retry consulta /state ANTES e nunca repete POST /close sem confirmação', async () => {
      resetAllState();
      seedOpenShift('shift-s8', 150);

      // Tentativa 1: servidor recebeu e fechou no Firestore, mas resposta e /state falharam na rede -> estado desconhecido
      activeInterceptor = async (url, init) => {
        if (url.includes('/close')) {
          await realFetch(`${expressBaseUrl}${url}`, { method: init?.method, headers: init?.headers, body: init?.body });
          throw new TypeError('network connection lost after commit');
        }
        if (url.includes('/state') || url.includes('/api/health')) {
          throw new TypeError('still offline');
        }
        return null;
      };

      const attempt1 = await store.closeCashRegisterAsync(181, 'Caixa', 'Rede instável', { shiftId: 'shift-s8' });
      assert.strictEqual(attempt1.success, false);
      assert.strictEqual(attempt1.uncertain, true);
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO');

      // Tentativa 2A: conexão para /state ainda indisponível -> NÃO pode disparar novo POST /close!
      callLog.length = 0;
      const attempt2a = await store.closeCashRegisterAsync(181, 'Caixa', 'Retry offline', { shiftId: 'shift-s8' });
      assert.strictEqual(attempt2a.success, false);
      assert.strictEqual(attempt2a.uncertain, true);
      assert.strictEqual(
        callLog.filter((c) => c.method === 'POST' && c.url.includes('/close')).length,
        0,
        'Não pode repetir POST /close quando o estado anterior ainda é desconhecido'
      );
      assert.ok(
        callLog.some((c) => c.method === 'GET' && c.url.includes('/api/cash-shifts/shift-s8/state')),
        'Deve consultar GET /state antes de tentar novamente'
      );

      // Tentativa 2B: conexão volta; GET /state confirma que o turno JÁ está FECHADO -> reconcilia sem chamar POST /close!
      callLog.length = 0;
      activeInterceptor = null;
      const attempt2b = await store.closeCashRegisterAsync(181, 'Caixa', 'Retry online', { shiftId: 'shift-s8' });
      assert.strictEqual(attempt2b.success, true);
      assert.strictEqual(attempt2b.recoveredFromTimeout, true);
      assert.strictEqual(attempt2b.shift?.status, 'FECHADO');
      assert.strictEqual(
        callLog.filter((c) => c.method === 'POST' && c.url.includes('/close')).length,
        0,
        'Ao descobrir via /state que já está FECHADO, NÃO deve repetir POST /close (evita 409 falso)'
      );
      assert.strictEqual(store.getCurrentCashShift(), null);
      assert.strictEqual(store.getCashShiftHistory().length, 1);

      // Subcaso 2C: Se /state confirmar que ainda está ABERTO após falha anterior, libera novo POST /close com segurança
      resetAllState();
      seedOpenShift('shift-s8b', 150);
      activeInterceptor = (url) => {
        if (url.includes('/close') || url.includes('/state') || url.includes('/api/health')) {
          throw new TypeError('socket hang up before server received close');
        }
        return null;
      };
      const firstFail = await store.closeCashRegisterAsync(181, 'Caixa', undefined, { shiftId: 'shift-s8b' });
      assert.strictEqual(firstFail.uncertain, true);

      callLog.length = 0;
      activeInterceptor = null;
      const cleanRetry = await store.closeCashRegisterAsync(181, 'Caixa', 'Agora foi', { shiftId: 'shift-s8b' });
      assert.strictEqual(cleanRetry.success, true);
      assert.strictEqual(cleanRetry.shift?.status, 'FECHADO');
      assert.strictEqual(callLog.filter((c) => c.method === 'GET' && c.url.includes('/state')).length, 1);
      assert.strictEqual(callLog.filter((c) => c.method === 'POST' && c.url.includes('/close')).length, 1);
    });

    await runScenario('9. Métodos financeiros irmãos aplicam o mesmo tratamento de HTML 200, HTTP 503, JSON incompleto e guarda pré-retry', async () => {
      resetAllState();
      setLoggedUser('ADMINISTRADOR');

      const htmlPreviewInterceptor: FetchInterceptor = (url) => {
        if (url.includes('/api/health')) {
          return new Response(JSON.stringify({ ok: true, hasAdminSdk: false }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (
          url.includes('/api/cash-shifts/') ||
          url.includes('/confirm-payment') ||
          url.includes('/cancel')
        ) {
          return new Response('<html><body>Warmup proxy</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        return null;
      };

      activeInterceptor = htmlPreviewInterceptor;
      const openHtml = await store.openCashRegisterAsync(100, 'Admin', { shiftId: 'shift-sib-1' });
      assert.strictEqual(openHtml.success, false);
      assert.strictEqual(openHtml.rejected, true);
      assert.ok(openHtml.error?.includes('hasAdminSdk: false'), openHtml.error);

      seedOpenShift('shift-sib-1', 100);
      const movHtml = await store.addCashMovementAsync('SANGRIA', 20, 'Teste HTML', 'Admin', 'DINHEIRO', undefined, {
        shiftId: 'shift-sib-1',
        movementId: 'mov-sib-1',
      });
      assert.strictEqual(movHtml.success, false);
      assert.strictEqual(movHtml.rejected, true);
      assert.ok(movHtml.error?.includes('hasAdminSdk: false'), movHtml.error);

      const adjHtml = await store.adjustDrawerBalanceAsync(95, 'Ajuste HTML', 'Admin', {
        shiftId: 'shift-sib-1',
        movementId: 'adj-sib-1',
      });
      assert.strictEqual(adjHtml.success, false);
      assert.strictEqual(adjHtml.rejected, true);
      assert.ok(adjHtml.error?.includes('hasAdminSdk: false'), adjHtml.error);

      const delHtml = await store.deleteCashMovementAsync('mov-supr-1', { shiftId: 'shift-sib-1' });
      assert.strictEqual(delHtml.success, false);
      assert.strictEqual(delHtml.rejected, true);
      assert.ok(delHtml.error?.includes('hasAdminSdk: false'), delHtml.error);

      const pendOrder = {
        id: 'ord-sib-1',
        orderNumber: '#7001',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fulfillmentType: 'RETIRADA' as const,
        estimatedDeliveryMinutes: 15,
        customer: { name: 'Teste', phone: '83988887777' },
        items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz', quantity: 1, unitPrice: 20, subtotal: 20 }],
        subtotal: 20,
        deliveryFee: 0,
        discount: 0,
        totalAmount: 20,
        paymentMethod: 'PIX' as const,
        paymentStatus: 'PENDENTE' as const,
        status: 'NOVO' as const,
        trackingCode: 'tk_sib_1_123456789012345678901',
        movements: [],
      };
      simDb.seedDoc('orders', pendOrder.id, pendOrder);
      localStorage.setItem('gf_orders', JSON.stringify([pendOrder]));

      const payHtml = await store.updatePaymentStatusAsync('ord-sib-1', 'PAGO', 'Admin');
      assert.strictEqual(payHtml.synced, false);
      assert.strictEqual(payHtml.rejected, true);
      assert.ok(payHtml.error?.includes('hasAdminSdk: false'), payHtml.error);

      const recSaleHtml = await store.recordOrderSaleMovementAsync(pendOrder, 'Admin');
      assert.strictEqual(recSaleHtml.success, false);
      assert.strictEqual(recSaleHtml.rejected, true);
      assert.ok(recSaleHtml.error?.includes('hasAdminSdk: false'), recSaleHtml.error);

      const pdvHtml = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-sib-pdv',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 15,
          customer: { name: 'Balcão', phone: '83988887777' },
          items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz', quantity: 1, unitPrice: 12, subtotal: 12 }],
          subtotal: 12,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 12,
          paymentMethod: 'DINHEIRO',
          paymentStatus: 'PAGO',
          trackingCode: 'tk_sib_pdv_12345678901234567890',
        },
        'Admin'
      );
      assert.strictEqual(pdvHtml.synced, false);
      assert.strictEqual(pdvHtml.rejected, true);
      assert.ok(pdvHtml.error?.includes('hasAdminSdk: false'), pdvHtml.error);

      const cancelHtml = await store.cancelOrderAsync('ord-sib-1', 'Cancelamento HTML', 'Admin');
      assert.strictEqual(cancelHtml.success, false);
      assert.strictEqual(cancelHtml.rejected, true);
      assert.ok(cancelHtml.message.includes('hasAdminSdk: false'), cancelHtml.message);
    });

    console.log('\n==============================================================================');
    console.log(`RESULTADO: ${passed}/${total} cenários aprovados`);
    console.log('==============================================================================\n');

    if (passed !== total) {
      process.exitCode = 1;
    }
  } finally {
    server.closeAllConnections?.();
    server.close();
    if (hadExistingTombstoneFile && existingTombstoneBackup !== null) {
      fs.writeFileSync(tmpTombstonePath, existingTombstoneBackup, 'utf8');
    } else if (!hadExistingTombstoneFile && fs.existsSync(tmpTombstonePath)) {
      fs.unlinkSync(tmpTombstonePath);
    }
    if (hadExistingPushCacheFile && existingPushCacheBackup !== null) {
      fs.writeFileSync(tmpPushCachePath, existingPushCacheBackup, 'utf8');
    } else if (!hadExistingPushCacheFile && fs.existsSync(tmpPushCachePath)) {
      fs.unlinkSync(tmpPushCachePath);
    }
  }
  process.exit(passed === total ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
