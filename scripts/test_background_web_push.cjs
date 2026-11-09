/**
 * Comprehensive Automated Verification for Background Web Push & Driver Notifications
 * Amandita Sabores
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== TESTE AUTOMATIZADO: NOTIFICAÇÕES DO ENTREGADOR E WEB PUSH EM SEGUNDO PLANO ===\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    testsFailed++;
  }
}

// 1. Verify push-worker.js structure & requirements
runTest('1. push-worker.js: Estrutura resiliente de segundo plano e eventos NEW_ORDER, DELIVERY_CONFIRMED, READY_FOR_DELIVERY', () => {
  const workerPath = path.resolve('public/push-worker.js');
  assert(fs.existsSync(workerPath), 'public/push-worker.js deve existir');
  const content = fs.readFileSync(workerPath, 'utf8');

  assert(content.includes('self.skipWaiting()'), 'Worker deve invocar skipWaiting()');
  assert(content.includes('self.clients.claim()'), 'Worker deve invocar clients.claim()');
  assert(content.includes('event.waitUntil'), 'Handler de push deve usar event.waitUntil');
  assert(content.includes('self.registration.showNotification'), 'Worker deve invocar showNotification');
  assert(content.includes('requireInteraction: true'), 'Notificação deve ter requireInteraction: true para tela de bloqueio');
  assert(content.includes('renotify: true'), 'Notificação deve ter renotify: true');
  assert(content.includes('vibrate:'), 'Notificação deve definir vibração');
  assert(content.includes('DELIVERY_CONFIRMED'), 'Worker deve reconhecer DELIVERY_CONFIRMED');
  assert(content.includes('NEW_ORDER'), 'Worker deve reconhecer NEW_ORDER');
  assert(content.includes('READY_FOR_DELIVERY'), 'Worker deve reconhecer READY_FOR_DELIVERY para entregadores');
  assert(content.includes('Pedido pronto para entrega!'), 'Worker deve ter título específico para pedido pronto');
  assert(!content.match(/if\s*\(!event\.data\)\s*return;/), 'Worker NÃO deve abortar silenciosamente se event.data for nulo');
});

// 2. Verify Vercel Serverless notify-order.ts awaits execution
runTest('2. api/push/notify-order.ts: Execução assíncrona aguardada (await) e suporte a READY_FOR_DELIVERY', () => {
  const handlerPath = path.resolve('api/push/notify-order.ts');
  assert(fs.existsSync(handlerPath), 'api/push/notify-order.ts deve existir');
  const content = fs.readFileSync(handlerPath, 'utf8');

  assert(!content.includes('sendOrderPushNotification(order).catch('), 'NÃO pode haver promessa solta sem await no Serverless');
  assert(content.includes('await sendOrderPushNotification('), 'Handler DEVE aguardar (await) sendOrderPushNotification');
  assert(content.includes('DELIVERY_CONFIRMED'), 'Handler deve suportar DELIVERY_CONFIRMED');
  assert(content.includes('READY_FOR_DELIVERY'), 'Handler deve suportar READY_FOR_DELIVERY');
  assert(content.includes('eventType'), 'Handler deve passar eventType ao despachador');
});

// 3. Verify pushBackendService.ts business rules
runTest('3. src/server/pushBackendService.ts: Filtro de perfis específico para entregadores e idempotência', () => {
  const servicePath = path.resolve('src/server/pushBackendService.ts');
  assert(fs.existsSync(servicePath), 'src/server/pushBackendService.ts deve existir');
  const content = fs.readFileSync(servicePath, 'utf8');

  assert(content.includes("event !== 'NEW_ORDER' && event !== 'DELIVERY_CONFIRMED' && event !== 'READY_FOR_DELIVERY'"), 'Validação de eventos autorizados');
  assert(content.includes("urgency: 'high'"), 'Disparo deve ter urgency: high');
  assert(content.includes('TTL: 86400'), 'Disparo deve ter TTL de 24h');
  assert(content.includes("['ENTREGADOR', 'ADMINISTRADOR', 'GERENTE'].includes(r)"), 'READY_FOR_DELIVERY deve mirar entregador e supervisores');
  assert(content.includes('isPushAlreadyDispatched'), 'Deve verificar idempotência');
  assert(content.includes('markPushDispatched'), 'Deve registrar disparo');
  assert(content.includes('404') && content.includes('410'), 'Deve tratar e podar endpoints 404/410');
});

// 4. Verify Separation of Roles for New Order Sounds in store.ts
runTest('4. src/services/store.ts: Entregador NÃO ouve alarme de novo pedido (isOrderPrepStaffRole)', () => {
  const storePath = path.resolve('src/services/store.ts');
  const content = fs.readFileSync(storePath, 'utf8');

  assert(content.includes('export function isOrderPrepStaffRole'), 'Deve definir função isOrderPrepStaffRole');
  assert(content.includes("'ADMINISTRADOR'") && content.includes("'COZINHA'"), 'isOrderPrepStaffRole inclui cozinha e admin');
  assert(!content.match(/isOrderPrepStaffRole[\s\S]{1,150}'ENTREGADOR'/), 'isOrderPrepStaffRole NÃO deve incluir ENTREGADOR');

  // Confirm driver ready methods exist
  assert(content.includes('startDriverReadyAlert'), 'Deve disparar startDriverReadyAlert quando pedido estiver pronto');
  assert(content.includes('silenceDriverReadyAlerts'), 'Deve ter silenceDriverReadyAlerts');
  assert(content.includes('markDriverReadyOrderSeen'), 'Deve ter markDriverReadyOrderSeen');
  assert(content.includes('isDriverAssignedToOrder'), 'Deve ter isDriverAssignedToOrder');
  assert(content.includes('READY_FOR_DELIVERY'), 'Deve ter suporte a despacho READY_FOR_DELIVERY');
});

// 5. Verify audio.ts sound distinction and control
runTest('5. src/services/audio.ts: Som distinto e controle de parada para entregadores', () => {
  const audioPath = path.resolve('src/services/audio.ts');
  const content = fs.readFileSync(audioPath, 'utf8');

  assert(content.includes('playReadyOrderAlert'), 'audio.ts deve implementar playReadyOrderAlert');
  assert(content.includes('startDriverReadyAlert'), 'audio.ts deve implementar startDriverReadyAlert');
  assert(content.includes('stopDriverReadyAlert'), 'audio.ts deve implementar stopDriverReadyAlert');
  assert(content.includes('isDriverReadyAlertActive'), 'audio.ts deve implementar isDriverReadyAlertActive');
});

// 6. Verify DriverReadyOrderAlert.tsx component and UI requirements
runTest('6. src/components/delivery/DriverReadyOrderAlert.tsx: Banner visual, parar som e botão entendido', () => {
  const alertPath = path.resolve('src/components/delivery/DriverReadyOrderAlert.tsx');
  assert(fs.existsSync(alertPath), 'DriverReadyOrderAlert.tsx deve existir');
  const content = fs.readFileSync(alertPath, 'utf8');

  assert(content.includes('Pedido pronto para entrega!'), 'Deve conter o título da notificação');
  assert(content.includes('Parar som'), 'Deve conter o botão Parar som');
  assert(content.includes('Entendido'), 'Deve conter o botão Entendido');
  assert(content.includes('stopDriverReadyAlert') || content.includes('silenceDriverReadyAlerts'), 'Deve silenciar o som no clique');
  assert(content.includes('O pedido está pronto para retirada e entrega'), 'Deve exibir a mensagem informativa');
});

// 7. Verify DeliveryPortal mounts DriverReadyOrderAlert
runTest('7. src/components/delivery/DeliveryPortal.tsx: Integração do DriverReadyOrderAlert', () => {
  const portalPath = path.resolve('src/components/delivery/DeliveryPortal.tsx');
  const content = fs.readFileSync(portalPath, 'utf8');

  assert(content.includes('DriverReadyOrderAlert'), 'DeliveryPortal deve importar e renderizar DriverReadyOrderAlert');
});

// 8. Verify server.ts endpoints
runTest('8. server.ts: Endpoints com suporte a READY_FOR_DELIVERY', () => {
  const serverPath = path.resolve('server.ts');
  const content = fs.readFileSync(serverPath, 'utf8');

  assert(content.includes("eventType: 'NEW_ORDER' | 'DELIVERY_CONFIRMED' | 'READY_FOR_DELIVERY'"), 'server.ts deve tipar READY_FOR_DELIVERY');
  assert(content.includes("'READY_FOR_DELIVERY'"), 'server.ts deve aceitar READY_FOR_DELIVERY');
});

console.log(`\n========================================`);
console.log(`RESULTADO: ${testsPassed} testes passaram, ${testsFailed} falharam.`);
console.log(`========================================\n`);

if (testsFailed > 0) {
  process.exit(1);
}
