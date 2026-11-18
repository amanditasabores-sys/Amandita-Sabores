/**
 * Automated Verification Suite — Histórico de Entregas por Entregador
 * Tests:
 * 1. Today's deliveries in America/Fortaleza appear automatically for the selected driver
 * 2. Previous days' deliveries appear when filtering by that date
 * 3. More than 10 deliveries on the same day are returned completely (no 10-item cap)
 * 4. Newest-to-oldest ordering by createdAt
 * 5. Midnight boundary handling in America/Fortaleza (UTC-3) without UTC day shifting
 * 6. Driver matching including legacy IDs ('driver-<id>') and legacy normalized names
 * 7. "Hoje" return behavior using getFortalezaDateKey()
 *
 * Run with: npx tsx scripts/test_driver_delivery_history.ts
 */

import assert from 'node:assert/strict';

const memoryStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (memoryStorage.has(k) ? memoryStorage.get(k)! : null),
  setItem: (k: string, v: string) => memoryStorage.set(k, String(v)),
  removeItem: (k: string) => memoryStorage.delete(k),
  clear: () => memoryStorage.clear(),
};

(globalThis as any).window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { hostname: 'localhost', origin: 'http://localhost:3000', search: '' },
};

import type { Order, User } from '../src/types';

function makeOrder(overrides: Partial<Order> & { id: string; orderNumber: string; createdAt: string }): Order {
  return {
    id: overrides.id,
    orderNumber: overrides.orderNumber,
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt || overrides.createdAt,
    fulfillmentType: overrides.fulfillmentType || 'DELIVERY',
    customer: overrides.customer || { name: 'Cliente Teste', phone: '83999990000' },
    items: overrides.items || [],
    subtotal: overrides.subtotal ?? 30,
    deliveryFee: overrides.deliveryFee ?? 5,
    discount: overrides.discount ?? 0,
    totalAmount: overrides.totalAmount ?? 35,
    paymentMethod: overrides.paymentMethod || 'PIX',
    paymentStatus: overrides.paymentStatus || 'PAGO',
    status: overrides.status || 'ENTREGUE',
    estimatedDeliveryMinutes: overrides.estimatedDeliveryMinutes ?? 40,
    movements: overrides.movements || [],
    deliveryPersonId: overrides.deliveryPersonId,
    deliveryPersonName: overrides.deliveryPersonName,
    deliveryPerson: overrides.deliveryPerson,
  };
}

async function runTests() {
  const {
    doesDeliveryBelongToDriver,
    getDriverDeliveriesForDate,
  } = await import('../src/components/delivery/DeliverySupervisorDashboard');
  const {
    getFortalezaDateKey,
    formatFortalezaDateLabel,
  } = await import('../src/utils/formatters');

  const driverJoao: User = {
    id: 'usr-joao',
    name: 'João Silva',
    username: 'joao',
    email: 'joao@amandita.local',
    isEmailVerified: true,
    createdAt: '2026-01-01T10:00:00.000Z',
    role: 'ENTREGADOR',
    status: 'ATIVO',
    phone: '83991112222',
  };

  const driverMaria: User = {
    id: 'usr-maria',
    name: 'Maria Souza',
    username: 'maria',
    email: 'maria@amandita.local',
    isEmailVerified: true,
    createdAt: '2026-01-01T10:00:00.000Z',
    role: 'ENTREGADOR',
    status: 'ATIVO',
    phone: '83993334444',
  };

  // Use dynamic today in Fortaleza + explicit boundary dates
  const todayKey = getFortalezaDateKey();
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const yesterdayUtcRef = new Date(Date.UTC(ty, tm - 1, td - 1, 15, 0, 0));
  const yesterdayKey = getFortalezaDateKey(yesterdayUtcRef);

  // Build 14 deliveries for João on yesterday (intentionally unsorted input) + legacy formats
  const yesterdayOrders: Order[] = [];
  for (let i = 1; i <= 14; i++) {
    const hourUtc = 13 + (i % 10); // between 10:00 and 19:00 Fortaleza time
    const createdAt = `${yesterdayKey}T${String(hourUtc).padStart(2, '0')}:${String(i).padStart(2, '0')}:00.000Z`;
    yesterdayOrders.push(
      makeOrder({
        id: `ord-y-${i}`,
        orderNumber: `#${2000 + i}`,
        createdAt,
        deliveryPersonId: i === 1 ? `driver-${driverJoao.id}` : i === 2 ? undefined : driverJoao.id,
        deliveryPersonName: i === 2 ? 'Entregador João Silva' : undefined,
        deliveryPerson:
          i === 3
            ? { id: driverJoao.id, name: 'João Silva', phone: '83991112222' }
            : undefined,
      })
    );
  }
  // Shuffle yesterdayOrders to ensure sorting is explicitly enforced by helper
  const shuffledYesterday = [
    yesterdayOrders[5],
    yesterdayOrders[0],
    yesterdayOrders[13],
    yesterdayOrders[2],
    yesterdayOrders[1],
    yesterdayOrders[9],
    ...yesterdayOrders.filter((_, idx) => ![0, 1, 2, 5, 9, 13].includes(idx)),
  ];

  // Build midnight boundary orders in America/Fortaleza (UTC-3)
  // 2026-10-18 21:30 Fortaleza == 2026-10-19 00:30 UTC (must belong to 2026-10-18!)
  // 2026-10-18 23:55 Fortaleza == 2026-10-19 02:55 UTC (must belong to 2026-10-18!)
  // 2026-10-19 00:05 Fortaleza == 2026-10-19 03:05 UTC (must belong to 2026-10-19!)
  const midnightBoundaryOrders: Order[] = [
    makeOrder({
      id: 'ord-mid-1',
      orderNumber: '#3001',
      createdAt: '2026-10-19T00:30:00.000Z', // 21:30 BRT on 2026-10-18
      deliveryPersonId: driverJoao.id,
    }),
    makeOrder({
      id: 'ord-mid-2',
      orderNumber: '#3002',
      createdAt: '2026-10-19T02:55:00.000Z', // 23:55 BRT on 2026-10-18
      deliveryPersonId: driverJoao.id,
    }),
    makeOrder({
      id: 'ord-mid-3',
      orderNumber: '#3003',
      createdAt: '2026-10-19T03:05:00.000Z', // 00:05 BRT on 2026-10-19
      deliveryPersonId: driverJoao.id,
    }),
  ];

  // Today orders: 2 for João (one early morning, one current instant), 1 for Maria
  const todayMiddayIso = new Date().toISOString();
  const todayEarlyFt = `${todayKey}T03:10:00.000Z`; // 00:10 Fortaleza on todayKey!
  const todayOrders: Order[] = [
    makeOrder({
      id: 'ord-today-1',
      orderNumber: '#4001',
      createdAt: todayEarlyFt,
      deliveryPersonId: driverJoao.id,
    }),
    makeOrder({
      id: 'ord-today-2',
      orderNumber: '#4002',
      createdAt: todayMiddayIso,
      deliveryPerson: { id: `driver-${driverJoao.id}`, name: 'João Silva', phone: '83991112222' },
    }),
    makeOrder({
      id: 'ord-today-maria',
      orderNumber: '#4003',
      createdAt: todayMiddayIso,
      deliveryPersonId: driverMaria.id,
      deliveryPersonName: 'Maria Souza',
    }),
  ];

  const allDeliveryOrders = [...shuffledYesterday, ...midnightBoundaryOrders, ...todayOrders];

  // 1. Default view ("Hoje") shows ONLY today's deliveries for João
  const joaoToday = getDriverDeliveriesForDate(allDeliveryOrders, driverJoao, todayKey);
  assert.equal(joaoToday.length, 2, 'Deve retornar apenas as 2 entregas de hoje para João');
  assert.deepEqual(
    joaoToday.map((o) => o.id),
    ['ord-today-2', 'ord-today-1'],
    'Entregas de hoje devem vir ordenadas da mais recente para a mais antiga'
  );
  assert.ok(!joaoToday.some((o) => o.id === 'ord-today-maria'), 'Não deve misturar entregas de outro entregador');

  // 2. Selecting previous day shows all 14 deliveries (> 10 cap removed) ordered newest-first
  const joaoYesterday = getDriverDeliveriesForDate(allDeliveryOrders, driverJoao, yesterdayKey);
  assert.equal(joaoYesterday.length, 14, 'Deve exibir todas as 14 entregas do dia anterior, sem limite de 10');
  for (let idx = 1; idx < joaoYesterday.length; idx++) {
    assert.ok(
      Date.parse(joaoYesterday[idx - 1].createdAt) >= Date.parse(joaoYesterday[idx].createdAt),
      'Lista deve estar ordenada da mais recente para a mais antiga'
    );
  }

  // 3. Legacy matching verification (driver-<id>, legacy name only, deliveryPerson.id)
  assert.ok(doesDeliveryBelongToDriver(yesterdayOrders[0], driverJoao), 'Match por prefixo legado driver-<id>');
  assert.ok(doesDeliveryBelongToDriver(yesterdayOrders[1], driverJoao), 'Match por deliveryPersonName legado');
  assert.ok(doesDeliveryBelongToDriver(yesterdayOrders[2], driverJoao), 'Match por deliveryPerson.id');
  assert.ok(!doesDeliveryBelongToDriver(todayOrders[2], driverJoao), 'Não deve associar entrega de Maria a João');

  // 4. Midnight boundary in America/Fortaleza (UTC-3)
  const oct18 = getDriverDeliveriesForDate(allDeliveryOrders, driverJoao, '2026-10-18');
  assert.deepEqual(
    oct18.map((o) => o.id),
    ['ord-mid-2', 'ord-mid-1'],
    'Pedidos de 21:30 e 23:55 em Fortaleza (dia seguinte em UTC) devem permanecer em 18/10/2026'
  );
  const oct19 = getDriverDeliveriesForDate(allDeliveryOrders, driverJoao, '2026-10-19');
  assert.deepEqual(
    oct19.map((o) => o.id),
    ['ord-mid-3'],
    'Pedido de 00:05 em Fortaleza deve aparecer em 19/10/2026'
  );

  // 5. Return to "Hoje" via getFortalezaDateKey() + label formatting
  const backToTodayKey = getFortalezaDateKey();
  assert.equal(backToTodayKey, todayKey);
  assert.match(formatFortalezaDateLabel(backToTodayKey), /^\d{2}\/\d{2}\/\d{4}$/);
  const backToTodayList = getDriverDeliveriesForDate(allDeliveryOrders, driverJoao, backToTodayKey);
  assert.equal(backToTodayList.length, 2);

  // 6. Empty date returns 0 without throwing and without mutating input array
  const snapshotBefore = JSON.stringify(allDeliveryOrders);
  const emptyDay = getDriverDeliveriesForDate(allDeliveryOrders, driverJoao, '2025-01-01');
  assert.equal(emptyDay.length, 0);
  assert.equal(JSON.stringify(allDeliveryOrders), snapshotBefore, 'Histórico original não pode ser alterado');

  console.log('✅ Todos os testes de Histórico de Entregas por Entregador passaram com sucesso!');
  console.log(`   - Data atual (America/Fortaleza): ${todayKey} (${formatFortalezaDateLabel(todayKey)})`);
  console.log(`   - Entregas de hoje (João): ${joaoToday.length}`);
  console.log(`   - Entregas do dia anterior (${yesterdayKey}): ${joaoYesterday.length} (> 10 sem corte)`);
  console.log(`   - Virada de meia-noite (2026-10-18): ${oct18.map((o) => o.orderNumber).join(', ')}`);
}

runTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Falha nos testes de Histórico de Entregas por Entregador:', err);
    process.exit(1);
  });
