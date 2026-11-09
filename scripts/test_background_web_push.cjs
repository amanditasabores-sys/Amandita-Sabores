/**
 * Comprehensive Automated Verification for Background Web Push & Lock Screen Delivery
 * Amandita Sabores
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== TESTE AUTOMATIZADO: WEB PUSH EM SEGUNDO PLANO E TELA BLOQUEADA ===\n');

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
runTest('1. push-worker.js: Estrutura resiliente de segundo plano e tela bloqueada', () => {
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
  assert(!content.match(/if\s*\(!event\.data\)\s*return;/), 'Worker NÃO deve abortar silenciosamente se event.data for nulo');
});

// 2. Verify Vercel Serverless notify-order.ts awaits execution
runTest('2. api/push/notify-order.ts: Execução assíncrona aguardada (await) no Serverless', () => {
  const handlerPath = path.resolve('api/push/notify-order.ts');
  assert(fs.existsSync(handlerPath), 'api/push/notify-order.ts deve existir');
  const content = fs.readFileSync(handlerPath, 'utf8');

  assert(!content.includes('sendOrderPushNotification(order).catch('), 'NÃO pode haver promessa solta sem await no Serverless');
  assert(content.includes('await sendOrderPushNotification('), 'Handler DEVE aguardar (await) sendOrderPushNotification');
  assert(content.includes('DELIVERY_CONFIRMED'), 'Handler deve suportar DELIVERY_CONFIRMED');
  assert(content.includes('eventType'), 'Handler deve passar eventType ao despachador');
});

// 3. Verify pushBackendService.ts business rules
runTest('3. src/server/pushBackendService.ts: Regras de negócio, filtro de perfis e idempotência', () => {
  const servicePath = path.resolve('src/server/pushBackendService.ts');
  assert(fs.existsSync(servicePath), 'src/server/pushBackendService.ts deve existir');
  const content = fs.readFileSync(servicePath, 'utf8');

  assert(content.includes("event !== 'NEW_ORDER' && event !== 'DELIVERY_CONFIRMED'"), 'Apenas NEW_ORDER e DELIVERY_CONFIRMED são autorizados');
  assert(content.includes("urgency: 'high'"), 'Disparo deve ter urgency: high');
  assert(content.includes('TTL: 86400'), 'Disparo deve ter TTL de 24h');
  assert(content.includes('ADMINISTRADOR') && content.includes('ENTREGADOR'), 'Deve filtrar para equipe/entregadores');
  assert(content.includes('isPushAlreadyDispatched'), 'Deve verificar idempotência');
  assert(content.includes('markPushDispatched'), 'Deve registrar disparo');
  assert(content.includes('404') && content.includes('410'), 'Deve tratar e podar endpoints 404/410');
});

// 4. Verify PWA Workbox importScripts
runTest('4. vite.config.ts: Inclusão do push-worker.js no Service Worker da PWA', () => {
  const viteConfigPath = path.resolve('vite.config.ts');
  const content = fs.readFileSync(viteConfigPath, 'utf8');
  assert(content.includes("importScripts: ['/push-worker.js']"), 'Workbox deve importar /push-worker.js');
});

// 5. Verify Store independent notification toggles
runTest('5. src/services/store.ts: Toggles independentes para NEW_ORDER e DELIVERY_CONFIRMED', () => {
  const storePath = path.resolve('src/services/store.ts');
  const content = fs.readFileSync(storePath, 'utf8');
  assert(content.includes('notifyNewOrders === false'), 'Deve respeitar notifyNewOrders');
  assert(content.includes('notifyDeliveryConfirmed === false'), 'Deve respeitar notifyDeliveryConfirmed');
  assert(content.includes("event === 'NEW_ORDER'"), 'Deve verificar NEW_ORDER');
  assert(content.includes("event === 'DELIVERY_CONFIRMED'"), 'Deve verificar DELIVERY_CONFIRMED');
});

console.log(`\n========================================`);
console.log(`RESULTADO: ${testsPassed} testes passaram, ${testsFailed} falharam.`);
console.log(`========================================\n`);

if (testsFailed > 0) {
  process.exit(1);
}
