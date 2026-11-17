/**
 * Suite de Testes — Página Automática de Estabelecimento Fechado (Amandita Sabores)
 *
 * Executa contra o Express app real (`server.ts`) + `store.ts` + `storeHours.ts`
 * com simulador transacional de Firestore Admin (`runTransaction` com controle de versão),
 * cobrindo os 14 cenários obrigatórios de disponibilidade pelo caixa, bloqueio server-side,
 * carregamento/sincronização multi-dispositivo, atomicidade de schedule, corrida TOCTOU,
 * configuração administrativa, UI fechada e fail-closed.
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_OPERATING_HOURS,
  DEFAULT_CLOSED_PRIMARY_MESSAGE,
  DEFAULT_CLOSED_SECONDARY_MESSAGE,
  formatWhatsAppDisplay,
  buildWhatsAppUrl,
  validateOperatingHours,
  validateWhatsAppNumber,
} from '../src/utils/storeHours.ts';

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
    userAgent: 'AmanditaStoreClosedTest/1.0',
  },
});

const tmpFilesToRestore = [
  path.join(process.cwd(), '.deleted_orders_cache.json'),
  path.join(process.cwd(), '.push_dispatches_cache.json'),
  path.join(process.cwd(), '.store_schedule_cache.json'),
];
const fileBackups = tmpFilesToRestore.map((filePath) => ({
  filePath,
  existed: fs.existsSync(filePath),
  content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null,
}));

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
  public failWriteOnceOnPath: string | null = null;
  public beforeCommitHook: ((ops: Array<{ type: string; ref: any }>) => Promise<void>) | null = null;

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

  public clearAll(): void {
    this.cols.clear();
    this.colVersions.clear();
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
                readDocVersions.set(key, this.cols.get(target.colName)?.get(d.id)?.version || 0);
              }
            }
            return snap;
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

      if (this.beforeCommitHook) {
        await this.beforeCommitHook(pendingOps);
      }

      let conflict = false;
      for (const [colName, expectedColVer] of readColVersions.entries()) {
        if ((this.colVersions.get(colName) || 1) !== expectedColVer) {
          conflict = true;
          break;
        }
      }
      if (!conflict) {
        for (const [key, expectedDocVer] of readDocVersions.entries()) {
          const [colName, docId] = key.split('/');
          if ((this.cols.get(colName)?.get(docId)?.version || 0) !== expectedDocVer) {
            conflict = true;
            break;
          }
        }
      }

      if (conflict) {
        this.transactionConflictRetries++;
        await Promise.resolve();
        continue;
      }

      for (const op of pendingOps) {
        const targetPath = `${op.ref.colName}/${op.ref.id}`;
        if (this.failWriteOnceOnPath && this.failWriteOnceOnPath === targetPath) {
          this.failWriteOnceOnPath = null;
          throw new Error(`SIMULATED_TX_WRITE_FAILURE on ${targetPath}`);
        }
      }

      for (const op of pendingOps) {
        const col = this.ensureCol(op.ref.colName);
        const existing = col.get(op.ref.id);
        if (op.type === 'set') {
          const nextData = op.merge && existing ? { ...deepClone(existing.data), ...op.data } : op.data;
          col.set(op.ref.id, { data: nextData, version: (existing?.version || 0) + 1 });
        } else if (op.type === 'update') {
          if (!existing) throw new Error(`NOT_FOUND: ${op.ref.colName}/${op.ref.id}`);
          col.set(op.ref.id, { data: { ...deepClone(existing.data), ...op.data }, version: existing.version + 1 });
        } else if (op.type === 'delete') {
          col.delete(op.ref.id);
        }
        this.colVersions.set(op.ref.colName, (this.colVersions.get(op.ref.colName) || 1) + 1);
      }

      return result;
    }
    throw new Error('TRANSACTION_ABORTED: contention');
  }
}

async function runTests() {
  const { default: app, __setTestFirebaseAdminServices } = await import('../server.ts');
  const { store } = await import('../src/services/store.ts');
  const { INITIAL_MENU, INITIAL_CONFIG } = await import('../src/data/initialData.ts');

  const simDb = new TransactionalFirestoreSimulator();
  const tokenUserMap: Record<string, { uid: string; email: string; role: string; name: string }> = {
    'token-admin': { uid: 'u-admin', email: 'admin@amandita.com', role: 'ADMINISTRADOR', name: 'Admin Principal' },
    'token-gerente': { uid: 'u-gerente', email: 'gerente@amandita.com', role: 'GERENTE', name: 'Gerente Loja' },
    'token-caixa': { uid: 'u-caixa', email: 'caixa@amandita.com', role: 'CAIXA', name: 'Operador Caixa' },
    'token-atendente': { uid: 'u-atendente', email: 'atendente@amandita.com', role: 'ATENDENTE', name: 'Atendente Balcão' },
  };

  const mockAdminAuth = {
    async verifyIdToken(token: string) {
      const user = tokenUserMap[token];
      if (!user) throw new Error('INVALID_TOKEN');
      return { uid: user.uid, email: user.email, role: user.role };
    },
  };

  const applyAdminMode = (enabled: boolean) => {
    __setTestFirebaseAdminServices(
      enabled
        ? { adminDb: simDb as any, adminAuth: mockAdminAuth as any }
        : { adminDb: null, adminAuth: null }
    );
  };

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let currentClientToken: string | null = null;
  let simulateNetworkError = false;

  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const targetUrl = urlStr.startsWith('/') ? `${baseUrl}${urlStr}` : urlStr;
    if (simulateNetworkError && targetUrl.includes('/api/store/availability')) {
      throw new Error('ECONNREFUSED simulated network failure');
    }
    const headers = new Headers(init?.headers || {});
    if (urlStr.startsWith('/') && currentClientToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${currentClientToken}`);
    }
    return originalFetch(targetUrl, { ...init, headers });
  };

  const seedUsers = () => {
    for (const u of Object.values(tokenUserMap)) {
      simDb.seedDoc('users', u.uid, {
        id: u.uid,
        name: u.name,
        email: u.email,
        role: u.role,
        status: 'ATIVO',
      });
    }
  };

  const seedBaseCatalogAndConfig = (isOpen = false) => {
    for (const item of INITIAL_MENU) {
      simDb.seedDoc('menu_items', item.id, {
        id: item.id,
        name: item.name,
        price: item.price,
        category: item.category,
        available: true,
        addons: item.addons || [],
      });
    }
    simDb.seedDoc('configs', 'restaurant', {
      name: INITIAL_CONFIG.name,
      phone: INITIAL_CONFIG.phone,
      whatsapp: INITIAL_CONFIG.whatsapp,
      address: INITIAL_CONFIG.address,
      city: INITIAL_CONFIG.city,
      pixKey: INITIAL_CONFIG.pixKey,
      pixKeyType: INITIAL_CONFIG.pixKeyType,
      pixReceiverName: INITIAL_CONFIG.pixReceiverName,
      pixReceiverCity: INITIAL_CONFIG.pixReceiverCity,
      deliveryFeeBase: INITIAL_CONFIG.deliveryFeeBase,
      avgPrepTimeMinutes: INITIAL_CONFIG.avgPrepTimeMinutes,
      avgDeliveryTimeMinutes: INITIAL_CONFIG.avgDeliveryTimeMinutes,
      isOpen,
      updatedAt: new Date().toISOString(),
    });
  };

  const setClientStaffRole = (role: keyof typeof tokenUserMap | null) => {
    if (!role) {
      currentClientToken = null;
      localStorage.removeItem('gf_current_user');
      (window as any).location.search = '?mode=menu';
      return;
    }
    const u = tokenUserMap[role];
    currentClientToken = role;
    localStorage.setItem(
      'gf_current_user',
      JSON.stringify({
        id: u.uid,
        name: u.name,
        username: u.role.toLowerCase(),
        email: u.email,
        role: u.role,
        status: 'ATIVO',
        isEmailVerified: true,
        allowedModules: ['pdv', 'kanban', 'caixa', 'config', 'menu'],
        createdAt: new Date().toISOString(),
      })
    );
    (window as any).location.search = '';
  };

  const resetAll = () => {
    applyAdminMode(true);
    simulateNetworkError = false;
    simDb.clearAll();
    storageMap.clear();
    dispatchedEvents.length = 0;
    seedUsers();
    seedBaseCatalogAndConfig(false);
    localStorage.setItem('gf_orders', JSON.stringify([]));
    localStorage.setItem('gf_restaurant_config', JSON.stringify(INITIAL_CONFIG));
    store.setServerAtomicPaymentMode(true);
    setClientStaffRole(null);
  };

  let passed = 0;
  const runScenario = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  };

  try {
    console.log('\n=== TESTES: PÁGINA AUTOMÁTICA DE ESTABELECIMENTO FECHADO ===\n');

    await runScenario('1. Caixa fechado -> disponibilidade retorna isOpen: false, verified: true, reason: CASH_CLOSED, sem PII/saldos', async () => {
      resetAll();
      const res = await fetch(`${baseUrl}/api/store/availability`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.verified, true);
      assert.strictEqual(data.isOpen, false);
      assert.strictEqual(data.reason, 'CASH_CLOSED');
      assert.strictEqual(data.activeShiftId, null);
      assert.strictEqual(data.restaurantPublicInfo.name, 'Amandita Sabores');
      assert.strictEqual(data.closedSettings.closedPrimaryMessage, DEFAULT_CLOSED_PRIMARY_MESSAGE);
      assert.strictEqual(Array.isArray(data.closedSettings.operatingHours), true);
      assert.strictEqual(data.closedSettings.operatingHours.length, 7);

      // Nenhum dado interno de caixa/movimentação/usuários/pedidos exposto
      const rawJson = JSON.stringify(data);
      assert(!rawJson.includes('openingBalance'), 'Não pode expor saldo de abertura');
      assert(!rawJson.includes('movements'), 'Não pode expor movimentações');
      assert(!rawJson.includes('pixKey'), 'Disponibilidade pública não precisa expor chave PIX');

      const clientAvail = await store.fetchPublicStoreAvailability();
      assert.strictEqual(clientAvail.verified, true);
      assert.strictEqual(clientAvail.isOpen, false);
    });

    await runScenario('2. Abertura de caixa -> disponibilidade vira isOpen: true e pedido público é aceito', async () => {
      resetAll();
      setClientStaffRole('token-caixa');
      const openRes = await store.openCashRegisterAsync(150, 'Operador Caixa');
      assert.strictEqual(openRes.success, true);
      assert.strictEqual(openRes.shift?.status, 'ABERTO');
      assert.strictEqual(simDb.getRawDoc('configs', 'restaurant')?.isOpen, true, 'configs/restaurant.isOpen deve refletir caixa aberto');

      setClientStaffRole(null);
      const avail = await store.fetchPublicStoreAvailability();
      assert.strictEqual(avail.verified, true);
      assert.strictEqual(avail.isOpen, true);
      assert.strictEqual(avail.reason, 'CASH_OPEN');

      const orderRes = await store.createOrderAsync(
        {
          id: 'ord-open-02',
          orderNumber: '#4002',
          trackingCode: 'tk_open_02_abcdefghijklmnopqrstuvwxyz',
          estimatedDeliveryMinutes: 40,
          fulfillmentType: 'DELIVERY',
          customer: { name: 'Maria Silva', phone: '83999990000' },
          items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz com ovos', quantity: 1, unitPrice: 8.0, subtotal: 8.0 }],
          subtotal: 8.0,
          deliveryFee: 5.0,
          discount: 0,
          totalAmount: 13.0,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
          status: 'NOVO',
        },
        { requireServerConfirmation: true, publicMenuOrder: true }
      );
      assert.strictEqual(orderRes.synced, true);
      assert.ok(simDb.getRawDoc('orders', 'ord-open-02'));
    });

    await runScenario('3. Fechamento do caixa atualiza disponibilidade em tempo real sem exigir recarregar navegador', async () => {
      resetAll();
      setClientStaffRole('token-caixa');
      const openRes = await store.openCashRegisterAsync(100, 'Operador Caixa');
      assert.strictEqual(openRes.success, true);
      assert.strictEqual((await store.fetchPublicStoreAvailability()).isOpen, true);

      const closeRes = await store.closeCashRegisterAsync(100, 'Operador Caixa', 'Fim de expediente');
      assert.strictEqual(closeRes.success, true);
      assert.strictEqual(closeRes.shift?.status, 'FECHADO');
      assert.strictEqual(simDb.getRawDoc('configs', 'restaurant')?.isOpen, false);

      setClientStaffRole(null);
      const availAfterClose = await store.fetchPublicStoreAvailability();
      assert.strictEqual(availAfterClose.verified, true);
      assert.strictEqual(availAfterClose.isOpen, false);
      assert.strictEqual(availAfterClose.reason, 'CASH_CLOSED');

      const updatedEvent = dispatchedEvents.filter((e) => e.detail && (e.detail as any).type === 'STORE_AVAILABILITY_UPDATED').pop();
      assert.ok(updatedEvent, 'Deve emitir evento STORE_AVAILABILITY_UPDATED para transição automática da página aberta');

      const customerMenuSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/menu/CustomerMenu.tsx'), 'utf8');
      assert(customerMenuSrc.includes('STORE_AVAILABILITY_UPDATED'), 'CustomerMenu deve reagir a STORE_AVAILABILITY_UPDATED');
      assert(customerMenuSrc.includes('CONFIG_UPDATED'), 'CustomerMenu deve reagir a CONFIG_UPDATED em tempo real');
      assert(customerMenuSrc.includes('visibilitychange'), 'CustomerMenu deve revalidar ao voltar o foco/aba');
      assert(customerMenuSrc.includes('setInterval'), 'CustomerMenu deve manter polling periódico para clientes já abertos');
    });

    await runScenario('4. Reabertura do caixa restaura cardápio na mesma URL sem alterar link ou QR Code', async () => {
      resetAll();
      setClientStaffRole('token-caixa');
      await store.openCashRegisterAsync(100, 'Caixa');
      await store.closeCashRegisterAsync(100, 'Caixa');
      assert.strictEqual((await store.fetchPublicStoreAvailability()).isOpen, false);

      const reopen = await store.openCashRegisterAsync(200, 'Caixa Turno 2');
      assert.strictEqual(reopen.success, true);
      assert.strictEqual(simDb.getRawDoc('configs', 'restaurant')?.isOpen, true);

      setClientStaffRole(null);
      const availReopened = await store.fetchPublicStoreAvailability();
      assert.strictEqual(availReopened.verified, true);
      assert.strictEqual(availReopened.isOpen, true);
      assert.strictEqual(availReopened.activeShiftId, reopen.shift?.id);
    });

    await runScenario('5. Estado desatualizado em localStorage não engana o cardápio nem permite envio quando caixa está fechado', async () => {
      resetAll();
      // Adultera localStorage local simulando navegador com cache antigo aberto
      localStorage.setItem('gf_restaurant_config', JSON.stringify({ ...INITIAL_CONFIG, isOpen: true }));
      localStorage.setItem(
        'gf_current_cash_shift',
        JSON.stringify({ id: 'fake-stale-shift', status: 'ABERTO', openedAt: new Date().toISOString(), openingBalance: 50, openedBy: 'Antigo', movements: [] })
      );

      setClientStaffRole(null);
      const avail = await store.fetchPublicStoreAvailability();
      assert.strictEqual(avail.verified, true);
      assert.strictEqual(avail.isOpen, false);

      const persistedCfg = JSON.parse(localStorage.getItem('gf_restaurant_config') || '{}');
      assert.strictEqual(persistedCfg.isOpen, false, 'fetchPublicStoreAvailability deve sobrescrever cache local desatualizado');

      const blockedOrder = await store.createOrderAsync(
        {
          id: 'ord-stale-05',
          orderNumber: '#4005',
          trackingCode: 'tk_stale_05_abcdefghijklmnopqrstuvwxyz',
          estimatedDeliveryMinutes: 40,
          fulfillmentType: 'DELIVERY',
          customer: { name: 'Cliente Cache Antigo', phone: '83988881111' },
          items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz com ovos', quantity: 1, unitPrice: 8.0, subtotal: 8.0 }],
          subtotal: 8.0,
          deliveryFee: 5.0,
          discount: 0,
          totalAmount: 13.0,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
          status: 'NOVO',
        },
        { requireServerConfirmation: true, publicMenuOrder: true }
      );
      assert.strictEqual(blockedOrder.synced, false);
      assert.strictEqual(blockedOrder.isStoreClosed, true);
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-stale-05'), undefined);
    });

    await runScenario('6. Bloqueio direto na API POST /api/orders (anônimo e token com source=PUBLIC_MENU) quando caixa fechado', async () => {
      resetAll();
      const orderPayload = {
        id: 'ord-direct-bypass-06',
        orderNumber: '#4006',
        trackingCode: 'tk_bypass_06_abcdefghijklmnopqrstuvwxyz',
        fulfillmentType: 'DELIVERY',
        customer: { name: 'Bypass Direto', phone: '83999998888' },
        items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz com ovos', quantity: 1, unitPrice: 8.0, subtotal: 8.0 }],
        subtotal: 8.0,
        deliveryFee: 5.0,
        discount: 0,
        totalAmount: 13.0,
        paymentMethod: 'PIX',
        paymentStatus: 'PENDENTE',
        status: 'NOVO',
      };

      // 6a. POST anônimo direto no endpoint
      const anonRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: orderPayload }),
      });
      assert.strictEqual(anonRes.status, 403);
      const anonBody = await anonRes.json();
      assert.strictEqual(anonBody.isStoreClosed, true);
      assert.strictEqual(anonBody.code, 'STORE_CLOSED');

      // 6b. Até com token válido, se marcado source: PUBLIC_MENU deve ser bloqueado com caixa fechado
      const publicSourceRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-admin' },
        body: JSON.stringify({ order: orderPayload, source: 'PUBLIC_MENU' }),
      });
      assert.strictEqual(publicSourceRes.status, 403);
      assert.strictEqual((await publicSourceRes.json()).isStoreClosed, true);

      assert.strictEqual(simDb.getAllDocs('orders').length, 0);
      assert.strictEqual(simDb.getAllDocs('public_tracking').length, 0);
    });

    await runScenario('7. Configuração admin (horários, WhatsApp e mensagens), RBAC e garantia de NÃO mexer no caixa', async () => {
      resetAll();

      // 7a. Validação rejeita WhatsApp inválido e horário inválido
      setClientStaffRole('token-admin');
      const badWa = await store.updateRestaurantConfigAsync({ ...INITIAL_CONFIG, whatsapp: '123' });
      assert.strictEqual(badWa.success, false);

      const badHours = DEFAULT_OPERATING_HOURS.map((d) =>
        d.dayKey === 'seg' ? { ...d, isOpen: true, openTime: '18:00', closeTime: '10:00' } : d
      );
      const badHoursRes = await store.updateRestaurantConfigAsync({ ...INITIAL_CONFIG, operatingHours: badHours });
      assert.strictEqual(badHoursRes.success, false);

      const emptyMsgRes = await store.updateRestaurantConfigAsync({ ...INITIAL_CONFIG, closedPrimaryMessage: '   ' });
      assert.strictEqual(emptyMsgRes.success, false);

      // 7b. RBAC: CAIXA e ATENDENTE recebem 403 em /api/store/schedule
      for (const lowRole of ['token-caixa', 'token-atendente'] as const) {
        const denyRes = await fetch(`${baseUrl}/api/store/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lowRole}` },
          body: JSON.stringify({
            operatingHours: DEFAULT_OPERATING_HOURS,
            closedPrimaryMessage: 'Tentativa sem permissão',
          }),
        });
        assert.strictEqual(denyRes.status, 403);
      }

      // 7c. GERENTE consegue salvar horários (todos os dias marcados como aberto ou fechado NÃO abre/fecha caixa!)
      setClientStaffRole('token-gerente');
      const customHours = DEFAULT_OPERATING_HOURS.map((d) =>
        d.dayKey === 'dom'
          ? { ...d, isOpen: true, openTime: '08:00', closeTime: '12:30' }
          : { ...d, isOpen: false }
      );
      const saveRes = await store.updateRestaurantConfigAsync({
        ...INITIAL_CONFIG,
        whatsapp: '5583998765432',
        operatingHours: customHours,
        closedPrimaryMessage: 'Voltamos amanhã às 07h30!',
        closedSecondaryMessage: 'Estamos preparando delícias fresquinhas para o próximo turno.',
      });
      assert.strictEqual(saveRes.success, true);

      // Caixa deve permanecer estritamente intocado (0 turnos) mesmo com todos os dias configurados
      assert.strictEqual(simDb.getAllDocs('cash_shifts').length, 0, 'Horário informativo nunca pode criar/abrir turno de caixa');

      // Cardápio fechado reflete imediatamente novos horários, WhatsApp e mensagens
      setClientStaffRole(null);
      const avail = await store.fetchPublicStoreAvailability();
      assert.strictEqual(avail.isOpen, false);
      assert.strictEqual(avail.closedSettings.closedPrimaryMessage, 'Voltamos amanhã às 07h30!');
      assert.strictEqual(avail.closedSettings.closedSecondaryMessage, 'Estamos preparando delícias fresquinhas para o próximo turno.');
      assert.strictEqual(avail.restaurantPublicInfo.whatsapp, '5583998765432');
      const domEntry = avail.closedSettings.operatingHours.find((d) => d.dayKey === 'dom');
      assert.strictEqual(domEntry?.isOpen, true);
      assert.strictEqual(domEntry?.openTime, '08:00');
      assert.strictEqual(domEntry?.closeTime, '12:30');
    });

    await runScenario('8. Verificação de conteúdo e isolamento da StoreClosedView & CustomerMenu', async () => {
      const closedViewSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/menu/StoreClosedView.tsx'), 'utf8');
      const customerMenuSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/menu/CustomerMenu.tsx'), 'utf8');
      const storeSettingsSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/admin/StoreSettings.tsx'), 'utf8');

      // StoreClosedView contém todos os 8 elementos obrigatórios
      assert(closedViewSrc.includes('<AmanditaLogo variant="full" size="lg" theme="light"'), 'Logo original obrigatória');
      assert(closedViewSrc.includes('storeName'), 'Nome do estabelecimento presente');
      assert(closedViewSrc.includes('primaryMessage'), 'Mensagem principal destacada');
      assert(closedViewSrc.includes('secondaryMessage'), 'Mensagem complementar presente');
      assert(closedViewSrc.includes('Horários de Funcionamento'), 'Horários semanais presentes');
      assert(closedViewSrc.includes('formatWhatsAppDisplay'), 'WhatsApp formatado presente');
      assert(closedViewSrc.includes('buildWhatsAppUrl'), 'Link direto WhatsApp presente');
      assert(closedViewSrc.includes('Agradecemos pela preferência'), 'Mensagem final de agradecimento presente');
      assert(!closedViewSrc.includes('ShoppingBag') && !closedViewSrc.includes('filteredItems'), 'StoreClosedView não pode renderizar carrinho nem produtos');

      // Formatação helper validada
      assert.strictEqual(formatWhatsAppDisplay('5583998765432'), '+55 (83) 99876-5432');
      assert.strictEqual(buildWhatsAppUrl('5583998765432').startsWith('https://wa.me/5583998765432'), true);
      assert.strictEqual(validateWhatsAppNumber('5583998765432').valid, true);
      assert.strictEqual(validateOperatingHours(DEFAULT_OPERATING_HOURS).valid, true);

      // CustomerMenu nunca usa setDoc direto, renderiza StoreClosedView quando !isStoreOpenAuthoritative, e exige publicMenuOrder
      assert(!customerMenuSrc.includes('setDoc('), 'CustomerMenu não pode gravar via Client SDK setDoc');
      assert(customerMenuSrc.includes('!isStoreOpenAuthoritative ? ('), 'CustomerMenu renderiza StoreClosedView quando fechado');
      assert(customerMenuSrc.includes('publicMenuOrder: true'), 'CustomerMenu marca pedidos com publicMenuOrder: true');
      assert(customerMenuSrc.includes('syncRes.isStoreClosed'), 'CustomerMenu trata rejeição por fechamento em andamento');

      // StoreSettings possui seção de horários e mensagens sem alterar layout geral
      assert(storeSettingsSrc.includes('Horários de Funcionamento'), 'StoreSettings exibe seção de horários');
      assert(storeSettingsSrc.includes('closedPrimaryMessage'), 'StoreSettings permite editar mensagem principal');
      assert(storeSettingsSrc.includes('validateWhatsAppNumber'), 'StoreSettings valida WhatsApp antes de salvar');
    });

    await runScenario('9. Pedidos realizados antes do fechamento permanecem intactos após fechar e reabrir caixa', async () => {
      resetAll();
      setClientStaffRole('token-caixa');
      await store.openCashRegisterAsync(100, 'Caixa');

      setClientStaffRole(null);
      const orderRes = await store.createOrderAsync(
        {
          id: 'ord-preserved-09',
          orderNumber: '#4009',
          trackingCode: 'tk_preserved_09_abcdefghijklmnopqrstu',
          estimatedDeliveryMinutes: 35,
          fulfillmentType: 'DELIVERY',
          customer: { name: 'João Antes Fechar', phone: '83987650000' },
          items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz com ovos', quantity: 2, unitPrice: 8.0, subtotal: 16.0 }],
          subtotal: 16.0,
          deliveryFee: 5.0,
          discount: 0,
          totalAmount: 21.0,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
          status: 'NOVO',
        },
        { requireServerConfirmation: true, publicMenuOrder: true }
      );
      assert.strictEqual(orderRes.synced, true);

      setClientStaffRole('token-caixa');
      const closeRes = await store.closeCashRegisterAsync(100, 'Caixa');
      assert.strictEqual(closeRes.success, true);

      const savedOrder = simDb.getRawDoc('orders', 'ord-preserved-09');
      assert.ok(savedOrder, 'Pedido anterior deve permanecer no Firestore');
      assert.strictEqual(savedOrder?.status, 'NOVO');
      assert.strictEqual(savedOrder?.totalAmount, 21.0);
      assert.ok(simDb.getRawDoc('public_tracking', 'tk_preserved_09_abcdefghijklmnopqrstu'));
    });

    await runScenario('10. Pedidos internos pelo PDV/equipe continuam aceitos mesmo quando cardápio público está fechado', async () => {
      resetAll();
      // Caixa fechado para público!
      const pdvOrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-atendente' },
        body: JSON.stringify({
          order: {
            id: 'ord-pdv-10',
            orderNumber: '#4010',
            trackingCode: 'tk_pdv_10_abcdefghijklmnopqrstuvwxyz',
            fulfillmentType: 'RETIRADA',
            customer: { name: 'Balcão Interno', phone: '83999990000' },
            items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz com ovos', quantity: 1, unitPrice: 8.0, subtotal: 8.0 }],
            subtotal: 8.0,
            deliveryFee: 0,
            discount: 0,
            totalAmount: 8.0,
            paymentMethod: 'DINHEIRO',
            paymentStatus: 'PENDENTE',
            status: 'NOVO',
          },
        }),
      });
      assert.strictEqual(pdvOrderRes.status, 200);
      const pdvData = await pdvOrderRes.json();
      assert.strictEqual(pdvData.success, true);
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-pdv-10')?.id, 'ord-pdv-10');
    });

    await runScenario('11. Fail-closed em falha de rede, !adminDb (503/unverified) e múltiplos turnos abertos inconsistentes', async () => {
      resetAll();

      // 11a. Múltiplos turnos abertos -> servidor verifica estado inconsistente e bloqueia cardápio (fail-closed)
      simDb.seedDoc('cash_shifts', 'shift-dup-1', { id: 'shift-dup-1', status: 'ABERTO', openedAt: new Date().toISOString(), openingBalance: 50, openedBy: 'A', movements: [] });
      simDb.seedDoc('cash_shifts', 'shift-dup-2', { id: 'shift-dup-2', status: 'ABERTO', openedAt: new Date().toISOString(), openingBalance: 50, openedBy: 'B', movements: [] });
      const dupAvail = await store.fetchPublicStoreAvailability();
      assert.strictEqual(dupAvail.isOpen, false);
      assert.strictEqual(dupAvail.verified, true);
      assert.strictEqual(dupAvail.reason, 'MULTIPLE_OPEN_SHIFTS');

      // 11b. Ausência de Admin SDK (!adminDb) -> disponibilidade fail-closed e /api/orders público bloqueado (403)
      applyAdminMode(false);
      const noAdminAvail = await store.fetchPublicStoreAvailability();
      assert.strictEqual(noAdminAvail.isOpen, false);
      assert.strictEqual(noAdminAvail.verified, false);

      const noAdminOrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order: {
            id: 'ord-failclosed-11',
            orderNumber: '#4011',
            trackingCode: 'tk_failclosed_11_abcdefghijklmnopqrstu',
            fulfillmentType: 'RETIRADA',
            customer: { name: 'Cliente Falha', phone: '83999990000' },
            items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz com ovos', quantity: 1, unitPrice: 8.0, subtotal: 8.0 }],
            subtotal: 8.0,
            deliveryFee: 0,
            discount: 0,
            totalAmount: 8.0,
            paymentMethod: 'PIX',
            paymentStatus: 'PENDENTE',
            status: 'NOVO',
          },
          source: 'PUBLIC_MENU',
        }),
      });
      assert.strictEqual(noAdminOrderRes.status, 403);
      assert.strictEqual((await noAdminOrderRes.json()).isStoreClosed, true);

      // 11c. Erro de rede no cliente ao consultar /api/store/availability -> fail-closed
      applyAdminMode(true);
      simDb.clearAll();
      seedUsers();
      seedBaseCatalogAndConfig(true);
      simulateNetworkError = true;
      const netFailAvail = await store.fetchPublicStoreAvailability();
      simulateNetworkError = false;
      assert.strictEqual(netFailAvail.verified, false);
      assert.strictEqual(netFailAvail.isOpen, false);
    });

    await runScenario('12. Dispositivo novo carrega configs/store_schedule e configs/restaurant da nuvem e protege contra sobrescrita em erro', async () => {
      resetAll();
      simDb.yieldInsideTransaction = false;
      simDb.failWriteOnceOnPath = null;

      // Outro dispositivo já salvou horários personalizados, WhatsApp e mensagens no Firestore
      const customHours = DEFAULT_OPERATING_HOURS.map((d) =>
        d.dayKey === 'sex' ? { ...d, isOpen: true, openTime: '14:00', closeTime: '22:00' } : { ...d, isOpen: false }
      );
      simDb.seedDoc('configs', 'restaurant', {
        ...INITIAL_CONFIG,
        whatsapp: '5583991112233',
        deliveryFeeBase: 7.5,
        isOpen: false,
        updatedAt: new Date().toISOString(),
      });
      simDb.seedDoc('configs', 'store_schedule', {
        operatingHours: customHours,
        closedPrimaryMessage: 'Mensagem persistida na nuvem!',
        closedSecondaryMessage: 'Detalhes persistidos em outro navegador.',
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin@amandita.com',
      });

      // Dispositivo/navegador completamente limpo (localStorage sem gf_restaurant_config)
      storageMap.delete('gf_restaurant_config');
      setClientStaffRole('token-gerente');

      const loadRes = await store.loadStoreSettingsFromCloud();
      assert.strictEqual(loadRes.success, true, 'Deve carregar configurações da nuvem com sucesso');
      assert.strictEqual(loadRes.hasScheduleDoc, true);
      assert.strictEqual(loadRes.hasRestaurantDoc, true);
      assert.strictEqual(loadRes.config?.whatsapp, '5583991112233');
      assert.strictEqual(loadRes.config?.deliveryFeeBase, 7.5);
      assert.strictEqual(loadRes.config?.closedPrimaryMessage, 'Mensagem persistida na nuvem!');
      assert.strictEqual(loadRes.config?.closedSecondaryMessage, 'Detalhes persistidos em outro navegador.');
      const sexDay = loadRes.config?.operatingHours?.find((d) => d.dayKey === 'sex');
      assert.strictEqual(sexDay?.isOpen, true);
      assert.strictEqual(sexDay?.openTime, '14:00');
      assert.strictEqual(sexDay?.closeTime, '22:00');

      // Ao editar apenas taxa de entrega após carregamento, horários/mensagens não são sobrescritos por defaults
      const updateFeeRes = await store.updateRestaurantConfigAsync({
        ...loadRes.config!,
        deliveryFeeBase: 9.0,
      });
      assert.strictEqual(updateFeeRes.success, true);
      assert.strictEqual(
        simDb.getRawDoc('configs', 'store_schedule')?.closedPrimaryMessage,
        'Mensagem persistida na nuvem!'
      );
      assert.strictEqual(simDb.getRawDoc('configs', 'restaurant')?.deliveryFeeBase, 9.0);
      assert.strictEqual(simDb.getRawDoc('configs', 'restaurant')?.whatsapp, '5583991112233');

      // RBAC GET /api/store/schedule bloqueia CAIXA/ATENDENTE
      const lowRoleGet = await fetch(`${baseUrl}/api/store/schedule`, {
        method: 'GET',
        headers: { Authorization: 'Bearer token-caixa' },
      });
      assert.strictEqual(lowRoleGet.status, 403);

      // Falha de leitura na nuvem (!adminDb) NÃO retorna sucesso falso nem sobrescreve os dados reais no Firestore
      applyAdminMode(false);
      const failLoadRes = await store.loadStoreSettingsFromCloud();
      assert.strictEqual(failLoadRes.success, false);
      applyAdminMode(true);
      assert.strictEqual(
        simDb.getRawDoc('configs', 'store_schedule')?.closedPrimaryMessage,
        'Mensagem persistida na nuvem!'
      );

      // Verifica proteções explícitas na UI do StoreSettings.tsx
      const storeSettingsSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/admin/StoreSettings.tsx'), 'utf8');
      assert(storeSettingsSrc.includes('isLoadingCloudConfig'), 'StoreSettings deve controlar estado isLoadingCloudConfig');
      assert(storeSettingsSrc.includes('cloudLoadError'), 'StoreSettings deve exibir erro explícito cloudLoadError');
      assert(storeSettingsSrc.includes('loadCloudSettings'), 'StoreSettings deve permitir recarregar configurações');
      assert(storeSettingsSrc.includes('hasUnsavedChangesRef'), 'StoreSettings não deve sobrescrever edições não salvas');
      assert(
        storeSettingsSrc.includes('disabled={isSaving || isLoadingCloudConfig || Boolean(cloudLoadError)}'),
        'Botão salvar deve ficar bloqueado enquanto carrega ou há erro de leitura'
      );
    });

    await runScenario('13. POST /api/store/schedule exige persistência real no Firestore, sem cache em disco e com rollback atômico', async () => {
      resetAll();
      const cachePath = path.join(process.cwd(), '.store_schedule_cache.json');
      if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);

      setClientStaffRole('token-admin');

      // 13a. Sem adminDb e sem token REST válido -> erro explícito 503, persistedToFirestore: false (nunca 200)
      applyAdminMode(false);
      const failSaveHttp = await fetch(`${baseUrl}/api/store/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-admin' },
        body: JSON.stringify({
          operatingHours: DEFAULT_OPERATING_HOURS,
          closedPrimaryMessage: 'Teste sem adminDb',
          whatsapp: '5583999998888',
        }),
      });
      // verifyStaffAuth sem adminAuth/adminDb também falha fechado em 403 ou 503 — nunca 200
      assert.strictEqual(failSaveHttp.ok, false);
      const failSaveBody = await failSaveHttp.json();
      assert.strictEqual(failSaveBody.success, false);
      assert.strictEqual(failSaveBody.persistedToFirestore, false);

      const failStoreSave = await store.updateRestaurantConfigAsync({
        ...INITIAL_CONFIG,
        whatsapp: '5583999998888',
        closedPrimaryMessage: 'Não pode dar falso positivo',
      });
      assert.strictEqual(failStoreSave.success, false);
      assert.strictEqual(failStoreSave.synced, false);

      // Nunca cria arquivo .store_schedule_cache.json
      assert.strictEqual(fs.existsSync(cachePath), false, '.store_schedule_cache.json não pode ser criado ou usado');

      // 13b. Falha atômica dentro de runTransaction (configs/store_schedule falha após preparar escrita em configs/restaurant)
      applyAdminMode(true);
      simDb.seedDoc('configs', 'restaurant', {
        ...INITIAL_CONFIG,
        name: 'Amandita Sabores',
        whatsapp: '5583999990001',
        deliveryFeeBase: 5.0,
        isOpen: false,
      });
      simDb.seedDoc('configs', 'store_schedule', {
        operatingHours: DEFAULT_OPERATING_HOURS,
        closedPrimaryMessage: 'Original Preserved',
        closedSecondaryMessage: 'Original Sec',
        updatedAt: new Date().toISOString(),
        updatedBy: 'admin@amandita.com',
      });

      simDb.failWriteOnceOnPath = 'configs/store_schedule';
      const atomicFailRes = await store.updateRestaurantConfigAsync({
        ...INITIAL_CONFIG,
        name: 'Nome Alterado Parcialmente',
        whatsapp: '5583999997777',
        deliveryFeeBase: 19.0,
        operatingHours: DEFAULT_OPERATING_HOURS,
        closedPrimaryMessage: 'Nova Mensagem Que Falhou',
      });
      assert.strictEqual(atomicFailRes.success, false);
      assert.strictEqual(atomicFailRes.synced, false);

      // Rollback completo: nem configs/restaurant nem configs/store_schedule foram parcialmente gravados
      assert.strictEqual(simDb.getRawDoc('configs', 'restaurant')?.name, 'Amandita Sabores');
      assert.strictEqual(simDb.getRawDoc('configs', 'restaurant')?.deliveryFeeBase, 5.0);
      assert.strictEqual(simDb.getRawDoc('configs', 'store_schedule')?.closedPrimaryMessage, 'Original Preserved');

      // 13c. Salvar configurações NÃO altera o estado autoritativo isOpen do caixa (mantém true se aberto, false se fechado)
      setClientStaffRole('token-caixa');
      await store.openCashRegisterAsync(100, 'Operador Caixa');
      setClientStaffRole('token-admin');
      const saveWhileOpen = await store.updateRestaurantConfigAsync({
        ...INITIAL_CONFIG,
        whatsapp: '5583999991234',
        isOpen: false, // mesmo se cliente mandar isOpen: false, transação consulta cash_shifts ABERTO
      });
      assert.strictEqual(saveWhileOpen.success, true);
      assert.strictEqual(simDb.getRawDoc('configs', 'restaurant')?.isOpen, true, 'isOpen deve seguir o turno de caixa aberto');
      assert.strictEqual(fs.existsSync(cachePath), false, '.store_schedule_cache.json nunca deve existir após GET/POST');
    });

    await runScenario('14. Corrida concorrente TOCTOU (POST /api/orders vs fechamento de caixa) e retry idempotente após timeout', async () => {
      resetAll();

      // Caso A: fechamento do caixa vence a corrida contra POST /api/orders concorrente
      setClientStaffRole('token-caixa');
      const openRes = await store.openCashRegisterAsync(150, 'Operador Caixa');
      assert.strictEqual(openRes.success, true);
      const shiftId = openRes.shift!.id;

      simDb.transactionConflictRetries = 0;
      simDb.yieldInsideTransaction = true;

      const racingOrder = {
        id: 'ord-toctou-race-14',
        orderNumber: '#4014',
        trackingCode: 'tk_toctou_14_abcdefghijklmnopqrstuvwxyz',
        estimatedDeliveryMinutes: 30,
        fulfillmentType: 'DELIVERY',
        customer: { name: 'Cliente Corrida', phone: '83988887777' },
        items: [{ id: 'i1', menuItemId: 'cuscuz-ovos', name: 'Cuscuz com ovos', quantity: 1, unitPrice: 8.0, subtotal: 8.0 }],
        subtotal: 8.0,
        deliveryFee: 5.0,
        discount: 0,
        totalAmount: 13.0,
        paymentMethod: 'PIX',
        paymentStatus: 'PENDENTE',
        status: 'NOVO',
      };

      // Simula sobreposição exata de TOCTOU:
      // 1) POST /api/orders lê cash_shifts=ABERTO dentro de runTransaction;
      // 2) Antes do commit de orders, fechamento de caixa commita FECHADO;
      // 3) Commit de orders sofre conflito otimista, faz retry automático, enxerga FECHADO e rejeita com 403.
      let closeTriggered = false;
      let closePromise: Promise<Response> | null = null;
      simDb.beforeCommitHook = async (ops) => {
        const writingOrders = ops.some((op) => op.ref?.colName === 'orders');
        if (writingOrders && !closeTriggered) {
          closeTriggered = true;
          closePromise = fetch(`${baseUrl}/api/cash-shifts/${shiftId}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-caixa' },
            body: JSON.stringify({ countedCash: 150, closedBy: 'Operador Caixa', notes: 'Fechamento concorrente' }),
          });
          const closeRes = await closePromise;
          assert.strictEqual(closeRes.status, 200);
        }
      };

      const orderHttpRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: racingOrder, source: 'PUBLIC_MENU' }),
      });
      simDb.beforeCommitHook = null;
      simDb.yieldInsideTransaction = false;

      assert.strictEqual(closeTriggered, true);
      assert.strictEqual(simDb.getRawDoc('cash_shifts', shiftId)?.status, 'FECHADO');
      assert.strictEqual(orderHttpRes.status, 403, 'Quando fechamento commita antes, pedido concorrente deve falhar atomicamente com 403');
      const orderRaceBody = await orderHttpRes.json();
      assert.strictEqual(orderRaceBody.isStoreClosed, true);
      assert.strictEqual(orderRaceBody.code, 'STORE_CLOSED');
      assert.strictEqual(simDb.getRawDoc('orders', 'ord-toctou-race-14'), undefined);
      assert.strictEqual(simDb.getRawDoc('public_tracking', 'tk_toctou_14_abcdefghijklmnopqrstuvwxyz'), undefined);
      assert.ok(simDb.transactionConflictRetries >= 1, 'Simulador deve registrar conflito e retry transacional real');

      // Caso B: pedido já gravado antes do fechamento tem retry idempotente preservado mesmo após o caixa fechar
      setClientStaffRole('token-caixa');
      const open2 = await store.openCashRegisterAsync(100, 'Operador Caixa');
      assert.strictEqual(open2.success, true);

      const committedOrder = {
        ...racingOrder,
        id: 'ord-idemp-retry-14b',
        orderNumber: '#4015',
        trackingCode: 'tk_idemp_14b_abcdefghijklmnopqrstuvwxy',
      };
      const firstSubmit = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: committedOrder, source: 'PUBLIC_MENU' }),
      });
      assert.strictEqual(firstSubmit.status, 200);

      // Fecha caixa em seguida
      await store.closeCashRegisterAsync(100, 'Operador Caixa');

      // Retry idempotente do mesmo pedido (simula recuperação de timeout no cliente) continua confirmando sem duplicar
      const retrySubmit = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: committedOrder, source: 'PUBLIC_MENU' }),
      });
      assert.strictEqual(retrySubmit.status, 200);
      const retryBody = await retrySubmit.json();
      assert.strictEqual(retryBody.success, true);
      assert.strictEqual(retryBody.alreadyExists, true);
      assert.strictEqual(simDb.getAllDocs('orders').filter((o) => o.id === 'ord-idemp-retry-14b').length, 1);

      const confRes = await fetch(
        `${baseUrl}/api/orders/ord-idemp-retry-14b/public-confirmation?trackingCode=tk_idemp_14b_abcdefghijklmnopqrstuvwxy`
      );
      assert.strictEqual(confRes.status, 200);
      assert.strictEqual((await confRes.json()).confirmed, true);
    });

    console.log(`\n🎉 CONCLUÍDO: ${passed}/14 cenários da Página Automática de Estabelecimento Fechado passaram!\n`);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections?.();
    server.close();
    for (const bk of fileBackups) {
      if (bk.existed && bk.content !== null) {
        fs.writeFileSync(bk.filePath, bk.content, 'utf8');
      } else if (!bk.existed && fs.existsSync(bk.filePath)) {
        fs.unlinkSync(bk.filePath);
      }
    }
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Falha nos testes de estabelecimento fechado:', err);
  process.exit(1);
});
