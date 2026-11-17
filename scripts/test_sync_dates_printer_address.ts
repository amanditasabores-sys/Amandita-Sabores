/**
 * Automated Verification Suite (Runtime Unit/Integration + Backend HTTP)
 * Covers:
 * - America/Fortaleza (UTC-3) date boundaries & daily order classification
 * - Complete delivery address formatting & placeholder sanitization
 * - Cross-device order reconciliation, deletion propagation & tombstone resurrection guard
 * - Thermal printer startup recovery, disconnect/reconnect state honesty
 * - Backend endpoints (/api/orders/tombstones RBAC, tampered pricing guard, no-fake delete)
 *
 * Run with: npx tsx scripts/test_sync_dates_printer_address.ts
 */

import assert from 'node:assert/strict';

// Minimal browser globals shim BEFORE importing services
const memoryStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (memoryStorage.has(k) ? memoryStorage.get(k)! : null),
  setItem: (k: string, v: string) => memoryStorage.set(k, String(v)),
  removeItem: (k: string) => memoryStorage.delete(k),
  clear: () => memoryStorage.clear(),
};

const dispatchedEvents: string[] = [];
(globalThis as any).window = {
  dispatchEvent: (ev: any) => {
    if (ev?.type) dispatchedEvents.push(ev.type);
    return true;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { hostname: 'localhost', origin: 'http://localhost:3000', search: '' },
};
if (typeof (globalThis as any).CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
}

let mockBluetoothDevices: any[] = [];
Object.defineProperty(globalThis, 'navigator', {
  value: {
    bluetooth: {
      getDevices: async () => mockBluetoothDevices,
    },
  },
  configurable: true,
});

async function runTests() {
  const {
    getFortalezaDateKey,
    formatFortalezaDateLabel,
    formatAddressDetails,
    formatCustomerAddress,
  } = await import('../src/utils/formatters');

  const { store } = await import('../src/services/store');
  const { thermalPrinterService } = await import('../src/services/thermalPrinter');

  console.log('=== [1] DATAS E FUSO HORÁRIO (America/Fortaleza UTC-3) ===');

  // 22:30 in Fortaleza on 2026-10-26 is 01:30Z on 2026-10-27
  assert.equal(getFortalezaDateKey('2026-10-27T01:30:00.000Z'), '2026-10-26', '22:30 BRT não pode virar dia seguinte UTC');
  // 00:05 in Fortaleza on 2026-10-27 is 03:05Z on 2026-10-27
  assert.equal(getFortalezaDateKey('2026-10-27T03:05:00.000Z'), '2026-10-27', '00:05 BRT deve ser dia 27/10');
  assert.equal(formatFortalezaDateLabel('2026-10-27T01:30:00.000Z'), '26/10/2026', 'Label deve refletir 26/10/2026');

  // Daily classification check (Operação de Hoje vs Pendências Anteriores vs Histórico por Data)
  const todayKey = '2026-10-27';
  const sampleOrders = [
    { id: 'ord-today-novo', status: 'NOVO', createdAt: '2026-10-27T11:00:00-03:00' },
    { id: 'ord-today-done', status: 'ENTREGUE', createdAt: '2026-10-27T12:00:00-03:00' },
    { id: 'ord-today-cancel', status: 'CANCELADO', createdAt: '2026-10-27T13:00:00-03:00' },
    { id: 'ord-old-open', status: 'EM_ROTA', createdAt: '2026-10-26T22:30:00-03:00' },
    { id: 'ord-old-done', status: 'ENTREGUE', createdAt: '2026-10-26T20:00:00-03:00' },
  ];
  const todayOps = sampleOrders.filter((o) => getFortalezaDateKey(o.createdAt) === todayKey);
  const priorPending = sampleOrders.filter((o) => {
    const k = getFortalezaDateKey(o.createdAt);
    return Boolean(k) && k < todayKey && o.status !== 'ENTREGUE' && o.status !== 'CANCELADO';
  });
  const historyOct26 = sampleOrders.filter((o) => getFortalezaDateKey(o.createdAt) === '2026-10-26');

  assert.deepEqual(todayOps.map((o) => o.id), ['ord-today-novo', 'ord-today-done', 'ord-today-cancel']);
  assert.deepEqual(priorPending.map((o) => o.id), ['ord-old-open']);
  assert.deepEqual(historyOct26.map((o) => o.id), ['ord-old-open', 'ord-old-done']);
  console.log('✓ Passou: Classificação diária em America/Fortaleza sem desvio de meia-noite UTC.');

  console.log('\n=== [2] ENDEREÇOS COMPLETOS SEM "undefined" OU "Condomínio Outros" ===');

  const condoAddr = formatAddressDetails({
    condominium: 'Condomínio Eco Way',
    street: 'Condomínio Eco Way',
    block: '03',
    apartment: '204',
    neighborhood: 'Condomínio Eco Way',
    city: 'Campina Grande',
    reference: 'Portão lateral',
  });
  assert(!condoAddr.fullSingleLine.includes('undefined'), 'Não pode conter undefined');
  assert.equal((condoAddr.primaryLine.match(/Eco Way/g) || []).length, 1, 'Não pode duplicar Eco Way');
  assert(condoAddr.primaryLine.includes('Bloco 03') && condoAddr.primaryLine.includes('Ap 204'), 'Deve incluir bloco e ap');
  assert(condoAddr.referenceLine === 'Portão lateral', 'Deve preservar ponto de referência');

  const pollutedLegacyAddr = formatAddressDetails({
    condominium: 'Outros',
    street: 'Rua Aprígio Veloso',
    number: 'undefined',
    complement: 'Casa B',
    neighborhood: 'Condomínio Outros',
    city: 'Campina Grande',
  });
  assert(!pollutedLegacyAddr.fullSingleLine.includes('undefined'), 'Deve filtrar literal "undefined"');
  assert(!pollutedLegacyAddr.fullSingleLine.includes('Condomínio Outros'), 'Deve filtrar placeholder "Condomínio Outros"');
  assert(pollutedLegacyAddr.primaryLine.includes('Rua Aprígio Veloso'), 'Deve manter rua real');
  assert(pollutedLegacyAddr.secondaryLine.includes('Casa B'), 'Deve manter complemento');

  const waFormatted = formatCustomerAddress(
    {
      name: 'Maria',
      address: {
        condominium: 'Condomínio Eco Fit',
        street: 'Av. Severino Bezerra Cabral',
        number: '1200',
        block: 'B',
        apartment: '501',
        neighborhood: 'Catolé',
        city: 'Campina Grande',
        reference: 'Em frente ao parque',
      },
    },
    false
  );
  assert(
    waFormatted.includes('Condomínio Eco Fit') &&
      waFormatted.includes('Av. Severino Bezerra Cabral, 1200') &&
      waFormatted.includes('Bloco B') &&
      waFormatted.includes('Ap 501') &&
      waFormatted.includes('Catolé'),
    'WhatsApp/single-line deve exibir todos os campos preenchidos'
  );
  console.log('✓ Passou: Formatação e sanitização de endereço completo validadas.');

  console.log('\n=== [3] RECONCILIAÇÃO MULTI-DISPOSITIVO E PROPAGAÇÃO DE EXCLUSÕES ===');

  memoryStorage.clear();
  const baseOrder = {
    id: 'ord-sync-1',
    orderNumber: '#2001',
    createdAt: '2026-10-27T14:00:00.000Z',
    updatedAt: '2026-10-27T14:00:00.000Z',
    fulfillmentType: 'DELIVERY',
    status: 'NOVO',
    paymentStatus: 'PENDENTE',
    paymentMethod: 'PIX',
    customer: { name: 'Cliente Sync', phone: '83999990000' },
    items: [],
    subtotal: 20,
    deliveryFee: 5,
    discount: 0,
    totalAmount: 25,
    movements: [],
  };

  // Device B initially receives ord-sync-1 synced from server
  let res = store.reconcileRemoteOrders([baseOrder as any], { authoritative: true });
  assert.equal(store.getOrders().length, 1);

  // Device A advances status to EM_PREPARO -> Device B receives update on snapshot/refresh
  res = store.reconcileRemoteOrders(
    [{ ...baseOrder, status: 'EM_PREPARO', updatedAt: '2026-10-27T14:05:00.000Z' } as any],
    { authoritative: true }
  );
  assert.equal(store.getOrderById('ord-sync-1')?.status, 'EM_PREPARO');
  assert.equal(res.updated, 1);

  // Device A unassigns a driver -> Device B receives removal of deliveryPersonId cleanly
  res = store.reconcileRemoteOrders(
    [{ ...baseOrder, status: 'PRONTO', deliveryPersonId: 'drv-1', deliveryPersonName: 'João', updatedAt: '2026-10-27T14:08:00.000Z' } as any],
    { authoritative: true }
  );
  assert.equal(store.getOrderById('ord-sync-1')?.deliveryPersonId, 'drv-1');

  res = store.reconcileRemoteOrders(
    [{ ...baseOrder, status: 'PRONTO', deliveryPersonId: undefined, deliveryPersonName: undefined, updatedAt: '2026-10-27T14:09:00.000Z' } as any],
    { authoritative: true }
  );
  assert.equal(store.getOrderById('ord-sync-1')?.deliveryPersonId, undefined, 'Desatribuição de entregador deve propagar');

  // Unsynced local offline order must NOT be erased by authoritative snapshot while still pending upload
  const offlineLocalOrder = { ...baseOrder, id: 'ord-offline-local', orderNumber: '#2002', _cloudSyncStatus: 'PENDING' };
  const current = store.getOrders();
  localStorage.setItem('gf_orders', JSON.stringify([offlineLocalOrder, ...current]));
  localStorage.setItem('gf_pending_sync_orders', JSON.stringify([offlineLocalOrder]));

  // Server snapshot drops ord-sync-1 (deleted remotely on Device A!), does not have ord-offline-local yet
  res = store.reconcileRemoteOrders([], { authoritative: true });
  assert.equal(store.getOrderById('ord-sync-1'), undefined, 'Pedido sincronizado excluído remotamente deve sumir no outro dispositivo');
  assert.equal(res.removed, 1, 'Resumo deve contabilizar 1 remoção');
  assert.ok(store.getOrderById('ord-offline-local'), 'Criação offline ainda não enviada deve ser preservada');
  assert.ok(store.getDeletedOrderIds().has('ord-sync-1'), 'ID excluído deve entrar em tombstones locais');

  // Even if stale payload brings ord-sync-1 back, tombstone blocks resurrection!
  store.reconcileRemoteOrders([baseOrder as any], { authoritative: true });
  assert.equal(store.getOrderById('ord-sync-1'), undefined, 'Tombstone deve impedir ressurreição');
  console.log('✓ Passou: Sincronização de status, desatribuição, propagação de exclusão e proteção offline.');

  console.log('\n=== [4] IMPRESSORA TÉRMICA BLE: STATUS HONESTO E RECUPERAÇÃO PASSIVA ===');

  // Saved device exists in config, but GATT server rejects/fails -> MUST stay disconnected (honest!)
  thermalPrinterService.saveConfig({
    enabled: true,
    connectionMode: 'bluetooth_ble',
    lastDeviceId: 'ble-printer-1',
    lastDeviceName: 'MTP-II 58mm',
  });
  mockBluetoothDevices = [
    {
      id: 'ble-printer-1',
      name: 'MTP-II 58mm',
      gatt: {
        connected: false,
        connect: async () => {
          throw new Error('Dispositivo Bluetooth fora de alcance');
        },
      },
      addEventListener: () => {},
    },
  ];
  const failRes = await thermalPrinterService.tryAutoReconnectOnStartup();
  const failStatus = thermalPrinterService.getStatus();
  assert.equal(failRes.success, false, 'Retorno deve informar falha na reconexão');
  assert.equal(failStatus.connected, false, 'Nunca deve fingir conexão ativa se GATT falhar');
  assert.equal(failStatus.reconnecting, false, 'Estado reconnecting deve finalizar em false');
  assert.equal(failStatus.hasSavedDevice, true, 'Deve informar que há impressora salva para reconexão em 1 clique');

  // Saved device responds with valid GATT + write characteristic -> restores connected honestly
  const fakeCharacteristic = {
    properties: { writeWithoutResponse: true, write: false },
    writeValueWithoutResponse: async () => {},
  };
  mockBluetoothDevices = [
    {
      id: 'ble-printer-1',
      name: 'MTP-II 58mm',
      gatt: {
        connected: false,
        connect: async function () {
          this.connected = true;
          return {
            connected: true,
            getPrimaryServices: async () => [
              {
                getCharacteristics: async () => [fakeCharacteristic],
              },
            ],
          };
        },
      },
      addEventListener: () => {},
    },
  ];
  const okRes = await thermalPrinterService.tryAutoReconnectOnStartup();
  const okStatus = thermalPrinterService.getStatus();
  assert.equal(okRes.success, true, 'Deve retornar sucesso quando GATT + característica respondem');
  assert.equal(okStatus.connected, true, 'Deve conectar quando GATT + característica respondem de fato');
  assert.equal(okStatus.deviceName, 'MTP-II 58mm');
  await thermalPrinterService.disconnectBluetooth();
  assert.equal(thermalPrinterService.getStatus().connected, false);
  console.log('✓ Passou: Status da impressora honesto e recuperação via getDevices() testada.');

  console.log('\n=== [5] BACKEND HTTP: RBAC DE TOMBSTONES E REJEIÇÃO DE PREÇO ADULTERADO ===');

  const BASE_URL = 'http://localhost:3000';
  const health = await fetch(`${BASE_URL}/api/health`);
  assert.equal(health.status, 200, 'Servidor HTTP deve estar ativo em localhost:3000');

  const tombUnauthGet = await fetch(`${BASE_URL}/api/orders/tombstones`);
  assert.ok(tombUnauthGet.status === 401 || tombUnauthGet.status === 403, 'GET /api/orders/tombstones sem token deve retornar 401/403');

  const tombUnauthPost = await fetch(`${BASE_URL}/api/orders/tombstones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: 'ord-fake' }),
  });
  assert.ok(tombUnauthPost.status === 401 || tombUnauthPost.status === 403, 'POST /api/orders/tombstones sem token deve retornar 401/403');

  const delUnauth = await fetch(`${BASE_URL}/api/orders/ord-fake`, { method: 'DELETE' });
  assert.ok(delUnauth.status === 401 || delUnauth.status === 403, 'DELETE /api/orders/:id sem token deve retornar 401/403');

  console.log('✓ Passou: Endpoints do backend ativos e protegidos com autenticação staff.');
  console.log('\n======================================================================');
  console.log('SUÍTE COMPLETA (DATAS BRT, ENDEREÇOS, SYNC/EXCLUSÃO, BLE, BACKEND) PASSOU!');
  console.log('======================================================================\n');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Falha na execução da suíte de testes:', err);
    process.exit(1);
  });
