/**
 * Suite Completa de Integridade Financeira (12 Cenários Obrigatórios)
 *
 * Executa o Express app real (`server.ts`) e a camada `store.ts` contra um simulador
 * transacional fiel de Firebase Admin Firestore (`runTransaction` com controle de versão,
 * detecção de conflitos concorrentes, retry automático e commit/rollback atômico).
 *
 * IMPORTANTE: NÃO conecta em dados reais de produção e preserva `.deleted_orders_cache.json`.
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// 1. Setup de ambiente ANTES de importar server.ts / store.ts
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
    userAgent: 'AmanditaFinancialIntegrityTest/1.0',
  },
});

const tmpTombstonePath = path.join(process.cwd(), '.deleted_orders_cache.json');
const hadExistingTombstoneFile = fs.existsSync(tmpTombstonePath);
const existingTombstoneBackup = hadExistingTombstoneFile ? fs.readFileSync(tmpTombstonePath, 'utf8') : null;

const tmpPushCachePath = path.join(process.cwd(), '.push_dispatches_cache.json');
const hadExistingPushCacheFile = fs.existsSync(tmpPushCachePath);
const existingPushCacheBackup = hadExistingPushCacheFile ? fs.readFileSync(tmpPushCachePath, 'utf8') : null;

// ---------------------------------------------------------------------------
// Simulador Transacional Fiel do Firebase Admin Firestore (Com Optimistic Concurrency)
// ---------------------------------------------------------------------------
interface StoredDoc {
  data: Record<string, any>;
  version: number;
}

function deepClone<T>(val: T): T {
  return val === undefined ? undefined as any : JSON.parse(JSON.stringify(val));
}

class TransactionalFirestoreSimulator {
  private cols = new Map<string, Map<string, StoredDoc>>();
  private colVersions = new Map<string, number>();
  public transactionConflictRetries = 0;
  public yieldInsideTransaction = false;

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

  public getAllDocs(colName: string): Array<Record<string, any>> {
    const col = this.cols.get(colName);
    if (!col) return [];
    return Array.from(col.values()).map((entry) => deepClone(entry.data));
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
    const docs = entries.map(([id, entry]) => {
      const ref = this.docRef(colName, id);
      return {
        exists: true,
        id,
        ref,
        data: () => deepClone(entry.data),
      };
    });
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

  public batch(): any {
    const ops: Array<() => void> = [];
    const self = this;
    return {
      set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
        ops.push(() => {
          const col = self.ensureCol(ref.colName);
          const existing = col.get(ref.id);
          const nextData = opts?.merge && existing ? { ...deepClone(existing.data), ...deepClone(data) } : deepClone(data);
          col.set(ref.id, { data: nextData, version: (existing?.version || 0) + 1 });
          self.colVersions.set(ref.colName, (self.colVersions.get(ref.colName) || 1) + 1);
        });
      },
      update(ref: any, partial: Record<string, any>) {
        ops.push(() => {
          const col = self.ensureCol(ref.colName);
          const existing = col.get(ref.id);
          if (!existing) throw new Error(`NOT_FOUND: ${ref.path}`);
          col.set(ref.id, { data: { ...deepClone(existing.data), ...deepClone(partial) }, version: existing.version + 1 });
          self.colVersions.set(ref.colName, (self.colVersions.get(ref.colName) || 1) + 1);
        });
      },
      delete(ref: any) {
        ops.push(() => {
          const col = self.ensureCol(ref.colName);
          col.delete(ref.id);
          self.colVersions.set(ref.colName, (self.colVersions.get(ref.colName) || 1) + 1);
        });
      },
      async commit() {
        for (const op of ops) op();
      },
    };
  }

  public async runTransaction<T>(updateFn: (tx: any) => Promise<T>): Promise<T> {
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const readDocVersions = new Map<string, number>();
      const readColVersions = new Map<string, number>();
      const pendingOps: Array<{ type: 'set' | 'update' | 'delete'; ref: any; data?: any; merge?: boolean }> = [];

      const tx = {
        get: async (target: any) => {
          if (this.yieldInsideTransaction) {
            await Promise.resolve();
          }
          if (target?.__kind === 'queryRef') {
            this.ensureCol(target.colName);
            if (!readColVersions.has(target.colName)) {
              readColVersions.set(target.colName, this.colVersions.get(target.colName) || 1);
            }
            const snap = this.runQuerySync(target.colName, target.filters, target.limitNum);
            for (const d of snap.docs) {
              const key = `${target.colName}/${d.id}`;
              if (!readDocVersions.has(key)) {
                const ver = this.cols.get(target.colName)?.get(d.id)?.version || 0;
                readDocVersions.set(key, ver);
              }
            }
            return snap;
          }
          const colName = target.colName;
          const docId = target.id;
          const key = `${colName}/${docId}`;
          if (!readDocVersions.has(key)) {
            const ver = this.cols.get(colName)?.get(docId)?.version || 0;
            readDocVersions.set(key, ver);
          }
          return this.makeDocSnapshot(colName, docId, target);
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

      const outcome = await updateFn(tx);

      if (this.yieldInsideTransaction) {
        await new Promise((r) => setTimeout(r, attempt === 1 ? 25 : 2));
      }

      // Check optimistic concurrency conflicts before committing any buffered write
      let conflict = false;
      for (const [key, seenVer] of readDocVersions.entries()) {
        const [colName, docId] = key.split('/');
        const liveVer = this.cols.get(colName)?.get(docId)?.version || 0;
        if (liveVer !== seenVer) {
          conflict = true;
          break;
        }
      }
      if (!conflict) {
        for (const [colName, seenColVer] of readColVersions.entries()) {
          const liveColVer = this.colVersions.get(colName) || 1;
          if (liveColVer !== seenColVer) {
            conflict = true;
            break;
          }
        }
      }

      if (conflict) {
        this.transactionConflictRetries++;
        if (attempt === maxAttempts) {
          throw new Error('ABORTED: Firestore transaction contention exceeded max retries');
        }
        await new Promise((r) => setTimeout(r, attempt * 2));
        continue;
      }

      // Atomic commit of all buffered operations
      for (const op of pendingOps) {
        const col = this.ensureCol(op.ref.colName);
        const existing = col.get(op.ref.id);
        if (op.type === 'set') {
          const nextData = op.merge && existing ? { ...deepClone(existing.data), ...op.data } : op.data;
          col.set(op.ref.id, { data: nextData, version: (existing?.version || 0) + 1 });
        } else if (op.type === 'update') {
          if (!existing) throw new Error(`NOT_FOUND: ${op.ref.path}`);
          col.set(op.ref.id, { data: { ...deepClone(existing.data), ...op.data }, version: existing.version + 1 });
        } else if (op.type === 'delete') {
          col.delete(op.ref.id);
        }
        this.colVersions.set(op.ref.colName, (this.colVersions.get(op.ref.colName) || 1) + 1);
      }

      return outcome;
    }
    throw new Error('Transaction unreachable state');
  }
}

// ---------------------------------------------------------------------------
// Usuários de Teste e Fetch Interceptor
// ---------------------------------------------------------------------------
const simUsersByToken: Record<string, { uid: string; email: string; role: string; status: string }> = {
  'tok-admin': { uid: 'uid-admin', email: 'dvrmercadinho@gmail.com', role: 'ADMINISTRADOR', status: 'ATIVO' },
  'tok-gerente': { uid: 'uid-gerente', email: 'gerente@amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' },
  'tok-caixa': { uid: 'uid-caixa', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
  'tok-atendente': { uid: 'uid-atendente', email: 'atendente@staff.amanditasabores.com.br', role: 'ATENDENTE', status: 'ATIVO' },
  'tok-entregador': { uid: 'uid-entregador', email: 'entregador@staff.amanditasabores.com.br', role: 'ENTREGADOR', status: 'ATIVO' },
  'tok-cozinha': { uid: 'uid-cozinha', email: 'cozinha@staff.amanditasabores.com.br', role: 'COZINHA', status: 'ATIVO' },
};

const realFetch = globalThis.fetch.bind(globalThis);
let expressBaseUrl = '';
let activeTestToken = 'tok-atendente';
let delayConfirmResponseMs = 0;
let forceNetworkFailureOnConfirm = false;
let forceNetworkFailureOnPaymentState = false;

(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method || 'GET').toUpperCase();

  if (url.startsWith('/')) {
    const isConfirmCall = method === 'POST' && url.includes('/confirm-payment');
    const isPaymentStateCall = method === 'GET' && url.includes('/payment-state');

    if (isConfirmCall && forceNetworkFailureOnConfirm) {
      throw new TypeError('Simulated network error during confirm-payment');
    }
    if (isPaymentStateCall && forceNetworkFailureOnPaymentState) {
      throw new TypeError('Simulated network error during payment-state');
    }

    const headers = new Headers(init?.headers || {});
    if (!headers.has('Authorization') && activeTestToken) {
      headers.set('Authorization', `Bearer ${activeTestToken}`);
    }

    const targetUrl = `${expressBaseUrl}${url}`;

    // For Scenario 3: let Express complete the atomic Firestore commit BEFORE simulating client timeout abort!
    if (isConfirmCall && delayConfirmResponseMs > 0) {
      const { signal, ...initWithoutSignal } = init || {};
      const committedResponse = await realFetch(targetUrl, { ...initWithoutSignal, headers });
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          const abortErr = new Error('The operation was aborted');
          (abortErr as any).name = 'AbortError';
          reject(abortErr);
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, delayConfirmResponseMs);
        const onAbort = () => {
          clearTimeout(timer);
          const abortErr = new Error('The operation was aborted');
          (abortErr as any).name = 'AbortError';
          reject(abortErr);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      return committedResponse;
    }

    return realFetch(targetUrl, { ...init, headers });
  }

  return realFetch(input, init);
};

async function run() {
  const simDb = new TransactionalFirestoreSimulator();
  for (const [, u] of Object.entries(simUsersByToken)) {
    simDb.seedDoc('users', u.uid, { id: u.uid, email: u.email, role: u.role, status: u.status });
  }

  const simAdminAuth = {
    verifyIdToken: async (token: string) => {
      const u = simUsersByToken[token];
      if (!u) throw new Error('INVALID_ID_TOKEN');
      return { uid: u.uid, email: u.email };
    },
  };

  const { store } = await import('../src/services/store.ts');
  const { default: app, __setTestFirebaseAdminServices } = await import('../server.ts');

  __setTestFirebaseAdminServices({
    adminDb: simDb as any,
    adminAuth: simAdminAuth as any,
  });

  store.setServerAtomicPaymentMode(true);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  expressBaseUrl = `http://127.0.0.1:${addr.port}`;

  let passed = 0;
  let total = 0;

  function seedOpenShift(shiftId = 'shift-main') {
    simDb.clearCollection('cash_shifts');
    const shift = {
      id: shiftId,
      openedAt: new Date().toISOString(),
      openedBy: 'Operador Caixa',
      initialBalance: 150,
      status: 'ABERTO' as const,
      movements: [] as any[],
    };
    simDb.seedDoc('cash_shifts', shiftId, shift);
    localStorage.setItem('gf_current_cash_shift', JSON.stringify(shift));
    return shift;
  }

  function seedPendingOrder(orderId: string, amount: number, method: 'PIX' | 'DINHEIRO' | 'CARTAO_CREDITO' = 'PIX') {
    const now = new Date().toISOString();
    const order = {
      id: orderId,
      orderNumber: `#${Math.floor(1000 + Math.random() * 8999)}`,
      createdAt: now,
      updatedAt: now,
      fulfillmentType: 'DELIVERY' as const,
      customer: { name: `Cliente ${orderId}`, phone: '83999990000' },
      items: [
        {
          id: `item-${orderId}`,
          menuItemId: 'cuscuz-carne-sol-queijo',
          name: 'Cuscuz de carne de sol com queijo',
          quantity: 1,
          unitPrice: amount,
          subtotal: amount,
        },
      ],
      subtotal: amount,
      deliveryFee: 0,
      discount: 0,
      totalAmount: amount,
      paymentMethod: method,
      paymentStatus: 'PENDENTE' as const,
      status: 'NOVO' as const,
      trackingCode: `tk_${orderId}_${Date.now()}`,
      movements: [{ id: `mov-init-${orderId}`, timestamp: now, toStatus: 'NOVO', author: 'Sistema' }],
    };
    simDb.seedDoc('orders', orderId, order);
    const existingOrders = JSON.parse(localStorage.getItem('gf_orders') || '[]');
    localStorage.setItem('gf_orders', JSON.stringify([order, ...existingOrders.filter((o: any) => o.id !== orderId)]));
    return order;
  }

  async function scenario(name: string, fn: () => Promise<void> | void) {
    total++;
    delayConfirmResponseMs = 0;
    forceNetworkFailureOnConfirm = false;
    forceNetworkFailureOnPaymentState = false;
    simDb.yieldInsideTransaction = false;
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  try {
    console.log('=== TESTES DE INTEGRIDADE FINANCEIRA ATÔMICA (12 CENÁRIOS + REGRAS) ===\n');

    // Cenário 1: Duas confirmações simultâneas do mesmo pedido
    await scenario('1. Duas confirmações simultâneas do mesmo pedido -> exatamente 1 VENDA e status PAGO', async () => {
      seedOpenShift('shift-c1');
      const ordId = 'ord-sim-same-1';
      seedPendingOrder(ordId, 37.5, 'PIX');
      await store.login('atendente', '123456');
      activeTestToken = 'tok-atendente';
      simDb.yieldInsideTransaction = true;

      const [r1, r2] = await Promise.all([
        store.updatePaymentStatusAsync(ordId, 'PAGO', 'Atendente A', 'Confirmação 1'),
        store.updatePaymentStatusAsync(ordId, 'PAGO', 'Atendente B', 'Confirmação 2'),
      ]);

      assert.strictEqual(r1.synced, true);
      assert.strictEqual(r2.synced, true);
      assert.strictEqual(r1.alreadyConfirmed || r2.alreadyConfirmed, true, 'Uma das chamadas concorrentes deve ser idempotente');

      const dbOrder = simDb.getRawDoc('orders', ordId)!;
      const dbShift = simDb.getRawDoc('cash_shifts', 'shift-main') || simDb.getRawDoc('cash_shifts', 'shift-c1')!;
      assert.strictEqual(dbOrder.paymentStatus, 'PAGO');
      const matchingSales = dbShift.movements.filter((m: any) => m.orderId === ordId && m.type === 'VENDA');
      assert.strictEqual(matchingSales.length, 1, 'Nunca pode duplicar movimentação VENDA em corrida simultânea');
      assert.strictEqual(matchingSales[0].amount, 37.5);
    });

    // Cenário 2: Dois pedidos diferentes confirmados ao mesmo tempo
    await scenario('2. Dois pedidos diferentes confirmados simultaneamente -> conflito retentado e 2 VENDAS distintas preservadas', async () => {
      seedOpenShift('shift-c2');
      seedPendingOrder('ord-diff-a', 24.0, 'PIX');
      seedPendingOrder('ord-diff-b', 41.99, 'DINHEIRO');
      await store.login('caixa', '123456');
      activeTestToken = 'tok-caixa';
      simDb.yieldInsideTransaction = true;
      const retriesBefore = simDb.transactionConflictRetries;

      const [rA, rB] = await Promise.all([
        store.updatePaymentStatusAsync('ord-diff-a', 'PAGO', 'Caixa'),
        store.updatePaymentStatusAsync('ord-diff-b', 'PAGO', 'Caixa'),
      ]);

      assert.strictEqual(rA.synced, true);
      assert.strictEqual(rB.synced, true);
      assert(simDb.transactionConflictRetries > retriesBefore, 'Transação deve detectar concorrência e retentar sem perder nenhuma venda');

      const dbShift = simDb.getRawDoc('cash_shifts', 'shift-c2')!;
      assert.strictEqual(dbShift.movements.length, 2, 'As 2 vendas distintas devem estar no caixa');
      assert(dbShift.movements.some((m: any) => m.orderId === 'ord-diff-a' && m.amount === 24.0));
      assert(dbShift.movements.some((m: any) => m.orderId === 'ord-diff-b' && m.amount === 41.99));
    });

    // Cenário 3: Timeout após o servidor já ter confirmado a transação
    await scenario('3. Timeout após commit no servidor -> reconciliação via /payment-state sem rollback nem duplicidade', async () => {
      seedOpenShift('shift-c3');
      const ordId = 'ord-timeout-committed';
      seedPendingOrder(ordId, 52.35, 'PIX');
      await store.login('atendente', '123456');
      activeTestToken = 'tok-atendente';

      delayConfirmResponseMs = 150;
      const res = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Atendente', undefined, { timeoutMs: 35 });

      assert.strictEqual(res.synced, true, 'Deve recuperar estado confirmado pelo servidor via /payment-state');
      assert.strictEqual(res.recoveredFromTimeout, true);
      assert.strictEqual(res.order?.paymentStatus, 'PAGO');
      assert.strictEqual(store.getOrderById(ordId)?.paymentStatus, 'PAGO');

      // Reenviar confirmação novamente não pode duplicar
      delayConfirmResponseMs = 0;
      const retryRes = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Atendente');
      assert.strictEqual(retryRes.synced, true);
      assert.strictEqual(retryRes.alreadyConfirmed, true);

      const dbShift = simDb.getRawDoc('cash_shifts', 'shift-c3')!;
      const sales = dbShift.movements.filter((m: any) => m.orderId === ordId);
      assert.strictEqual(sales.length, 1);
    });

    // Cenário 4: Falha de rede durante a operação (Update + PDV)
    await scenario('4. Falha de rede -> estado incerto reportado sem adulteração local nem pedido fantasma', async () => {
      seedOpenShift('shift-c4');
      const ordId = 'ord-net-drop';
      seedPendingOrder(ordId, 29.9, 'PIX');
      await store.login('atendente', '123456');
      activeTestToken = 'tok-atendente';

      forceNetworkFailureOnConfirm = true;
      forceNetworkFailureOnPaymentState = true;
      const res = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Atendente');

      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.uncertain, true);
      assert.strictEqual(store.getOrderById(ordId)?.paymentStatus, 'PENDENTE', 'Pedido local permanece PENDENTE sem otimismo falso');
      assert.strictEqual(store.getCurrentCashShift()?.movements.length, 0, 'Nenhuma movimentação falsa gravada no caixa local');

      const pdvNetRes = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-pdv-net-drop',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 10,
          customer: { name: 'PDV Queda Rede', phone: '83999991111' },
          items: [{ id: 'i1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 14, subtotal: 14 }],
          subtotal: 14,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 14,
          paymentMethod: 'DINHEIRO',
          paymentStatus: 'PAGO',
        },
        'Atendente'
      );
      assert.strictEqual(pdvNetRes.order, null);
      assert.strictEqual(pdvNetRes.uncertain, true);
      assert.strictEqual(store.getOrderById('ord-pdv-net-drop'), undefined, 'PDV não pode criar comanda local fantasma após queda de rede');
    });

    // Cenário 5: Turno de caixa FECHADO
    await scenario('5. Turno de caixa FECHADO -> recusado (409 SHIFT_ALREADY_CLOSED) e pedido permanece PENDENTE', async () => {
      simDb.clearCollection('cash_shifts');
      const closedShift = {
        id: 'shift-closed-5',
        openedAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
        openedBy: 'Caixa',
        initialBalance: 100,
        status: 'FECHADO' as const,
        movements: [] as any[],
      };
      simDb.seedDoc('cash_shifts', closedShift.id, closedShift);
      localStorage.setItem('gf_current_cash_shift', JSON.stringify(closedShift));

      const ordId = 'ord-closed-shift';
      seedPendingOrder(ordId, 18.5, 'PIX');
      await store.login('caixa', '123456');
      activeTestToken = 'tok-caixa';

      const res = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Caixa', undefined, { shiftId: closedShift.id });
      assert.strictEqual(res.synced, false);
      assert.strictEqual(res.rejected, true);
      assert.strictEqual(simDb.getRawDoc('orders', ordId)?.paymentStatus, 'PENDENTE');
      assert.strictEqual(simDb.getRawDoc('cash_shifts', closedShift.id)?.movements.length, 0);
      assert.strictEqual(store.getOrderById(ordId)?.paymentStatus, 'PENDENTE');
    });

    // Cenário 6: Nenhum turno de caixa aberto (+ proteção >1 turnos abertos + !adminDb 503)
    await scenario('6. Sem turno ABERTO (404), múltiplos turnos abertos (409) e Admin SDK ausente (503)', async () => {
      simDb.clearCollection('cash_shifts');
      localStorage.removeItem('gf_current_cash_shift');

      const ordId = 'ord-no-shift';
      seedPendingOrder(ordId, 33.0, 'PIX');
      await store.login('admin', '123456');
      activeTestToken = 'tok-admin';

      const noShiftRes = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Admin');
      assert.strictEqual(noShiftRes.synced, false);
      assert.strictEqual(noShiftRes.rejected, true);
      assert.strictEqual(simDb.getRawDoc('orders', ordId)?.paymentStatus, 'PENDENTE');

      const pdvNoShift = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-pdv-noshift',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 10,
          customer: { name: 'Sem Turno', phone: '83999990000' },
          items: [{ id: 'i1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 14, subtotal: 14 }],
          subtotal: 14,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 14,
          paymentMethod: 'DINHEIRO',
          paymentStatus: 'PAGO',
        },
        'Admin'
      );
      assert.strictEqual(pdvNoShift.order, null);
      assert.strictEqual(pdvNoShift.rejected, true);
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-pdv-noshift'), undefined);

      // Proteção: 2 turnos ABERTOs simultâneos -> rejeita 409 MULTIPLE_OPEN_SHIFTS
      simDb.seedDoc('cash_shifts', 'shift-dup-1', { id: 'shift-dup-1', status: 'ABERTO', openedAt: new Date().toISOString(), openedBy: 'A', initialBalance: 0, movements: [] });
      simDb.seedDoc('cash_shifts', 'shift-dup-2', { id: 'shift-dup-2', status: 'ABERTO', openedAt: new Date().toISOString(), openedBy: 'B', initialBalance: 0, movements: [] });
      const multiHttp = await realFetch(`${expressBaseUrl}/api/orders/${ordId}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-admin' },
        body: JSON.stringify({ author: 'Admin' }),
      });
      assert.strictEqual(multiHttp.status, 409);
      const multiBody = await multiHttp.json();
      assert.strictEqual(multiBody.code, 'MULTIPLE_OPEN_SHIFTS');

      // Proteção: POST /api/cash-shifts impede abertura de segundo turno ABERTO
      simDb.clearCollection('cash_shifts');
      simDb.seedDoc('cash_shifts', 'shift-only-one', { id: 'shift-only-one', status: 'ABERTO', openedAt: new Date().toISOString(), openedBy: 'A', initialBalance: 100, movements: [] });
      const secondShiftHttp = await realFetch(`${expressBaseUrl}/api/cash-shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-caixa' },
        body: JSON.stringify({ shift: { id: 'shift-second', status: 'ABERTO', openedAt: new Date().toISOString(), openedBy: 'Caixa', initialBalance: 50, movements: [] } }),
      });
      assert.strictEqual(secondShiftHttp.status, 409);
      const secondShiftBody = await secondShiftHttp.json();
      assert.strictEqual(secondShiftBody.code, 'OPEN_SHIFT_ALREADY_EXISTS');

      // Proteção: sem adminDb -> 503 ADMIN_SDK_UNAVAILABLE
      __setTestFirebaseAdminServices({ adminDb: null });
      const unavailableRes = await realFetch(`${expressBaseUrl}/api/orders/${ordId}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-admin' },
        body: JSON.stringify({ author: 'Admin' }),
      });
      assert.strictEqual(unavailableRes.status, 503);
      const unavailableBody = await unavailableRes.json();
      assert.strictEqual(unavailableBody.code, 'ADMIN_SDK_UNAVAILABLE');
      __setTestFirebaseAdminServices({ adminDb: simDb as any });
    });

    // Cenário 7: ATENDENTE tentando alterar o caixa diretamente (+ permissão apenas via endpoint atômico)
    await scenario('7. ATENDENTE bloqueado de alterar caixa diretamente, mas confirma PIX via transação atômica', async () => {
      seedOpenShift('shift-c7');
      await store.login('atendente', '123456');
      activeTestToken = 'tok-atendente';

      // Mesmo se allowedModules tentar incluir 'caixa', canUserManageCash() deve permanecer false
      const currentAtt = store.getCurrentUser()!;
      const escalatedAtt = { ...currentAtt, allowedModules: [...(currentAtt.allowedModules || []), 'caixa'] };
      localStorage.setItem('gf_current_user', JSON.stringify(escalatedAtt));
      assert.strictEqual(store.canUserManageCash(), false, 'allowedModules nunca pode conceder acesso ao caixa para ATENDENTE');
      assert.strictEqual(store.openCashRegister(100, 'Atendente'), null);
      assert.strictEqual(store.closeCashRegister(100, 'Atendente'), null);
      assert.strictEqual(store.addCashMovement('SANGRIA', 20, 'Tentativa', 'Atendente'), null);
      assert.strictEqual(store.adjustDrawerBalance(50, 'Tentativa', 'Atendente'), null);
      assert.strictEqual(store.deleteCashMovement('mov-x'), false);

      // Bloqueio HTTP direto em POST /api/cash-shifts
      const directShiftWrite = await realFetch(`${expressBaseUrl}/api/cash-shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-atendente' },
        body: JSON.stringify({ shift: { id: 'shift-hack', status: 'ABERTO', openedAt: new Date().toISOString(), openedBy: 'Atendente', initialBalance: 999, movements: [] } }),
      });
      assert.strictEqual(directShiftWrite.status, 403);

      // Regras do Firestore não possuem escrita direta de ATENDENTE em cash_shifts
      const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
      assert(!rulesText.includes('isValidAttendantSaleAppend'), 'firestore.rules não deve permitir escrita direta de ATENDENTE em cash_shifts');

      // Confirmação autorizada via transação atômica funciona para ATENDENTE
      const ordId = 'ord-att-pix';
      seedPendingOrder(ordId, 19.5, 'PIX');
      const okRes = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Atendente');
      assert.strictEqual(okRes.synced, true);
      assert.strictEqual(simDb.getRawDoc('orders', ordId)?.paymentStatus, 'PAGO');
      assert.strictEqual(simDb.getRawDoc('cash_shifts', 'shift-c7')?.movements.length, 1);
    });

    // Cenário 8: ENTREGADOR tentando alterar paymentStatus
    await scenario('8. ENTREGADOR bloqueado de alterar paymentStatus (Store, /confirm-payment e /status)', async () => {
      seedOpenShift('shift-c8');
      const ordId = 'ord-driver-deny';
      seedPendingOrder(ordId, 28.0, 'DINHEIRO');
      await store.login('entregador', '123456');
      activeTestToken = 'tok-entregador';

      const storeDeny = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Entregador');
      assert.strictEqual(storeDeny.synced, false);
      assert.strictEqual(storeDeny.rejected, true);

      const confirmHttpDeny = await realFetch(`${expressBaseUrl}/api/orders/${ordId}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-entregador' },
        body: JSON.stringify({ author: 'Entregador' }),
      });
      assert.strictEqual(confirmHttpDeny.status, 403);

      const statusHttpDeny = await realFetch(`${expressBaseUrl}/api/orders/${ordId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-entregador' },
        body: JSON.stringify({ status: 'ENTREGUE', paymentStatus: 'PAGO', author: 'Entregador' }),
      });
      assert.strictEqual(statusHttpDeny.status, 403);

      assert.strictEqual(simDb.getRawDoc('orders', ordId)?.paymentStatus, 'PENDENTE');
      assert.strictEqual(simDb.getRawDoc('cash_shifts', 'shift-c8')?.movements.length, 0);
    });

    // Cenário 9: Pedido cancelado (CANCELADO)
    await scenario('9. Pedido CANCELADO -> bloqueado em /confirm-payment, /status e Store (0 movimentações)', async () => {
      seedOpenShift('shift-c9');
      const ordId = 'ord-cancelled-9';
      const ord = seedPendingOrder(ordId, 44.0, 'PIX');
      simDb.seedDoc('orders', ordId, { ...ord, status: 'CANCELADO' });
      const ordersList = JSON.parse(localStorage.getItem('gf_orders') || '[]').map((o: any) =>
        o.id === ordId ? { ...o, status: 'CANCELADO' } : o
      );
      localStorage.setItem('gf_orders', JSON.stringify(ordersList));

      await store.login('admin', '123456');
      activeTestToken = 'tok-admin';

      const storeCancelDeny = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Admin');
      assert.strictEqual(storeCancelDeny.synced, false);
      assert.strictEqual(storeCancelDeny.rejected, true);

      const httpCancelDeny = await realFetch(`${expressBaseUrl}/api/orders/${ordId}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-admin' },
        body: JSON.stringify({ author: 'Admin' }),
      });
      assert.strictEqual(httpCancelDeny.status, 409);
      const cancelBody = await httpCancelDeny.json();
      assert.strictEqual(cancelBody.code, 'ORDER_CANCELLED');

      const statusUpdateDeny = await realFetch(`${expressBaseUrl}/api/orders/${ordId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-admin' },
        body: JSON.stringify({ status: 'ENTREGUE', author: 'Admin' }),
      });
      assert.strictEqual(statusUpdateDeny.status, 409);

      assert.strictEqual(simDb.getRawDoc('orders', ordId)?.paymentStatus, 'PENDENTE');
      assert.strictEqual(simDb.getRawDoc('cash_shifts', 'shift-c9')?.movements.length, 0);
    });

    // Cenário 10: Repetição da mesma requisição (idempotência estrita)
    await scenario('10. Repetição sequencial da mesma confirmação -> idempotência sem duplicar VENDA', async () => {
      seedOpenShift('shift-c10');
      const ordId = 'ord-idemp-10';
      seedPendingOrder(ordId, 60.0, 'PIX');
      await store.login('gerente', '123456');
      activeTestToken = 'tok-gerente';

      const first = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Gerente');
      const second = await store.updatePaymentStatusAsync(ordId, 'PAGO', 'Gerente');
      const thirdHttp = await realFetch(`${expressBaseUrl}/api/orders/${ordId}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-gerente' },
        body: JSON.stringify({ author: 'Gerente' }),
      });
      const thirdBody = await thirdHttp.json();

      assert.strictEqual(first.synced, true);
      assert.strictEqual(first.alreadyConfirmed, false);
      assert.strictEqual(second.synced, true);
      assert.strictEqual(second.alreadyConfirmed, true);
      assert.strictEqual(thirdHttp.status, 200);
      assert.strictEqual(thirdBody.alreadyConfirmed, true);

      const dbShift = simDb.getRawDoc('cash_shifts', 'shift-c10')!;
      assert.strictEqual(dbShift.movements.length, 1);
      assert.strictEqual(dbShift.movements[0].id, `cash-sale-${ordId}`);
    });

    // Cenário 11: Venda em dinheiro e venda em cartão no PDV
    await scenario('11. Vendas PDV em DINHEIRO e CARTAO_CREDITO -> criação + PAGO + VENDA atômicos com arredondamento exato', async () => {
      seedOpenShift('shift-c11');
      await store.login('caixa', '123456');
      activeTestToken = 'tok-caixa';

      const cashSale = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-pdv-cash-11',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 10,
          customer: { name: 'Cliente Dinheiro', phone: '83999992222' },
          items: [
            { id: 'ic1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 2, unitPrice: 14, subtotal: 28 },
          ],
          subtotal: 28,
          deliveryFee: 0,
          discount: 2.55,
          totalAmount: 25.45,
          paymentMethod: 'DINHEIRO',
          paymentStatus: 'PAGO',
          paymentChangeFor: 30,
          cashReceived: 30,
          changeAmount: 4.55,
        },
        'Caixa'
      );

      assert.strictEqual(cashSale.synced, true);
      assert.strictEqual(cashSale.order?.paymentStatus, 'PAGO');
      assert.strictEqual(cashSale.order?.totalAmount, 25.45);

      const cardSale = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-pdv-card-11',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 10,
          customer: { name: 'Cliente Cartão', phone: '83999993333' },
          items: [
            { id: 'ic2', menuItemId: 'cuscuz-manteiga', name: 'Cuscuz com manteiga', quantity: 3, unitPrice: 5, subtotal: 15 },
          ],
          subtotal: 15,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 15,
          paymentMethod: 'CARTAO_CREDITO',
          paymentStatus: 'PAGO',
        },
        'Caixa'
      );

      assert.strictEqual(cardSale.synced, true);
      assert.strictEqual(cardSale.order?.paymentStatus, 'PAGO');

      const dbShift = simDb.getRawDoc('cash_shifts', 'shift-c11')!;
      assert.strictEqual(dbShift.movements.length, 2);
      const movCash = dbShift.movements.find((m: any) => m.orderId === 'ord-pdv-cash-11');
      const movCard = dbShift.movements.find((m: any) => m.orderId === 'ord-pdv-card-11');
      assert.strictEqual(movCash?.paymentMethod, 'DINHEIRO');
      assert.strictEqual(movCash?.amount, 25.45);
      assert.strictEqual(movCard?.paymentMethod, 'CARTAO_CREDITO');
      assert.strictEqual(movCard?.amount, 15);
    });

    // Cenário 12: Pedido com adicionais pagos e > 8 itens
    await scenario('12. Pedido com adicionais pagos (R$ 3,00) e > 8 itens (10 linhas) -> validado e confirmado atomicamente', async () => {
      seedOpenShift('shift-c12');
      await store.login('caixa', '123456');
      activeTestToken = 'tok-caixa';

      // Construir 10 itens distintos/linhas (> 8), com adicionais pagos reais do catálogo
      const itemsWithAddons = Array.from({ length: 10 }, (_, idx) => {
        const useAddons = idx % 2 === 0;
        const addons = useAddons
          ? [
              { id: 'ad-ovos', name: 'Ovos', price: 3.0 },
              { id: 'ad-queijo', name: 'Queijo', price: 3.0 },
            ]
          : [];
        const unitPrice = useAddons ? 20.0 : 14.0; // Cuscuz carne de sol (14) + 2x R$ 3,00 adicionais
        return {
          id: `line-${idx + 1}`,
          menuItemId: 'cuscuz-carne-sol-queijo',
          name: 'Cuscuz de carne de sol com queijo',
          quantity: 1,
          unitPrice,
          addons,
          subtotal: unitPrice,
        };
      });
      // Total = 5 * 20 + 5 * 14 = 100 + 70 = 170.00
      const expectedTotal = 170.0;

      // 12a) Criação PENDENTE pelo endpoint público POST /api/orders (> 8 itens + adicionais)
      const pendingPublicRes = await realFetch(`${expressBaseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order: {
            id: 'ord-addons-pending-12',
            orderNumber: '#8812',
            status: 'NOVO',
            trackingCode: 'tk_addons_pending_12_abcdef123456',
            fulfillmentType: 'RETIRADA',
            estimatedDeliveryMinutes: 30,
            customer: { name: 'Cliente Adicionais Pendente', phone: '83988887777' },
            items: itemsWithAddons,
            subtotal: expectedTotal,
            deliveryFee: 0,
            discount: 0,
            totalAmount: expectedTotal,
            paymentMethod: 'PIX',
            paymentStatus: 'PENDENTE',
          },
        }),
      });
      assert.strictEqual(pendingPublicRes.status, 200, 'POST /api/orders deve aceitar pedido legítimo com > 8 itens e adicionais pagos');
      const pendingData = await pendingPublicRes.json();
      assert.strictEqual(pendingData.order.totalAmount, expectedTotal);
      assert.strictEqual(pendingData.order.items.length, 10);

      // 12b) Venda PDV já PAGA com > 8 itens e adicionais pagos via createAndConfirmPaidOrderAsync
      const paidAddonsRes = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-addons-paid-12',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 20,
          customer: { name: 'Cliente Adicionais Pago', phone: '83988889999' },
          items: itemsWithAddons,
          subtotal: expectedTotal,
          deliveryFee: 0,
          discount: 0,
          totalAmount: expectedTotal,
          paymentMethod: 'CARTAO_DEBITO',
          paymentStatus: 'PAGO',
        },
        'Caixa'
      );

      assert.strictEqual(paidAddonsRes.synced, true);
      assert.strictEqual(paidAddonsRes.order?.items.length, 10);
      assert.strictEqual(paidAddonsRes.order?.totalAmount, expectedTotal);
      assert.strictEqual(paidAddonsRes.order?.paymentStatus, 'PAGO');

      const dbShift = simDb.getRawDoc('cash_shifts', 'shift-c12')!;
      assert.strictEqual(dbShift.movements.length, 1);
      assert.strictEqual(dbShift.movements[0].orderId, 'ord-addons-paid-12');
      assert.strictEqual(dbShift.movements[0].amount, expectedTotal);
    });

    console.log(`\n============================================================`);
    console.log(`RESULTADO INTEGRIDADE FINANCEIRA: ${passed}/${total} CENÁRIOS APROVADOS.`);
    console.log(`(Retentativas reais de conflito transacional verificadas: ${simDb.transactionConflictRetries})`);
    console.log(`============================================================`);
  } finally {
    server.close();
    if (hadExistingTombstoneFile && existingTombstoneBackup !== null) {
      fs.writeFileSync(tmpTombstonePath, existingTombstoneBackup, 'utf8');
    } else if (fs.existsSync(tmpTombstonePath)) {
      fs.unlinkSync(tmpTombstonePath);
    }
    if (hadExistingPushCacheFile && existingPushCacheBackup !== null) {
      fs.writeFileSync(tmpPushCachePath, existingPushCacheBackup, 'utf8');
    } else if (fs.existsSync(tmpPushCachePath)) {
      fs.unlinkSync(tmpPushCachePath);
    }
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('Falha nos testes de integridade financeira:', err);
  process.exit(1);
});
