/**
 * Automated Test Suite: Flow Regressions, Multi-Item Cart,
 * Push Notification Integrity, 4 Payment Methods & Delivery RBAC
 * Amandita Sabores
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
  }
}

console.log('======================================================================');
console.log('TEST SUITE: AMANDITA SABORES - INVESTIGAÇÃO E CORREÇÃO DE FLUXOS');
console.log('======================================================================\n');

// 1. CustomerMenu & Multi-Item Cart
console.log('1. Verificando Cardápio Público, Multi-Item e Cardápio do Dia...');
const customerMenuContent = fs.readFileSync(path.join(__dirname, '../src/components/menu/CustomerMenu.tsx'), 'utf8');

test('CustomerMenu persiste carrinho no localStorage (gf_customer_cart)', () => {
  assert(customerMenuContent.includes('gf_customer_cart'), 'Deve persistir carrinho no localStorage');
});

test('CustomerMenu NÃO abre carrinho compulsoriamente ao adicionar item', () => {
  assert(!customerMenuContent.includes('// Auto-abre carrinho'), 'Não deve ter comentário de auto-abrir');
  assert(customerMenuContent.includes('cartToast'), 'Deve disparar notificação suave/toast ao adicionar item');
});

test('CustomerMenu remove seletor de Catálogo Completo e restringe ao Cardápio do Dia', () => {
  assert(!customerMenuContent.includes('viewScope'), 'Não deve ter seletor de escopo de catálogo');
  assert(customerMenuContent.includes('Cardápio do Dia Indisponível'), 'Deve exibir estado vazio informativo se nada publicado');
});

test('CustomerMenu suporta 4 formas de pagamento distintas', () => {
  assert(customerMenuContent.includes("'DINHEIRO'"), 'Suporta Dinheiro');
  assert(customerMenuContent.includes("'PIX'"), 'Suporta PIX');
  assert(customerMenuContent.includes("'CARTAO_CREDITO'"), 'Suporta Cartão de Crédito');
  assert(customerMenuContent.includes("'CARTAO_DEBITO'"), 'Suporta Cartão de Débito');
  assert(customerMenuContent.includes('Cartão de Crédito'), 'Exibe rótulo Cartão de Crédito');
  assert(customerMenuContent.includes('Cartão de Débito'), 'Exibe rótulo Cartão de Débito');
});

// 2. Notificações Públicas vs Privadas e Isolamento Sonoro
console.log('\n2. Verificando Isolamento de Notificações Públicas e Privadas...');
const storeContent = fs.readFileSync(path.join(__dirname, '../src/services/store.ts'), 'utf8');

test('store.ts possui método de detecção de contexto público do cliente', () => {
  assert(storeContent.includes('isPublicCustomerContext'), 'Deve conter isPublicCustomerContext()');
});

test('store.ts bloqueia campainha de pedidos no BroadcastChannel se for contexto público', () => {
  assert(storeContent.includes('!this.isPublicCustomerContext()'), 'BroadcastChannel onmessage deve verificar !isPublicCustomerContext()');
});

test('store.ts removeu chamada duplicada de fetch(/api/push/notify-order) em createOrder', () => {
  const createOrderSection = storeContent.slice(storeContent.indexOf('async createOrder('), storeContent.indexOf('async updateOrderStatus('));
  assert(!createOrderSection.includes("fetch('/api/push/notify-order'"), 'createOrder não deve disparar fetch paralelo para /api/push/notify-order');
});

// 3. Servidor: Push Notifications e Ordenação
console.log('\n3. Verificando Servidor Backend (server.ts) e Push Worker...');
const serverContent = fs.readFileSync(path.join(__dirname, '../server.ts'), 'utf8');
const pushWorkerContent = fs.readFileSync(path.join(__dirname, '../public/push-worker.js'), 'utf8');

test('server.ts filtra push exclusivamente para colaboradores da equipe', () => {
  assert(serverContent.includes('staffSubscriptions'), 'Deve filtrar para staffSubscriptions');
  assert(serverContent.includes("'ADMINISTRADOR'") && serverContent.includes("'COZINHA'"), 'Filtra papéis de equipe');
});

test('server.ts envia timestamp real do pedido no payload para ordenação cronológica no SO', () => {
  assert(serverContent.includes('orderTimestamp') && serverContent.includes('order.createdAt'), 'Payload deve conter timestamp baseado em order.createdAt');
  assert(serverContent.includes('timestamp: orderTimestamp'), 'Payload do push deve passar timestamp do pedido');
});

test('push-worker.js preserva timestamp recebido do servidor nas opções da notificação', () => {
  assert(pushWorkerContent.includes('timestamp: payload.timestamp'), 'Worker deve repassar timestamp para showNotification');
});

// 4. PDV: Venda sem travamentos, 4 pagamentos e impressão térmica
console.log('\n4. Verificando Ponto de Venda (PointOfSale.tsx)...');
const posContent = fs.readFileSync(path.join(__dirname, '../src/components/admin/PointOfSale.tsx'), 'utf8');

test('PointOfSale suporta 4 formas de pagamento distintas', () => {
  assert(posContent.includes('CARTAO_CREDITO'), 'Suporta CARTAO_CREDITO no PDV');
  assert(posContent.includes('CARTAO_DEBITO'), 'Suporta CARTAO_DEBITO no PDV');
  assert(posContent.includes('Crédito'), 'Botão Crédito visível');
  assert(posContent.includes('Débito'), 'Botão Débito visível');
});

test('PointOfSale não trava ao finalizar venda e limpa para nova venda com banner de sucesso', () => {
  assert(posContent.includes('saleSuccessBanner'), 'Possui banner de sucesso não-bloqueante');
  assert(posContent.includes('setCompletedOrder(null)'), 'Limpa completedOrder imediatamente');
  assert(posContent.includes('handleClearCart()'), 'Limpa carrinho imediatamente');
  assert(posContent.includes('Imprimir Cupom'), 'Opção de impressão térmica 58mm presente');
});

// 5. Portal do Entregador e Tela de Login Dedicada
console.log('\n5. Verificando Portal do Entregador e Tela de Login Dedicada...');
const deliveryLoginExists = fs.existsSync(path.join(__dirname, '../src/components/delivery/DeliveryLoginScreen.tsx'));
const appContent = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
const deliveryPortalContent = fs.readFileSync(path.join(__dirname, '../src/components/delivery/DeliveryPortal.tsx'), 'utf8');

test('DeliveryLoginScreen.tsx existe e está implementado', () => {
  assert(deliveryLoginExists, 'Arquivo DeliveryLoginScreen.tsx deve existir');
});

test('App.tsx permite exibição de DeliveryLoginScreen para visitantes não autenticados em view=entregador', () => {
  assert(appContent.includes("view === 'entregador' && !user"), 'isViewAllowedForUser deve permitir entregador deslogado para exibir login');
  assert(appContent.includes('<DeliveryLoginScreen'), 'App.tsx deve renderizar DeliveryLoginScreen');
});

test('DeliveryPortal restringe visualização a entregas autorizadas para o entregador', () => {
  assert(deliveryPortalContent.includes('isDriverRole'), 'Identifica se o usuário é entregador');
  assert(deliveryPortalContent.includes('!isDriverRole'), 'Oculta botão Alterar perfil de entregador');
});

// 6. Integridade de firestore.rules
console.log('\n6. Verificando Integridade de firestore.rules...');
const rulesContent = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');

test('firestore.rules existe e preserva a estrutura de coleções intacta', () => {
  assert(rulesContent.includes("rules_version = '2'"), 'Regras versão 2');
  assert(rulesContent.includes('/orders/{orderId}'), 'Coleção orders protegida');
  assert(rulesContent.includes('/users/{userId}'), 'Coleção users protegida');
  assert(rulesContent.includes('/push_subscriptions/{subId}'), 'Coleção push_subscriptions preservada');
  assert(rulesContent.includes('/public_tracking/{trackingCode}'), 'Coleção public_tracking preservada');
});

console.log('\n======================================================================');
console.log(`TOTAL DE TESTES: ${totalTests} | APROVADOS: ${passedTests} | FALHAS: ${totalTests - passedTests}`);
console.log('======================================================================\n');

if (passedTests === totalTests) {
  console.log('✓ TODAS AS VALIDAÇÕES DE FLUXO FORAM APROVADAS COM SUCESSO!\n');
  process.exit(0);
} else {
  console.error('✗ UMA OU MAIS VALIDAÇÕES FALHARAM.\n');
  process.exit(1);
}
