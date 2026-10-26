/**
 * Comprehensive Security Rules Simulator & Test Suite for Amandita Sabores
 * Evaluates all hardened security invariants, role-specific immutable fields,
 * item-price consistency, public tracking PII shield, and user escalation guards.
 */

const assert = require('assert');

class FirestoreRuleEngine {
  constructor(firestoreState = {}) {
    this.db = firestoreState; // collection -> docId -> docData
  }

  isValidId(id) {
    return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id);
  }

  hasActiveProfile(auth) {
    if (!auth || !auth.uid) return false;
    const userDoc = this.db.users?.[auth.uid];
    return !!(userDoc && userDoc.status === 'ATIVO');
  }

  userRole(auth) {
    return this.db.users?.[auth.uid]?.role;
  }

  isBootstrappedAdmin(auth) {
    if (!auth || !auth.token || !auth.token.email) return false;
    return auth.token.email === 'dvrmercadinho@gmail.com' || auth.token.email === 'admin@amanditasabores.com.br';
  }

  isAdmin(auth) {
    return this.isBootstrappedAdmin(auth) || (
      this.hasActiveProfile(auth) && (this.userRole(auth) === 'ADMINISTRADOR' || this.userRole(auth) === 'admin')
    );
  }

  isGerente(auth) {
    return this.isAdmin(auth) || (
      this.hasActiveProfile(auth) && (this.userRole(auth) === 'GERENTE' || this.userRole(auth) === 'gerente')
    );
  }

  isStaff(auth) {
    return this.isGerente(auth) || (
      this.hasActiveProfile(auth) && [
        'CAIXA', 'COZINHA', 'ENTREGADOR', 'ATENDENTE',
        'caixa', 'cozinha', 'entregador', 'atendente'
      ].includes(this.userRole(auth))
    );
  }

  isKitchenStaff(auth) {
    return this.isGerente(auth) || (this.hasActiveProfile(auth) && ['COZINHA', 'cozinha'].includes(this.userRole(auth)));
  }

  isDeliveryStaff(auth) {
    return this.isGerente(auth) || (this.hasActiveProfile(auth) && ['ENTREGADOR', 'entregador'].includes(this.userRole(auth)));
  }

  isCashierStaff(auth) {
    return this.isGerente(auth) || (this.hasActiveProfile(auth) && ['CAIXA', 'caixa', 'ATENDENTE', 'atendente'].includes(this.userRole(auth)));
  }

  // Collection: menu_items
  evalMenuItemGet(auth, itemId) {
    return this.isValidId(itemId);
  }
  evalMenuItemList(auth) {
    return true;
  }
  evalMenuItemWrite(auth, itemId) {
    return this.isValidId(itemId) && this.isGerente(auth);
  }

  // Collection: configs
  evalConfigGet(auth, configId) {
    return configId === 'restaurant';
  }
  evalConfigList(auth) {
    return this.isStaff(auth);
  }
  evalConfigWrite(auth, configId) {
    return configId === 'restaurant' && this.isAdmin(auth);
  }

  // Collection: orders
  evalOrderList(auth) {
    return this.isStaff(auth);
  }
  evalOrderGet(auth, orderId) {
    return this.isValidId(orderId) && this.isStaff(auth);
  }
  isPriceExact(submittedPrice, officialPrice) {
    return Math.abs(submittedPrice - officialPrice) <= 0.001;
  }

  isValidAddon(addon) {
    if (typeof addon !== 'object' || !addon) return false;
    if (!('id' in addon && 'name' in addon && 'price' in addon)) return false;
    if (!this.isValidId(addon.id)) return false;
    if (typeof addon.name !== 'string' || addon.name.length > 60) return false;
    if (typeof addon.price !== 'number') return false;
    return addon.price === 3.00 || addon.price === 0.00;
  }

  isItemSubtotalExact(item) {
    const base = item.unitPrice;
    const q = item.quantity;
    const addons = item.addons || [];
    if (!Array.isArray(addons) || addons.length === 0) {
      return Math.abs(item.subtotal - (base * q)) <= 0.01;
    }
    if (addons.length > 4) return false;
    let addonsTotal = 0;
    for (const a of addons) {
      if (!this.isValidAddon(a)) return false;
      addonsTotal += a.price;
    }
    const expected = (base + addonsTotal) * q;
    return Math.abs(item.subtotal - expected) <= 0.01;
  }

  isValidOrderItemStructure(item) {
    if (typeof item !== 'object' || !item) return false;
    const required = ['id', 'name', 'quantity', 'unitPrice', 'subtotal', 'menuItemId'];
    for (const r of required) {
      if (!(r in item)) return false;
    }
    if (!this.isValidId(item.id)) return false;
    if (!this.isValidId(item.menuItemId)) return false;
    if (typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 100) return false;
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) return false;
    if (typeof item.unitPrice !== 'number' || item.unitPrice <= 0) return false;
    if (typeof item.subtotal !== 'number' || item.subtotal < (item.unitPrice * item.quantity) - 0.01) return false;
    return true;
  }

  isItemCatalogConsistent(item) {
    if (!this.isValidOrderItemStructure(item)) return false;
    const catalogItem = this.db.menu_items?.[item.menuItemId];
    if (!catalogItem) return false; // Rejects nonexistent products
    if (catalogItem.available !== true) return false; // Rejects unavailable products
    if (!this.isPriceExact(item.unitPrice, catalogItem.price)) return false; // Rejects undercharging and overcharging
    if (!this.isItemSubtotalExact(item)) return false; // Rejects addon price forgery and free addon theft
    return true;
  }

  areAllPublicItemsValid(items, subtotal) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 8) return false;
    const count = items.length;
    let sum = 0;
    for (let i = 0; i < count; i++) {
      if (!this.isItemCatalogConsistent(items[i])) return false;
      sum += items[i].subtotal;
    }
    return Math.abs(subtotal - sum) <= 0.01;
  }

  areStaffItemsValid(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 50) return false;
    const checkCount = Math.min(items.length, 8);
    for (let i = 0; i < checkCount; i++) {
      if (!this.isValidOrderItemStructure(items[i])) return false;
    }
    return true;
  }

  evalOrderCreate(auth, orderId, incoming) {
    if (!this.isValidId(orderId)) return false;
    if (incoming.id !== orderId) return false;
    const requiredKeys = [
      'id', 'orderNumber', 'createdAt', 'updatedAt',
      'fulfillmentType', 'customer', 'items', 'subtotal',
      'deliveryFee', 'discount', 'totalAmount', 'paymentMethod',
      'paymentStatus', 'status', 'movements'
    ];
    for (const k of requiredKeys) {
      if (!(k in incoming)) return false;
    }
    const staff = this.isStaff(auth);
    if (!(incoming.status === 'NOVO' || (incoming.status === 'EM_PREPARO' && staff))) return false;
    if (!(staff || incoming.paymentStatus === 'PENDENTE')) return false;
    if (typeof incoming.orderNumber !== 'string' || incoming.orderNumber.length < 2 || incoming.orderNumber.length > 32) return false;
    if (!['DELIVERY', 'RETIRADA'].includes(incoming.fulfillmentType)) return false;
    if (!['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO'].includes(incoming.paymentMethod)) return false;
    if (typeof incoming.customer !== 'object' || !incoming.customer || typeof incoming.customer.name !== 'string' || incoming.customer.name.length < 1 || incoming.customer.name.length > 100) return false;
    
    // Items list validation: all items checked against official catalog for public orders (1-5 items)
    if (!Array.isArray(incoming.items)) return false;
    const itemsValid = staff
      ? this.areStaffItemsValid(incoming.items)
      : this.areAllPublicItemsValid(incoming.items, incoming.subtotal);
    if (!itemsValid) return false;

    if (typeof incoming.subtotal !== 'number' || incoming.subtotal < 0 || incoming.subtotal > 100000) return false;
    if (typeof incoming.deliveryFee !== 'number' || incoming.deliveryFee < 0 || incoming.deliveryFee > 1000) return false;
    if (typeof incoming.discount !== 'number' || incoming.discount < 0 || incoming.discount > incoming.subtotal) return false;
    if (typeof incoming.totalAmount !== 'number' || incoming.totalAmount < 0) return false;
    const diff = incoming.totalAmount - (incoming.subtotal + incoming.deliveryFee - incoming.discount);
    if (diff < -0.01 || diff > 0.01) return false;
    if (incoming.fulfillmentType === 'RETIRADA' && incoming.deliveryFee !== 0) return false;
    
    // High-entropy tracking code requirement
    if (!('trackingCode' in incoming) || typeof incoming.trackingCode !== 'string' || incoming.trackingCode.length < 20) return false;
    if (!Array.isArray(incoming.movements) || incoming.movements.length < 1) return false;
    if (!staff) {
      if ('operatorName' in incoming) return false;
      if ('cancellationReason' in incoming) return false;
      if ('cancelledBy' in incoming) return false;
      if ('deliveryPerson' in incoming) return false;
      if (incoming.discount !== 0) return false;
    }
    return true;
  }

  evalOrderUpdate(auth, orderId, existing, incoming) {
    if (!this.isValidId(orderId)) return false;
    if (!this.isStaff(auth)) return false;
    
    // Primary identity immutable
    if (incoming.id !== existing.id) return false;
    if (incoming.orderNumber !== existing.orderNumber) return false;
    if (incoming.createdAt !== existing.createdAt) return false;
    if (incoming.fulfillmentType !== existing.fulfillmentType) return false;

    const isGerente = this.isGerente(auth);
    const isKitchen = this.isKitchenStaff(auth) && ['EM_PREPARO', 'PRONTO'].includes(incoming.status);
    const isDelivery = this.isDeliveryStaff(auth) && ['EM_ROTA', 'ENTREGUE'].includes(incoming.status);
    const isCashier = this.isCashierStaff(auth) && ['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'].includes(incoming.status);

    if (!isGerente && !isKitchen && !isDelivery && !isCashier) return false;

    // Kitchen specific immutable field restrictions
    if (this.isKitchenStaff(auth) && !isGerente) {
      if (incoming.subtotal !== existing.subtotal) return false;
      if (incoming.deliveryFee !== existing.deliveryFee) return false;
      if (incoming.discount !== existing.discount) return false;
      if (incoming.totalAmount !== existing.totalAmount) return false;
      if (incoming.paymentMethod !== existing.paymentMethod) return false;
      if (incoming.paymentStatus !== existing.paymentStatus) return false;
      if (JSON.stringify(incoming.items) !== JSON.stringify(existing.items)) return false;
      if (JSON.stringify(incoming.customer) !== JSON.stringify(existing.customer)) return false;
    }

    // Delivery specific immutable field restrictions
    if (this.isDeliveryStaff(auth) && !isGerente) {
      if (incoming.subtotal !== existing.subtotal) return false;
      if (incoming.deliveryFee !== existing.deliveryFee) return false;
      if (incoming.discount !== existing.discount) return false;
      if (incoming.totalAmount !== existing.totalAmount) return false;
      if (incoming.paymentMethod !== existing.paymentMethod) return false;
      if (JSON.stringify(incoming.items) !== JSON.stringify(existing.items)) return false;
      if (incoming.customer?.name !== existing.customer?.name) return false;
    }

    // Cashier specific immutable field restrictions
    if (this.isCashierStaff(auth) && !isGerente) {
      if (JSON.stringify(incoming.items) !== JSON.stringify(existing.items)) return false;
      if (incoming.subtotal !== existing.subtotal) return false;
      if (incoming.deliveryFee !== existing.deliveryFee) return false;
    }

    if (incoming.status === 'CANCELADO') {
      if (existing.status === 'CANCELADO') return false;
      if (!('cancellationReason' in incoming) || typeof incoming.cancellationReason !== 'string' || incoming.cancellationReason.length < 3) return false;
      if (!isGerente) return false;
    }
    return true;
  }

  evalOrderDelete(auth, orderId) {
    return this.isValidId(orderId) && this.isAdmin(auth);
  }

  // Collection: cash_shifts
  evalCashShiftGet(auth, shiftId) {
    return this.isStaff(auth) && (this.isCashierStaff(auth) || this.isGerente(auth));
  }
  evalCashShiftList(auth) {
    return this.isStaff(auth) && (this.isCashierStaff(auth) || this.isGerente(auth));
  }
  evalCashShiftWrite(auth, shiftId) {
    return this.isValidId(shiftId) && this.isStaff(auth) && (this.isCashierStaff(auth) || this.isGerente(auth));
  }
  evalCashShiftDelete(auth, shiftId) {
    return this.isValidId(shiftId) && this.isAdmin(auth);
  }

  // Collection: users
  evalUsersList(auth) {
    return this.isStaff(auth);
  }
  evalUsersGet(auth, userId) {
    return Boolean(auth && (auth.uid === userId || this.isStaff(auth)));
  }
  evalUsersUpdate(auth, userId) {
    return this.isValidId(userId) && this.isAdmin(auth);
  }
  evalUsersDelete(auth, userId) {
    return this.isValidId(userId) && this.isAdmin(auth);
  }
  evalUsersCreate(auth, userId, incoming) {
    if (!this.isValidId(userId)) return false;
    if (this.isAdmin(auth)) return true;
    if (!auth || !auth.uid || auth.uid !== userId) return false;
    if (!auth.token || !auth.token.email) return false;
    if (incoming.id !== userId) return false;
    if (incoming.email !== auth.token.email) return false;
    if (incoming.status !== 'ATIVO') return false;

    const email = auth.token.email;
    const isBoot = this.isBootstrappedAdmin(auth);
    if (isBoot && (incoming.role === 'ADMINISTRADOR' || incoming.role === 'admin')) return true;

    const isStaffEmail = email.endsWith('@staff.amanditasabores.com.br') || email.endsWith('@amanditasabores.com.br');
    if (isStaffEmail && ['CAIXA', 'COZINHA', 'ENTREGADOR', 'ATENDENTE', 'caixa', 'cozinha', 'entregador', 'atendente'].includes(incoming.role)) {
      return true;
    }
    return false;
  }

  // Collection: access_logs
  evalAccessLogsList(auth) {
    return this.isAdmin(auth);
  }
  evalAccessLogsCreate(auth, logId) {
    return this.isValidId(logId) && this.isStaff(auth);
  }
  evalAccessLogsUpdate() { return false; }
  evalAccessLogsDelete() { return false; }

  // Collection: public_tracking
  evalPublicTrackingGet(auth, code) {
    return this.isValidId(code) && code.length >= 20;
  }
  evalPublicTrackingList(auth) {
    return false; // Complete enumeration forbidden
  }
  evalPublicTrackingCreate(auth, code, incoming) {
    if (!this.isValidId(code) || code.length < 20) return false;
    if (incoming.trackingCode !== code) return false;
    if (typeof incoming.id !== 'string' || typeof incoming.orderNumber !== 'string') return false;
    if (!['NOVO', 'EM_PREPARO'].includes(incoming.status)) return false;
    if (typeof incoming.totalAmount !== 'number' || incoming.totalAmount < 0) return false;
    
    // Strict PII protection
    if ('customer' in incoming || 'phone' in incoming || 'address' in incoming) return false;
    
    // Whitelist allowed tracking keys
    const allowed = new Set([
      'id', 'orderNumber', 'createdAt', 'estimatedDeliveryMinutes',
      'fulfillmentType', 'status', 'items', 'subtotal',
      'deliveryFee', 'discount', 'totalAmount', 'paymentMethod',
      'paymentStatus', 'deliveryPerson', 'trackingCode', 'destinationSummary'
    ]);
    for (const k of Object.keys(incoming)) {
      if (!allowed.has(k)) return false;
    }
    return true;
  }
  evalPublicTrackingUpdate(auth, code, existing, incoming) {
    if (!this.isValidId(code) || code.length < 20) return false;
    if (!this.isStaff(auth)) return false;
    if (incoming.id !== existing.id || incoming.trackingCode !== existing.trackingCode) return false;
    if ('customer' in incoming || 'phone' in incoming || 'address' in incoming) return false;
    const allowed = new Set([
      'id', 'orderNumber', 'createdAt', 'estimatedDeliveryMinutes',
      'fulfillmentType', 'status', 'items', 'subtotal',
      'deliveryFee', 'discount', 'totalAmount', 'paymentMethod',
      'paymentStatus', 'deliveryPerson', 'trackingCode', 'destinationSummary'
    ]);
    for (const k of Object.keys(incoming)) {
      if (!allowed.has(k)) return false;
    }
    return true;
  }
  evalPublicTrackingDelete(auth, code) {
    return this.isValidId(code) && this.isAdmin(auth);
  }
}

// ==========================================
// TEST SUITE SETUP
// ==========================================
const mockDb = {
  menu_items: {
    'item-cuscuz-carne': { id: 'item-cuscuz-carne', price: 14.00, available: true },
    'item-suco-laranja': { id: 'item-suco-laranja', price: 6.00, available: true },
    'item-tapioca-queijo': { id: 'item-tapioca-queijo', price: 10.00, available: true },
    'item-cafe-expresso': { id: 'item-cafe-expresso', price: 5.00, available: true },
    'item-bolo-rolo': { id: 'item-bolo-rolo', price: 8.00, available: true },
    'item-esgotado': { id: 'item-esgotado', price: 12.00, available: false }
  },
  users: {
    'admin-1': { id: 'admin-1', email: 'admin@amanditasabores.com.br', role: 'ADMINISTRADOR', status: 'ATIVO' },
    'gerente-1': { id: 'gerente-1', email: 'gerente@staff.amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' },
    'cozinha-1': { id: 'cozinha-1', email: 'cozinha@staff.amanditasabores.com.br', role: 'COZINHA', status: 'ATIVO' },
    'entregador-1': { id: 'entregador-1', email: 'entregador@staff.amanditasabores.com.br', role: 'ENTREGADOR', status: 'ATIVO' },
    'caixa-1': { id: 'caixa-1', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' },
    'blocked-1': { id: 'blocked-1', email: 'ex@staff.amanditasabores.com.br', role: 'GERENTE', status: 'BLOQUEADO' }
  }
};

const engine = new FirestoreRuleEngine(mockDb);

const anonymousAuth = null;
const customerAuth = null;
const adminAuth = { uid: 'admin-1', token: { email: 'admin@amanditasabores.com.br' } };
const bootstrapAuth = { uid: 'dvr-1', token: { email: 'dvrmercadinho@gmail.com' } };
const gerenteAuth = { uid: 'gerente-1', token: { email: 'gerente@staff.amanditasabores.com.br' } };
const cozinhaAuth = { uid: 'cozinha-1', token: { email: 'cozinha@staff.amanditasabores.com.br' } };
const entregadorAuth = { uid: 'entregador-1', token: { email: 'entregador@staff.amanditasabores.com.br' } };
const caixaAuth = { uid: 'caixa-1', token: { email: 'caixa@staff.amanditasabores.com.br' } };
const blockedAuth = { uid: 'blocked-1', token: { email: 'ex@staff.amanditasabores.com.br' } };

let testCount = 0;
let passedCount = 0;

function runTest(name, fn) {
  testCount++;
  try {
    fn();
    passedCount++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

console.log('=== TEST SUITE DE REGRAS HARDENED (AMANDITA SABORES) ===\n');

// 1. Menu Items Tests
runTest('1. Cardápio: Leitura pública aberta para clientes anônimos', () => {
  assert.strictEqual(engine.evalMenuItemList(anonymousAuth), true);
  assert.strictEqual(engine.evalMenuItemGet(anonymousAuth, 'item-cuscuz-carne'), true);
});

runTest('2. Cardápio: Modificação proibida para clientes anônimos', () => {
  assert.strictEqual(engine.evalMenuItemWrite(anonymousAuth, 'item-cuscuz-carne'), false);
});

// 2. Configs Tests
runTest('3. Configs: Leitura pública restrita ao documento restaurant', () => {
  assert.strictEqual(engine.evalConfigGet(anonymousAuth, 'restaurant'), true);
  assert.strictEqual(engine.evalConfigGet(anonymousAuth, 'private_secrets'), false);
  assert.strictEqual(engine.evalConfigList(anonymousAuth), false);
});

// 3. Public Order Creation & Price Consistency
const validOrderPayload = {
  id: 'ord-1001',
  orderNumber: '#1001',
  createdAt: '2026-10-23T12:00:00.000Z',
  updatedAt: '2026-10-23T12:00:00.000Z',
  fulfillmentType: 'DELIVERY',
  customer: { name: 'Mariana Silveira', phone: '83988234190' },
  items: [
    {
      id: 'it-1',
      menuItemId: 'item-cuscuz-carne',
      name: 'Cuscuz de carne de sol com queijo',
      quantity: 1,
      unitPrice: 14.00,
      subtotal: 14.00
    }
  ],
  subtotal: 14.00,
  deliveryFee: 5.00,
  discount: 0,
  totalAmount: 19.00,
  paymentMethod: 'PIX',
  paymentStatus: 'PENDENTE',
  status: 'NOVO',
  trackingCode: 'tk_9876543210abcdef12345678', // 28 chars
  movements: [{ id: 'mov-1', timestamp: '2026-10-23T12:00:00.000Z', toStatus: 'NOVO', author: 'Cliente' }]
};

runTest('4. Pedido Público: Criação válida com cálculos matemáticos corretos', () => {
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', validOrderPayload), true);
});

runTest('5. Preço Oficial: Rejeitar manipulação de preço unitário abaixo do oficial (R$ 0,01)', () => {
  const fraudUnder = {
    ...validOrderPayload,
    items: [{ id: 'it-1', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz', quantity: 1, unitPrice: 0.01, subtotal: 0.01 }],
    subtotal: 0.01,
    totalAmount: 5.01
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', fraudUnder), false);
});

runTest('5b. Preço Oficial: Rejeitar manipulação de preço unitário acima do oficial (R$ 25,00 vs R$ 14,00)', () => {
  const fraudOver = {
    ...validOrderPayload,
    items: [{ id: 'it-1', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz', quantity: 1, unitPrice: 25.00, subtotal: 25.00 }],
    subtotal: 25.00,
    totalAmount: 30.00
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', fraudOver), false);
});

runTest('5c. Produto Inexistente: Rejeitar pedido com menuItemId fantasma', () => {
  const ghostItem = {
    ...validOrderPayload,
    items: [{ id: 'it-1', menuItemId: 'item-fantasma-inexistente', name: 'Inexistente', quantity: 1, unitPrice: 14.00, subtotal: 14.00 }]
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', ghostItem), false);
});

runTest('5d. Produto Indisponível: Rejeitar item com available: false', () => {
  const unavailableItem = {
    ...validOrderPayload,
    items: [{ id: 'it-1', menuItemId: 'item-esgotado', name: 'Esgotado', quantity: 1, unitPrice: 12.00, subtotal: 12.00 }],
    subtotal: 12.00,
    totalAmount: 17.00
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', unavailableItem), false);
});

runTest('5e. Múltiplos Produtos: Validar pedido com 2 produtos reais e soma consistente de subtotais', () => {
  const multiItemOrder = {
    ...validOrderPayload,
    items: [
      { id: 'it-1', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz', quantity: 1, unitPrice: 14.00, subtotal: 14.00 },
      { id: 'it-2', menuItemId: 'item-suco-laranja', name: 'Suco', quantity: 2, unitPrice: 6.00, subtotal: 12.00 }
    ],
    subtotal: 26.00, // 14 + 12
    totalAmount: 31.00 // 26 + 5
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', multiItemOrder), true);
});

runTest('5f. Múltiplos Produtos: Rejeitar quando o subtotal do pedido não bate com a soma dos itens', () => {
  const inconsistentSum = {
    ...validOrderPayload,
    items: [
      { id: 'it-1', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz', quantity: 1, unitPrice: 14.00, subtotal: 14.00 },
      { id: 'it-2', menuItemId: 'item-suco-laranja', name: 'Suco', quantity: 2, unitPrice: 6.00, subtotal: 12.00 }
    ],
    subtotal: 20.00, // FRAUDE: soma real é 26.00
    totalAmount: 25.00
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', inconsistentSum), false);
});

runTest('5g. Múltiplos Produtos: Validar pedido com 8 itens (limite máximo para regras diretas do cliente)', () => {
  const eightItemsOrder = {
    ...validOrderPayload,
    items: [
      { id: 'it-1', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz', quantity: 1, unitPrice: 14.00, subtotal: 14.00 },
      { id: 'it-2', menuItemId: 'item-suco-laranja', name: 'Suco', quantity: 1, unitPrice: 6.00, subtotal: 6.00 },
      { id: 'it-3', menuItemId: 'item-tapioca-queijo', name: 'Tapioca', quantity: 1, unitPrice: 10.00, subtotal: 10.00 },
      { id: 'it-4', menuItemId: 'item-cafe-expresso', name: 'Café', quantity: 1, unitPrice: 5.00, subtotal: 5.00 },
      { id: 'it-5', menuItemId: 'item-bolo-rolo', name: 'Bolo', quantity: 1, unitPrice: 8.00, subtotal: 8.00 },
      { id: 'it-6', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz 2', quantity: 1, unitPrice: 14.00, subtotal: 14.00 },
      { id: 'it-7', menuItemId: 'item-suco-laranja', name: 'Suco 2', quantity: 1, unitPrice: 6.00, subtotal: 6.00 },
      { id: 'it-8', menuItemId: 'item-tapioca-queijo', name: 'Tapioca 2', quantity: 1, unitPrice: 10.00, subtotal: 10.00 }
    ],
    subtotal: 73.00,
    totalAmount: 78.00
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', eightItemsOrder), true);
});

runTest('5h. Limite do Cliente: Rejeitar pedido público com 9 itens diretamente no Firestore (requer backend)', () => {
  const nineItemsOrder = {
    ...validOrderPayload,
    items: [
      { id: 'it-1', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz', quantity: 1, unitPrice: 14.00, subtotal: 14.00 },
      { id: 'it-2', menuItemId: 'item-suco-laranja', name: 'Suco', quantity: 1, unitPrice: 6.00, subtotal: 6.00 },
      { id: 'it-3', menuItemId: 'item-tapioca-queijo', name: 'Tapioca', quantity: 1, unitPrice: 10.00, subtotal: 10.00 },
      { id: 'it-4', menuItemId: 'item-cafe-expresso', name: 'Café', quantity: 1, unitPrice: 5.00, subtotal: 5.00 },
      { id: 'it-5', menuItemId: 'item-bolo-rolo', name: 'Bolo', quantity: 1, unitPrice: 8.00, subtotal: 8.00 },
      { id: 'it-6', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz 2', quantity: 1, unitPrice: 14.00, subtotal: 14.00 },
      { id: 'it-7', menuItemId: 'item-suco-laranja', name: 'Suco 2', quantity: 1, unitPrice: 6.00, subtotal: 6.00 },
      { id: 'it-8', menuItemId: 'item-tapioca-queijo', name: 'Tapioca 2', quantity: 1, unitPrice: 10.00, subtotal: 10.00 },
      { id: 'it-9', menuItemId: 'item-cafe-expresso', name: 'Café 2', quantity: 1, unitPrice: 5.00, subtotal: 5.00 }
    ],
    subtotal: 78.00,
    totalAmount: 83.00
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', nineItemsOrder), false);
});

runTest('5i. Adicionais Legítimos: Validar item com adicional oficial de R$ 3,00 e soma exata do subtotal', () => {
  const addonOrder = {
    ...validOrderPayload,
    items: [
      {
        id: 'it-1',
        menuItemId: 'item-cuscuz-carne',
        name: 'Cuscuz',
        quantity: 1,
        unitPrice: 14.00,
        addons: [{ id: 'ad-queijo', name: 'Queijo', price: 3.00 }],
        subtotal: 17.00 // 14 + 3
      }
    ],
    subtotal: 17.00,
    totalAmount: 22.00 // 17 + 5
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', addonOrder), true);
});

runTest('5j. Adicional Adulterado: Rejeitar tentativa de adulterar preço do adicional (R$ 0,01 vs oficial R$ 3,00)', () => {
  const forgedAddon = {
    ...validOrderPayload,
    items: [
      {
        id: 'it-1',
        menuItemId: 'item-cuscuz-carne',
        name: 'Cuscuz',
        quantity: 1,
        unitPrice: 14.00,
        addons: [{ id: 'ad-queijo', name: 'Queijo', price: 0.01 }],
        subtotal: 14.01
      }
    ],
    subtotal: 14.01,
    totalAmount: 19.01
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', forgedAddon), false);
});

runTest('5k. Adicional Grátis: Rejeitar pedido que inclui adicional mas não soma seu valor ao subtotal', () => {
  const unpaidAddon = {
    ...validOrderPayload,
    items: [
      {
        id: 'it-1',
        menuItemId: 'item-cuscuz-carne',
        name: 'Cuscuz',
        quantity: 1,
        unitPrice: 14.00,
        addons: [{ id: 'ad-queijo', name: 'Queijo', price: 3.00 }],
        subtotal: 14.00 // FRAUDE: não somou os R$ 3,00 do queijo
      }
    ],
    subtotal: 14.00,
    totalAmount: 19.00
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', unpaidAddon), false);
});

runTest('6. Fraude de Desconto: Rejeitar auto-desconto por cliente', () => {
  const fraud = { ...validOrderPayload, discount: 5.00, totalAmount: 14.00 };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', fraud), false);
});

runTest('7. Fraude de Pagamento: Rejeitar paymentStatus PAGO na criação pelo cliente', () => {
  const fraud = { ...validOrderPayload, paymentStatus: 'PAGO' };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', fraud), false);
});

runTest('8. Token Previsível: Rejeitar código de rastreamento curto (< 20 caracteres)', () => {
  const fraud = { ...validOrderPayload, trackingCode: 'curto123' };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', fraud), false);
});

// 4. Public Tracking Shield
const validTrackingDoc = {
  id: 'ord-1001',
  orderNumber: '#1001',
  createdAt: '2026-10-23T12:00:00.000Z',
  estimatedDeliveryMinutes: 30,
  fulfillmentType: 'DELIVERY',
  status: 'NOVO',
  items: [{ id: 'it-1', name: 'Cuscuz', quantity: 1, subtotal: 14.00 }],
  subtotal: 14.00,
  deliveryFee: 5.00,
  discount: 0,
  totalAmount: 19.00,
  paymentMethod: 'PIX',
  paymentStatus: 'PENDENTE',
  trackingCode: 'tk_9876543210abcdef12345678',
  destinationSummary: 'Bela Vista · Campina Grande'
};

runTest('9. Rastreio: Criação permitida com campos estritamente higienizados', () => {
  assert.strictEqual(engine.evalPublicTrackingCreate(anonymousAuth, 'tk_9876543210abcdef12345678', validTrackingDoc), true);
});

runTest('10. Rastreio: REJEITAR injeção de telefone ou endereço residencial (PII Shield)', () => {
  const leakPhone = { ...validTrackingDoc, phone: '83988234190' };
  assert.strictEqual(engine.evalPublicTrackingCreate(anonymousAuth, 'tk_9876543210abcdef12345678', leakPhone), false);
  const leakAddr = { ...validTrackingDoc, address: { street: 'Rua das Flores 140' } };
  assert.strictEqual(engine.evalPublicTrackingCreate(anonymousAuth, 'tk_9876543210abcdef12345678', leakAddr), false);
});

runTest('11. Rastreio: Enumeração/listagem da coleção totalmente proibida (anti-scraping)', () => {
  assert.strictEqual(engine.evalPublicTrackingList(anonymousAuth), false);
});

runTest('12. Rastreio: Consulta permitida apenas via token longo exato', () => {
  assert.strictEqual(engine.evalPublicTrackingGet(anonymousAuth, 'tk_9876543210abcdef12345678'), true);
  assert.strictEqual(engine.evalPublicTrackingGet(anonymousAuth, 'tk_123'), false); // curto demais
});

// 5. Per-Role Update Restrictions on Orders
const baseOrder = {
  id: 'ord-1001',
  orderNumber: '#1001',
  createdAt: '2026-10-23T12:00:00.000Z',
  fulfillmentType: 'DELIVERY',
  customer: { name: 'Mariana Silveira', phone: '83988234190' },
  items: [{ id: 'it-1', name: 'Cuscuz', quantity: 1, unitPrice: 14.00, subtotal: 14.00 }],
  subtotal: 14.00,
  deliveryFee: 5.00,
  discount: 0,
  totalAmount: 19.00,
  paymentMethod: 'PIX',
  paymentStatus: 'PENDENTE',
  status: 'NOVO'
};

runTest('13. Cozinha: Pode avançar status para EM_PREPARO e PRONTO', () => {
  const prep = { ...baseOrder, status: 'EM_PREPARO' };
  assert.strictEqual(engine.evalOrderUpdate(cozinhaAuth, 'ord-1001', baseOrder, prep), true);
  const pronto = { ...baseOrder, status: 'PRONTO' };
  assert.strictEqual(engine.evalOrderUpdate(cozinhaAuth, 'ord-1001', baseOrder, pronto), true);
});

runTest('14. Cozinha: REJEITAR qualquer tentativa de alterar valores, itens ou cliente', () => {
  const forgedPrice = { ...baseOrder, status: 'EM_PREPARO', totalAmount: 10.00 };
  assert.strictEqual(engine.evalOrderUpdate(cozinhaAuth, 'ord-1001', baseOrder, forgedPrice), false);
  const forgedItems = { ...baseOrder, status: 'EM_PREPARO', items: [] };
  assert.strictEqual(engine.evalOrderUpdate(cozinhaAuth, 'ord-1001', baseOrder, forgedItems), false);
  const forgedPayment = { ...baseOrder, status: 'EM_PREPARO', paymentStatus: 'PAGO' };
  assert.strictEqual(engine.evalOrderUpdate(cozinhaAuth, 'ord-1001', baseOrder, forgedPayment), false);
});

runTest('15. Entregador: Pode avançar para EM_ROTA e ENTREGUE', () => {
  const rota = { ...baseOrder, status: 'EM_ROTA' };
  assert.strictEqual(engine.evalOrderUpdate(entregadorAuth, 'ord-1001', baseOrder, rota), true);
  const entregue = { ...baseOrder, status: 'ENTREGUE' };
  assert.strictEqual(engine.evalOrderUpdate(entregadorAuth, 'ord-1001', baseOrder, entregue), true);
});

runTest('16. Entregador: REJEITAR tentativa de alterar preços ou itens', () => {
  const forgedPrice = { ...baseOrder, status: 'EM_ROTA', totalAmount: 5.00 };
  assert.strictEqual(engine.evalOrderUpdate(entregadorAuth, 'ord-1001', baseOrder, forgedPrice), false);
  const forgedItems = { ...baseOrder, status: 'EM_ROTA', items: [] };
  assert.strictEqual(engine.evalOrderUpdate(entregadorAuth, 'ord-1001', baseOrder, forgedItems), false);
});

runTest('17. Cancelamento: Apenas Gerente/Admin com motivo válido (>= 3 chars)', () => {
  const cancelCozinha = { ...baseOrder, status: 'CANCELADO', cancellationReason: 'Sem gás' };
  assert.strictEqual(engine.evalOrderUpdate(cozinhaAuth, 'ord-1001', baseOrder, cancelCozinha), false);
  const cancelGerente = { ...baseOrder, status: 'CANCELADO', cancellationReason: 'Cliente desistiu' };
  assert.strictEqual(engine.evalOrderUpdate(gerenteAuth, 'ord-1001', baseOrder, cancelGerente), true);
  const cancelSemMotivo = { ...baseOrder, status: 'CANCELADO' };
  assert.strictEqual(engine.evalOrderUpdate(gerenteAuth, 'ord-1001', baseOrder, cancelSemMotivo), false);
});

// 6. User Management & Escalation Guards
runTest('18. Gestão de Usuários: Novo usuário NÃO pode se cadastrar como ADMINISTRADOR', () => {
  const newStaffAuth = { uid: 'new-staff', token: { email: 'novo@staff.amanditasabores.com.br' } };
  const adminDoc = { id: 'new-staff', email: 'novo@staff.amanditasabores.com.br', role: 'ADMINISTRADOR', status: 'ATIVO' };
  assert.strictEqual(engine.evalUsersCreate(newStaffAuth, 'new-staff', adminDoc), false);

  const cashierDoc = { id: 'new-staff', email: 'novo@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO' };
  assert.strictEqual(engine.evalUsersCreate(newStaffAuth, 'new-staff', cashierDoc), true);
});

runTest('19. Usuário Bloqueado: Acesso revogado imediatamente para todas as coleções internas', () => {
  assert.strictEqual(engine.evalOrderList(blockedAuth), false);
  assert.strictEqual(engine.evalCashShiftList(blockedAuth), false);
  assert.strictEqual(engine.evalUsersList(blockedAuth), false);
});

runTest('20. Leitura do Próprio Perfil: Permitida para colaborador autenticado', () => {
  assert.strictEqual(engine.evalUsersGet(cozinhaAuth, 'cozinha-1'), true);
});

console.log(`\n======================================================`);
console.log(`RESULTADO DA SUÍTE DE TESTES: ${passedCount}/${testCount} TESTES APROVADOS.`);
console.log(`======================================================`);

if (passedCount !== testCount) {
  process.exit(1);
}
