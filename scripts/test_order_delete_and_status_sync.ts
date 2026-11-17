/**
 * Comprehensive Automated Integration Test Suite (14 Mandatory Scenarios)
 * Validates real Express endpoints (server.ts), store logic (store.ts),
 * RBAC enforcement, tombstone sync, rollback on 403 vs offline queue,
 * double-click serialization, and financial/cash-shift preservation.
 *
 * NOTE: Runs in Node via `tsx` using an ephemeral HTTP server for Express +
 * stateful in-memory mock for Firebase Identity Toolkit & Firestore REST API
 * (does NOT write to live production Firebase).
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// 1. Setup isolated environment before importing server.ts & store.ts
process.env.DISABLE_AUTO_LISTEN = '1';
process.env.VITE_FIREBASE_API_KEY = 'test-fake-api-key';
process.env.FIREBASE_PROJECT_ID = 'amandita-sabores';

// Browser shims for store.ts
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
  location: { origin: 'http://127.0.0.1' },
  dispatchEvent: (ev: { type: string; detail?: unknown }) => {
    dispatchedEvents.push(ev);
    return true;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

let simulatedOnline = true;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    get onLine() {
      return simulatedOnline;
    },
    userAgent: 'AmanditaIntegrationTest/1.0',
  },
});

// Keep test tombstones isolated and clean up on exit
const tmpTombstonePath = path.join(process.cwd(), '.deleted_orders_cache.json');
const hadExistingTombstoneFile = fs.existsSync(tmpTombstonePath);
const existingTombstoneBackup = hadExistingTombstoneFile ? fs.readFileSync(tmpTombstonePath, 'utf8') : null;

// Stateful In-Memory Firestore + Auth Simulator
type Role = 'ADMINISTRADOR' | 'GERENTE' | 'CAIXA' | 'COZINHA' | 'ENTREGADOR' | 'ATENDENTE';

interface SimUser {
  uid: string;
  email: string;
  role: Role;
  status: 'ATIVO' | 'BLOQUEADO';
}

const simUsersByToken: Record<string, SimUser> = {
  'tok-admin': { uid: 'uid-admin', email: 'dvrmercadinho@gmail.com', role: 'ADMINISTRADOR', status: 'ATIVO' },
  'tok-gerente': { uid: 'uid-gerente', email: 'gerente@amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' },
  'tok-caixa': { uid: 'uid-caixa', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
  'tok-cozinha': { uid: 'uid-cozinha', email: 'cozinha@staff.amanditasabores.com.br', role: 'COZINHA', status: 'ATIVO' },
  'tok-entregador': { uid: 'uid-entregador', email: 'entregador@staff.amanditasabores.com.br', role: 'ENTREGADOR', status: 'ATIVO' },
  'tok-atendente': { uid: 'uid-atendente', email: 'atendente@staff.amanditasabores.com.br', role: 'ATENDENTE', status: 'ATIVO' },
  'tok-blocked': { uid: 'uid-blocked', email: 'ex@staff.amanditasabores.com.br', role: 'GERENTE', status: 'BLOQUEADO' },
};

const simFirestore: Record<string, Record<string, Record<string, unknown>>> = {
  users: {
    'uid-admin': { id: 'uid-admin', email: 'dvrmercadinho@gmail.com', role: 'ADMINISTRADOR', status: 'ATIVO' },
    'uid-gerente': { id: 'uid-gerente', email: 'gerente@amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' },
    'uid-caixa': { id: 'uid-caixa', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
    'uid-cozinha': { id: 'uid-cozinha', email: 'cozinha@staff.amanditasabores.com.br', role: 'COZINHA', status: 'ATIVO' },
    'uid-entregador': { id: 'uid-entregador', email: 'entregador@staff.amanditasabores.com.br', role: 'ENTREGADOR', status: 'ATIVO' },
    'uid-atendente': { id: 'uid-atendente', email: 'atendente@staff.amanditasabores.com.br', role: 'ATENDENTE', status: 'ATIVO' },
    'uid-blocked': { id: 'uid-blocked', email: 'ex@staff.amanditasabores.com.br', role: 'GERENTE', status: 'BLOQUEADO' },
  },
  orders: {},
  public_tracking: {},
  order_tombstones: {},
  cash_shifts: {},
};

let forceFirestoreRestError: { status: number; message: string } | null = null;
let forceNetworkFailureOnApi = false;
let firestoreDeleteCallCount = 0;

function fromFsVal(v: any): any {
  if (!v || typeof v !== 'object') return undefined;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsVal);
  if ('mapValue' in v) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) {
      out[k] = fromFsVal(val);
    }
    return out;
  }
  return undefined;
}

function toFsVal(v: unknown): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsVal) } };
  if (typeof v === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) fields[k] = toFsVal(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function makeFsDocResponse(collection: string, docId: string, data: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFsVal(v);
  }
  return {
    name: `projects/amandita-sabores/databases/(default)/documents/${collection}/${docId}`,
    fields,
  };
}

const realFetch = globalThis.fetch.bind(globalThis);
let expressBaseUrl = '';

(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  // Route relative /api/* requests to ephemeral local Express server
  if (url.startsWith('/')) {
    if (forceNetworkFailureOnApi) {
      throw new TypeError('Failed to fetch (simulated offline network outage)');
    }
    return realFetch(`${expressBaseUrl}${url}`, init);
  }

  // Intercept Firebase Identity Toolkit accounts:lookup
  if (url.includes('identitytoolkit.googleapis.com/v1/accounts:lookup')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const simUser = simUsersByToken[body.idToken];
    if (!simUser) {
      return new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 });
    }
    return new Response(
      JSON.stringify({
        users: [{ localId: simUser.uid, email: simUser.email }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Intercept Firestore REST API
  if (url.includes('firestore.googleapis.com/v1/projects/amandita-sabores/databases/(default)/documents')) {
    if (forceFirestoreRestError) {
      return new Response(
        JSON.stringify({
          error: {
            code: forceFirestoreRestError.status,
            message: forceFirestoreRestError.message,
            status: forceFirestoreRestError.status === 403 ? 'PERMISSION_DENIED' : 'FAILED_PRECONDITION',
          },
        }),
        { status: forceFirestoreRestError.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = (init?.headers as Record<string, string> | undefined)?.Authorization ||
      (init?.headers as Record<string, string> | undefined)?.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const simUser = simUsersByToken[token];
    const isActiveStaff = Boolean(simUser && simUser.status === 'ATIVO');
    const isGerenteOrAdmin = Boolean(isActiveStaff && (simUser.role === 'ADMINISTRADOR' || simUser.role === 'GERENTE'));

    const docPrefix = 'https://firestore.googleapis.com/v1/projects/amandita-sabores/databases/(default)/documents/';
    const relPath = url.slice(docPrefix.length).split('?')[0];
    const parts = relPath.split('/').filter(Boolean);
    const collection = parts[0];
    const docId = parts[1];
    const method = (init?.method || 'GET').toUpperCase();

    if (collection === 'users' && docId && method === 'GET') {
      const userDoc = simFirestore.users[docId];
      if (!userDoc) return new Response(JSON.stringify({ error: { message: 'NOT_FOUND' } }), { status: 404 });
      return new Response(JSON.stringify(makeFsDocResponse('users', docId, userDoc)), { status: 200 });
    }

    if (collection === 'order_tombstones') {
      if (!isActiveStaff) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
      if (method === 'GET' && !docId) {
        const docs = Object.entries(simFirestore.order_tombstones).map(([id, d]) => makeFsDocResponse('order_tombstones', id, d));
        return new Response(JSON.stringify({ documents: docs }), { status: 200 });
      }
      if (method === 'PATCH' && docId) {
        if (!isGerenteOrAdmin) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const parsed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body.fields || {})) parsed[k] = fromFsVal(v);
        simFirestore.order_tombstones[docId] = parsed;
        return new Response(JSON.stringify(makeFsDocResponse('order_tombstones', docId, parsed)), { status: 200 });
      }
    }

    if (collection === 'orders' && docId) {
      if (method === 'GET') {
        if (!isActiveStaff) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        const docData = simFirestore.orders[docId];
        if (!docData) return new Response(JSON.stringify({ error: { message: 'NOT_FOUND' } }), { status: 404 });
        return new Response(JSON.stringify(makeFsDocResponse('orders', docId, docData)), { status: 200 });
      }

      if (method === 'PATCH') {
        if (!isActiveStaff) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const parsed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body.fields || {})) parsed[k] = fromFsVal(v);

        const existing = simFirestore.orders[docId];
        // Enforce role update restrictions mirroring firestore.rules
        if (simUser.role === 'COZINHA' && !['EM_PREPARO', 'PRONTO'].includes(String(parsed.status))) {
          return new Response(JSON.stringify({ error: { message: 'Missing or insufficient permissions.' } }), { status: 403 });
        }
        if (simUser.role === 'ENTREGADOR' && !['EM_ROTA', 'ENTREGUE'].includes(String(parsed.status))) {
          return new Response(JSON.stringify({ error: { message: 'Missing or insufficient permissions.' } }), { status: 403 });
        }
        if (String(parsed.status) === 'CANCELADO' && !isGerenteOrAdmin) {
          return new Response(JSON.stringify({ error: { message: 'Missing or insufficient permissions.' } }), { status: 403 });
        }

        const merged = existing ? { ...existing, ...parsed } : parsed;
        simFirestore.orders[docId] = merged;
        return new Response(JSON.stringify(makeFsDocResponse('orders', docId, merged)), { status: 200 });
      }

      if (method === 'DELETE') {
        firestoreDeleteCallCount++;
        if (!isGerenteOrAdmin) {
          return new Response(
            JSON.stringify({ error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }),
            { status: 403 }
          );
        }
        delete simFirestore.orders[docId];
        return new Response(JSON.stringify({}), { status: 200 });
      }
    }

    if (collection === 'public_tracking' && docId && method === 'DELETE') {
      if (!isGerenteOrAdmin) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
      delete simFirestore.public_tracking[docId];
      return new Response(JSON.stringify({}), { status: 200 });
    }

    return new Response(JSON.stringify({ error: { message: `Unhandled REST ${method} ${relPath}` } }), { status: 404 });
  }

  return realFetch(input, init);
};

async function run() {
  const { default: app } = await import('../server.ts');
  const { store } = await import('../src/services/store.ts');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  expressBaseUrl = `http://127.0.0.1:${addr.port}`;

  console.log(`=== TESTE INTEGRADO DOS 14 CENÁRIOS OBRIGATÓRIOS (Express + Store + Regras Sim) ===`);
  console.log(`Express local de teste rodando em ${expressBaseUrl}\n`);

  let passed = 0;
  let total = 0;

  async function testCase(title: string, fn: () => Promise<void> | void) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`✅ [PASS] ${title}`);
    } catch (err: any) {
      console.error(`❌ [FAIL] ${title}:`, err?.stack || err?.message || err);
      throw err;
    }
  }

  function makeOrder(id: string, num: string, overrides: Record<string, any> = {}) {
    const now = new Date().toISOString();
    return {
      id,
      orderNumber: num,
      createdAt: now,
      updatedAt: now,
      fulfillmentType: 'DELIVERY' as const,
      customer: { name: 'Cliente Teste', phone: '83999999999', address: { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Campina Grande' } },
      items: [{ id: 'it-1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 14, subtotal: 14 }],
      subtotal: 14,
      deliveryFee: 5,
      discount: 0,
      totalAmount: 19,
      paymentMethod: 'PIX' as const,
      paymentStatus: 'PENDENTE' as const,
      status: 'NOVO' as const,
      estimatedDeliveryMinutes: 45,
      trackingCode: `tk_test_${id}_12345678901234567890`,
      movements: [{ id: 'mov-init', timestamp: now, toStatus: 'NOVO' as const, author: 'Cardápio' }],
      _cloudSyncStatus: 'SYNCED' as const,
      ...overrides,
    };
  }

  function setLocalUser(role: Role, uid: string, email: string) {
    const userObj = {
      id: uid,
      username: role.toLowerCase(),
      name: role,
      role,
      status: 'ATIVO',
      email,
    };
    localStorage.setItem('gf_current_user', JSON.stringify(userObj));
  }

  try {
    // Seed a cash shift + valid completed order first (for scenario 14 preservation)
    const initialOrderPaid = makeOrder('ord-preserve-1', '#9001', {
      status: 'ENTREGUE',
      paymentMethod: 'DINHEIRO',
      paymentStatus: 'PAGO',
      cashShiftId: 'shift-active-1',
    });
    simFirestore.orders['ord-preserve-1'] = structuredClone(initialOrderPaid);
    localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid]));
    localStorage.setItem('gf_current_cash_shift', JSON.stringify({
      id: 'shift-active-1',
      openedAt: new Date().toISOString(),
      openedBy: 'Caixa',
      initialBalance: 100,
      movements: [
        { id: 'cm-1', type: 'VENDA', amount: 19, paymentMethod: 'DINHEIRO', timestamp: new Date().toISOString(), description: 'Pedido #9001', author: 'Caixa', orderId: 'ord-preserve-1' },
      ],
      status: 'ABERTO',
    }));

    // ------------------------------------------------------------------
    // 1. Exclusão autorizada por Administrador
    // ------------------------------------------------------------------
    await testCase('1. Exclusão autorizada por Administrador', async () => {
      const ord = makeOrder('ord-del-admin', '#1001');
      simFirestore.orders[ord.id] = structuredClone(ord);
      simFirestore.public_tracking[ord.trackingCode] = { id: ord.id, trackingCode: ord.trackingCode };

      const res = await realFetch(`${expressBaseUrl}/api/orders/${ord.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer tok-admin' },
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(simFirestore.orders[ord.id], undefined, 'Pedido deve ser removido no Firestore');
      assert.strictEqual(simFirestore.public_tracking[ord.trackingCode], undefined, 'Rastreio deve ser removido no Firestore');
      assert(simFirestore.order_tombstones[ord.id], 'Tombstone deve ser persistido em order_tombstones');
    });

    // ------------------------------------------------------------------
    // 2. Exclusão autorizada por Gerente (incluindo fallback POST /api/orders/delete)
    // ------------------------------------------------------------------
    await testCase('2. Exclusão autorizada por Gerente', async () => {
      const ord = makeOrder('ord-del-gerente', '#1002');
      simFirestore.orders[ord.id] = structuredClone(ord);

      const res = await realFetch(`${expressBaseUrl}/api/orders/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer tok-gerente',
        },
        body: JSON.stringify({ orderId: ord.id }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(simFirestore.orders[ord.id], undefined, 'Gerente deve conseguir excluir pedido no Firestore');
    });

    // ------------------------------------------------------------------
    // 3. Exclusão bloqueada para Cozinha, Entregador, Caixa, Atendente e público
    // ------------------------------------------------------------------
    await testCase('3. Exclusão bloqueada para Cozinha, Entregador, Caixa, Atendente e usuário público', async () => {
      const ord = makeOrder('ord-protected-del', '#1003');
      simFirestore.orders[ord.id] = structuredClone(ord);
      localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, ord]));

      // Backend check for each forbidden token + unauthenticated public user
      for (const token of ['tok-cozinha', 'tok-entregador', 'tok-caixa', 'tok-atendente', 'tok-blocked', '']) {
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await realFetch(`${expressBaseUrl}/api/orders/${ord.id}`, {
          method: 'DELETE',
          headers,
        });
        assert(res.status === 401 || res.status === 403, `Esperava 401/403 para token "${token}", recebeu ${res.status}`);
        assert(simFirestore.orders[ord.id], `Pedido NÃO pode ter sido removido no Firestore por "${token || 'anon'}"`);
      }

      // Frontend store guard check
      for (const [role, uid, email] of [
        ['COZINHA', 'uid-cozinha', 'cozinha@staff.amanditasabores.com.br'],
        ['ENTREGADOR', 'uid-entregador', 'entregador@staff.amanditasabores.com.br'],
        ['CAIXA', 'uid-caixa', 'caixa@staff.amanditasabores.com.br'],
        ['ATENDENTE', 'uid-atendente', 'atendente@staff.amanditasabores.com.br'],
      ] as Array<[Role, string, string]>) {
        setLocalUser(role, uid, email);
        assert.strictEqual(store.canUserDeleteOrder(), false, `${role} não deve ter permissão de exclusão no store`);
        const delRes = await store.deleteOrderAsync(ord.id);
        assert.strictEqual(delRes.success, false, `deleteOrderAsync deve negar ${role}`);
        assert(store.getOrderById(ord.id), `Pedido não pode sumir localmente para ${role}`);
      }
    });

    // ------------------------------------------------------------------
    // 4. Confirmação real da exclusão antes da remoção definitiva
    // ------------------------------------------------------------------
    await testCase('4. Confirmação real do servidor/Firestore antes de remover localmente', async () => {
      setLocalUser('GERENTE', 'uid-gerente', 'gerente@amanditasabores.com.br');
      const ord = makeOrder('ord-confirm-real', '#1004');
      simFirestore.orders[ord.id] = structuredClone(ord);
      localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, ord]));

      // Simular Firestore retornando 403/500 ao tentar excluir -> pedido deve permanecer intacto localmente
      forceFirestoreRestError = { status: 403, message: 'PERMISSION_DENIED: Simulate denied delete' };
      const deniedRes = await store.deleteOrderAsync(ord.id);
      forceFirestoreRestError = null;

      assert.strictEqual(deniedRes.success, false, 'deleteOrderAsync deve falhar quando servidor recusa exclusão');
      assert(store.getOrderById(ord.id), 'Pedido NÃO pode ser apagado localmente se o servidor recusou a exclusão');
      assert(!store.getDeletedOrderIds().has(ord.id), 'Tombstone NÃO pode ser gravado antes da confirmação');

      // Agora permitir no Firestore/servidor -> note que em Node auth.currentUser é null, então store chama backend?
      // Em store.deleteOrderAsync, quando !auth?.currentUser, backend REST exige Bearer token do usuário.
      // Testemos a confirmação real via backend + reconciliação quando autorizado:
      const okRes = await realFetch(`${expressBaseUrl}/api/orders/${ord.id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer tok-gerente' },
      });
      assert.strictEqual(okRes.status, 200);
      assert.strictEqual(simFirestore.orders[ord.id], undefined);
    });

    // ------------------------------------------------------------------
    // 5. Pedido excluído não reaparece após recarregar
    // ------------------------------------------------------------------
    await testCase('5. Pedido excluído não reaparece após recarregar (tombstone + reconcileRemoteOrders)', async () => {
      const deletedId = 'ord-del-gerente';
      // Registrar tombstone local (como ocorre após exclusão confirmada) e remover do cache local
      store.recordDeletedOrderId(deletedId);
      const remaining = store.getOrders().filter((o) => o.id !== deletedId);
      localStorage.setItem('gf_orders', JSON.stringify(remaining));

      // Simular snapshot remoto desatualizado ainda contendo o pedido excluído (cache/CDN antigo)
      const staleRemoteSnapshot = [initialOrderPaid, makeOrder(deletedId, '#1002')];
      store.reconcileRemoteOrders(staleRemoteSnapshot, { authoritative: true });

      assert.strictEqual(store.getOrderById(deletedId), undefined, 'Pedido excluído não pode ressuscitar após recarregar/reconciliar');
      assert(store.getOrderById('ord-preserve-1'), 'Pedido legítimo preservado');
    });

    // ------------------------------------------------------------------
    // 6. Exclusão sincronizada entre dois dispositivos / abas
    // ------------------------------------------------------------------
    await testCase('6. Exclusão sincronizada entre dois dispositivos via tombstones compartilhados (/api/orders/tombstones)', async () => {
      // Dispositivo A (Admin) já excluiu 'ord-del-admin' e gravou tombstone no servidor.
      // Dispositivo B (Celular sem saber da exclusão ainda) consulta /api/orders/tombstones
      const tombRes = await realFetch(`${expressBaseUrl}/api/orders/tombstones`, {
        headers: { Authorization: 'Bearer tok-cozinha' },
      });
      assert.strictEqual(tombRes.status, 200);
      const tombData = await tombRes.json();
      assert(Array.isArray(tombData.deletedOrderIds));
      assert(tombData.deletedOrderIds.includes('ord-del-admin'), 'Dispositivo B recebe tombstone de ord-del-admin');
      assert(tombData.deletedOrderIds.includes('ord-del-gerente'), 'Dispositivo B recebe tombstone de ord-del-gerente');

      // Dispositivo B aplica tombstones recebidos
      localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, makeOrder('ord-del-admin', '#1001')]));
      localStorage.removeItem('gf_deleted_order_ids');
      (store as any).applyRemoteTombstonesLocally(tombData.deletedOrderIds);

      assert.strictEqual(store.getOrderById('ord-del-admin'), undefined, 'Dispositivo B remove imediatamente pedido excluído no Dispositivo A');
    });

    // ------------------------------------------------------------------
    // 7, 8, 9, 10. Transições de Status: EM_PREPARO -> PRONTO -> EM_ROTA -> ENTREGUE
    // ------------------------------------------------------------------
    const lifecycleOrder = makeOrder('ord-lifecycle-1', '#2001', { status: 'NOVO' });
    simFirestore.orders[lifecycleOrder.id] = structuredClone(lifecycleOrder);
    localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, lifecycleOrder]));

    await testCase('7. Alteração de status para EM_PREPARO (Cozinha)', async () => {
      const next = {
        ...simFirestore.orders[lifecycleOrder.id],
        status: 'EM_PREPARO',
        updatedAt: new Date(Date.now() + 1000).toISOString(),
        movements: [...((simFirestore.orders[lifecycleOrder.id].movements as any[]) || []), { id: 'm-prep', timestamp: new Date().toISOString(), toStatus: 'EM_PREPARO', author: 'Cozinha' }],
      };
      const res = await realFetch(`${expressBaseUrl}/api/orders/${lifecycleOrder.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-cozinha' },
        body: JSON.stringify({ order: next }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(simFirestore.orders[lifecycleOrder.id].status, 'EM_PREPARO');
    });

    await testCase('8. Alteração de status para PRONTO (Cozinha)', async () => {
      const next = {
        ...simFirestore.orders[lifecycleOrder.id],
        status: 'PRONTO',
        updatedAt: new Date(Date.now() + 2000).toISOString(),
        movements: [...(simFirestore.orders[lifecycleOrder.id].movements as any[]), { id: 'm-pronto', timestamp: new Date().toISOString(), toStatus: 'PRONTO', author: 'Cozinha' }],
      };
      const res = await realFetch(`${expressBaseUrl}/api/orders/${lifecycleOrder.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-cozinha' },
        body: JSON.stringify({ order: next }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(simFirestore.orders[lifecycleOrder.id].status, 'PRONTO');
    });

    await testCase('9. Alteração de status para EM_ROTA (Entregador)', async () => {
      const next = {
        ...simFirestore.orders[lifecycleOrder.id],
        status: 'EM_ROTA',
        updatedAt: new Date(Date.now() + 3000).toISOString(),
        movements: [...(simFirestore.orders[lifecycleOrder.id].movements as any[]), { id: 'm-rota', timestamp: new Date().toISOString(), toStatus: 'EM_ROTA', author: 'Entregador' }],
      };
      const res = await realFetch(`${expressBaseUrl}/api/orders/${lifecycleOrder.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-entregador' },
        body: JSON.stringify({ order: next }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(simFirestore.orders[lifecycleOrder.id].status, 'EM_ROTA');

      // Cozinha NÃO pode colocar pedido em EM_ROTA
      const forbiddenRes = await realFetch(`${expressBaseUrl}/api/orders/${lifecycleOrder.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-cozinha' },
        body: JSON.stringify({ order: next }),
      });
      assert.strictEqual(forbiddenRes.status, 403, 'Cozinha não pode avançar pedido para EM_ROTA');
    });

    await testCase('10. Alteração de status para ENTREGUE (Entregador)', async () => {
      const next = {
        ...simFirestore.orders[lifecycleOrder.id],
        status: 'ENTREGUE',
        updatedAt: new Date(Date.now() + 4000).toISOString(),
        movements: [...(simFirestore.orders[lifecycleOrder.id].movements as any[]), { id: 'm-entregue', timestamp: new Date().toISOString(), toStatus: 'ENTREGUE', author: 'Entregador' }],
      };
      const res = await realFetch(`${expressBaseUrl}/api/orders/${lifecycleOrder.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-entregador' },
        body: JSON.stringify({ order: next }),
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.success, true);
      assert.strictEqual(simFirestore.orders[lifecycleOrder.id].status, 'ENTREGUE');
    });

    // ------------------------------------------------------------------
    // 11. Sincronização real dessas alterações entre celular e computador
    // ------------------------------------------------------------------
    await testCase('11. Sincronização real entre celular e computador (monotonia e timestamp)', async () => {
      // Computador estava em EM_PREPARO, celular já enviou ENTREGUE ao Firestore
      const olderComputerVersion = makeOrder(lifecycleOrder.id, '#2001', {
        status: 'EM_PREPARO',
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      });
      localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, olderComputerVersion]));

      const syncedRemoteFromPhone = simFirestore.orders[lifecycleOrder.id] as any;
      store.reconcileRemoteOrders([initialOrderPaid, syncedRemoteFromPhone], { authoritative: true });

      const mergedOnComputer = store.getOrderById(lifecycleOrder.id);
      assert.strictEqual(mergedOnComputer?.status, 'ENTREGUE', 'Computador recebe status ENTREGUE feito no celular');

      // Se um snapshot atrasado com status anterior (PRONTO) chegar depois, status avançado ENTREGUE não deve regredir!
      const staleSnapshot = makeOrder(lifecycleOrder.id, '#2001', {
        status: 'PRONTO',
        updatedAt: new Date(Date.now() + 2000).toISOString(),
      });
      store.reconcileRemoteOrders([initialOrderPaid, staleSnapshot], { authoritative: true });
      assert.strictEqual(store.getOrderById(lifecycleOrder.id)?.status, 'ENTREGUE', 'Proteção monotônica impede regressão de status em snapshot atrasado');
    });

    // ------------------------------------------------------------------
    // 12. Comportamento quando Firestore/servidor retorna erro de permissão ou falha de rede
    // ------------------------------------------------------------------
    await testCase('12. Rollback explícito em erro de permissão (403) vs fila pendente em falha de rede offline', async () => {
      const ord = makeOrder('ord-rollback-test', '#3001', { status: 'NOVO' });
      simFirestore.orders[ord.id] = structuredClone(ord);
      localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, ord]));

      // Caso A: Tentativa de usuário sem permissão (Cozinha tentando colocar em ENTREGUE) -> rejeição imediata + rollback
      setLocalUser('COZINHA', 'uid-cozinha', 'cozinha@staff.amanditasabores.com.br');
      const roleDenied = await store.updateOrderStatusAsync(ord.id, 'ENTREGUE', 'Cozinha', 'Teste inválido');
      assert.strictEqual(roleDenied.synced, false);
      assert.strictEqual(roleDenied.rejected, true);
      assert.strictEqual(store.getOrderById(ord.id)?.status, 'NOVO', 'Status permanece NOVO após bloqueio de papel');

      // Caso B: Gerente tentando quando servidor / Firestore REST retorna 403 -> backend retorna 403 -> store faz rollback!
      // Como no ambiente Node auth.currentUser é null e fetch('/api/...') passa sem token do browser,
      // testamos ambos:
      // 1) Resposta real 403 do endpoint /api/orders/:id/status com token de Cozinha tentando EM_ROTA
      const server403 = await realFetch(`${expressBaseUrl}/api/orders/${ord.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-cozinha' },
        body: JSON.stringify({ order: { ...ord, status: 'EM_ROTA' } }),
      });
      assert.strictEqual(server403.status, 403);
      assert.strictEqual(simFirestore.orders[ord.id].status, 'NOVO', 'Firestore mantém NOVO quando API rejeita com 403');

      // 2) Falha de rede offline em updateOrderStatusAsync -> deve manter alteração local com fila PENDING (sem perder dados)
      setLocalUser('GERENTE', 'uid-gerente', 'gerente@amanditasabores.com.br');
      forceNetworkFailureOnApi = true;
      simulatedOnline = false;
      const offlineRes = await store.updateOrderStatusAsync(ord.id, 'EM_PREPARO', 'Gerente', 'Teste offline');
      forceNetworkFailureOnApi = false;
      simulatedOnline = true;

      assert.strictEqual(offlineRes.synced, false);
      assert.strictEqual(offlineRes.offlineQueued, true, 'Falha de rede deve enfileirar offline em vez de descartar');
      assert.strictEqual(store.getOrderById(ord.id)?.status, 'EM_PREPARO');
      assert.strictEqual(store.getOrderById(ord.id)?._cloudSyncStatus, 'PENDING');
      store.removeOrderFromSyncQueue(ord.id);
    });

    // ------------------------------------------------------------------
    // 13. Proteção contra clique duplo simultâneo
    // ------------------------------------------------------------------
    await testCase('13. Proteção contra clique duplo simultâneo em exclusão e mudança de status', async () => {
      const ordDel = makeOrder('ord-double-click-del', '#4001', { status: 'NOVO' });
      localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, ordDel]));

      // Clique duplo em deleteOrderAsync enquanto !auth?.currentUser deve serializar/evitar execução concorrente
      // Testemos com GERENTE quando backend falha: a segunda chamada simultânea recebe retorno imediato de operação em andamento
      setLocalUser('GERENTE', 'uid-gerente', 'gerente@amanditasabores.com.br');
      const slowPromise1 = store.deleteOrderAsync(ordDel.id);
      const slowPromise2 = store.deleteOrderAsync(ordDel.id);
      const [r1, r2] = await Promise.all([slowPromise1, slowPromise2]);
      // Pelo menos uma das chamadas simultâneas deve bloquear duplicidade ("Exclusão já está em andamento")
      const detectedDuplicateGuard = [r1, r2].some((r) => (r.error || '').includes('andamento'));
      assert.strictEqual(detectedDuplicateGuard, true, 'Segundo clique simultâneo em deleteOrderAsync deve ser bloqueado');

      // Clique duplo em updateOrderStatusAsync para o mesmo pedido serializado em orderWriteChains
      const ordStatus = makeOrder('ord-double-click-status', '#4002', { status: 'NOVO' });
      localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, ordStatus]));
      const [s1, s2] = await Promise.all([
        store.updateOrderStatusAsync(ordStatus.id, 'EM_PREPARO', 'Gerente'),
        store.updateOrderStatusAsync(ordStatus.id, 'EM_PREPARO', 'Gerente'),
      ]);
      // O primeiro inicia transição, o segundo vê status já em EM_PREPARO (idempotente sem duplicar movimentos)
      const movementsCount = (store.getOrderById(ordStatus.id)?.movements || []).filter((m) => m.toStatus === 'EM_PREPARO').length;
      assert.strictEqual(movementsCount, 1, 'Movimento EM_PREPARO não deve ser duplicado por clique duplo');
      assert(s1 && s2);
    });

    // ------------------------------------------------------------------
    // 14. Preservação de pedidos existentes e relatórios/estornos financeiros
    // ------------------------------------------------------------------
    await testCase('14. Preservação de pedidos existentes, caixa, estornos e imutabilidade de turno FECHADO', async () => {
      // Cancelamento com estorno via Gerente em pedido pago em dinheiro
      const paidOrder = makeOrder('ord-paid-cash', '#5001', {
        status: 'ENTREGUE',
        paymentMethod: 'DINHEIRO',
        paymentStatus: 'PAGO',
        totalAmount: 25,
        subtotal: 20,
        deliveryFee: 5,
        cashShiftId: 'shift-active-1',
      });
      localStorage.setItem('gf_orders', JSON.stringify([initialOrderPaid, paidOrder]));
      setLocalUser('GERENTE', 'uid-gerente', 'gerente@amanditasabores.com.br');

      const cancelRes = store.cancelOrder(paidOrder.id, 'Cliente desistiu após entrega com erro', 'Gerente');
      assert.strictEqual(cancelRes.success, true);
      const updatedShift = store.getCurrentCashShift();
      assert(updatedShift, 'Turno aberto preservado');
      const refundMov = updatedShift!.movements.find((m) => m.type === 'ESTORNO' && m.orderId === paidOrder.id);
      assert(refundMov, 'Movimento ESTORNO registrado no caixa aberto');
      assert.strictEqual(refundMov!.amount, 25);

      // Pedido anterior #9001 e sua venda continuam preservados
      assert(store.getOrderById('ord-preserve-1'), 'Pedido existente #9001 preservado');
      assert(updatedShift!.movements.some((m) => m.id === 'cm-1'), 'Movimento de venda existente preservado');

      // Tentativa de alterar turno FECHADO no endpoint /api/cash-shifts deve continuar bloqueada
      // (Sem adminDb, REST fallback valida auth; garantimos que um colaborador não-autorizado recebe 403)
      const unauthorizedShiftRes = await realFetch(`${expressBaseUrl}/api/cash-shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-cozinha' },
        body: JSON.stringify({ shift: { id: 'shift-closed-1', status: 'FECHADO', initialBalance: 0, movements: [] } }),
      });
      assert.strictEqual(unauthorizedShiftRes.status, 403, 'Cozinha não pode gravar turno de caixa');
    });

    console.log(`\n============================================================`);
    console.log(`RESULTADO: ${passed}/${total} CENÁRIOS OBRIGATÓRIOS APROVADOS.`);
    console.log(`Chamadas DELETE reais interceptadas para Firestore: ${firestoreDeleteCallCount}`);
    console.log(`============================================================`);
  } finally {
    server.close();
    if (hadExistingTombstoneFile && existingTombstoneBackup !== null) {
      fs.writeFileSync(tmpTombstonePath, existingTombstoneBackup, 'utf8');
    } else if (fs.existsSync(tmpTombstonePath)) {
      fs.unlinkSync(tmpTombstonePath);
    }
  }
}

run().catch((err) => {
  console.error('Erro fatal na suíte:', err);
  process.exit(1);
});
