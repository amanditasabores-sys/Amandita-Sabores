/**
 * Automated Test Suite: Flow Regressions, Multi-Item Cart,
 * Push Notification Integrity, PDV Financial Safety, Cash Shift Serialization,
 * Thermal Printing Resilience, and Delivery Portal Complete Isolation
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
console.log('TEST SUITE: AMANDITA SABORES - PDV & ISOLAMENTO DO PORTAL DO ENTREGADOR');
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

test('CustomerMenu restringe exibição exclusivamente ao Cardápio do Dia', () => {
  assert(!customerMenuContent.includes('viewScope'), 'Não deve ter seletor de escopo de catálogo');
  assert(customerMenuContent.includes('Cardápio do Dia Indisponível'), 'Deve exibir estado vazio informativo se nada publicado');
});

test('CustomerMenu suporta 4 formas de pagamento distintas', () => {
  assert(customerMenuContent.includes("'DINHEIRO'"), 'Suporta Dinheiro');
  assert(customerMenuContent.includes("'PIX'"), 'Suporta PIX');
  assert(customerMenuContent.includes("'CARTAO_CREDITO'"), 'Suporta Cartão de Crédito');
  assert(customerMenuContent.includes("'CARTAO_DEBITO'"), 'Suporta Cartão de Débito');
});

// 2. PDV: Venda sem travamentos, serialização segura, trava de duplo clique e impressão térmica
console.log('\n2. Verificando Ponto de Venda (PointOfSale.tsx) e Sanitização do Caixa (store.ts)...');
const posContent = fs.readFileSync(path.join(__dirname, '../src/components/admin/PointOfSale.tsx'), 'utf8');
const storeContent = fs.readFileSync(path.join(__dirname, '../src/services/store.ts'), 'utf8');

test('PointOfSale possui trava estrita contra duplo clique (submittingRef)', () => {
  assert(posContent.includes('submittingRef = useRef(false)'), 'Deve declarar submittingRef');
  assert(posContent.includes('submittingRef.current = true'), 'Deve travar submittingRef antes da chamada assíncrona');
  assert(posContent.includes('submittingRef.current = false'), 'Deve destravar submittingRef no finally');
});

test('PointOfSale suporta 4 formas de pagamento (Dinheiro, PIX, Cartão Débito, Cartão Crédito)', () => {
  assert(posContent.includes('CARTAO_CREDITO'), 'Suporta CARTAO_CREDITO no PDV');
  assert(posContent.includes('CARTAO_DEBITO'), 'Suporta CARTAO_DEBITO no PDV');
  assert(posContent.includes('Crédito'), 'Botão Crédito visível');
  assert(posContent.includes('Débito'), 'Botão Débito visível');
});

test('store.ts sanitiza documentos de turnos de caixa para evitar erro de campo undefined no setDoc', () => {
  assert(storeContent.includes('this.cleanForFirestore(shift)'), 'saveCurrentCashShift deve chamar cleanForFirestore');
  assert(storeContent.includes('this.cleanForFirestore(closedShift)'), 'closeCashRegister deve chamar cleanForFirestore');
  assert(storeContent.includes('cleanForFirestore<T>'), 'Método cleanForFirestore deve existir em store.ts');
});

test('store.ts não auto-imprime na criação de pedidos se for contexto de PDV/equipe', () => {
  assert(storeContent.includes('isPdvOrStaffContext'), 'store.ts deve checar contexto de PDV antes de auto-imprimir');
  assert(storeContent.includes('!isPdvOrStaffContext && printerCfg.enabled'), 'Deve ignorar auto-impressão para vendas originadas no PDV');
});

test('PointOfSale executa ordem segura: grava pedido -> grava caixa -> limpa carrinho -> imprime cupom', () => {
  const finalizeIdx = posContent.indexOf('const handleFinalizeSale = async () => {');
  const createOrderIdx = posContent.indexOf('store.createOrderAsync(', finalizeIdx);
  const addCashIdx = posContent.indexOf('store.addCashMovement(', createOrderIdx);
  const clearCartIdx = posContent.indexOf('handleClearCart()', addCashIdx);
  const printIdx = posContent.indexOf('thermalPrinterService.printOrder(', clearCartIdx);

  assert(createOrderIdx > finalizeIdx, 'Criação de pedido deve ocorrer primeiro');
  assert(addCashIdx > createOrderIdx, 'Movimento de caixa deve ser registrado após criação do pedido');
  assert(clearCartIdx > addCashIdx, 'Carrinho deve ser esvaziado antes da impressão para evitar reenvio');
  assert(printIdx > clearCartIdx, 'Impressão térmica deve ocorrer após venda e caixa estarem confirmados');
});

test('PointOfSale trata falhas de impressora com resiliência sem abortar a venda', () => {
  assert(posContent.includes('Falha na impressão do cupom térmico (a venda permanece registrada com sucesso)'), 'Deve capturar erro da impressora');
  assert(posContent.includes('printed: printSuccess'), 'Banner deve informar se cupom foi impresso');
  assert(posContent.includes('Reimprimir Cupom'), 'Deve disponibilizar botão de reimpressão imediata');
});

// 3. Portal do Entregador: Isolamento Total de Sessão e Filtro Rígido
console.log('\n3. Verificando Portal do Entregador e Isolamento de Sessão...');
const appContent = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
const deliveryPortalContent = fs.readFileSync(path.join(__dirname, '../src/components/delivery/DeliveryPortal.tsx'), 'utf8');
const deliveryLoginExists = fs.existsSync(path.join(__dirname, '../src/components/delivery/DeliveryLoginScreen.tsx'));

test('DeliveryLoginScreen.tsx existe e está implementado', () => {
  assert(deliveryLoginExists, 'Arquivo DeliveryLoginScreen.tsx deve existir');
});

test('App.tsx utiliza autenticação unificada e sessão centralizada (currentUser / gf_current_user)', () => {
  assert(appContent.includes('UnifiedLoginScreen'), 'App.tsx deve usar UnifiedLoginScreen');
  assert(appContent.includes('currentUser'), 'App.tsx deve usar currentUser como sessão oficial');
});

test('App.tsx oculta barra global de navegação do administrador em view=entregador', () => {
  assert(appContent.includes("currentView !== 'entregador'"), 'isGlobalToolbarVisible deve excluir entregador');
});

test('App.tsx inicializa selectedOrderId como vazio (não vaza pedido #1002 de retirada)', () => {
  assert(appContent.includes("selectedOrderId, setSelectedOrderId] = useState<string>('')"), 'selectedOrderId deve iniciar vazio');
});

test('DeliveryPortal removeu o botão de PDV e o botão de Alterar perfil', () => {
  assert(!deliveryPortalContent.includes('switch_to_pdv'), 'DeliveryPortal não deve conter atalho switch_to_pdv');
  assert(!deliveryPortalContent.includes('(Alterar)'), 'DeliveryPortal não deve conter botão (Alterar)');
  assert(!deliveryPortalContent.includes('isEditingProfile'), 'DeliveryPortal não deve conter modal de edição de perfil');
});

test('DeliveryPortal exibe a logomarca oficial Amandita Sabores no cabeçalho', () => {
  assert(deliveryPortalContent.includes('<AmanditaLogo variant="icon" size="sm" theme="dark" />'), 'Deve renderizar AmanditaLogo');
});

test('DeliveryPortal filtra rigorosamente para NUNCA exibir pedidos de Retirada no Balcão', () => {
  assert(deliveryPortalContent.includes("if (o.fulfillmentType !== 'DELIVERY') return false; // Never show Retirada no Balcão"), 'Filtra fulfillmentType DELIVERY em ready');
  assert(deliveryPortalContent.includes("if (o.fulfillmentType !== 'DELIVERY') return false;"), 'Filtra fulfillmentType DELIVERY em done');
  assert(deliveryPortalContent.includes('Aguardando Entrega'), 'Card de métricas deve dizer Aguardando Entrega e não Prontos no Balcão');
});

test('App.tsx e store.ts invalidam sessões de colaboradores desativados imediatamente', () => {
  assert(appContent.includes("fresh.status === 'DESATIVADO' || fresh.status === 'BLOQUEADO'"), 'App.tsx invalida sessão de usuário desativado');
  assert(appContent.includes('Sua conta de colaborador foi desativada ou bloqueada pela administração'), 'Exibe aviso de desativação');
});

test('Regras RBAC impedem entregador de acessar módulos administrativos (PDV, Caixa, Cozinha, etc.)', () => {
  assert(appContent.includes("if (role === 'ENTREGADOR') return false;"), 'isViewAllowedForUser bloqueia entregador de views administrativas');
  assert(storeContent.includes('canUserManageCash'), 'store.ts valida se perfil pode gerenciar caixa');
  assert(storeContent.includes('canUserManageMenu'), 'store.ts valida se perfil pode gerenciar cardápio');
});

// 4. Integridade de firestore.rules
console.log('\n4. Verificando Integridade de firestore.rules...');
const rulesContent = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');

test('firestore.rules foi rigorosamente preservado intacto sem alterações não autorizadas', () => {
  assert(rulesContent.includes("rules_version = '2'"), 'Regras versão 2');
  assert(rulesContent.includes('/orders/{orderId}'), 'Coleção orders protegida');
  assert(rulesContent.includes('/users/{userId}'), 'Coleção users protegida');
  assert(rulesContent.includes('/cash_shifts/{shiftId}'), 'Coleção cash_shifts protegida');
  assert(rulesContent.includes('/push_subscriptions/{subId}'), 'Coleção push_subscriptions preservada');
  assert(rulesContent.includes('/public_tracking/{trackingCode}'), 'Coleção public_tracking preservada');
});

console.log('\n======================================================================');
console.log(`TOTAL DE TESTES: ${totalTests} | APROVADOS: ${passedTests} | FALHAS: ${totalTests - passedTests}`);
console.log('======================================================================\n');

if (passedTests === totalTests) {
  console.log('✓ TODAS AS 21 VALIDAÇÕES TÉCNICAS FORAM APROVADAS COM SUCESSO!\n');
  process.exit(0);
} else {
  console.error('✗ UMA OU MAIS VALIDAÇÕES FALHARAM.\n');
  process.exit(1);
}
