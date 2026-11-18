/**
 * Verification Suite: Auth Session Mode, RBAC, PIX Validation/Persistence, and Order Operations
 *
 * NOTE: Runs in Node via `npx tsx` with an ephemeral Express HTTP server and stateful
 * in-memory mock for Firebase Identity Toolkit & Firestore REST API.
 * Does NOT connect to or mutate live production Firebase.
 */

import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// 1. Setup isolated env BEFORE importing server.ts / store.ts
process.env.DISABLE_AUTO_LISTEN = '1';
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
    userAgent: 'AmanditaVerifyTest/1.0',
  },
});

const tmpTombstonePath = path.join(process.cwd(), '.deleted_orders_cache.json');
const hadExistingTombstoneFile = fs.existsSync(tmpTombstonePath);
const existingTombstoneBackup = hadExistingTombstoneFile ? fs.readFileSync(tmpTombstonePath, 'utf8') : null;

const simUsersByToken: Record<string, { uid: string; email: string; role: string; status: string }> = {
  'tok-admin': { uid: 'uid-admin', email: 'dvrmercadinho@gmail.com', role: 'ADMINISTRADOR', status: 'ATIVO' },
  'tok-gerente': { uid: 'uid-gerente', email: 'gerente@amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' },
  'tok-cozinha': { uid: 'uid-cozinha', email: 'cozinha@staff.amanditasabores.com.br', role: 'COZINHA', status: 'ATIVO' },
  'tok-entregador': { uid: 'uid-entregador', email: 'entregador@staff.amanditasabores.com.br', role: 'ENTREGADOR', status: 'ATIVO' },
  'tok-caixa': { uid: 'uid-caixa', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
  'tok-atendente': { uid: 'uid-atendente', email: 'atendente@staff.amanditasabores.com.br', role: 'ATENDENTE', status: 'ATIVO' },
  'tok-blocked': { uid: 'uid-blocked', email: 'blocked@staff.amanditasabores.com.br', role: 'ADMINISTRADOR', status: 'BLOQUEADO' },
};

const simFirestore: Record<string, Record<string, Record<string, unknown>>> = {
  users: {
    'uid-admin': { id: 'uid-admin', email: 'dvrmercadinho@gmail.com', role: 'ADMINISTRADOR', status: 'ATIVO' },
    'uid-gerente': { id: 'uid-gerente', email: 'gerente@amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' },
    'uid-cozinha': { id: 'uid-cozinha', email: 'cozinha@staff.amanditasabores.com.br', role: 'COZINHA', status: 'ATIVO' },
    'uid-entregador': { id: 'uid-entregador', email: 'entregador@staff.amanditasabores.com.br', role: 'ENTREGADOR', status: 'ATIVO' },
    'uid-caixa': { id: 'uid-caixa', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
    'uid-atendente': { id: 'uid-atendente', email: 'atendente@staff.amanditasabores.com.br', role: 'ATENDENTE', status: 'ATIVO' },
    'uid-blocked': { id: 'uid-blocked', email: 'blocked@staff.amanditasabores.com.br', role: 'ADMINISTRADOR', status: 'BLOQUEADO' },
  },
  orders: {},
  cash_shifts: {},
  public_tracking: {},
  order_tombstones: {},
};

const capturedRestRequests: Array<{ method: string; url: string }> = [];
let forceFirestore403 = false;

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

function makeFsDoc(collection: string, docId: string, data: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) fields[k] = toFsVal(v);
  return {
    name: `projects/amandita-sabores/databases/(default)/documents/${collection}/${docId}`,
    fields,
  };
}

const realFetch = globalThis.fetch.bind(globalThis);
let expressBaseUrl = '';

(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (url.startsWith('/')) {
    return realFetch(`${expressBaseUrl}${url}`, init);
  }

  if (url.includes('identitytoolkit.googleapis.com/v1/accounts:lookup')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const user = simUsersByToken[body.idToken];
    if (!user) {
      return new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 });
    }
    return new Response(JSON.stringify({ users: [{ localId: user.uid, email: user.email }] }), { status: 200 });
  }

  if (url.includes('firestore.googleapis.com/v1/projects/amandita-sabores/databases/(default)/documents')) {
    const method = (init?.method || 'GET').toUpperCase();
    capturedRestRequests.push({ method, url });

    if (forceFirestore403 && method !== 'GET') {
      return new Response(
        JSON.stringify({ error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } }),
        { status: 403 }
      );
    }

    const authHeader =
      (init?.headers as Record<string, string> | undefined)?.Authorization ||
      (init?.headers as Record<string, string> | undefined)?.authorization ||
      '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const simUser = simUsersByToken[token];
    const isActiveStaff = Boolean(simUser && simUser.status === 'ATIVO');
    const isGerenteOrAdmin = Boolean(isActiveStaff && (simUser.role === 'ADMINISTRADOR' || simUser.role === 'GERENTE'));

    if (url.endsWith(':runQuery') && method === 'POST') {
      if (!isActiveStaff) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const colId = body?.structuredQuery?.from?.[0]?.collectionId;
      const filterField = body?.structuredQuery?.where?.fieldFilter?.field?.fieldPath;
      const filterVal = body?.structuredQuery?.where?.fieldFilter?.value?.stringValue;
      if (colId === 'cash_shifts') {
        const isCashMgr = ['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(simUser!.role);
        const isAttendant = simUser!.role === 'ATENDENTE';
        if (!isCashMgr && !(isAttendant && filterField === 'status' && filterVal === 'ABERTO')) {
          return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        }
        const matched = Object.entries(simFirestore.cash_shifts)
          .filter(([, d]) => (!filterField ? true : d[filterField] === filterVal))
          .map(([id, d]) => ({ document: makeFsDoc('cash_shifts', id, d) }));
        return new Response(JSON.stringify(matched.length > 0 ? matched : [{ readTime: new Date().toISOString() }]), { status: 200 });
      }
    }

    const docPrefix = 'https://firestore.googleapis.com/v1/projects/amandita-sabores/databases/(default)/documents/';
    const relPath = url.slice(docPrefix.length).split('?')[0];
    const [collection, docId] = relPath.split('/').filter(Boolean);

    if (collection === 'users' && docId && method === 'GET') {
      const u = simFirestore.users[docId];
      if (!u) return new Response(JSON.stringify({ error: { message: 'NOT_FOUND' } }), { status: 404 });
      return new Response(JSON.stringify(makeFsDoc('users', docId, u)), { status: 200 });
    }

    if (collection === 'cash_shifts' && docId) {
      const isCashMgr = Boolean(isActiveStaff && ['ADMINISTRADOR', 'GERENTE', 'CAIXA'].includes(simUser!.role));
      const isAttendant = Boolean(isActiveStaff && simUser!.role === 'ATENDENTE');
      const existing = simFirestore.cash_shifts[docId];
      if (method === 'GET') {
        if (!existing) return new Response(JSON.stringify({ error: { message: 'NOT_FOUND' } }), { status: 404 });
        if (!isCashMgr && !(isAttendant && existing.status === 'ABERTO')) {
          return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        }
        return new Response(JSON.stringify(makeFsDoc('cash_shifts', docId, existing)), { status: 200 });
      }
      if (method === 'PATCH') {
        if (existing && existing.status === 'FECHADO') {
          return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        }
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const parsed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body.fields || {})) parsed[k] = fromFsVal(v);
        if (isCashMgr) {
          const merged = existing ? { ...existing, ...parsed } : parsed;
          simFirestore.cash_shifts[docId] = merged;
          return new Response(JSON.stringify(makeFsDoc('cash_shifts', docId, merged)), { status: 200 });
        }
        if (isAttendant && existing && existing.status === 'ABERTO') {
          const queryPart = url.split('?')[1] || '';
          const maskOnlyMovements = queryPart === 'updateMask.fieldPaths=movements';
          const prevMovs = Array.isArray(existing.movements) ? existing.movements : [];
          const nextMovs = Array.isArray(parsed.movements) ? parsed.movements : [];
          const newMov = nextMovs[nextMovs.length - 1] as Record<string, unknown> | undefined;
          const targetOrder = newMov?.orderId ? simFirestore.orders[String(newMov.orderId)] : undefined;
          if (
            maskOnlyMovements &&
            nextMovs.length === prevMovs.length + 1 &&
            newMov?.type === 'VENDA' &&
            Number(newMov?.amount) > 0 &&
            targetOrder &&
            targetOrder.paymentStatus === 'PAGO'
          ) {
            const merged = { ...existing, movements: nextMovs };
            simFirestore.cash_shifts[docId] = merged;
            return new Response(JSON.stringify(makeFsDoc('cash_shifts', docId, merged)), { status: 200 });
          }
        }
        return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
      }
    }

    if (collection === 'order_tombstones') {
      if (!isActiveStaff) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
      if (method === 'GET') {
        const docs = Object.entries(simFirestore.order_tombstones).map(([id, d]) => makeFsDoc('order_tombstones', id, d));
        return new Response(JSON.stringify({ documents: docs }), { status: 200 });
      }
      if (method === 'PATCH' && docId) {
        if (!isGerenteOrAdmin) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const parsed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body.fields || {})) parsed[k] = fromFsVal(v);
        simFirestore.order_tombstones[docId] = parsed;
        return new Response(JSON.stringify(makeFsDoc('order_tombstones', docId, parsed)), { status: 200 });
      }
    }

    if (collection === 'orders' && docId) {
      if (method === 'GET') {
        if (!isActiveStaff) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        const d = simFirestore.orders[docId];
        if (!d) return new Response(JSON.stringify({ error: { message: 'NOT_FOUND' } }), { status: 404 });
        return new Response(JSON.stringify(makeFsDoc('orders', docId, d)), { status: 200 });
      }
      if (method === 'PATCH') {
        if (!isActiveStaff) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const parsed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body.fields || {})) parsed[k] = fromFsVal(v);
        const existingOrder = simFirestore.orders[docId];
        if (simUser?.role === 'ENTREGADOR' && existingOrder && parsed.paymentStatus !== undefined && parsed.paymentStatus !== existingOrder.paymentStatus) {
          return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        }
        const merged = existingOrder ? { ...existingOrder, ...parsed } : parsed;
        simFirestore.orders[docId] = merged;
        return new Response(JSON.stringify(makeFsDoc('orders', docId, merged)), { status: 200 });
      }
      if (method === 'DELETE') {
        if (!isGerenteOrAdmin) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        delete simFirestore.orders[docId];
        return new Response(JSON.stringify({}), { status: 200 });
      }
    }

    if (collection === 'public_tracking' && docId) {
      if (method === 'PATCH') {
        if (!isActiveStaff) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const parsed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body.fields || {})) parsed[k] = fromFsVal(v);
        simFirestore.public_tracking[docId] = parsed;
        return new Response(JSON.stringify(makeFsDoc('public_tracking', docId, parsed)), { status: 200 });
      }
      if (method === 'DELETE') {
        if (!isGerenteOrAdmin) return new Response(JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }), { status: 403 });
        delete simFirestore.public_tracking[docId];
        return new Response(JSON.stringify({}), { status: 200 });
      }
    }

    return new Response(JSON.stringify({ error: { message: `Unhandled REST ${method} ${relPath}` } }), { status: 404 });
  }

  return realFetch(input, init);
};

async function runFirebaseModeChecks() {
  process.env.VITE_FIREBASE_API_KEY = 'AIzaSyTestFakeFirebaseApiKey1234567890';
  process.env.VITE_FIREBASE_PROJECT_ID = 'amandita-sabores';
  process.env.VITE_FIREBASE_APP_ID = '1:1234567890:web:abcdef123456';

  (globalThis as any).fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('identitytoolkit.googleapis.com')) {
      return new Response(
        JSON.stringify({ error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ error: { message: 'SIMULATED_OFFLINE_OR_DENIED' } }), { status: 403 });
  };

  const { isFirebaseReady } = await import('../src/services/firebase');
  const { store } = await import('../src/services/store');

  assert.strictEqual(isFirebaseReady(), true, 'Firebase deve estar marcado como configurado');
  const loginFail = await store.login('admin', '123456');
  assert.strictEqual(loginFail.success, false, 'Login NÃO pode fazer fallback silencioso para senha local 123456 quando Firebase Auth falha');
  assert.strictEqual(loginFail.isCloudAuth, false);
  assert.strictEqual(store.getCurrentUser(), null, 'Sessão local deve permanecer nula após falha do Firebase Auth');
  assert.strictEqual(store.getAuthSessionMode(), 'unauthenticated');

  // Simular cache local residual de sessão sem auth.currentUser -> operações devem bloquear
  localStorage.setItem('gf_current_user', JSON.stringify({
    id: 'uid-admin-stale',
    username: 'admin',
    name: 'Admin',
    role: 'ADMINISTRADOR',
    status: 'ATIVO',
    email: 'dvrmercadinho@gmail.com',
    allowedModules: ['pdv', 'configuracoes'],
  }));
  const ord = store.createOrder(
    {
      fulfillmentType: 'RETIRADA',
      estimatedDeliveryMinutes: 35,
      customer: { name: 'Teste', phone: '83999999999' },
      items: [{ id: 'i1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 14, subtotal: 14 }],
      subtotal: 14,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 14,
      paymentMethod: 'PIX',
      paymentStatus: 'PENDENTE',
    },
    false
  );
  const statusRes = await store.updateOrderStatusAsync(ord.id, 'EM_PREPARO', 'Admin');
  assert.strictEqual(statusRes.synced, false);
  assert.strictEqual(statusRes.rejected, true, 'Sem auth.currentUser em modo Firebase, alteração de status deve ser rejeitada');
  assert.strictEqual(store.getOrderById(ord.id)?.status, 'NOVO', 'Status não pode avançar sem sessão Firebase');

  const delRes = await store.deleteOrderAsync(ord.id);
  assert.strictEqual(delRes.success, false, 'Sem auth.currentUser em modo Firebase, exclusão deve ser recusada');
  assert(store.getOrderById(ord.id), 'Comanda deve permanecer intacta');

  const cfgRes = await store.updateRestaurantConfigAsync({
    ...store.getRestaurantConfig(),
    pixKeyType: 'TELEFONE',
    pixKey: '(83) 99123-4567',
    pixReceiverName: 'Amandita Sabores',
    pixReceiverCity: 'Campina Grande',
  });
  assert.strictEqual(cfgRes.success, false, 'Sem auth.currentUser em modo Firebase, salvar PIX deve falhar explicitamente');
  assert.strictEqual(cfgRes.synced, false);
  process.exit(0);
}

async function run() {
  if (process.argv.includes('--firebase-mode')) {
    await runFirebaseModeChecks();
    return;
  }
  const {
    sanitizePixKey,
    validatePixKey,
    validatePixReceiver,
    getPixKeyHint,
    generatePixCopiaECola,
    generatePurchasePixPayload,
    generateOrderPixTxId,
    validatePixPayload,
    parseTLVFields,
    formatField,
    calculateCRC16,
    getUtf8ByteLength,
    inferPixKeyType,
  } = await import('../src/utils/pix');
  const { generateQRCodeDataUrl } = await import('../src/utils/qrcode');
  const { store } = await import('../src/services/store');
  // Enable API key before importing server so server verifies tokens via Identity Toolkit mock
  process.env.VITE_FIREBASE_API_KEY = 'test-fake-api-key';
  const { default: app } = await import('../server');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  expressBaseUrl = `http://127.0.0.1:${addr.port}`;

  let passed = 0;
  let total = 0;
  async function check(name: string, fn: () => Promise<void> | void) {
    total++;
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  try {
    console.log('=== VERIFICAÇÃO DE AUTENTICAÇÃO, PIX E OPERAÇÕES DE COMANDA ===\n');

    // 1. PIX Key Sanitization & Strict Validation
    await check('1. utils/pix.ts: sanitizePixKey + validatePixKey + validatePixReceiver por tipo', () => {
      assert.strictEqual(sanitizePixKey('', 'TELEFONE'), '', 'Telefone vazio não deve retornar "+"');
      assert.strictEqual(sanitizePixKey('(83) 99123-4567', 'TELEFONE'), '+5583991234567');

      assert.strictEqual(validatePixKey('529.982.247-25', 'CPF').valid, true);
      assert.strictEqual(validatePixKey('529.982.247-25', 'CPF').normalized, '52998224725');
      assert.strictEqual(validatePixKey('111.111.111-11', 'CPF').valid, false);
      assert.strictEqual(validatePixKey('52998224720', 'CPF').valid, false);

      assert.strictEqual(validatePixKey('11.222.333/0001-81', 'CNPJ').valid, true);
      assert.strictEqual(validatePixKey('11.222.333/0001-80', 'CNPJ').valid, false);

      assert.strictEqual(validatePixKey(' Pagamentos@AmanditaSabores.com.br ', 'EMAIL').normalized, 'pagamentos@amanditasabores.com.br');
      assert.strictEqual(validatePixKey('email-invalido', 'EMAIL').valid, false);

      const phoneRes = validatePixKey('(83) 99123-4567', 'TELEFONE');
      assert.strictEqual(phoneRes.valid, true);
      assert.strictEqual(phoneRes.normalized, '+5583991234567');
      assert.strictEqual(validatePixKey('(05) 99123-4567', 'TELEFONE').valid, false);
      assert.strictEqual(validatePixKey('(83) 89123-4567', 'TELEFONE').valid, false, '11 dígitos deve iniciar com 9');

      const uuidRes = validatePixKey('123E4567E89B12D3A456426614174000', 'ALEATORIA');
      assert.strictEqual(uuidRes.valid, true);
      assert.strictEqual(uuidRes.normalized, '123e4567-e89b-12d3-a456-426614174000');
      assert.strictEqual(validatePixKey('chave-errada', 'ALEATORIA').valid, false);

      // Troca de tipo deve rejeitar formato incompatível
      assert.strictEqual(validatePixKey('loja@amandita.com', 'CPF').valid, false);
      assert(getPixKeyHint('TELEFONE').includes('+55'));

      // Titular/Cidade vazios não podem ser mascarados por fallback
      assert.strictEqual(validatePixReceiver('', 'Campina Grande').valid, false);
      assert.strictEqual(validatePixReceiver('Amandita Sabores', '').valid, false);
      assert.strictEqual(validatePixReceiver('Amandita Sabores', 'João Pessoa').valid, true);
    });

    // 2. BACEN PIX Copia e Cola, TLV audit, TXID uniqueness & QR Data URL with exact amount
    await check('2. utils/pix.ts + qrcode.ts: generatePurchasePixPayload + validatePixPayload TLV/CRC16 + QR DataURL', async () => {
      const payload = generatePixCopiaECola({
        pixKey: '(83) 99123-4567',
        keyType: 'TELEFONE',
        receiverName: 'Amandita Sabores Ltda',
        receiverCity: 'Campina Grande',
        amount: 47.9,
        txId: '1042',
      });
      assert(payload.startsWith('000201010211'), 'Deve iniciar com formato 01 e método estático 11');
      assert(payload.includes('+5583991234567'), 'Deve conter chave normalizada +55');
      assert(payload.includes('540547.90'), 'Deve conter campo 54 com valor exato 47.90');
      assert(payload.includes('5921AMANDITA SABORES LTDA'), 'Deve conter recebedor sanitizado');
      assert(payload.includes('6014CAMPINA GRANDE'), 'Deve conter cidade sanitizada');
      const bodyWithoutCrc = payload.slice(0, -4);
      const crc = payload.slice(-4);
      assert.strictEqual(calculateCRC16(bodyWithoutCrc), crc, 'CRC16-CCITT deve fechar exatamente');

      const audit = validatePixPayload(payload);
      assert.strictEqual(audit.valid, true, `TLV inválido: ${audit.error}`);
      assert.strictEqual(audit.pixKey, '+5583991234567');
      assert.strictEqual(audit.amount, '47.90');
      assert.strictEqual(audit.txId, '1042');

      // Test centralized generatePurchasePixPayload across all key types + Field 26 <= 99 chars
      const txA = generateOrderPixTxId('#1043', 'ord-abc1');
      const txB = generateOrderPixTxId('#1044', 'ord-abc2');
      assert.notStrictEqual(txA, txB, 'TXIDs de pedidos distintos devem ser únicos');
      assert(/^[A-Za-z0-9]{1,25}$/.test(txA), 'TXID deve conter apenas alfanuméricos até 25 chars');

      const evpRes = generatePurchasePixPayload({
        pixKey: '123e4567-e89b-12d3-a456-426614174000',
        keyType: 'ALEATORIA',
        receiverName: 'Amandita Sabores',
        receiverCity: 'Campina Grande',
        amount: 123.45,
        txId: txA,
        description: 'Pedido #1043 com adicionais e entrega',
      });
      assert.strictEqual(evpRes.success, true);
      if (evpRes.success) {
        const evpAudit = validatePixPayload(evpRes.payload);
        assert.strictEqual(evpAudit.valid, true, `EVP TLV inválido: ${evpAudit.error}`);
        assert((evpAudit.fields?.['26']?.length || 0) <= 99, 'Campo 26 não pode exceder 99 chars');
        assert.strictEqual(evpAudit.amount, '123.45');
        assert.strictEqual(evpAudit.txId, txA);
      }

      // Error when key missing or amount <= 0
      assert.strictEqual(generatePurchasePixPayload({ pixKey: '', amount: 25 }).success, false);
      assert.strictEqual(generatePurchasePixPayload({ pixKey: 'pix@amandita.com', keyType: 'EMAIL', amount: 0 }).success, false);

      const qrUrl = await generateQRCodeDataUrl(payload);
      assert(qrUrl.startsWith('data:image/png;base64,'), 'QR Code deve gerar DataURL PNG válida');
    });

    // 3. Auth Session Mode, No Silent Admin Escalation, Blocked User Rejection
    await check('3. Auth Mode & RBAC: Contingência local explícita + verifyStaffRole sem auto-elevação', async () => {
      store.logout();
      assert.strictEqual(store.getAuthSessionMode(), 'unauthenticated');

      const loginRes = await store.login('admin', '123456');
      assert.strictEqual(loginRes.success, true);
      assert.strictEqual(loginRes.isCloudAuth, false);
      assert.strictEqual(loginRes.isLocalContingency, true);
      assert.strictEqual(loginRes.user?.authProvider, 'local_contingency');
      assert.strictEqual(store.getAuthSessionMode(), 'local_contingency');

      const googleRes = await store.loginWithGoogle();
      assert.strictEqual(googleRes.success, false, 'Sem Firebase configurado, Google login não deve simular sucesso');
      assert.strictEqual(googleRes.isCloudAuth, false);

      // Simular usuário arbitrário em localStorage marcado como ADMINISTRADOR -> verifyStaffRole NUNCA pode elevá-lo
      const currentUsers = store.getUsers();
      localStorage.setItem(
        'gf_users',
        JSON.stringify([
          ...currentUsers,
          {
            id: 'arbitrary-1',
            name: 'Arbitrário',
            username: 'intruder',
            email: 'intruder@gmail.com',
            isEmailVerified: true,
            role: 'ADMINISTRADOR',
            status: 'ATIVO',
            allowedModules: ['pdv'],
            createdAt: new Date().toISOString(),
          },
          {
            id: 'blocked-1',
            name: 'Bloqueado',
            username: 'blocked',
            email: 'blocked@staff.amanditasabores.com.br',
            isEmailVerified: true,
            role: 'GERENTE',
            status: 'BLOQUEADO',
            allowedModules: ['pdv'],
            createdAt: new Date().toISOString(),
          },
        ])
      );

      assert.strictEqual(await store.verifyStaffRole({ uid: 'u-boot', email: 'dvrmercadinho@gmail.com' }), 'ADMINISTRADOR');
      assert.strictEqual(await store.verifyStaffRole({ uid: 'u-ger', email: 'gerente@amanditasabores.com.br' }), 'GERENTE');
      assert.strictEqual(await store.verifyStaffRole({ uid: 'arbitrary-1', email: 'intruder@gmail.com' }), null, 'E-mail arbitrário não pode herdar ADMINISTRADOR via localStorage');
      assert.strictEqual(await store.verifyStaffRole({ uid: 'blocked-1', email: 'blocked@staff.amanditasabores.com.br' }), null, 'Usuário bloqueado deve retornar null');
    });

    // 4. PIX Settings Validation, Permissions, Internal Field Preservation & Menu Propagation
    await check('4. Cadastro PIX: Permissão, validação por tipo, preservação de campos internos e propagação ao pedido', async () => {
      // Usuário CAIXA não pode salvar configuração PIX
      await store.login('caixa', '123456');
      assert.strictEqual(store.canUserManageConfig(), false);
      const deniedSave = await store.updateRestaurantConfigAsync({
        ...store.getRestaurantConfig(),
        pixKeyType: 'TELEFONE',
        pixKey: '(83) 99123-4567',
      });
      assert.strictEqual(deniedSave.success, false);

      // Administrador pode salvar, mas chave inválida é rejeitada sem sobrescrever config anterior
      await store.login('admin', '123456');
      assert.strictEqual(store.canUserManageConfig(), true);

      const baseCfg = {
        ...store.getRestaurantConfig(),
        receiptFooterText: 'Rodapé personalizado preservado!',
        defaultDeliveryPersonId: 'driver-keep-1',
      };
      localStorage.setItem('gf_restaurant_config', JSON.stringify(baseCfg));

      const badKeyRes = await store.updateRestaurantConfigAsync({
        ...baseCfg,
        pixKeyType: 'CPF',
        pixKey: '111.111.111-11',
      });
      assert.strictEqual(badKeyRes.success, false);
      assert.strictEqual(store.getRestaurantConfig().pixKey, baseCfg.pixKey, 'Chave anterior deve ser preservada quando validação falha');

      // Salvamento válido normaliza TELEFONE -> +5583991234567, preserva rodapé e dispara CONFIG_UPDATED
      dispatchedEvents.length = 0;
      const okSave = await store.updateRestaurantConfigAsync({
        ...baseCfg,
        pixKeyType: 'TELEFONE',
        pixKey: '(83) 99123-4567',
        pixReceiverName: 'Amandita Sabores',
        pixReceiverCity: 'João Pessoa',
      });
      assert.strictEqual(okSave.success, true);
      assert.strictEqual(okSave.localOnly, true);
      const savedCfg = store.getRestaurantConfig();
      assert.strictEqual(savedCfg.pixKey, '+5583991234567');
      assert.strictEqual(savedCfg.pixReceiverCity, 'JOAO PESSOA');
      assert.strictEqual(savedCfg.receiptFooterText, 'Rodapé personalizado preservado!');
      assert.strictEqual(savedCfg.defaultDeliveryPersonId, 'driver-keep-1');
      assert(
        dispatchedEvents.some((e) => e.type === 'gestaofood_state_changed' && (e.detail as any)?.type === 'CONFIG_UPDATED'),
        'Evento CONFIG_UPDATED deve ser disparado'
      );

      // Novo pedido PIX criado pelo cardápio/PDV deve gerar Copia e Cola com a nova chave + valor exato
      const created = store.createOrder(
        {
          fulfillmentType: 'DELIVERY',
          estimatedDeliveryMinutes: 45,
          customer: { name: 'Maria PIX', phone: '83988887777' },
          items: [{ id: 'it-1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 2, unitPrice: 14, subtotal: 28 }],
          subtotal: 28,
          deliveryFee: 5,
          discount: 0,
          totalAmount: 33,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
        },
        false
      );
      assert(created.pixCode?.includes('+5583991234567'), 'Pedido novo deve usar nova chave PIX imediatamente');
      assert(created.pixCode?.includes('540533.00'), 'Pedido novo deve embutir valor exato 33.00 no BR Code');
      assert(created.pixCode?.includes('JOAO PESSOA'), 'Pedido novo deve usar nova cidade recebedora');
      assert(created.pixTxId && created.pixTxId.length >= 2, 'Pedido PIX deve persistir pixTxId');
      assert.strictEqual(created.paymentStatus, 'PENDENTE', 'Gerar PIX não pode marcar pedido como PAGO automaticamente');

      // Pedido com adicionais + taxa de entrega - desconto -> valor final exato no BR Code
      const createdWithDiscount = store.createOrder(
        {
          fulfillmentType: 'DELIVERY',
          estimatedDeliveryMinutes: 45,
          customer: { name: 'Carlos PIX', phone: '83988886666' },
          items: [
            {
              id: 'it-2',
              menuItemId: 'cuscuz-carne-sol-queijo',
              name: 'Cuscuz',
              quantity: 2,
              unitPrice: 17, // 14 + 3 adicional
              addons: [{ id: 'ad-ovo', name: 'Ovo', price: 3 }],
              subtotal: 34,
            },
          ],
          subtotal: 34,
          deliveryFee: 5,
          discount: 4.5,
          totalAmount: 34.5,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
        },
        false
      );
      const createdAudit = validatePixPayload(createdWithDiscount.pixCode || '');
      assert.strictEqual(createdAudit.valid, true, `BR Code do pedido inválido: ${createdAudit.error}`);
      assert.strictEqual(createdAudit.amount, '34.50', 'BR Code deve refletir subtotal + taxa - desconto');
      assert.strictEqual(createdAudit.txId, createdWithDiscount.pixTxId, 'TXID do BR Code deve coincidir com o salvo no pedido');
      assert.notStrictEqual(createdWithDiscount.pixTxId, created.pixTxId, 'Pedidos distintos devem gerar TXIDs distintos');

      // Confirmação manual altera de PENDENTE -> PAGO
      const manuallyConfirmed = store.updatePaymentStatus(createdWithDiscount.id, 'PAGO', 'Caixa', 'Conferido no banco');
      assert.strictEqual(manuallyConfirmed?.paymentStatus, 'PAGO');
    });

    // 5. Server HTTP PATCH updateMask.fieldPaths & 403 error propagation
    await check('5. Server REST PATCH updateMask.fieldPaths + tratamento explícito de 403 em status/assign-driver/delete', async () => {
      const orderId = `ord-mask-${Date.now()}`;
      const now = new Date().toISOString();
      simFirestore.orders[orderId] = {
        id: orderId,
        orderNumber: '#7701',
        createdAt: now,
        updatedAt: now,
        fulfillmentType: 'DELIVERY',
        customer: { name: 'João Teste', phone: '83999990000' },
        items: [{ id: 'i1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 14, subtotal: 14 }],
        subtotal: 14,
        deliveryFee: 5,
        discount: 0,
        totalAmount: 19,
        paymentMethod: 'DINHEIRO',
        paymentStatus: 'PENDENTE',
        status: 'NOVO',
        trackingCode: 'tk_mask_test_12345678901234567890',
        movements: [{ id: 'm1', timestamp: now, toStatus: 'NOVO', author: 'Sistema' }],
      };

      capturedRestRequests.length = 0;
      const statusRes = await realFetch(`${expressBaseUrl}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-cozinha' },
        body: JSON.stringify({ status: 'EM_PREPARO', author: 'Cozinha' }),
      });
      assert.strictEqual(statusRes.status, 200);
      const orderPatch = capturedRestRequests.find(
        (r) => r.method === 'PATCH' && r.url.includes(`/orders/${orderId}?`)
      );
      assert(orderPatch, 'PATCH /orders/{id} deve incluir query string updateMask');
      assert(
        orderPatch!.url.includes('updateMask.fieldPaths=status') &&
          orderPatch!.url.includes('updateMask.fieldPaths=updatedAt') &&
          orderPatch!.url.includes('updateMask.fieldPaths=movements'),
        `updateMask inesperado: ${orderPatch!.url}`
      );

      // assign-driver também deve usar updateMask.fieldPaths
      capturedRestRequests.length = 0;
      const assignRes = await realFetch(`${expressBaseUrl}/api/orders/${orderId}/assign-driver`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-gerente' },
        body: JSON.stringify({
          deliveryPerson: { id: 'uid-entregador', name: 'Carlos Moto', phone: '83988881111' },
        }),
      });
      assert.strictEqual(assignRes.status, 200);
      const assignPatch = capturedRestRequests.find(
        (r) => r.method === 'PATCH' && r.url.includes(`/orders/${orderId}?`)
      );
      assert(
        assignPatch && assignPatch.url.includes('updateMask.fieldPaths=deliveryPerson'),
        'PATCH assign-driver deve usar updateMask.fieldPaths'
      );

      // Quando Firestore REST retorna 403, backend deve propagar 403 e NÃO apagar o pedido
      forceFirestore403 = true;
      const delDenied = await realFetch(`${expressBaseUrl}/api/orders/${orderId}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer tok-admin' },
      });
      forceFirestore403 = false;
      assert.strictEqual(delDenied.status, 403);
      assert(simFirestore.orders[orderId], 'Pedido não pode desaparecer quando Firestore nega exclusão');

      // Exclusão autorizada com sucesso
      const delOk = await realFetch(`${expressBaseUrl}/api/orders/${orderId}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer tok-admin' },
      });
      assert.strictEqual(delOk.status, 200);
      assert.strictEqual(simFirestore.orders[orderId], undefined);
      assert(simFirestore.order_tombstones[orderId], 'Tombstone gravado após exclusão confirmada');
    });

    // 6. Firebase-configured mode without active Firebase Auth session -> zero silent fallback
    await check('6. Firebase configurado: falha no Auth NÃO cai para senha local e operações rejeitam sem auth.currentUser', () => {
      const child = spawnSync(
        process.execPath,
        [...process.execArgv, path.resolve(process.cwd(), 'scripts/verify_auth_pix_orders.ts'), '--firebase-mode'],
        { encoding: 'utf8' }
      );
      assert.strictEqual(
        child.status,
        0,
        `Subprocesso --firebase-mode falhou (${child.status}):\n${child.stdout}\n${child.stderr}`
      );
    });

    // 7. ATENDENTE manual PIX confirmation + scoped cash sale append + denial of general cash operations
    await check('7. ATENDENTE: confirma PIX manualmente e registra VENDA no caixa, sem acesso geral a turnos/sangria/exclusão', async () => {
      await store.login('atendente', '123456');
      assert.strictEqual(store.canUserConfirmPayments(), true, 'ATENDENTE deve poder confirmar pagamentos manualmente');
      assert.strictEqual(store.canUserManageCash(), false, 'ATENDENTE NÃO pode gerenciar caixa geral');
      assert.strictEqual(store.openCashRegister(200, 'Atendente'), null, 'ATENDENTE não pode abrir caixa');
      assert.strictEqual(store.closeCashRegister(200, 'Atendente'), null, 'ATENDENTE não pode fechar caixa');
      assert.strictEqual(store.addCashMovement('SANGRIA', 50, 'Teste', 'Atendente'), null, 'ATENDENTE não pode fazer sangria');
      assert.strictEqual(store.adjustDrawerBalance(100, 'Teste', 'Atendente'), null, 'ATENDENTE não pode ajustar gaveta');
      assert.strictEqual(store.deleteCashMovement('mov-cash-1'), false, 'ATENDENTE não pode excluir movimentação');

      const pixOrder = store.createOrder(
        {
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 15,
          customer: { name: 'Ana Atendente PIX', phone: '83991112222' },
          items: [{ id: 'it-att', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 18.5, subtotal: 18.5 }],
          subtotal: 18.5,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 18.5,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
        },
        false
      );
      assert.strictEqual(pixOrder.paymentStatus, 'PENDENTE');

      // Confirmação manual pelo ATENDENTE deve marcar PAGO e gravar movimento VENDA no turno aberto
      const confirmRes = await store.updatePaymentStatusAsync(pixOrder.id, 'PAGO', 'Atendente', 'Conferido no app do banco');
      assert.strictEqual(confirmRes.rejected, undefined, `Erro inesperado ao confirmar: ${confirmRes.error}`);
      assert.strictEqual(store.getOrderById(pixOrder.id)?.paymentStatus, 'PAGO');
      const shiftAfter = store.getCurrentCashShift();
      const recordedMov = shiftAfter?.movements.find((m) => m.orderId === pixOrder.id && m.type === 'VENDA');
      assert(recordedMov, 'Movimentação VENDA deve ser gravada no caixa após confirmação do ATENDENTE');
      assert.strictEqual(recordedMov!.amount, 18.5);

      // Falha financeira (turno FECHADO) NÃO pode ser ignorada e deve manter paymentStatus como PENDENTE
      const pixOrderFail = store.createOrder(
        {
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 15,
          customer: { name: 'Falha Caixa', phone: '83991113333' },
          items: [{ id: 'it-fail', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 22.0, subtotal: 22.0 }],
          subtotal: 22.0,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 22.0,
          paymentMethod: 'PIX',
          paymentStatus: 'PENDENTE',
        },
        false
      );
      const closedMockShift = { ...shiftAfter!, status: 'FECHADO' as const };
      localStorage.setItem('gf_current_cash_shift', JSON.stringify(closedMockShift));
      const failRes = await store.updatePaymentStatusAsync(pixOrderFail.id, 'PAGO', 'Atendente');
      assert.strictEqual(failRes.rejected, true, 'Confirmação deve ser rejeitada quando caixa está FECHADO');
      assert.strictEqual(store.getOrderById(pixOrderFail.id)?.paymentStatus, 'PENDENTE', 'paymentStatus deve permanecer PENDENTE quando gravação financeira falhar');

      // Restaurar turno ABERTO e verificar endpoints HTTP reais:
      // 1) POST /api/cash-shifts -> 403 para ATENDENTE
      // 2) Sem Firebase Admin SDK, /api/orders/:id/confirm-payment e /api/cash-shifts/record-sale falham de forma segura com 503 ADMIN_SDK_UNAVAILABLE (zero fallback REST não atômico)
      localStorage.setItem('gf_current_cash_shift', JSON.stringify(shiftAfter));
      const generalCashHttp = await realFetch(`${expressBaseUrl}/api/cash-shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-atendente' },
        body: JSON.stringify({ shift: { id: 'shift-intrusion', status: 'ABERTO', openedAt: new Date().toISOString(), openedBy: 'atendente', initialBalance: 0, movements: [] } }),
      });
      assert.strictEqual(generalCashHttp.status, 403, 'ATENDENTE deve receber 403 em POST /api/cash-shifts');

      const remoteOrderId = `ord-att-remote-${Date.now()}`;
      capturedRestRequests.length = 0;

      const confirmWithoutAdminRes = await realFetch(`${expressBaseUrl}/api/orders/${remoteOrderId}/confirm-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-atendente' },
        body: JSON.stringify({ author: 'Atendente Balcão' }),
      });
      assert.strictEqual(confirmWithoutAdminRes.status, 503, 'Sem Admin SDK, /confirm-payment deve recusar com 503 seguro');
      const confirmWithoutAdminData = await confirmWithoutAdminRes.json();
      assert.strictEqual(confirmWithoutAdminData.code, 'ADMIN_SDK_UNAVAILABLE');

      const recordWithoutAdminRes = await realFetch(`${expressBaseUrl}/api/cash-shifts/record-sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-atendente' },
        body: JSON.stringify({ orderId: remoteOrderId, author: 'Atendente Balcão' }),
      });
      assert.strictEqual(recordWithoutAdminRes.status, 503, 'Sem Admin SDK, /record-sale deve recusar com 503 sem fallback REST');
      const recordWithoutAdminData = await recordWithoutAdminRes.json();
      assert.strictEqual(recordWithoutAdminData.code, 'ADMIN_SDK_UNAVAILABLE');
      assert.strictEqual(
        capturedRestRequests.some((r) => r.method === 'PATCH' && r.url.includes('/cash_shifts/')),
        false,
        'Nunca deve executar PATCH REST em cash_shifts sem transação atômica Admin SDK'
      );
    });

    // 8. ENTREGADOR cannot confirm payment or write cash_shifts + firestore.rules lock verification
    await check('8. ENTREGADOR bloqueado de alterar paymentStatus (Store, Server e Firestore Rules)', async () => {
      await store.login('entregador', '123456');
      assert.strictEqual(store.canUserConfirmPayments(), false, 'ENTREGADOR não pode confirmar pagamentos');
      assert.strictEqual(store.canUserManageCash(), false, 'ENTREGADOR não pode gerenciar caixa');

      const orderId = `ord-drv-lock-${Date.now()}`;
      const now = new Date().toISOString();
      simFirestore.orders[orderId] = {
        id: orderId,
        orderNumber: '#8802',
        createdAt: now,
        updatedAt: now,
        fulfillmentType: 'DELIVERY',
        customer: { name: 'Cliente Lock', phone: '83988880000' },
        items: [{ id: 'i1', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 1, unitPrice: 20, subtotal: 20 }],
        subtotal: 20,
        deliveryFee: 5,
        discount: 0,
        totalAmount: 25,
        paymentMethod: 'PIX',
        paymentStatus: 'PENDENTE',
        status: 'PRONTO',
        trackingCode: 'tk_drv_lock_test_1234567890123456',
        movements: [{ id: 'm1', timestamp: now, toStatus: 'PRONTO', author: 'Cozinha' }],
      };

      const driverAttempt = await realFetch(`${expressBaseUrl}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-entregador' },
        body: JSON.stringify({ status: 'ENTREGUE', paymentStatus: 'PAGO', author: 'Entregador' }),
      });
      assert.strictEqual(driverAttempt.status, 403, 'ENTREGADOR ou qualquer papel tentando mudar paymentStatus via /status deve receber 403');
      assert.strictEqual(simFirestore.orders[orderId].paymentStatus, 'PENDENTE');

      // Verificar presença literal das travas endurecidas em firestore.rules
      const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
      assert(rulesContent.includes('data.paymentStatus == prev.paymentStatus'), 'firestore.rules deve bloquear Client SDK de alterar paymentStatus');
      assert(rulesContent.includes('isCashManager()'), 'firestore.rules deve restringir escrita em cash_shifts a isCashManager()');
      assert(!rulesContent.includes('isValidAttendantSaleAppend'), 'firestore.rules não deve permitir escrita direta de ATENDENTE em cash_shifts');
      assert(!rulesContent.includes('isValidAttendantSaleMovement'), 'firestore.rules não deve conter regra antiga de append em cash_shifts');
      assert(!rulesContent.includes('isValidAttendantSaleOrderMatch'), 'firestore.rules não deve conter regra antiga de append por pedido em cash_shifts');
    });

    // 9. Unified PDV PIX payload parity + 2-decimal rounding without float drift
    await check('9. Paridade 100% PDV Preview vs Pedido salvo + arredondamento financeiro exato', async () => {
      await store.login('admin', '123456');
      const cfg = store.getRestaurantConfig();
      const pdvTxId = generateOrderPixTxId('PDV', '999888777');
      const rawSubtotal = 0.1 + 0.2 + 19.99 * 3; // 60.27 with IEEE 754 float noise (60.269999999999996)
      const rawDiscount = (rawSubtotal * 10) / 100; // 6.026999999999999 -> 6.03
      const rawDelivery = 4.99;
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      const roundedSubtotal = round2(rawSubtotal);
      const roundedDiscount = round2(rawDiscount);
      const expectedTotal = round2(roundedSubtotal - roundedDiscount + rawDelivery); // 60.27 - 6.03 + 4.99 = 59.23

      const previewPix = generatePurchasePixPayload({
        pixKey: cfg.pixKey,
        keyType: cfg.pixKeyType,
        receiverName: cfg.pixReceiverName,
        receiverCity: cfg.pixReceiverCity,
        storeName: cfg.name,
        amount: expectedTotal,
        txId: pdvTxId,
        description: 'Venda PDV Amandita',
      });
      if (!previewPix.success) throw new Error(previewPix.error);

      const persistedPdvOrder = store.createOrder(
        {
          fulfillmentType: 'DELIVERY',
          estimatedDeliveryMinutes: 30,
          customer: { name: 'Paridade PDV', phone: '83999995555' },
          items: [{ id: 'it-par', menuItemId: 'cuscuz-carne-sol-queijo', name: 'Cuscuz', quantity: 3, unitPrice: 19.99, subtotal: rawSubtotal }],
          subtotal: rawSubtotal,
          deliveryFee: rawDelivery,
          discount: rawDiscount,
          totalAmount: round2(rawSubtotal - rawDiscount + rawDelivery),
          paymentMethod: 'PIX',
          pixCode: previewPix.payload,
          pixTxId: pdvTxId,
          pixDescription: 'Venda PDV Amandita',
          paymentStatus: 'PENDENTE',
        },
        false
      );

      assert.strictEqual(persistedPdvOrder.subtotal, roundedSubtotal);
      assert.strictEqual(persistedPdvOrder.discount, roundedDiscount);
      assert.strictEqual(persistedPdvOrder.totalAmount, expectedTotal, 'Total do pedido não pode ter imprecisão de ponto flutuante');
      assert.strictEqual(persistedPdvOrder.pixCode, previewPix.payload, 'Payload Copia e Cola do pedido salvo deve ser 100% idêntico ao preview do PDV (incluindo Campo 26.02 e CRC16)');
      assert.strictEqual(persistedPdvOrder.pixTxId, pdvTxId);
      assert.strictEqual(persistedPdvOrder.paymentStatus, 'PENDENTE', 'Gerar QR Code no PDV não pode marcar pedido como PAGO');

      const audit = validatePixPayload(persistedPdvOrder.pixCode || '');
      assert.strictEqual(audit.valid, true);
      assert.strictEqual(audit.amount, expectedTotal.toFixed(2));
      assert.strictEqual(audit.merchantAccountInfo?.['02'], 'Venda PDV Amandita');
    });

    // 10. Etapa 2: UTF-8 TLV lengths, multibyte CRC16, >99 bytes rejection & duplicate TLV tags
    await check('10. BR Code UTF-8: comprimento TLV em bytes, CRC16 multibyte, rejeição > 99 bytes e tags duplicadas', () => {
      // 1) Comprimento TLV em bytes UTF-8
      assert.strictEqual(getUtf8ByteLength('João'), 5, 'João tem 4 chars UTF-16 mas 5 bytes UTF-8');
      assert.strictEqual(formatField('59', 'João'), '5905João', 'TLV deve usar comprimento 05 em bytes UTF-8');

      // 2) CRC16 sobre conteúdo ASCII e multibyte UTF-8
      assert.strictEqual(calculateCRC16('123456789'), '29B1', 'Vetor padrão CRC16-CCITT-FALSE para ASCII 123456789 deve ser 29B1');
      assert.notStrictEqual(
        calculateCRC16('5905João'),
        calculateCRC16('5905Joao'),
        'CRC16 deve variar entre UTF-8 multibyte e ASCII'
      );
      const utf8TlvPayload =
        formatField('00', '01') +
        formatField('01', '11') +
        formatField('26', formatField('00', 'br.gov.bcb.pix') + formatField('01', 'pix@amandita.com')) +
        formatField('52', '0000') +
        formatField('53', '986') +
        formatField('54', '10.50') +
        formatField('58', 'BR') +
        formatField('59', 'Padaria João') +
        formatField('60', 'São Paulo') +
        formatField('62', formatField('05', 'UTF8TEST')) +
        '6304';
      const fullUtf8Payload = `${utf8TlvPayload}${calculateCRC16(utf8TlvPayload)}`;
      const utf8Audit = validatePixPayload(fullUtf8Payload);
      assert.strictEqual(utf8Audit.valid, true, `Payload UTF-8 válido falhou: ${utf8Audit.error}`);
      assert.strictEqual(utf8Audit.receiverName, 'Padaria João');
      assert.strictEqual(utf8Audit.receiverCity, 'São Paulo');

      // 3) Rejeitar campo TLV acima de 99 bytes
      assert.throws(
        () => formatField('02', 'A'.repeat(100)),
        /99 bytes/,
        'formatField deve rejeitar valor com > 99 bytes'
      );
      assert.throws(
        () => formatField('02', 'é'.repeat(50)), // 50 chars = 100 UTF-8 bytes!
        /99 bytes/,
        'formatField deve rejeitar valor multibyte com > 99 bytes UTF-8'
      );

      // 4) Detectar tags TLV duplicadas (raiz e subcampo)
      const bodyWithDupTag =
        formatField('00', '01') +
        formatField('01', '11') +
        formatField('26', formatField('00', 'br.gov.bcb.pix') + formatField('01', 'pix@amandita.com')) +
        formatField('52', '0000') +
        formatField('53', '986') +
        formatField('54', '10.00') +
        formatField('54', '99.00') + // tag duplicada!
        formatField('58', 'BR') +
        formatField('59', 'AMANDITA') +
        formatField('60', 'CAMPINA') +
        formatField('62', formatField('05', 'DUP1')) +
        '6304';
      const dupPayload = `${bodyWithDupTag}${calculateCRC16(bodyWithDupTag)}`;
      const dupAudit = validatePixPayload(dupPayload);
      assert.strictEqual(dupAudit.valid, false, 'Tag TLV 54 duplicada deve ser rejeitada');
      assert(dupAudit.error?.includes('duplicada'));

      const parsedNestedDup = parseTLVFields(
        formatField('00', 'br.gov.bcb.pix') + formatField('01', 'a@b.com') + formatField('01', 'c@d.com')
      );
      assert.strictEqual(parsedNestedDup.valid, false, 'Subtag duplicada dentro do Campo 26 deve ser rejeitada');
    });

    // 11. Etapa 2: Acentos/caracteres especiais, todos os 5 tipos de chave e validação de e-mail ASCII
    await check('11. Chaves PIX (5 tipos) + acentos/caracteres especiais + rejeição de recebedor/cidade/chave inválidos', () => {
      // Todos os 5 tipos com recebedor/cidade/descrição acentuados
      const allFiveKeys: Array<{ type: 'TELEFONE' | 'CPF' | 'CNPJ' | 'EMAIL' | 'ALEATORIA'; key: string }> = [
        { type: 'TELEFONE', key: '(83) 99123-4567' },
        { type: 'CPF', key: '529.982.247-25' },
        { type: 'CNPJ', key: '11.222.333/0001-81' },
        { type: 'EMAIL', key: 'vendas@amanditasabores.com.br' },
        { type: 'ALEATORIA', key: '123e4567-e89b-12d3-a456-426614174000' },
      ];

      for (const sample of allFiveKeys) {
        const res = generatePurchasePixPayload({
          pixKey: sample.key,
          keyType: sample.type,
          receiverName: 'São João & Cia — Café D’Ávila!',
          receiverCity: 'João Pessoa/PB',
          amount: 19.9,
          txId: `TX${sample.type}`,
          description: 'Cuscuz nº 1 — Promoção!',
        });
        assert.strictEqual(res.success, true, `Falha no tipo ${sample.type}: ${res.success ? '' : res.error}`);
        if (res.success) {
          const audit = validatePixPayload(res.payload);
          assert.strictEqual(audit.valid, true, `Payload inválido para ${sample.type}: ${audit.error}`);
          assert.strictEqual(audit.amount, '19.90');
          assert.strictEqual(audit.receiverName, 'SAO JOAO CIA CAFE D AVILA'.slice(0, 25).trim());
          assert.strictEqual(audit.receiverCity, 'JOAO PESSOA PB');
        }
      }

      // E-mail com acento ou espaço não é aceito pelo padrão PIX/BACEN
      assert.strictEqual(validatePixKey('josé@domínio.com', 'EMAIL').valid, false);
      assert.strictEqual(validatePixKey('joao silva@dominio.com', 'EMAIL').valid, false);

      // Rejeição sem fallback quando recebedor, cidade ou chave são inválidos
      const missingName = generatePurchasePixPayload({
        pixKey: 'vendas@amandita.com',
        keyType: 'EMAIL',
        receiverName: '',
        receiverCity: 'Campina Grande',
        storeName: 'Loja Ignorada',
        amount: 25,
      });
      assert.strictEqual(missingName.success, false, 'Não pode usar fallback quando receiverName está vazio');

      const missingCity = generatePurchasePixPayload({
        pixKey: 'vendas@amandita.com',
        keyType: 'EMAIL',
        receiverName: 'Amandita Sabores',
        receiverCity: '',
        amount: 25,
      });
      assert.strictEqual(missingCity.success, false, 'Não pode usar fallback quando receiverCity está vazio');

      assert.throws(() =>
        generatePixCopiaECola({
          pixKey: 'vendas@amandita.com',
          keyType: 'EMAIL',
          receiverName: 'A', // < 2 chars
          receiverCity: 'Campina Grande',
          amount: 25,
        })
      );

      // Telefone sem pixKeyType nunca cai para EMAIL
      assert.strictEqual(inferPixKeyType('(83) 99123-4567'), 'TELEFONE');
    });

    // 12. Etapa 2: Valores monetários exatos e inválidos (0.01, 1.005, 10.50, 1999.99, 0, negativo, NaN)
    await check('12. Valores monetários: 0.01, 1.005->1.01, 10.50, 1999.99 e rejeição de 0, negativo, NaN', () => {
      const validCases: Array<[number, string]> = [
        [0.01, '0.01'],
        [1.005, '1.01'],
        [10.5, '10.50'],
        [1999.99, '1999.99'],
      ];
      for (const [amount, expectedStr] of validCases) {
        const res = generatePurchasePixPayload({
          pixKey: '11222333000181',
          keyType: 'CNPJ',
          receiverName: 'Amandita Sabores',
          receiverCity: 'Campina Grande',
          amount,
          txId: 'VALTEST',
        });
        assert.strictEqual(res.success, true, `Valor ${amount} deve gerar payload válido`);
        if (res.success) {
          const audit = validatePixPayload(res.payload);
          assert.strictEqual(audit.valid, true);
          assert.strictEqual(audit.amount, expectedStr, `Valor ${amount} deve gerar Campo 54 = ${expectedStr}`);
        }
      }

      for (const invalidAmount of [0, -1, -0.01, Number.NaN, Infinity]) {
        const badRes = generatePurchasePixPayload({
          pixKey: '11222333000181',
          keyType: 'CNPJ',
          receiverName: 'Amandita Sabores',
          receiverCity: 'Campina Grande',
          amount: invalidAmount,
        });
        assert.strictEqual(badRes.success, false, `Valor inválido ${invalidAmount} deve ser rejeitado`);
      }
    });

    // 13. Etapa 2: Erro explícito no QR Code + Bloqueio no PDV + StoreSettings sem fallback silencioso
    await check('13. QR Code: erro propagado sem string vazia + PDV bloqueia finalização preservando Copia e Cola', async () => {
      await assert.rejects(
        () => generateQRCodeDataUrl(''),
        /vazio|inválido/,
        'generateQRCodeDataUrl deve rejeitar com Error em vez de retornar string vazia'
      );

      const posCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/PointOfSale.tsx'), 'utf8');
      assert(posCode.includes("setPosPixQrError('Não foi possível gerar o QR Code PIX.')"));
      assert(posCode.includes('Boolean(posPixError) || !posPixCode'));
      assert(posCode.includes('{posPixCode && ('), 'PDV deve preservar Copia e Cola válido quando QR falhar');

      const settingsCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/StoreSettings.tsx'), 'utf8');
      assert(settingsCode.includes('setTestQrError('), 'Simulador deve reportar erro explícito de QR');
      assert(!settingsCode.includes('parseFloat(testAmount) || 1.00'), 'Simulador não deve mascarar 0/NaN como 1.00');

      const menuCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/menu/CustomerMenu.tsx'), 'utf8');
      assert(menuCode.includes('setPixQrError('), 'Cardápio público deve exibir aviso caso imagem do QR falhe');
      assert(menuCode.includes('pixPrecheck'), 'Cardápio público deve pré-validar geração PIX antes de enviar pedido');
    });

    // 14. Etapa 2: Servidor valida config PIX (/api/store/schedule) e payload PIX (/api/orders)
    await check('14. Servidor: /api/store/schedule e /api/orders rejeitam config/BR Code adulterado e mantêm PIX PENDENTE', async () => {
      // 14a) /api/store/schedule rejeita chave inválida e recebedor inválido
      const badScheduleKeyRes = await realFetch(`${expressBaseUrl}/api/store/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-admin' },
        body: JSON.stringify({
          operatingHours: [],
          closedPrimaryMessage: 'Fechado',
          restaurantConfig: {
            name: 'Amandita Sabores',
            whatsapp: '5583991234567',
            pixKey: '111.111.111-11',
            pixKeyType: 'CPF',
            pixReceiverName: 'Amandita Sabores',
            pixReceiverCity: 'Campina Grande',
          },
        }),
      });
      assert.strictEqual(badScheduleKeyRes.status, 400, 'CPF inválido deve ser rejeitado em /api/store/schedule');

      const badScheduleReceiverRes = await realFetch(`${expressBaseUrl}/api/store/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-admin' },
        body: JSON.stringify({
          operatingHours: [],
          closedPrimaryMessage: 'Fechado',
          restaurantConfig: {
            name: 'Amandita Sabores',
            whatsapp: '5583991234567',
            pixKey: '(83) 99123-4567',
            // omit pixKeyType: servidor deve inferir TELEFONE, mas rejeitar cidade vazia
            pixReceiverName: 'Amandita Sabores',
            pixReceiverCity: '',
          },
        }),
      });
      assert.strictEqual(badScheduleReceiverRes.status, 400, 'Cidade recebedora vazia deve ser rejeitada no servidor');

      // 14b) /api/orders rejeita código PIX adulterado ou com valor divergente
      const validOrderPix = generatePurchasePixPayload({
        pixKey: '(83) 99123-4567',
        keyType: 'TELEFONE',
        receiverName: 'Amandita Sabores',
        receiverCity: 'Campina Grande',
        amount: 14.0,
        txId: 'ORDPIXVALID1',
      });
      if (!validOrderPix.success) throw new Error(validOrderPix.error);

      // Valor divergente (BR Code válido para R$ 1.00 em pedido de R$ 14.00)
      const mismatchedAmountPix = generatePurchasePixPayload({
        pixKey: '(83) 99123-4567',
        keyType: 'TELEFONE',
        receiverName: 'Amandita Sabores',
        receiverCity: 'Campina Grande',
        amount: 1.0,
        txId: 'ORDPIXMISMATCH1',
      });
      if (!mismatchedAmountPix.success) throw new Error(mismatchedAmountPix.error);

      const baseHttpOrder = {
        id: `ord-srv-pix-${Date.now()}`,
        orderNumber: '#9010',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fulfillmentType: 'RETIRADA',
        status: 'NOVO',
        paymentStatus: 'PENDENTE',
        paymentMethod: 'PIX',
        customer: { name: 'Cliente Server PIX', phone: '83991234567' },
        items: [
          {
            id: 'it-srv-1',
            menuItemId: 'cuscuz-carne-sol-queijo',
            name: 'Cuscuz',
            quantity: 1,
            unitPrice: 14.0,
            subtotal: 14.0,
          },
        ],
        subtotal: 14.0,
        deliveryFee: 0,
        discount: 0,
        totalAmount: 14.0,
        trackingCode: 'tk_srv_pix_validation_12345678901234',
      };

      // Tampered CRC16 must return 400 even without staff auth (validated before persistence)
      const badCrcRes = await realFetch(`${expressBaseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order: {
            ...baseHttpOrder,
            id: `${baseHttpOrder.id}-badcrc`,
            pixCode: `${validOrderPix.payload.slice(0, -4)}0000`,
            pixTxId: 'ORDPIXVALID1',
          },
        }),
      });
      assert.strictEqual(badCrcRes.status, 400, 'BR Code com CRC16 adulterado deve ser rejeitado com 400');

      const mismatchRes = await realFetch(`${expressBaseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-atendente' },
        body: JSON.stringify({
          order: {
            ...baseHttpOrder,
            id: `${baseHttpOrder.id}-mismatch`,
            pixCode: mismatchedAmountPix.payload,
            pixTxId: 'ORDPIXMISMATCH1',
          },
        }),
      });
      assert.strictEqual(mismatchRes.status, 400, 'BR Code com valor divergente do pedido deve ser rejeitado com 400');

      // Código PIX íntegro (staff PDV/Atendente) persiste e mantém pagamento PENDENTE (sem confirmação automática)
      const validHttpRes = await realFetch(`${expressBaseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-atendente' },
        body: JSON.stringify({
          order: {
            ...baseHttpOrder,
            id: `${baseHttpOrder.id}-ok`,
            pixCode: validOrderPix.payload,
            pixTxId: 'ORDPIXVALID1',
          },
        }),
      });
      assert.strictEqual(validHttpRes.status, 200, 'Pedido PIX válido deve ser persistido com sucesso');
      const validHttpBody = await validHttpRes.json();
      assert.strictEqual(validHttpBody.order.paymentStatus, 'PENDENTE', 'Pedido PIX deve permanecer PENDENTE até conferência manual');
    });

    // 15. Etapa 2: Não regressão de Dinheiro, Cartão e Fluxo de Caixa (abrir, movimentar, fechar)
    await check('15. Não regressão: Dinheiro e Cartão + abertura, movimentação e fechamento de caixa intactos', async () => {
      await store.login('caixa', '123456');

      // Reset shift para testar abertura -> movimentação -> venda Dinheiro/Cartão -> fechamento
      localStorage.setItem('gf_current_cash_shift', 'null');
      const openedShift = store.openCashRegister(100, 'Operador Caixa');
      assert(openedShift && openedShift.status === 'ABERTO', 'Abertura de caixa deve funcionar normalmente');

      const suprimento = store.addCashMovement('SUPRIMENTO', 50, 'Troco inicial', 'Operador Caixa');
      assert(suprimento && suprimento.amount === 50, 'Movimentação SUPRIMENTO no caixa deve funcionar normalmente');

      const cashRes = await store.createAndConfirmPaidOrderAsync(
        {
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 15,
          customer: { name: 'Cliente Dinheiro', phone: '83990001111' },
          items: [{ id: 'it-cash', menuItemId: 'cuscuz-manteiga', name: 'Cuscuz com manteiga', quantity: 2, unitPrice: 5, subtotal: 10 }],
          subtotal: 10,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 10,
          paymentMethod: 'DINHEIRO',
          paymentStatus: 'PAGO',
        },
        'Operador Caixa'
      );
      assert(cashRes.order, 'Venda em Dinheiro deve ser criada');
      assert.strictEqual(cashRes.order!.paymentMethod, 'DINHEIRO');
      assert.strictEqual(cashRes.order!.paymentStatus, 'PAGO');
      assert.strictEqual(cashRes.order!.pixCode, undefined);

      const cardRes = await store.createAndConfirmPaidOrderAsync(
        {
          fulfillmentType: 'RETIRADA',
          estimatedDeliveryMinutes: 15,
          customer: { name: 'Cliente Cartão', phone: '83990002222' },
          items: [{ id: 'it-card', menuItemId: 'cuscuz-manteiga', name: 'Cuscuz com manteiga', quantity: 3, unitPrice: 5, subtotal: 15 }],
          subtotal: 15,
          deliveryFee: 0,
          discount: 0,
          totalAmount: 15,
          paymentMethod: 'CARTAO_CREDITO',
          paymentStatus: 'PAGO',
        },
        'Operador Caixa'
      );
      assert(cardRes.order, 'Venda em Cartão deve ser criada');
      assert.strictEqual(cardRes.order!.paymentMethod, 'CARTAO_CREDITO');
      assert.strictEqual(cardRes.order!.paymentStatus, 'PAGO');
      assert.strictEqual(cardRes.order!.pixCode, undefined);

      // Dinheiro: 100 abertura + 50 suprimento + 10 venda em dinheiro = 160 esperado em espécie (cartão não soma gaveta)
      const closedShift = store.closeCashRegister(160, 'Operador Caixa', 'Conferido');
      assert(closedShift && closedShift.status === 'FECHADO', 'Fechamento de caixa deve funcionar normalmente');
      assert.strictEqual(closedShift!.finalCalculatedBalance, 160);
      assert.strictEqual(closedShift!.difference, 0);
    });

    console.log(`\n============================================================`);
    console.log(`RESULTADO: ${passed}/${total} VERIFICAÇÕES APROVADAS.`);
    console.log(`============================================================`);
  } finally {
    server.close();
    if (hadExistingTombstoneFile && existingTombstoneBackup !== null) {
      fs.writeFileSync(tmpTombstonePath, existingTombstoneBackup, 'utf8');
    } else if (fs.existsSync(tmpTombstonePath)) {
      fs.unlinkSync(tmpTombstonePath);
    }
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('Erro na verificação:', err);
  process.exit(1);
});
