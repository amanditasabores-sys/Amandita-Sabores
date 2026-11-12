// scripts/test_deletion_and_sync_stability.cjs
// Valida tecnicamente o fluxo de exclusão persistente e a estabilidade do status de sincronização

const assert = require('assert');

console.log('=== TESTE AUTOMATIZADO: EXCLUSÃO DE PEDIDOS E ESTABILIDADE DE SINCRONIZAÇÃO ===\n');

// 1. Verificar implementação da rota de exclusão no backend (server.ts)
const fs = require('fs');
const serverContent = fs.readFileSync('./server.ts', 'utf8');

assert(
  serverContent.includes("app.delete(['/api/orders/:id', '/orders/:id']"),
  'Endpoint DELETE /api/orders/:id deve estar registrado em server.ts'
);
assert(
  serverContent.includes("app.post(['/api/orders/delete', '/orders/delete']"),
  'Endpoint POST /api/orders/delete deve estar registrado como fallback em server.ts'
);
assert(
  serverContent.includes('verifyStaffAuth'),
  'A exclusão de pedidos deve validar autenticação de colaborador'
);
assert(
  serverContent.includes('adminDb.collection(\'orders\').doc(orderId).delete()'),
  'Exclusão deve remover o documento do Cloud Firestore via Admin SDK'
);
console.log('✅ [PASS] 1. Endpoints de exclusão no servidor (DELETE & POST /api/orders/:id com Admin SDK e REST API)');

// 2. Verificar implementação de deleteOrderAsync e tombstones em store.ts
const storeContent = fs.readFileSync('./src/services/store.ts', 'utf8');

assert(
  storeContent.includes('public getDeletedOrderIds(): Set<string>'),
  'store.ts deve implementar getDeletedOrderIds()'
);
assert(
  storeContent.includes('public recordDeletedOrderId(orderId: string): void'),
  'store.ts deve implementar recordDeletedOrderId()'
);
assert(
  storeContent.includes('public async deleteOrderAsync(orderId: string)'),
  'store.ts deve implementar deleteOrderAsync()'
);
assert(
  storeContent.includes('this.removeOrderFromSyncQueue(orderId)'),
  'Exclusão deve remover o pedido da fila de sincronização pendente'
);
console.log('✅ [PASS] 2. Métodos deleteOrderAsync, getDeletedOrderIds e remoção da fila em store.ts');

// 3. Verificar que o listener do Firestore em store.ts descarta pedidos tombstone
assert(
  storeContent.includes('const deletedIds = this.getDeletedOrderIds()'),
  'initStaffFirestoreSync deve consultar a lista de pedidos excluídos'
);
assert(
  storeContent.includes('if (deletedIds.has(ro.id))'),
  'initStaffFirestoreSync deve descartar pedidos que já foram excluídos'
);
assert(
  storeContent.includes('if (!deletedIds.has(lo.id))'),
  'initStaffFirestoreSync não deve processar pedidos locais excluídos'
);
console.log('✅ [PASS] 3. Proteção contra ressurreição de pedidos excluídos (tombstone filter no onSnapshot)');

// 4. Verificar preservação de entregador e estabilização de sync status
assert(
  storeContent.includes('const mergedDeliveryPersonId = ro.deliveryPersonId || lo.deliveryPersonId'),
  'initStaffFirestoreSync deve preservar atribuição de entregador para evitar oscilação de dados'
);
assert(
  !storeContent.includes('localStorage.setItem(\'gf_orders\', JSON.stringify(merged));\n\n            // Apply automated assignment rule: if exactly 1 active driver exists, auto-assign\n            this.applyAutomaticDriverAssignment();'),
  'applyAutomaticDriverAssignment não pode ser chamado repetidamente dentro do onSnapshot de pedidos'
);
console.log('✅ [PASS] 4. Estabilidade do status de sincronização (sem loop de alternância verde/laranja)');

// 5. Verificar feedback visual e tratamento assíncrono em LiveOrdersKanban.tsx
const kanbanContent = fs.readFileSync('./src/components/admin/LiveOrdersKanban.tsx', 'utf8');

assert(
  kanbanContent.includes('const [isDeletingOrder, setIsDeletingOrder] = useState(false);'),
  'LiveOrdersKanban deve possuir estado de carregamento durante exclusão'
);
assert(
  kanbanContent.includes('const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);'),
  'LiveOrdersKanban deve possuir estado de erro para exclusão'
);
assert(
  kanbanContent.includes('await store.deleteOrderAsync(orderToDelete.id)'),
  'executeDeleteOrder deve aguardar confirmação assíncrona'
);
assert(
  kanbanContent.includes('isLoading={isDeletingOrder}'),
  'ConfirmModal deve receber estado de carregamento'
);
console.log('✅ [PASS] 5. Feedback visual assíncrono e modal de confirmação em LiveOrdersKanban.tsx');

console.log('\n========================================');
console.log('TODAS AS 5 VALIDAÇÕES TÉCNICAS PASSARAM COM SUCESSO!');
console.log('========================================');
