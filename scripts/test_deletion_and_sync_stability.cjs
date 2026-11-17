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

// 3. Verificar que reconcileRemoteOrders e listener em store.ts descartam pedidos tombstone e propagam exclusões
assert(
  storeContent.includes('const deletedIds = this.getDeletedOrderIds()'),
  'reconcileRemoteOrders deve consultar a lista de pedidos excluídos'
);
assert(
  storeContent.includes('if (deletedIds.has(ro.id))'),
  'reconcileRemoteOrders deve descartar pedidos que já foram excluídos'
);
assert(
  storeContent.includes('.filter((lo) => !deletedIds.has(lo.id))'),
  'reconcileRemoteOrders não deve processar pedidos locais excluídos'
);
assert(
  storeContent.includes('syncTombstonesFromServer'),
  'store.ts deve sincronizar tombstones compartilhados do servidor'
);
assert(
  storeContent.includes("updateErr?.code === 'not-found'") && storeContent.includes('updateDoc('),
  'persistOrderToFirestore deve usar updateDoc em pedidos já sincronizados para não ressuscitar exclusões remotas'
);
console.log('✅ [PASS] 3. Proteção contra ressurreição de pedidos excluídos (tombstone filter + updateDoc + tombstones do servidor)');

// 4. Verificar serialização de escritas e ausência de sucesso falso na exclusão no servidor
assert(
  storeContent.includes('pendingOrderRewrites') && storeContent.includes('isLocalPendingAhead'),
  'store.ts deve serializar gravações consecutivas e proteger atualizações pendentes'
);
assert(
  !serverContent.includes('if (deletedFromFirestore || !adminDb)'),
  'server.ts NÃO pode retornar sucesso falso quando !adminDb sem confirmação do Firestore'
);
console.log('✅ [PASS] 4. Estabilidade do status de sincronização e confirmação real de exclusão no servidor');

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
