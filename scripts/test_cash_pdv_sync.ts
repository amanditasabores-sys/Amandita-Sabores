/**
 * Testes Específicos — Sincronização do Caixa com o PDV
 *
 * Valida os 6 requisitos obrigatórios:
 *  a) Firebase ativo e sincronização pendente (e snapshot fromCache) NÃO cria turno fictício.
 *  b) Snapshot autoritativo confirmando caixa aberto apresenta o turno verdadeiro e envia o shiftId real.
 *  c) Snapshot autoritativo confirmando caixa fechado não apresenta caixa aberto e impede venda paga.
 *  d) Falha de sincronização não permite venda com turno não confirmado (sem chamar /confirm-payment).
 *  e) Abertura e fechamento continuam funcionando normalmente contra o servidor transacional.
 *  f) Modo local de contingência continua funcionando normalmente.
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
    userAgent: 'AmanditaCashSyncTest/1.0',
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

class InMemoryTransactionalDb {
  private cols = new Map<string, Map<string, StoredDoc>>();

  private ensureCol(name: string): Map<string, StoredDoc> {
    let m = this.cols.get(name);
    if (!m) {
      m = new Map();
      this.cols.set(name, m);
    }
    return m;
  }

  public seedDoc(colName: string, docId: string, data: Record<string, any>): void {
    const col = this.ensureCol(colName);
    const prev = col.get(docId);
    col.set(docId, { data: deepClone(data), version: (prev?.version || 0) + 1 });
  }

  public clearCollection(colName: string): void {
    this.cols.set(colName, new Map());
  }

  public getRawDoc(colName: string, docId: string): Record<string, any> | undefined {
    const entry = this.cols.get(colName)?.get(docId);
    return entry ? deepClone(entry.data) : undefined;
  }

  private docRef(colName: string, docId: string): any {
    const self = this;
    return {
      __kind: 'docRef',
      colName,
      id: docId,
      path: `${colName}/${docId}`,
      async get() {
        const entry = self.cols.get(colName)?.get(docId);
        return {
          exists: Boolean(entry),
          id: docId,
          ref: this,
          data: () => (entry ? deepClone(entry.data) : undefined),
        };
      },
      async set(data: Record<string, any>, opts?: { merge?: boolean }) {
        const col = self.ensureCol(colName);
        const existing = col.get(docId);
        const nextData = opts?.merge && existing ? { ...deepClone(existing.data), ...deepClone(data) } : deepClone(data);
        col.set(docId, { data: nextData, version: (existing?.version || 0) + 1 });
      },
      async update(partial: Record<string, any>) {
        const col = self.ensureCol(colName);
        const existing = col.get(docId);
        if (!existing) throw new Error(`NOT_FOUND: ${colName}/${docId}`);
        col.set(docId, { data: { ...deepClone(existing.data), ...deepClone(partial) }, version: existing.version + 1 });
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
        const col = self.ensureCol(colName);
        let entries = Array.from(col.entries()).filter(([, entry]) =>
          filters.every((f) => (f.op === '==' ? entry.data[f.field] === f.value : true))
        );
        if (typeof limitNum === 'number' && limitNum >= 0) {
          entries = entries.slice(0, limitNum);
        }
        const docs = entries.map(([id, entry]) => ({
          exists: true,
          id,
          ref: self.docRef(colName, id),
          data: () => deepClone(entry.data),
        }));
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb: (d: any) => void) => docs.forEach(cb),
        };
      },
    };
  }

  public collection(colName: string): any {
    const self = this;
    return {
      ...this.queryRef(colName),
      doc: (docId: string) => self.docRef(colName, docId),
    };
  }

  public async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const tx = {
      get: async (target: any) => target.get(),
      set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => {
        const col = this.ensureCol(ref.colName);
        const existing = col.get(ref.id);
        const nextData = opts?.merge && existing ? { ...deepClone(existing.data), ...deepClone(data) } : deepClone(data);
        col.set(ref.id, { data: nextData, version: (existing?.version || 0) + 1 });
      },
      update: (ref: any, partial: Record<string, any>) => {
        const col = this.ensureCol(ref.colName);
        const existing = col.get(ref.id);
        if (!existing) throw new Error(`NOT_FOUND: ${ref.path}`);
        col.set(ref.id, { data: { ...deepClone(existing.data), ...deepClone(partial) }, version: existing.version + 1 });
      },
      delete: (ref: any) => {
        this.ensureCol(ref.colName).delete(ref.id);
      },
    };
    return await fn(tx);
  }
}

const simUsersByToken: Record<string, { uid: string; email: string; role: string; status: string }> = {
  'tok-caixa': { uid: 'uid-caixa', email: 'caixa@amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
  'tok-atendente': { uid: 'uid-atendente', email: 'atendente@amanditasabores.com.br', role: 'ATENDENTE', status: 'ATIVO' },
};

let activeTestToken = 'tok-caixa';
let expressBaseUrl = '';
const confirmPaymentCalls: Array<{ url: string; body: any }> = [];
let mockAvailabilityResponse: { status: number; body: any } | null = null;

const realFetch = globalThis.fetch.bind(globalThis);
(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (urlStr.startsWith('/api/')) {
    if (urlStr === '/api/store/availability' && mockAvailabilityResponse) {
      return new Response(JSON.stringify(mockAvailabilityResponse.body), {
        status: mockAvailabilityResponse.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (urlStr.includes('/confirm-payment')) {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
      confirmPaymentCalls.push({ url: urlStr, body: parsedBody });
    }

    const headers = new Headers(init?.headers || {});
    if (!headers.has('Authorization') && activeTestToken) {
      headers.set('Authorization', `Bearer ${activeTestToken}`);
    }
    return realFetch(`${expressBaseUrl}${urlStr}`, { ...init, headers });
  }

  return realFetch(input, init);
};

async function run() {
  const simDb = new InMemoryTransactionalDb();
  for (const u of Object.values(simUsersByToken)) {
    simDb.seedDoc('users', u.uid, { id: u.uid, email: u.email, role: u.role, status: u.status });
  }

  const simAdminAuth = {
    verifyIdToken: async (token: string) => {
      const u = simUsersByToken[token];
      if (!u) throw new Error('INVALID_ID_TOKEN');
      return { uid: u.uid, role: u.role, status: u.status };
    },
  };

  const { store } = await import('../src/services/store');
  const setTestStaffSession = (role: 'CAIXA' | 'ATENDENTE') => {
    const tokenKey = role === 'CAIXA' ? 'tok-caixa' : 'tok-atendente';
    const meta = simUsersByToken[tokenKey];
    activeTestToken = tokenKey;
    store.setCurrentUser({
      id: meta.uid,
      name: role === 'CAIXA' ? 'Caixa Teste' : 'Atendente Teste',
      username: role === 'CAIXA' ? 'caixa_teste' : 'atendente_teste',
      email: '',
      isEmailVerified: false,
      role,
      status: 'ATIVO',
      allowedModules: role === 'CAIXA' ? ['pdv', 'kanban', 'caixa'] : ['pdv', 'kanban'],
      createdAt: new Date().toISOString(),
      authProvider: 'firebase_custom_token',
      provisioningState: 'ACTIVE',
    });
  };
  const { default: app, __setTestFirebaseAdminServices } = await import('../server');

  __setTestFirebaseAdminServices({
    adminDb: simDb as any,
    adminAuth: simAdminAuth as any,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  expressBaseUrl = `http://127.0.0.1:${addr.port}`;

  let passed = 0;
  let total = 0;

  async function testCase(name: string, fn: () => Promise<void> | void) {
    total++;
    mockAvailabilityResponse = null;
    confirmPaymentCalls.length = 0;
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  try {
    console.log('=== TESTES DE SINCRONIZAÇÃO CAIXA <-> PDV ===\n');

    // a) Firebase ativo e sincronização pendente não cria turno fictício
    await testCase('a) Firebase ativo com sincronização pendente (e fromCache: true) não cria turno fictício', async () => {
      storageMap.clear();
      simDb.clearCollection('cash_shifts');
      simDb.clearCollection('orders');
      store.setServerAtomicPaymentMode(true);
      store.setExplicitCashConfirmationModeForTest(true);
      setTestStaffSession('CAIXA');

      assert.strictEqual(store.getCashShiftSyncState().status, 'IDLE');
      assert.strictEqual(store.getCurrentCashShift(), null, 'Não deve criar nem retornar turno sintético antes da confirmação');
      assert.strictEqual(localStorage.getItem('gf_current_cash_shift'), null, 'Não deve gravar shift-YYYY-MM-DD no localStorage');

      store.beginCashShiftSyncForTest();
      assert.strictEqual(store.getCashShiftSyncState().status, 'SYNCING');
      assert.strictEqual(store.getCurrentCashShift(), null);

      // Snapshot apenas de cache local (IndexedDB fromCache: true) com turno falso/velho NÃO confirma abertura
      const staleCachedShift = {
        id: 'shift-stale-cache',
        openedAt: new Date(Date.now() - 86400000).toISOString(),
        status: 'ABERTO' as const,
        openedBy: 'Cache Velho',
        initialBalance: 100,
        movements: [],
      };
      store.simulateFirestoreCashShiftSnapshotForTest([staleCachedShift], { fromCache: true });
      assert.strictEqual(store.getCashShiftSyncState().status, 'SYNCING', 'Snapshot fromCache=true não pode marcar estado como CONFIRMED');
      assert.strictEqual(store.getCurrentCashShift(), null, 'Turno em cache não confirmado não deve ser considerado aberto');
    });

    // b) Snapshot confirmando caixa aberto apresenta o turno verdadeiro
    await testCase('b) Snapshot autoritativo confirmando caixa aberto apresenta o turno verdadeiro e envia o shiftId real na venda', async () => {
      storageMap.clear();
      simDb.clearCollection('cash_shifts');
      simDb.clearCollection('orders');
      store.setServerAtomicPaymentMode(true);
      store.setExplicitCashConfirmationModeForTest(true);
      setTestStaffSession('ATENDENTE');
      store.beginCashShiftSyncForTest();

      const realShift = {
        id: 'shift-1763400000000',
        openedAt: new Date().toISOString(),
        status: 'ABERTO' as const,
        openedBy: 'Caixa Real',
        initialBalance: 200,
        movements: [],
      };
      simDb.seedDoc('cash_shifts', realShift.id, realShift);
      store.simulateFirestoreCashShiftSnapshotForTest([realShift], { fromCache: false, isFullCollection: false });

      assert.strictEqual(store.getCashShiftSyncState().status, 'CONFIRMED');
      const current = store.getCurrentCashShift();
      assert(current, 'Turno real deve ser retornado após snapshot autoritativo');
      assert.strictEqual(current!.id, realShift.id);
      assert.strictEqual(current!.status, 'ABERTO');

      const saleRes = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-real-shift-sale',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 10,
          customer: { name: 'Cliente Balcão', phone: '83999990000' },
          items: [{ id: 'it-1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz de carne de sol com queijo', quantity: 1, unitPrice: 14, subtotal: 14 }],
          subtotal: 14,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 14,
          paymentMethod: 'DINHEIRO',
          paymentStatus: 'PAGO',
        },
        'Atendente'
      );

      assert.strictEqual(saleRes.synced, true);
      assert.strictEqual(confirmPaymentCalls.length, 1);
      assert.strictEqual(confirmPaymentCalls[0].body.shiftId, realShift.id, 'Venda paga deve enviar exatamente o shiftId real confirmado');
    });

    // c) Snapshot confirmando caixa fechado não apresenta caixa aberto
    await testCase('c) Snapshot autoritativo confirmando caixa fechado não apresenta caixa aberto e impede venda paga', async () => {
      storageMap.clear();
      simDb.clearCollection('cash_shifts');
      simDb.clearCollection('orders');
      store.setServerAtomicPaymentMode(true);
      store.setExplicitCashConfirmationModeForTest(true);
      setTestStaffSession('CAIXA');
      store.beginCashShiftSyncForTest();

      const closedShift = {
        id: 'shift-closed-only',
        openedAt: new Date(Date.now() - 7200000).toISOString(),
        closedAt: new Date(Date.now() - 3600000).toISOString(),
        status: 'FECHADO' as const,
        openedBy: 'Caixa',
        closedBy: 'Caixa',
        initialBalance: 150,
        movements: [],
      };
      simDb.seedDoc('cash_shifts', closedShift.id, closedShift);
      store.simulateFirestoreCashShiftSnapshotForTest([closedShift], { fromCache: false, isFullCollection: true });

      assert.strictEqual(store.getCashShiftSyncState().status, 'CONFIRMED');
      assert.strictEqual(store.getCurrentCashShift(), null, 'Quando não há turno ABERTO, getCurrentCashShift deve ser null');
      assert.strictEqual(localStorage.getItem('gf_current_cash_shift'), 'null');

      const saleRes = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-closed-rejected',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 10,
          customer: { name: 'Cliente Teste', phone: '83999990000' },
          items: [{ id: 'it-1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 15, subtotal: 15 }],
          subtotal: 15,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 15,
          paymentMethod: 'CARTAO_DEBITO',
          paymentStatus: 'PAGO',
        },
        'Caixa'
      );

      assert.strictEqual(saleRes.synced, false);
      assert.strictEqual(saleRes.rejected, true);
      assert.strictEqual(confirmPaymentCalls.length, 0, 'Com caixa confirmado fechado, cliente não deve disparar venda com turno falso');
    });

    // d) Falha de sincronização não permite venda com turno não confirmado
    await testCase('d) Falha de sincronização bloqueia venda sem turno confirmado e sem enviar shiftId sintético', async () => {
      storageMap.clear();
      simDb.clearCollection('cash_shifts');
      simDb.clearCollection('orders');
      store.setServerAtomicPaymentMode(true);
      store.setExplicitCashConfirmationModeForTest(true);
      setTestStaffSession('ATENDENTE');

      // Mesmo que existisse lixo antigo no localStorage, antes de confirmar NÃO pode ser usado
      localStorage.setItem(
        'gf_current_cash_shift',
        JSON.stringify({ id: 'shift-stale-lixo', status: 'ABERTO', openedAt: new Date().toISOString(), openedBy: 'x', initialBalance: 50, movements: [] })
      );
      store.simulateFirestoreCashShiftErrorForTest('permission-denied no listener de caixa');
      // Simula backend availability também indisponível (HTTP 500)
      mockAvailabilityResponse = {
        status: 500,
        body: { success: false, verified: false, isOpen: false, message: 'Falha temporária' },
      };

      assert.strictEqual(store.getCashShiftSyncState().status, 'ERROR');
      assert.strictEqual(store.getCurrentCashShift(), null, 'Sem confirmação real, turno antigo/lixo não deve aparecer como aberto');

      const saleRes = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-sync-error',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 10,
          customer: { name: 'Cliente Sync Erro', phone: '83999990000' },
          items: [{ id: 'it-1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 20, subtotal: 20 }],
          subtotal: 20,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 20,
          paymentMethod: 'DINHEIRO',
          paymentStatus: 'PAGO',
        },
        'Atendente'
      );

      assert.strictEqual(saleRes.synced, false);
      assert.strictEqual(saleRes.rejected, true);
      assert.strictEqual(confirmPaymentCalls.length, 0, 'Venda não pode ser enviada quando a sincronização falhou e não há turno confirmado');
    });

    // e) Abertura e fechamento continuam funcionando
    await testCase('e) Abertura e fechamento de caixa preservados no servidor e atualizam estado confirmado', async () => {
      storageMap.clear();
      simDb.clearCollection('cash_shifts');
      simDb.clearCollection('orders');
      store.setServerAtomicPaymentMode(true);
      store.setExplicitCashConfirmationModeForTest(true);
      setTestStaffSession('CAIXA');

      const openRes = await store.openCashRegisterAsync(150, 'Caixa Teste', { shiftId: 'shift-open-close-e' });
      assert.strictEqual(openRes.success, true);
      assert.strictEqual(openRes.synced, true);
      assert.strictEqual(openRes.shift?.id, 'shift-open-close-e');
      assert.strictEqual(store.getCashShiftSyncState().status, 'CONFIRMED');
      assert.strictEqual(store.getCurrentCashShift()?.id, 'shift-open-close-e');

      const closeRes = await store.closeCashRegisterAsync(150, 'Caixa Teste', 'Fechamento normal', { shiftId: 'shift-open-close-e' });
      assert.strictEqual(closeRes.success, true);
      assert.strictEqual(closeRes.synced, true);
      assert.strictEqual(closeRes.shift?.status, 'FECHADO');
      assert.strictEqual(store.getCashShiftSyncState().status, 'CONFIRMED');
      assert.strictEqual(store.getCurrentCashShift(), null);
      assert.strictEqual(store.getCashShiftHistory().length, 1);
    });

    // f) Modo local de contingência continua funcionando
    await testCase('f) Modo local de contingência continua funcionando quando Firebase não está configurado', async () => {
      storageMap.clear();
      store.setExplicitCashConfirmationModeForTest(false);
      store.setServerAtomicPaymentMode(false);
      setTestStaffSession('CAIXA');

      assert.strictEqual(store.getCashShiftSyncState().status, 'CONFIRMED');
      assert.strictEqual(store.getCashShiftSyncState().source, 'local_contingency');

      const localShift = store.getCurrentCashShift();
      assert(localShift && localShift.status === 'ABERTO', 'Em modo contingência local sem servidor, turno local continua disponível');

      const localSale = await store.createAndConfirmPaidOrderAsync(
        {
          id: 'ord-local-contingency',
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 10,
          customer: { name: 'Venda Local', phone: '83999990000' },
          items: [{ id: 'it-1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 12, subtotal: 12 }],
          subtotal: 12,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 12,
          paymentMethod: 'DINHEIRO',
          paymentStatus: 'PAGO',
        },
        'Caixa'
      );

      assert.strictEqual(localSale.synced, false);
      assert.strictEqual(localSale.rejected, undefined);
      assert(localSale.order && localSale.order.paymentStatus === 'PAGO');
      assert.strictEqual(confirmPaymentCalls.length, 0, 'Modo local não chama backend');
    });

    console.log(`\nResumo: ${passed}/${total} cenários aprovados.`);
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
  console.error('❌ Erro fatal nos testes de sincronização caixa <-> PDV:', err);
  process.exit(1);
});
