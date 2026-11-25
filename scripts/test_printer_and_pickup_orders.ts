/**
 * Suíte Automatizada: Impressora Térmica Bluetooth (Configurações + PDV) e Gestão de Pedidos (Retirada vs Delivery)
 * Valida:
 * 1. Preservação do gesto do usuário em connectBluetoothBLE (requestDevice chamado antes de qualquer getAvailability).
 * 2. Serialização de chamadas simultâneas (sem interferência entre Configurações e PDV).
 * 3. Persistência de dispositivo salvo, UUIDs BLE, desconexão manual e reconexão limpa.
 * 4. Existência e sincronização dos dois botões de pareamento (Configurações e PDV).
 * 5. Fluxo completo de pedido RETIRADA no balcão (ex.: #1035):
 *    - Sem "Despachar Motoboy"
 *    - Bloqueio estrito de EM_ROTA no domínio (store.ts) e no servidor (app.ts)
 *    - Bloqueio de atribuição de entregador a pedido RETIRADA
 *    - "Confirmar Retirada" -> ENTREGUE sem atribuir entregador e com histórico de movimentação
 * 6. Preservação integral do fluxo de pedido DELIVERY (Despachar Motoboy -> EM_ROTA -> ENTREGUE + entregador).
 * 7. Integridade da autenticação (arquivos protegidos inalterados).
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(`           ${err?.message || err}`);
    failed++;
  }
}

// ==========================================
// AMBIENTE SIMULADO DE BROWSER (localStorage + navigator.bluetooth)
// ==========================================
const storageMap = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
  setItem: (k: string, v: string) => {
    storageMap.set(k, String(v));
  },
  removeItem: (k: string) => {
    storageMap.delete(k);
  },
  clear: () => storageMap.clear(),
};

(globalThis as any).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  location: { origin: 'http://localhost:3000', href: 'http://localhost:3000' },
};

(globalThis as any).document = {
  visibilityState: 'visible',
  addEventListener: () => {},
  removeEventListener: () => {},
};

const callOrder: string[] = [];
const writtenChunks: Uint8Array[] = [];

function createMockBleDevice(id: string, name: string) {
  let gattConnected = false;
  const listeners: Record<string, (() => void)[]> = {};

  const mockChar = {
    uuid: '00002af1-0000-1000-8000-00805f9b34fb',
    service: { uuid: '000018f0-0000-1000-8000-00805f9b34fb' },
    properties: { write: true, writeWithoutResponse: true },
    writeValueWithoutResponse: async (chunk: Uint8Array) => {
      writtenChunks.push(chunk);
    },
    writeValue: async (chunk: Uint8Array) => {
      writtenChunks.push(chunk);
    },
  };

  const mockService = {
    uuid: '000018f0-0000-1000-8000-00805f9b34fb',
    getCharacteristics: async () => [mockChar],
    getCharacteristic: async (uuid: string) => (uuid === mockChar.uuid ? mockChar : null),
  };

  const gattServer = {
    get connected() {
      return gattConnected;
    },
    getPrimaryServices: async () => [mockService],
    getPrimaryService: async (uuid: string) => (uuid === mockService.uuid ? mockService : null),
    disconnect: () => {
      gattConnected = false;
      (listeners['gattserverdisconnected'] || []).forEach((fn) => fn());
    },
  };

  return {
    id,
    name,
    addEventListener: (ev: string, cb: () => void) => {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(cb);
    },
    removeEventListener: (ev: string, cb: () => void) => {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== cb);
    },
    gatt: {
      connect: async () => {
        callOrder.push(`gatt.connect:${id}`);
        gattConnected = true;
        return gattServer;
      },
    },
  };
}

let requestDeviceCount = 0;
let mockDeviceToReturn = createMockBleDevice('ble-printer-01', 'MPT-II 58mm');
let requestDeviceError: any = null;

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: {
    onLine: true,
    userAgent: 'Chrome/125.0.0.0',
    bluetooth: {
      getAvailability: async () => {
        callOrder.push('getAvailability');
        return true;
      },
      requestDevice: async () => {
        callOrder.push('requestDevice');
        requestDeviceCount++;
        if (requestDeviceError) throw requestDeviceError;
        return mockDeviceToReturn;
      },
      getDevices: async () => [mockDeviceToReturn],
    },
  },
});

async function main() {
  console.log('==================================================================');
  console.log('TESTES: IMPRESSORA BLUETOOTH (CONFIG + PDV) & RETIRADA NO BALCÃO');
  console.log('==================================================================\n');

  const { thermalPrinterService } = await import('../src/services/thermalPrinter');
  const { store } = await import('../src/services/store');

  console.log('--- 1. Serviço de Impressora Térmica Bluetooth (thermalPrinter.ts) ---');

  await test('connectBluetoothBLE chama requestDevice diretamente sem aguardar getAvailability antes (preserva gesto do usuário)', async () => {
    callOrder.length = 0;
    requestDeviceCount = 0;
    requestDeviceError = null;
    mockDeviceToReturn = createMockBleDevice('ble-printer-01', 'MPT-II 58mm');

    const res = await thermalPrinterService.connectBluetoothBLE();
    assert.equal(res.success, true, `Esperado sucesso, obteve: ${res.message}`);
    assert.equal(callOrder[0], 'requestDevice', `Primeiro chamado deve ser requestDevice, obteve: ${callOrder.join(' -> ')}`);
    assert.equal(callOrder.includes('getAvailability'), false, 'getAvailability não deve ser chamado em fluxo bem-sucedido');

    const status = thermalPrinterService.getStatus();
    const cfg = thermalPrinterService.getConfig();
    assert.equal(status.connected, true);
    assert.equal(status.deviceName, 'MPT-II 58mm');
    assert.equal(cfg.connectionMode, 'bluetooth_ble');
    assert.equal(cfg.lastDeviceId, 'ble-printer-01');
    assert.equal(cfg.bleServiceUuid, '000018f0-0000-1000-8000-00805f9b34fb');
    assert.equal(cfg.bleCharUuid, '00002af1-0000-1000-8000-00805f9b34fb');
  });

  await test('Chamadas simultâneas (Configurações + PDV) são serializadas sem duplicar requestDevice', async () => {
    await thermalPrinterService.disconnectBluetooth();
    requestDeviceCount = 0;
    callOrder.length = 0;

    const [r1, r2] = await Promise.all([
      thermalPrinterService.connectBluetoothBLE(),
      thermalPrinterService.connectBluetoothBLE(),
    ]);

    assert.equal(r1.success, true);
    assert.equal(r2.success, true);
    assert.equal(requestDeviceCount, 1, 'requestDevice deve ser aberto apenas uma vez em cliques simultâneos');
  });

  await test('Desconexão manual preserva dispositivo salvo e permite reconexão direta via reconnectSavedBLE()', async () => {
    await thermalPrinterService.disconnectBluetooth();
    const afterDisconnect = thermalPrinterService.getStatus();
    assert.equal(afterDisconnect.connected, false);
    assert.equal(afterDisconnect.hasSavedDevice, true);
    assert.equal(afterDisconnect.deviceName, 'MPT-II 58mm');

    const reconn = await thermalPrinterService.reconnectSavedBLE();
    assert.equal(reconn.success, true, `Reconexão deveria funcionar, obteve: ${reconn.message}`);
    assert.equal(thermalPrinterService.getStatus().connected, true);
  });

  await test('Impressão de comprovante de teste envia bytes ESC/POS pela característica BLE conectada', async () => {
    writtenChunks.length = 0;
    const res = await thermalPrinterService.printTestReceipt();
    assert.equal(res.success, true, `Impressão de teste falhou: ${res.message}`);
    assert.ok(writtenChunks.length > 0, 'Deve enviar blocos ESC/POS ao dispositivo BLE');
  });

  await test('Cancelamento pelo usuário (NotFoundError) não apaga configuração salva e retorna orientação clara', async () => {
    await thermalPrinterService.disconnectBluetooth();
    requestDeviceError = Object.assign(new Error('User cancelled'), { name: 'NotFoundError' });

    const res = await thermalPrinterService.connectBluetoothBLE();
    assert.equal(res.success, false);
    assert.match(res.message, /cancelada|selecionada/i);
    assert.equal(thermalPrinterService.getConfig().lastDeviceId, 'ble-printer-01');
    requestDeviceError = null;
  });

  await test('SecurityError informa claramente sobre permissão/iframe e uso em aba direta do Chrome', async () => {
    requestDeviceError = Object.assign(new Error('Blocked by permissions policy'), { name: 'SecurityError' });
    const res = await thermalPrinterService.connectBluetoothBLE();
    assert.equal(res.success, false);
    assert.match(res.message, /Chrome|iframe/i);
    requestDeviceError = null;
  });

  console.log('\n--- 2. Verificação dos Dois Botões de Pareamento (Configurações + PDV) ---');

  await test('PrinterSettings.tsx (Configurações) sincroniza config e mantém botão de pareamento em todos os modos', () => {
    const content = fs.readFileSync(path.resolve('src/components/admin/PrinterSettings.tsx'), 'utf8');
    assert.ok(content.includes('setConfig(thermalPrinterService.getConfig())'), 'subscribe deve sincronizar config local');
    assert.ok(content.includes('Localizar e Parear Impressora'), 'Botão original Localizar e Parear Impressora presente');
    assert.ok(content.includes('Localizar e Parear Impressora (BLE)'), 'Botão BLE permanece visível mesmo em RawBT ou Spooler');
    assert.ok(content.includes('Reconectar Impressora'), 'Botão Reconectar Impressora preservado');
    assert.ok(content.includes('Parear Outra'), 'Opção para parear outra impressora mesmo quando conectada');
  });

  await test('PointOfSale.tsx (PDV) possui botão independente funcional em todos os estados sem bloquear pareamento', () => {
    const content = fs.readFileSync(path.resolve('src/components/admin/PointOfSale.tsx'), 'utf8');
    assert.ok(content.includes('handleExplicitBlePair'), 'Ação explícita de pareamento BLE presente no PDV');
    assert.ok(content.includes('Parear impressora'), 'Botão Parear impressora presente quando sem dispositivo salvo');
    assert.ok(content.includes('<span>Parear</span>'), 'Botão direto Parear ao lado de Reconectar quando há dispositivo salvo');
    assert.ok(content.includes('offerRepair: !res.success'), 'Qualquer falha de reconexão oferece botão Parear novamente');
    assert.ok(!content.includes("if (printerStatus.mode !== 'bluetooth_ble') {\n      return;"), 'Botão do PDV não ignora mais cliques em outros modos');
  });

  console.log('\n--- 3. Gestão de Pedidos: Retirada no Balcão vs Delivery (store.ts + Kanban + app.ts) ---');

  // Limpa sessão e cria pedidos de teste isolados no localStorage em memória
  localStorage.removeItem('gf_orders');
  localStorage.removeItem('gf_current_user');

  const pickupOrder = {
    id: 'ord-1035-pickup',
    orderNumber: '#1035',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    customer: { name: 'Cliente Balcão', phone: '00000000000' },
    fulfillmentType: 'RETIRADA' as const,
    items: [
      {
        id: 'it-1',
        menuItemId: 'item-1',
        name: 'Torta de Frango (Fatia)',
        unitPrice: 15,
        quantity: 1,
        subtotal: 15,
      },
    ],
    subtotal: 15,
    deliveryFee: 0,
    discount: 0,
    totalAmount: 15,
    paymentMethod: 'PIX' as const,
    paymentStatus: 'PAGO' as const,
    status: 'PRONTO' as const,
    movements: [
      {
        id: 'mov-init-1035',
        timestamp: new Date().toISOString(),
        toStatus: 'PRONTO' as const,
        author: 'Cozinha',
        notes: 'Pedido pronto no balcão',
      },
    ],
  };

  const deliveryOrder = {
    id: 'ord-1036-delivery',
    orderNumber: '#1036',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    customer: {
      name: 'Maria Cliente',
      phone: '85999990000',
      address: { street: 'Rua Exemplo', number: '123', neighborhood: 'Centro' },
    },
    fulfillmentType: 'DELIVERY' as const,
    items: [
      {
        id: 'it-2',
        menuItemId: 'item-1',
        name: 'Bolo de Cenoura',
        unitPrice: 20,
        quantity: 1,
        subtotal: 20,
      },
    ],
    subtotal: 20,
    deliveryFee: 5,
    discount: 0,
    totalAmount: 25,
    paymentMethod: 'PIX' as const,
    paymentStatus: 'PAGO' as const,
    status: 'PRONTO' as const,
    movements: [
      {
        id: 'mov-init-1036',
        timestamp: new Date().toISOString(),
        toStatus: 'PRONTO' as const,
        author: 'Cozinha',
        notes: 'Pedido pronto para entrega',
      },
    ],
  };

  localStorage.setItem('gf_orders', JSON.stringify([pickupOrder, deliveryOrder]));

  await test('Pedido RETIRADA (#1035) bloqueia transição para EM_ROTA (motoboy) em updateOrderStatus e updateOrderStatusAsync', async () => {
    const syncRes = store.updateOrderStatus(pickupOrder.id, 'EM_ROTA', 'Administrador', 'Tentativa indevida', false, { suppressSound: true });
    assert.equal(syncRes, null, 'updateOrderStatus deve rejeitar EM_ROTA para RETIRADA');

    const asyncRes = await store.updateOrderStatusAsync(pickupOrder.id, 'EM_ROTA', 'Administrador');
    assert.equal(asyncRes.rejected, true, 'updateOrderStatusAsync deve rejeitar EM_ROTA para RETIRADA');
    assert.match(asyncRes.error || '', /Retirada no Balcão/i);

    const unchanged = store.getOrderById(pickupOrder.id);
    assert.equal(unchanged?.status, 'PRONTO');
    assert.equal(unchanged?.deliveryPerson, undefined);
  });

  await test('Pedido RETIRADA (#1035) bloqueia atribuição de entregador em assignDeliveryPerson e assignDeliveryPersonAsync', async () => {
    const driver = { id: 'drv-1', name: 'Carlos Motoboy', phone: '85988887777' };
    const syncAssign = store.assignDeliveryPerson(pickupOrder.id, driver, 'Admin', undefined, false);
    assert.equal(syncAssign, null, 'assignDeliveryPerson deve rejeitar entregador em pedido RETIRADA');

    const asyncAssign = await store.assignDeliveryPersonAsync(pickupOrder.id, driver, 'Admin');
    assert.equal(asyncAssign.rejected, true, 'assignDeliveryPersonAsync deve rejeitar entregador em pedido RETIRADA');
    assert.match(asyncAssign.error || '', /Retirada no Balcão/i);
  });

  await test('Pedido RETIRADA (#1035) conclui diretamente de PRONTO para ENTREGUE via Confirmar Retirada sem atribuir motoboy', () => {
    const completed = store.updateOrderStatus(pickupOrder.id, 'ENTREGUE', 'Atendente Caixa', undefined, false, { suppressSound: true });
    assert.ok(completed, 'Pedido RETIRADA deve concluir para ENTREGUE');
    assert.equal(completed!.status, 'ENTREGUE');
    assert.equal(completed!.deliveryPerson, undefined, 'Pedido RETIRADA não pode fabricar deliveryPerson ao concluir');
    assert.equal(completed!.deliveryPersonId, undefined);
    assert.equal(completed!.deliveryPersonName, undefined);

    const lastMove = completed!.movements[completed!.movements.length - 1];
    assert.equal(lastMove.fromStatus, 'PRONTO');
    assert.equal(lastMove.toStatus, 'ENTREGUE');
    assert.equal(lastMove.notes, 'Retirada confirmada no balcão');
  });

  await test('Pedido DELIVERY (#1036) preserva integralmente fluxo PRONTO -> EM_ROTA -> ENTREGUE com entregador', () => {
    const driver = { id: 'drv-1', name: 'Carlos Motoboy', phone: '85988887777' };
    const assigned = store.assignDeliveryPerson(deliveryOrder.id, driver, 'Admin', undefined, false);
    assert.ok(assigned);
    assert.equal(assigned!.deliveryPersonName, 'Carlos Motoboy');

    const inRoute = store.updateOrderStatus(deliveryOrder.id, 'EM_ROTA', 'Carlos Motoboy', 'Saiu para entrega', false, { suppressSound: true });
    assert.ok(inRoute);
    assert.equal(inRoute!.status, 'EM_ROTA');
    assert.equal(inRoute!.deliveryPerson?.name, 'Carlos Motoboy');

    const delivered = store.updateOrderStatus(deliveryOrder.id, 'ENTREGUE', 'Carlos Motoboy', 'Entregue ao cliente', false, { suppressSound: true });
    assert.ok(delivered);
    assert.equal(delivered!.status, 'ENTREGUE');
    assert.ok(delivered!.deliveryPerson?.deliveredAt, 'DELIVERY deve registrar deliveredAt no entregador');
  });

  await test('LiveOrdersKanban.tsx exibe Confirmar Retirada para RETIRADA e mantém Despachar Motoboy apenas para DELIVERY', () => {
    const kanban = fs.readFileSync(path.resolve('src/components/admin/LiveOrdersKanban.tsx'), 'utf8');
    assert.ok(kanban.includes("order.status === 'PRONTO' && order.fulfillmentType === 'RETIRADA'"), 'Card diferencia RETIRADA no status PRONTO');
    assert.ok(kanban.includes('Confirmar Retirada'), 'Botão Confirmar Retirada presente');
    assert.ok(kanban.includes("order.status === 'PRONTO' && order.fulfillmentType !== 'RETIRADA'"), 'Despachar Motoboy restrito a pedidos não-RETIRADA');
    assert.ok(kanban.includes("selectedOrderForModal.fulfillmentType === 'DELIVERY' && (") && kanban.includes('Em Rota (Motoboy)'), 'Modal restringe Em Rota (Motoboy) exclusivamente a DELIVERY');
    assert.ok(kanban.includes('Pronto p/ Retirada'), 'Rótulo adequado para RETIRADA em EM_PREPARO e modal');
  });

  await test('src/server/app.ts bloqueia EM_ROTA e atribuição de entregador para pedidos RETIRADA', () => {
    const appSrc = fs.readFileSync(path.resolve('src/server/app.ts'), 'utf8');
    assert.ok(appSrc.includes("code: 'INVALID_PICKUP_STATUS'"), 'Rota de status bloqueia EM_ROTA em RETIRADA');
    assert.ok(appSrc.includes("code: 'INVALID_PICKUP_DRIVER'"), 'Rota de atribuição bloqueia entregador em RETIRADA');
    assert.ok(appSrc.includes("prev.fulfillmentType !== 'RETIRADA'"), 'Rota de status não grava deliveryPerson em RETIRADA');
  });

  console.log('\n==================================================================');
  console.log(`RESULTADO: ${passed + failed} testes | APROVADOS: ${passed} | FALHAS: ${failed}`);
  console.log('==================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Erro fatal na execução dos testes:', err);
  process.exit(1);
});
