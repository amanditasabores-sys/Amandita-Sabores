/**
 * Suite Completa de Integridade Financeira — ETAPA 2 (Amandita Sabores)
 *
 * Testa contra o Express app real (`server.ts`) + camada `store.ts` + simulador
 * transacional de Firestore Admin (`runTransaction` com controle de versão):
 *  1. Cancelamento & Estorno atômicos (PENDENTE, PAGO PIX/DINHEIRO, concorrência,
 *     timeout recovery via /cancel-state, ausência de turno, turno FECHADO, múltiplos
 *     turnos abertos, 503 sem Admin SDK, RBAC).
 *  2. Caixa com confirmação real do servidor (abertura, concorrência 2 opens,
 *     fechamento com falha de rede, imutabilidade de turno FECHADO, idempotência
 *     de movimentações e ajuste após timeout, proteção de VENDA/ESTORNO, RBAC, guards).
 *  3. Cardápio público com confirmação real antes do sucesso (PIX exato & TXID
 *     PENDENTE, falha antes de gravar sem marcar recebido, resposta perdida após
 *     commit com recuperação via /public-confirmation, retry idempotente sem duplicar,
 *     carrinho > 8 itens com adicionais).
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { validatePixPayload } from '../src/utils/pix';

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
    userAgent: 'AmanditaStage2IntegrityTest/1.0',
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

  public async runTransaction<T>(updateFn: (tx: any) => Promise<T>): Promise<T> {
    const maxAttempts = 12;
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
        await new Promise((r) => setTimeout(r, attempt === 1 ? 20 : 2));
      }

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

const simUsersByToken: Record<string, { uid: string; email: string; role: string; status: string }> = {
  'tok-admin': { uid: 'uid-admin', email: 'dvrmercadinho@gmail.com', role: 'ADMINISTRADOR', status: 'ATIVO' },
  'tok-gerente': { uid: 'uid-gerente', email: 'gerente@amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' },
  'tok-caixa': { uid: 'uid-caixa', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
  'tok-atendente': { uid: 'uid-atendente', email: 'atendente@staff.amanditasabores.com.br', role: 'ATENDENTE', status: 'ATIVO' },
  'tok-entregador': { uid: 'uid-entregador', email: 'entregador@staff.amanditasabores.com.br', role: 'ENTREGADOR', status: 'ATIVO' },
};

const realFetch = globalThis.fetch.bind(globalThis);
let expressBaseUrl = '';
let activeTestToken = 'tok-admin';
let delayPostUrlsMatching: { pattern: string; delayMs: number } | null = null;
let failPostUrlsMatching: string | null = null;

(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method || 'GET').toUpperCase();

  if (url.startsWith('/')) {
    if (method === 'POST' && failPostUrlsMatching && url.includes(failPostUrlsMatching)) {
      throw new TypeError(`Simulated network failure before commit on ${url}`);
    }

    const headers = new Headers(init?.headers || {});
    if (!headers.has('Authorization') && activeTestToken) {
      headers.set('Authorization', `Bearer ${activeTestToken}`);
    }

    const targetUrl = `${expressBaseUrl}${url}`;

    // Simulate response drop/timeout AFTER server successfully commits transaction
    if (method === 'POST' && delayPostUrlsMatching && url.includes(delayPostUrlsMatching.pattern)) {
      const { signal, ...initWithoutSignal } = init || {};
      const committedResponse = await realFetch(targetUrl, { ...initWithoutSignal, headers });
      const delayMs = delayPostUrlsMatching.delayMs;
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          const err = new Error('The operation was aborted');
          (err as any).name = 'AbortError';
          reject(err);
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          const err = new Error('The operation was aborted');
          (err as any).name = 'AbortError';
          reject(err);
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

  const { store } = await import('../src/services/store');
  const { default: app, __setTestFirebaseAdminServices } = await import('../server');

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

  function setLoggedUser(role: 'ADMINISTRADOR' | 'GERENTE' | 'CAIXA' | 'ATENDENTE' | 'ENTREGADOR' | null) {
    if (!role) {
      activeTestToken = '';
      localStorage.removeItem('gf_current_user');
      return;
    }
    const tokenMap = {
      ADMINISTRADOR: 'tok-admin',
      GERENTE: 'tok-gerente',
      CAIXA: 'tok-caixa',
      ATENDENTE: 'tok-atendente',
      ENTREGADOR: 'tok-entregador',
    };
    activeTestToken = tokenMap[role];
    const u = simUsersByToken[activeTestToken];
    localStorage.setItem(
      'gf_current_user',
      JSON.stringify({
        id: u.uid,
        name: `Operador ${role}`,
        username: role.toLowerCase(),
        email: u.email,
        role,
        status: 'ATIVO',
      })
    );
  }

  function resetAllState() {
    delayPostUrlsMatching = null;
    failPostUrlsMatching = null;
    simDb.yieldInsideTransaction = false;
    simDb.clearCollection('orders');
    simDb.clearCollection('public_tracking');
    simDb.clearCollection('cash_shifts');
    localStorage.setItem('gf_orders', '[]');
    localStorage.setItem('gf_current_cash_shift', 'null');
    localStorage.setItem('gf_cash_shifts_history', '[]');
    localStorage.removeItem('gf_pending_sync_orders');
    localStorage.removeItem('gf_synced_order_ids');
    localStorage.removeItem('gf_deleted_order_ids');
    // Configure valid store PIX settings
    const cfg = store.getRestaurantConfig();
    localStorage.setItem(
      'gf_restaurant_config',
      JSON.stringify({
        ...cfg,
        pixKey: '83988887777',
        pixKeyType: 'TELEFONE',
        pixReceiverName: 'AMANDITA SABORES',
        pixReceiverCity: 'CAMPINA GRANDE',
        deliveryFeeBase: 5.0,
      })
    );
  }

  function seedShift(shiftId: string, status: 'ABERTO' | 'FECHADO', initialBalance = 150, movements: any[] = []) {
    const shift = {
      id: shiftId,
      openedAt: new Date(Date.now() - 3600000).toISOString(),
      ...(status === 'FECHADO' ? { closedAt: new Date(Date.now() - 1800000).toISOString(), closedBy: 'Caixa Antigo', finalCalculatedBalance: initialBalance, finalCountedCash: initialBalance, difference: 0 } : {}),
      openedBy: 'Operador Teste',
      initialBalance,
      status,
      movements,
    };
    simDb.seedDoc('cash_shifts', shiftId, shift);
    if (status === 'ABERTO') {
      localStorage.setItem('gf_current_cash_shift', JSON.stringify(shift));
    }
    return shift;
  }

  function seedPaidOrderWithSale(
    orderId: string,
    amount: number,
    method: 'PIX' | 'DINHEIRO' | 'CARTAO_CREDITO',
    shiftId: string
  ) {
    const now = new Date().toISOString();
    const trackingCode = `tk_${orderId}_${'a'.repeat(24)}`;
    const order = {
      id: orderId,
      orderNumber: `#${Math.floor(1100 + Math.random() * 8000)}`,
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
      paymentStatus: 'PAGO' as const,
      status: 'EM_PREPARO' as const,
      trackingCode,
      movements: [{ id: 'm1', timestamp: now, toStatus: 'EM_PREPARO', author: 'Sistema' }],
    };
    simDb.seedDoc('orders', orderId, order);
    simDb.seedDoc('public_tracking', trackingCode, {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount,
      updatedAt: now,
    });

    const shift = simDb.getRawDoc('cash_shifts', shiftId);
    if (shift) {
      shift.movements.push({
        id: `cash-sale-${orderId}`,
        timestamp: now,
        type: 'VENDA',
        amount,
        paymentMethod: method,
        description: `Recebimento Pedido ${order.orderNumber}`,
        orderId,
        orderNumber: order.orderNumber,
        author: 'Operador',
      });
      simDb.seedDoc('cash_shifts', shiftId, shift);
      if (shift.status === 'ABERTO') {
        localStorage.setItem('gf_current_cash_shift', JSON.stringify(shift));
      }
    }

    const localOrders = store.getOrders();
    localStorage.setItem('gf_orders', JSON.stringify([order, ...localOrders.filter((o: any) => o.id !== orderId)]));
    return order;
  }

  async function runScenario(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✓ [PASS] ${name}`);
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}: ${err?.stack || err?.message || err}`);
    }
  }

  try {
    console.log('==============================================================================');
    console.log('TESTES DE INTEGRIDADE FINANCEIRA — ETAPA 2 (CANCELAMENTO, CAIXA, CARDÁPIO)');
    console.log('==============================================================================\n');

    console.log('--- BLOCO 1: CANCELAMENTO & ESTORNO ATÔMICOS ---');

    await runScenario('1. Cancelar pedido PENDENTE cancela pedido e tracking sem gerar ESTORNO', async () => {
      resetAllState();
      setLoggedUser('ADMINISTRADOR');
      seedShift('shift-1', 'ABERTO', 150, []);
      const trackingCode = 'tk_pend_order_12345678901234567890';
      simDb.seedDoc('orders', 'ord-pend-1', {
        id: 'ord-pend-1',
        orderNumber: '#2001',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fulfillmentType: 'DELIVERY',
        customer: { name: 'Ana', phone: '83988887777' },
        items: [{ id: 'i1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 20, subtotal: 20 }],
        subtotal: 20,
        deliveryFee: 5,
        discount: 0,
        totalAmount: 25,
        paymentMethod: 'PIX',
        paymentStatus: 'PENDENTE',
        status: 'NOVO',
        trackingCode,
        movements: [],
      });
      simDb.seedDoc('public_tracking', trackingCode, { id: 'ord-pend-1', status: 'NOVO', paymentStatus: 'PENDENTE' });

      const res = await store.cancelOrderAsync('ord-pend-1', 'Cliente desistiu', 'Admin');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.synced, true);
      const remoteOrder = simDb.getRawDoc('orders', 'ord-pend-1')!;
      const remoteTrack = simDb.getRawDoc('public_tracking', trackingCode)!;
      const remoteShift = simDb.getRawDoc('cash_shifts', 'shift-1')!;
      assert.strictEqual(remoteOrder.status, 'CANCELADO');
      assert.strictEqual(remoteTrack.status, 'CANCELADO');
      assert.strictEqual(remoteShift.movements.length, 0);
    });

    await runScenario('2. Cancelar pedido PAGO (PIX e DINHEIRO) gera exatamente 1 ESTORNO atômico', async () => {
      resetAllState();
      setLoggedUser('GERENTE');
      seedShift('shift-2', 'ABERTO', 200, []);
      seedPaidOrderWithSale('ord-paid-pix', 35.5, 'PIX', 'shift-2');
      seedPaidOrderWithSale('ord-paid-cash', 40.0, 'DINHEIRO', 'shift-2');

      const resPix = await store.cancelOrderAsync('ord-paid-pix', 'Erro no pedido PIX', 'Gerente');
      assert.strictEqual(resPix.success, true);
      assert.strictEqual(resPix.synced, true);

      const resCash = await store.cancelOrderAsync('ord-paid-cash', 'Troco incorreto', 'Gerente');
      assert.strictEqual(resCash.success, true);

      const remoteShift = simDb.getRawDoc('cash_shifts', 'shift-2')!;
      const estornosPix = remoteShift.movements.filter((m: any) => m.type === 'ESTORNO' && m.orderId === 'ord-paid-pix');
      const estornosCash = remoteShift.movements.filter((m: any) => m.type === 'ESTORNO' && m.orderId === 'ord-paid-cash');
      assert.strictEqual(estornosPix.length, 1);
      assert.strictEqual(estornosPix[0].id, 'cash-estorno-ord-paid-pix');
      assert.strictEqual(estornosPix[0].paymentMethod, 'PIX');
      assert.strictEqual(estornosPix[0].amount, 35.5);

      assert.strictEqual(estornosCash.length, 1);
      assert.strictEqual(estornosCash[0].paymentMethod, 'DINHEIRO');
      assert.strictEqual(estornosCash[0].amount, 40);
    });

    await runScenario('3. Duas tentativas simultâneas (duplo clique) de cancelar pedido PAGO não duplicam ESTORNO', async () => {
      resetAllState();
      setLoggedUser('ADMINISTRADOR');
      simDb.yieldInsideTransaction = true;
      seedShift('shift-3', 'ABERTO', 150, []);
      seedPaidOrderWithSale('ord-race-cancel', 50, 'PIX', 'shift-3');

      const [r1, r2] = await Promise.all([
        store.cancelOrderAsync('ord-race-cancel', 'Cancelamento A', 'Admin A'),
        store.cancelOrderAsync('ord-race-cancel', 'Cancelamento B', 'Admin B'),
      ]);

      assert.strictEqual([r1.success, r2.success].filter(Boolean).length, 1, 'Exatamente 1 cancelamento concorrente deve vencer');
      const remoteShift = simDb.getRawDoc('cash_shifts', 'shift-3')!;
      const estornos = remoteShift.movements.filter((m: any) => m.type === 'ESTORNO' && m.orderId === 'ord-race-cancel');
      assert.strictEqual(estornos.length, 1, 'Nunca pode gerar ESTORNO duplicado em concorrência');
    });

    await runScenario('4. Timeout após commit do cancelamento reconcilia via /cancel-state sem duplicar ESTORNO', async () => {
      resetAllState();
      setLoggedUser('ADMINISTRADOR');
      seedShift('shift-4', 'ABERTO', 150, []);
      seedPaidOrderWithSale('ord-timeout-cancel', 28, 'PIX', 'shift-4');

      delayPostUrlsMatching = { pattern: '/cancel', delayMs: 220 };
      const res = await store.cancelOrderAsync('ord-timeout-cancel', 'Timeout na resposta', 'Admin', undefined, { timeoutMs: 40 });
      delayPostUrlsMatching = null;

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.synced, true);
      assert.strictEqual(res.recoveredFromTimeout, true);
      assert.strictEqual(store.getOrderById('ord-timeout-cancel')?.status, 'CANCELADO');
      const remoteShift = simDb.getRawDoc('cash_shifts', 'shift-4')!;
      assert.strictEqual(remoteShift.movements.filter((m: any) => m.orderId === 'ord-timeout-cancel' && m.type === 'ESTORNO').length, 1);
    });

    await runScenario('5. Falha de rede antes do servidor receber cancelamento mantém pedido ATIVO localmente', async () => {
      resetAllState();
      setLoggedUser('ADMINISTRADOR');
      seedShift('shift-5', 'ABERTO', 150, []);
      seedPaidOrderWithSale('ord-net-fail', 28, 'PIX', 'shift-5');

      failPostUrlsMatching = '/cancel';
      const res = await store.cancelOrderAsync('ord-net-fail', 'Queda de internet', 'Admin');
      failPostUrlsMatching = null;

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.synced, false);
      assert.strictEqual(store.getOrderById('ord-net-fail')?.status, 'EM_PREPARO');
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-net-fail')?.status, 'EM_PREPARO');
    });

    await runScenario('6. Cancelar pedido PAGO sem turno aberto OU com turno FECHADO falha atomicamente sem cancelamento parcial', async () => {
      resetAllState();
      setLoggedUser('ADMINISTRADOR');
      const closedShift = seedShift('shift-closed-6', 'FECHADO', 150, []);
      const order = seedPaidOrderWithSale('ord-no-open-shift', 42, 'PIX', 'shift-closed-6');
      localStorage.removeItem('gf_current_cash_shift');

      const res = await store.cancelOrderAsync('ord-no-open-shift', 'Sem caixa aberto', 'Admin');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.rejected, true);
      // Pedido continua intacto (EM_PREPARO e PAGO), turno FECHADO intacto!
      const remoteOrder = simDb.getRawDoc('orders', order.id)!;
      const remoteClosedShift = simDb.getRawDoc('cash_shifts', closedShift.id)!;
      assert.strictEqual(remoteOrder.status, 'EM_PREPARO');
      assert.strictEqual(remoteOrder.paymentStatus, 'PAGO');
      assert.strictEqual(remoteClosedShift.movements.filter((m: any) => m.type === 'ESTORNO').length, 0);
    });

    await runScenario('7. Cancelar pedido PAGO com múltiplos turnos ABERTOs falha sem mutação parcial', async () => {
      resetAllState();
      setLoggedUser('ADMINISTRADOR');
      seedShift('shift-open-a', 'ABERTO', 100, []);
      seedShift('shift-open-b', 'ABERTO', 100, []);
      seedPaidOrderWithSale('ord-multi-shift', 30, 'PIX', 'shift-open-a');

      const res = await store.cancelOrderAsync('ord-multi-shift', 'Múltiplos caixas', 'Admin');
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.rejected, true);
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-multi-shift')?.status, 'EM_PREPARO');
    });

    await runScenario('8. RBAC cancelamento e falha segura 503 sem Admin SDK', async () => {
      resetAllState();
      seedShift('shift-8', 'ABERTO', 100, []);
      seedPaidOrderWithSale('ord-rbac-8', 25, 'PIX', 'shift-8');

      for (const forbidden of ['ATENDENTE', 'CAIXA', 'ENTREGADOR'] as const) {
        setLoggedUser(forbidden);
        const r = await store.cancelOrderAsync('ord-rbac-8', 'Tentativa indevida', forbidden);
        assert.strictEqual(r.success, false, `${forbidden} não pode cancelar`);
        assert.strictEqual(r.rejected, true);
      }

      // Admin com Admin SDK indisponível => 503 seguro sem alterar pedido
      setLoggedUser('ADMINISTRADOR');
      __setTestFirebaseAdminServices({ adminDb: null, adminAuth: simAdminAuth as any });
      const r503 = await store.cancelOrderAsync('ord-rbac-8', 'Sem Admin SDK', 'Admin');
      __setTestFirebaseAdminServices({ adminDb: simDb as any, adminAuth: simAdminAuth as any });

      assert.strictEqual(r503.success, false);
      assert.strictEqual(r503.rejected, true);
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-rbac-8')?.status, 'EM_PREPARO');
    });

    console.log('\n--- BLOCO 2: OPERAÇÕES DE CAIXA CONFIRMADAS PELO SERVIDOR ---');

    await runScenario('9. Abrir caixa aguarda servidor e impede dois turnos ABERTOs simultâneos', async () => {
      resetAllState();
      setLoggedUser('CAIXA');
      simDb.yieldInsideTransaction = true;

      const [open1, open2] = await Promise.all([
        store.openCashRegisterAsync(150, 'Caixa A', { shiftId: 'shift-race-a' }),
        store.openCashRegisterAsync(200, 'Caixa B', { shiftId: 'shift-race-b' }),
      ]);

      const successes = [open1, open2].filter((r) => r.success);
      const failures = [open1, open2].filter((r) => !r.success);
      assert.strictEqual(successes.length, 1, 'Somente um turno pode ser aberto simultaneamente');
      assert.strictEqual(failures.length, 1);
      assert.strictEqual(failures[0].rejected, true);
      const openDocs = simDb.getAllDocs('cash_shifts').filter((s) => s.status === 'ABERTO');
      assert.strictEqual(openDocs.length, 1);
    });

    await runScenario('10. Falha de rede ao abrir ou fechar caixa NÃO altera o estado local nem simula sucesso', async () => {
      resetAllState();
      setLoggedUser('CAIXA');

      failPostUrlsMatching = '/cash-shifts/open';
      const openFail = await store.openCashRegisterAsync(150, 'Caixa', { shiftId: 'shift-net-open' });
      failPostUrlsMatching = null;
      assert.strictEqual(openFail.success, false);
      assert.strictEqual(store.getCurrentCashShift(), null, 'Não deve criar turno local falso após falha');

      // Agora abre de verdade
      const openOk = await store.openCashRegisterAsync(150, 'Caixa', { shiftId: 'shift-net-close' });
      assert.strictEqual(openOk.success, true);

      // Falha de rede ao fechar mantém caixa ABERTO localmente
      failPostUrlsMatching = '/close';
      const closeFail = await store.closeCashRegisterAsync(150, 'Caixa', 'Teste falha');
      failPostUrlsMatching = null;
      assert.strictEqual(closeFail.success, false);
      assert.strictEqual(store.getCurrentCashShift()?.status, 'ABERTO', 'Caixa local deve permanecer ABERTO');
      assert.strictEqual(store.getCashShiftHistory().length, 0);

      // Agora fecha com confirmação real do servidor
      const closeOk = await store.closeCashRegisterAsync(155, 'Caixa', 'Conferido');
      assert.strictEqual(closeOk.success, true);
      assert.strictEqual(closeOk.synced, true);
      assert.strictEqual(closeOk.shift?.status, 'FECHADO');
      assert.strictEqual(closeOk.shift?.difference, 5);
      assert.strictEqual(store.getCurrentCashShift(), null);
      assert.strictEqual(store.getCashShiftHistory().length, 1);
    });

    await runScenario('11. Imutabilidade de turno FECHADO, proteção de VENDA/ESTORNO e idempotência após timeout', async () => {
      resetAllState();
      setLoggedUser('CAIXA');
      const openRes = await store.openCashRegisterAsync(100, 'Caixa', { shiftId: 'shift-11' });
      assert.strictEqual(openRes.success, true);

      // Timeout após commit em addCashMovementAsync recupera sem duplicar
      delayPostUrlsMatching = { pattern: '/movements', delayMs: 220 };
      const movTimeoutRes = await store.addCashMovementAsync(
        'SANGRIA',
        30,
        'Compra de embalagem',
        'Caixa',
        'DINHEIRO',
        undefined,
        { movementId: 'mov-idem-11', timeoutMs: 40 }
      );
      delayPostUrlsMatching = null;
      assert.strictEqual(movTimeoutRes.success, true);
      assert.strictEqual(movTimeoutRes.recoveredFromTimeout, true);

      // Retry com o mesmo movementId não duplica
      const movRetry = await store.addCashMovementAsync(
        'SANGRIA',
        30,
        'Compra de embalagem',
        'Caixa',
        'DINHEIRO',
        undefined,
        { movementId: 'mov-idem-11' }
      );
      assert.strictEqual(movRetry.success, true);
      assert.strictEqual(simDb.getRawDoc('cash_shifts', 'shift-11')?.movements.length, 1);

      // Ajuste de gaveta no servidor (deve ser R$ 100 - 30 = 70; ajustar para 85 => +15)
      const adjRes = await store.adjustDrawerBalanceAsync(85, 'Sobra moedas', 'Caixa', { movementId: 'adj-11' });
      assert.strictEqual(adjRes.success, true);
      assert.strictEqual(adjRes.movement?.amount, 15);

      // Proteção de VENDA contra exclusão
      seedPaidOrderWithSale('ord-prot-11', 25, 'DINHEIRO', 'shift-11');
      const delAuditRes = await store.deleteCashMovementAsync('cash-sale-ord-prot-11', { shiftId: 'shift-11' });
      assert.strictEqual(delAuditRes.success, false);
      assert.strictEqual(delAuditRes.rejected, true);

      // Fecha turno e verifica bloqueio de alterações em turno FECHADO
      const closed = await store.closeCashRegisterAsync(110, 'Caixa', 'Lacre');
      assert.strictEqual(closed.success, true);

      const addOnClosed = await store.addCashMovementAsync(
        'SUPRIMENTO',
        50,
        'Tentativa pós fechamento',
        'Caixa',
        'DINHEIRO',
        undefined,
        { shiftId: 'shift-11', movementId: 'mov-after-close' }
      );
      assert.strictEqual(addOnClosed.success, false);
      assert.strictEqual(addOnClosed.rejected, true);

      const adjOnClosed = await store.adjustDrawerBalanceAsync(200, 'Indevido', 'Caixa', { shiftId: 'shift-11', movementId: 'adj-after-close' });
      assert.strictEqual(adjOnClosed.success, false);
      assert.strictEqual(adjOnClosed.rejected, true);

      const delOnClosed = await store.deleteCashMovementAsync('mov-idem-11', { shiftId: 'shift-11' });
      assert.strictEqual(delOnClosed.success, false);
      assert.strictEqual(delOnClosed.rejected, true);
    });

    await runScenario('12. RBAC do Caixa (ATENDENTE bloqueado) e bloqueio de métodos síncronos em modo nuvem', async () => {
      resetAllState();
      setLoggedUser('ATENDENTE');
      const rOpen = await store.openCashRegisterAsync(100, 'Atendente');
      assert.strictEqual(rOpen.success, false);
      assert.strictEqual(rOpen.rejected, true);

      setLoggedUser('CAIXA');
      // Chamadas síncronas não podem criar ou alterar turno em modo atômico
      assert.strictEqual(store.openCashRegister(100, 'Caixa'), null);
      assert.strictEqual(store.getCurrentCashShift(), null);
      assert.strictEqual(store.closeCashRegister(100, 'Caixa'), null);
      assert.strictEqual(store.addCashMovement('SANGRIA', 10, 'Teste', 'Caixa'), null);
      assert.strictEqual(store.adjustDrawerBalance(50, 'Teste', 'Caixa'), null);
      assert.strictEqual(store.deleteCashMovement('x'), false);
    });

    console.log('\n--- BLOCO 3: CARDÁPIO PÚBLICO COM CONFIRMAÇÃO REAL ANTES DO SUCESSO ---');

    await runScenario('13. Pedido PIX pelo Cardápio Público grava PENDENTE com QR/Copia e Cola de valor exato e TXID único', async () => {
      resetAllState();
      seedShift('shift-pub-13', 'ABERTO', 100);
      setLoggedUser(null); // Cliente anônimo público

      const res = await store.createOrderAsync(
        {
          id: 'ord-pub-pix-13',
          orderNumber: '#3013',
          trackingCode: 'tk_pub_pix_13_abcdefghijklmnopqrst',
          estimatedDeliveryMinutes: 40,
          fulfillmentType: 'DELIVERY',
          customer: { name: 'Cliente Web', phone: '83988887777' },
          items: [
            {
              id: 'ci-1',
              menuItemId: 'cuscuz-ovos',
              name: 'Cuscuz com ovos',
              quantity: 1,
              unitPrice: 11.0,
              addons: [{ id: 'ad-ovos', name: 'Ovos', price: 3.0 }],
              subtotal: 11.0,
            },
          ],
          subtotal: 11.0,
          deliveryFee: 5.0,
          discount: 0,
          totalAmount: 16.0,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
          status: 'NOVO',
        },
        { requireServerConfirmation: true }
      );

      assert.strictEqual(res.synced, true);
      assert.strictEqual(res.order.paymentStatus, 'PENDENTE');
      assert.ok(res.order.pixCode && res.order.pixTxId);
      const pixAudit = validatePixPayload(res.order.pixCode!);
      assert.strictEqual(pixAudit.valid, true);
      assert.strictEqual(pixAudit.amount, '16.00');
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-pub-pix-13')?.id, 'ord-pub-pix-13');
      assert.ok(simDb.getRawDoc('public_tracking', res.order.trackingCode!));
    });

    await runScenario('14. Falha antes da gravação no servidor retorna synced: false e NÃO grava localmente nem na fila offline', async () => {
      resetAllState();
      setLoggedUser(null);

      failPostUrlsMatching = '/api/orders';
      const res = await store.createOrderAsync(
        {
          id: 'ord-pub-fail-14',
          orderNumber: '#3014',
          trackingCode: 'tk_pub_fail_14_abcdefghijklmnopqr',
          estimatedDeliveryMinutes: 40,
          fulfillmentType: 'DELIVERY',
          customer: { name: 'Cliente Offline', phone: '83988887777' },
          items: [
            {
              id: 'ci-1',
              menuItemId: 'cuscuz-ovos',
              name: 'Cuscuz com ovos',
              quantity: 1,
              unitPrice: 8.0,
              subtotal: 8.0,
            },
          ],
          subtotal: 8.0,
          deliveryFee: 5.0,
          discount: 0,
          totalAmount: 13.0,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
          status: 'NOVO',
        },
        { requireServerConfirmation: true }
      );
      failPostUrlsMatching = null;

      assert.strictEqual(res.synced, false);
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-pub-fail-14'), undefined);
      assert.strictEqual(store.getOrderById('ord-pub-fail-14'), undefined, 'Pedido não pode entrar em gf_orders se falhou');
      const pendingQueue = JSON.parse(localStorage.getItem('gf_pending_sync_orders') || '[]');
      assert.strictEqual(pendingQueue.length, 0, 'Pedido público rejeitado/não confirmado não deve ficar pendente falso');
    });

    await runScenario('15. Resposta perdida após gravação no servidor recupera via /public-confirmation e retry é idempotente', async () => {
      resetAllState();
      seedShift('shift-pub-15', 'ABERTO', 100);
      setLoggedUser(null);
      const stableId = 'ord-pub-timeout-15';
      const stableTk = 'tk_pub_timeout_15_abcdefghijklmnop';

      // Cria carrinho > 8 itens para garantir caminho direto via /api/orders (ou fallback) + timeout pós-commit
      const items = Array.from({ length: 9 }, (_, i) => ({
        id: `ci-${i}`,
        menuItemId: 'cuscuz-ovos',
        name: 'Cuscuz com ovos',
        quantity: 1,
        unitPrice: 8.0,
        subtotal: 8.0,
      }));

      delayPostUrlsMatching = { pattern: '/api/orders', delayMs: 220 };
      const res = await store.createOrderAsync(
        {
          id: stableId,
          orderNumber: '#3015',
          trackingCode: stableTk,
          estimatedDeliveryMinutes: 15,
          fulfillmentType: 'RETIRADA',
          customer: { name: 'Cliente Timeout', phone: '83988887777' },
          items,
          subtotal: 72.0,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 72.0,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
          status: 'NOVO',
        },
        { requireServerConfirmation: true, timeoutMs: 40 }
      );
      delayPostUrlsMatching = null;

      assert.strictEqual(res.synced, true);
      assert.strictEqual(res.recoveredFromTimeout, true);
      assert.strictEqual(simDb.getAllDocs('orders').filter((o) => o.id === stableId).length, 1);

      // Reenvio idêntico pelo mesmo cliente não cria duplicado
      const retryRes = await store.createOrderAsync(
        {
          id: stableId,
          orderNumber: '#3015',
          trackingCode: stableTk,
          estimatedDeliveryMinutes: 15,
          fulfillmentType: 'RETIRADA',
          customer: { name: 'Cliente Timeout', phone: '83988887777' },
          items,
          subtotal: 72.0,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 72.0,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
          status: 'NOVO',
        },
        { requireServerConfirmation: true }
      );
      assert.strictEqual(retryRes.synced, true);
      assert.strictEqual(simDb.getAllDocs('orders').length, 1, 'Retry com mesmo ID/trackingCode nunca pode duplicar pedido');
    });

    await runScenario('16. Verificação estrutural dos componentes CashRegisterManager.tsx e CustomerMenu.tsx', async () => {
      const cashUi = fs.readFileSync(path.join(process.cwd(), 'src/components/admin/CashRegisterManager.tsx'), 'utf8');
      const menuUi = fs.readFileSync(path.join(process.cwd(), 'src/components/menu/CustomerMenu.tsx'), 'utf8');

      assert(cashUi.includes('openCashRegisterAsync'), 'CashRegisterManager deve usar openCashRegisterAsync');
      assert(cashUi.includes('closeCashRegisterAsync'), 'CashRegisterManager deve usar closeCashRegisterAsync');
      assert(cashUi.includes('addCashMovementAsync'), 'CashRegisterManager deve usar addCashMovementAsync');
      assert(cashUi.includes('adjustDrawerBalanceAsync'), 'CashRegisterManager deve usar adjustDrawerBalanceAsync');
      assert(cashUi.includes('deleteCashMovementAsync'), 'CashRegisterManager deve usar deleteCashMovementAsync');
      assert(!cashUi.includes("alert('Por favor"), 'CashRegisterManager não deve usar window.alert no ajuste');

      assert(menuUi.includes('requireServerConfirmation'), 'CustomerMenu deve exigir requireServerConfirmation');
      assert(menuUi.includes('draftOrderIdentityRef'), 'CustomerMenu deve preservar identidade estável para retry');
      assert(menuUi.includes('submittingOrderRef'), 'CustomerMenu deve travar duplo envio');
      const checkFailBeforeClear = menuUi.indexOf('if (requireCloudConfirm && (!syncRes.synced') < menuUi.indexOf('setCreatedOrder(order)');
      assert(checkFailBeforeClear, 'CustomerMenu só exibe Pedido Recebido após confirmação do servidor');
    });

    await runScenario('17. PATCH/POST /api/orders/:id/status rejeita CANCELADO com 403 USE_ATOMIC_ORDER_CANCELLATION (PAGO e PENDENTE) e Store bloqueia desvio', async () => {
      resetAllState();
      seedShift('shift-status-block', 'ABERTO', 150, []);
      seedPaidOrderWithSale('ord-paid-bypass', 45.0, 'PIX', 'shift-status-block');
      const pendOrder = {
        id: 'ord-pend-bypass',
        orderNumber: '#2099',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fulfillmentType: 'RETIRADA',
        customer: { name: 'Cliente Pendente', phone: '83988887777' },
        items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz', quantity: 1, unitPrice: 8, subtotal: 8 }],
        subtotal: 8,
        deliveryFee: 0,
        discount: 0,
        totalAmount: 8,
        paymentMethod: 'PIX',
        paymentStatus: 'PENDENTE',
        status: 'NOVO',
        trackingCode: 'tk_pend_bypass_12345678901234567890',
        movements: [],
      };
      simDb.seedDoc('orders', 'ord-pend-bypass', pendOrder);
      localStorage.setItem('gf_orders', JSON.stringify([pendOrder, ...store.getOrders()]));

      // 1) Admin e Gerente tentando cancelar pedido PAGO via PATCH /api/orders/:id/status
      for (const roleToken of ['tok-admin', 'tok-gerente']) {
        const resPaid = await realFetch(`${expressBaseUrl}/api/orders/ord-paid-bypass/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${roleToken}`,
          },
          body: JSON.stringify({
            status: 'CANCELADO',
            cancellationReason: 'Tentativa direta fora do fluxo oficial',
          }),
        });
        const bodyPaid = await resPaid.json();
        assert.strictEqual(resPaid.status, 403, `PATCH /status deve retornar 403 para pedido PAGO (${roleToken})`);
        assert.strictEqual(bodyPaid.code, 'USE_ATOMIC_ORDER_CANCELLATION');
        assert.strictEqual(simDb.getRawDoc('orders', 'ord-paid-bypass')?.status, 'EM_PREPARO');
        assert.strictEqual(simDb.getRawDoc('cash_shifts', 'shift-status-block')?.movements.filter((m: any) => m.type === 'ESTORNO').length, 0);
      }

      // 2) Admin tentando cancelar pedido PENDENTE via PATCH e POST /api/orders/:id/status
      for (const method of ['PATCH', 'POST'] as const) {
        const resPend = await realFetch(`${expressBaseUrl}/api/orders/ord-pend-bypass/status`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer tok-admin',
          },
          body: JSON.stringify({
            status: 'CANCELADO',
            cancellationReason: 'Tentativa direta em pedido pendente',
          }),
        });
        const bodyPend = await resPend.json();
        assert.strictEqual(resPend.status, 403, `${method} /status deve retornar 403 para pedido PENDENTE`);
        assert.strictEqual(bodyPend.code, 'USE_ATOMIC_ORDER_CANCELLATION');
        assert.strictEqual(simDb.getRawDoc('orders', 'ord-pend-bypass')?.status, 'NOVO');
      }

      // 3) Store layer (updateOrderStatusAsync & updateOrderStatus) também rejeita CANCELADO
      setLoggedUser('ADMINISTRADOR');
      const asyncGuard = await store.updateOrderStatusAsync('ord-paid-bypass', 'CANCELADO', 'Admin', 'Bypass');
      assert.strictEqual(asyncGuard.rejected, true);
      assert.strictEqual(asyncGuard.synced, false);
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-paid-bypass')?.status, 'EM_PREPARO');

      const syncGuard = store.updateOrderStatus('ord-pend-bypass', 'CANCELADO', 'Admin', 'Bypass');
      assert.strictEqual(syncGuard, null);
      assert.strictEqual(store.getOrderById('ord-pend-bypass')?.status, 'NOVO');
    });

    await runScenario('18. StoreSettings desabilita campos durante isLoadingCloudConfig e preserva proteções contra sobrescrita', async () => {
      const settingsUi = fs.readFileSync(path.join(process.cwd(), 'src/components/admin/StoreSettings.tsx'), 'utf8');
      const disabledCount = (settingsUi.match(/disabled=\{isLoadingCloudConfig\}/g) || []).length;
      assert(disabledCount >= 14, `Esperado >= 14 campos desabilitados durante carregamento em StoreSettings.tsx, encontrado: ${disabledCount}`);
      assert(settingsUi.includes('disabled={isSaving || isLoadingCloudConfig || Boolean(cloudLoadError)}'), 'Botão Salvar deve permanecer bloqueado em carregamento/erro');
      assert(settingsUi.includes('hasUnsavedChangesRef'), 'Proteção hasUnsavedChangesRef deve ser preservada');
      assert(settingsUi.includes('Tentar carregar novamente'), 'Botão de nova tentativa deve ser preservado');
      assert(settingsUi.includes('Sincronizando configurações, horários de funcionamento'), 'Indicador de carregamento deve ser preservado');
    });

    console.log('\n==============================================================================');
    console.log(`RESULTADO ETAPA 2: ${passed}/${total} cenários aprovados`);
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
