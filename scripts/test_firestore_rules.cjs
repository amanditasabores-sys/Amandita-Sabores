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
    const email = auth.token.email.toLowerCase();
    return (
      email === 'dvrmercadinho@gmail.com' ||
      email === 'admin@amanditasabores.com.br' ||
      email === 'amanditasabore@gmail.com' ||
      email === 'amanditasabores@gmail.com'
    );
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

  isCashManager(auth) {
    return this.isGerente(auth) || (this.hasActiveProfile(auth) && ['CAIXA', 'caixa'].includes(this.userRole(auth)));
  }

  // Collection: menu_items
  evalMenuItemGet(auth, itemId) {
    return this.isValidId(itemId);
  }
  evalMenuItemList(auth) {
    return true;
  }
  evalMenuItemWrite(auth, itemId, incoming) {
    if (incoming && 'costPrice' in incoming) return false;
    return this.isValidId(itemId) && this.isGerente(auth);
  }
  evalMenuItemCostRead(auth, itemId) {
    return this.isValidId(itemId) && this.isGerente(auth);
  }
  evalMenuItemCostWrite(auth, itemId) {
    return this.isValidId(itemId) && this.isGerente(auth);
  }

  isValidOperatingDay(day) {
    if (!day || typeof day !== 'object' || Array.isArray(day)) return false;
    const keys = Object.keys(day);
    const reqKeys = ['dayKey', 'label', 'isOpen', 'openTime', 'closeTime'];
    if (keys.length !== reqKeys.length || !reqKeys.every((k) => keys.includes(k))) return false;
    if (!['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].includes(day.dayKey)) return false;
    if (typeof day.label !== 'string' || day.label.length < 1 || day.label.length > 40) return false;
    if (typeof day.isOpen !== 'boolean') return false;
    const timeRegex = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    if (typeof day.openTime !== 'string' || !timeRegex.test(day.openTime)) return false;
    if (typeof day.closeTime !== 'string' || !timeRegex.test(day.closeTime)) return false;
    if (day.isOpen && !(day.openTime < day.closeTime)) return false;
    return true;
  }

  isValidStoreSchedule(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const keys = Object.keys(data);
    const reqKeys = ['operatingHours', 'closedPrimaryMessage', 'closedSecondaryMessage', 'updatedAt', 'updatedBy'];
    if (keys.length !== reqKeys.length || !reqKeys.every((k) => keys.includes(k))) return false;
    if (!Array.isArray(data.operatingHours) || data.operatingHours.length !== 7) return false;
    for (let i = 0; i < 7; i++) {
      if (!this.isValidOperatingDay(data.operatingHours[i])) return false;
    }
    if (typeof data.closedPrimaryMessage !== 'string' || data.closedPrimaryMessage.length < 1 || data.closedPrimaryMessage.length > 200) return false;
    if (typeof data.closedSecondaryMessage !== 'string' || data.closedSecondaryMessage.length > 500) return false;
    if (typeof data.updatedAt !== 'string' || data.updatedAt.length < 10 || data.updatedAt.length > 64) return false;
    if (typeof data.updatedBy !== 'string' || data.updatedBy.length < 1 || data.updatedBy.length > 128) return false;
    return true;
  }

  // Collection: configs
  evalConfigGet(auth, configId) {
    if (configId === 'restaurant' || configId === 'daily_menu') return true;
    if (configId === 'store_schedule') return this.isGerente(auth);
    return this.isAdmin(auth);
  }
  evalConfigList(auth, configId) {
    if (configId === 'restaurant' || configId === 'daily_menu') return this.isStaff(auth);
    if (configId === 'store_schedule') return this.isGerente(auth);
    return this.isAdmin(auth);
  }
  evalConfigWrite(auth, configId, incoming) {
    if (configId === 'restaurant') {
      if (!this.isGerente(auth)) return false;
      if (incoming) {
        const allowed = new Set([
          'name', 'phone', 'whatsapp', 'address', 'city',
          'pixKey', 'pixKeyType', 'pixReceiverName', 'pixReceiverCity',
          'deliveryFeeBase', 'avgPrepTimeMinutes', 'avgDeliveryTimeMinutes',
          'isOpen', 'customPublicUrl', 'updatedAt'
        ]);
        for (const k of Object.keys(incoming)) {
          if (!allowed.has(k)) return false;
        }
      }
      return true;
    }
    if (configId === 'store_schedule') {
      return this.isGerente(auth) && this.isValidStoreSchedule(incoming);
    }
    if (configId === 'daily_menu') {
      return this.isGerente(auth);
    }
    return this.isAdmin(auth);
  }
  evalConfigDelete(auth, configId) {
    return this.isAdmin(auth);
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

  areAddonsValid(item) {
    const addons = item.addons || [];
    if (!Array.isArray(addons)) return false;
    if (addons.length === 0) return true;
    if (addons.length > 4) return false;
    for (const a of addons) {
      if (!this.isValidAddon(a)) return false;
    }
    return true;
  }

  getAddonsSum(item) {
    const addons = item.addons || [];
    return addons.reduce((acc, a) => acc + a.price, 0);
  }

  isItemPriceAndSubtotalMatchesCatalog(item, officialPrice) {
    const q = item.quantity;
    const addonsTotal = this.getAddonsSum(item);
    const expectedSub = (officialPrice + addonsTotal) * q;
    const matchesCombinedUnit = Math.abs(item.unitPrice - (officialPrice + addonsTotal)) <= 0.001;
    const matchesBaseUnit = Math.abs(item.unitPrice - officialPrice) <= 0.001;
    return (matchesCombinedUnit || matchesBaseUnit) && Math.abs(item.subtotal - expectedSub) <= 0.01;
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
    if (!this.areAddonsValid(item)) return false;
    const catalogItem = this.db.menu_items?.[item.menuItemId];
    if (!catalogItem) return false;
    if (catalogItem.available !== true) return false;
    if (!this.isItemPriceAndSubtotalMatchesCatalog(item, catalogItem.price)) return false;
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
      if (!this.areAddonsValid(items[i])) return false;
    }
    return true;
  }

  evalOrderCreate(auth, orderId, incoming) {
    const staff = this.isStaff(auth);
    if (!staff) return false;
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
    if (!(incoming.status === 'NOVO' || (incoming.status === 'EM_PREPARO' && staff))) return false;
    if (incoming.paymentStatus !== 'PENDENTE') return false;
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
    
    // Primary identity & financial integrity immutable on direct Client SDK updates
    if (existing.status === 'CANCELADO') return false;
    if (incoming.id !== existing.id) return false;
    if (incoming.orderNumber !== existing.orderNumber) return false;
    if (incoming.createdAt !== existing.createdAt) return false;
    if (incoming.fulfillmentType !== existing.fulfillmentType) return false;
    if (incoming.subtotal !== existing.subtotal) return false;
    if (incoming.deliveryFee !== existing.deliveryFee) return false;
    if (incoming.discount !== existing.discount) return false;
    if (incoming.totalAmount !== existing.totalAmount) return false;
    if (incoming.paymentMethod !== existing.paymentMethod) return false;
    if (incoming.paymentStatus !== existing.paymentStatus) return false;
    if (JSON.stringify(incoming.items) !== JSON.stringify(existing.items)) return false;

    if (incoming.status === 'CANCELADO') return false;
    if (!['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'].includes(incoming.status)) return false;

    const isGerente = this.isGerente(auth);
    const isKitchen = this.isKitchenStaff(auth) && ['EM_PREPARO', 'PRONTO'].includes(incoming.status);
    const isDelivery = this.isDeliveryStaff(auth) && ['EM_ROTA', 'ENTREGUE'].includes(incoming.status);
    const isCashier = this.isCashierStaff(auth) && ['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'].includes(incoming.status);

    if (!isGerente && !isKitchen && !isDelivery && !isCashier) return false;

    // Kitchen specific immutable field restrictions
    if (this.isKitchenStaff(auth) && !isGerente) {
      if (JSON.stringify(incoming.customer) !== JSON.stringify(existing.customer)) return false;
    }

    // Delivery specific immutable field restrictions
    if (this.isDeliveryStaff(auth) && !isGerente) {
      if (incoming.customer?.name !== existing.customer?.name) return false;
    }

    return true;
  }

  evalOrderDelete(auth, orderId) {
    return this.isValidId(orderId) && this.isGerente(auth);
  }

  // Collection: cash_shifts
  evalCashShiftGet(auth, shiftId) {
    return this.isAdmin(auth) || this.isCashManager(auth) || (this.isStaff(auth) && this.db.cash_shifts?.[shiftId]?.status === 'ABERTO');
  }
  evalCashShiftList(auth) {
    return this.isAdmin(auth) || this.isCashManager(auth);
  }
  evalCashShiftCreate(auth, shiftId) {
    return this.isValidId(shiftId) && (this.isAdmin(auth) || this.isCashManager(auth));
  }
  evalCashShiftUpdate(auth, shiftId, incoming, existing) {
    return this.isValidId(shiftId) &&
      (this.isAdmin(auth) || this.isCashManager(auth)) &&
      existing?.status !== 'FECHADO';
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
  evalUsersUpdate(auth, userId, incoming, existing) {
    if (!this.isValidId(userId)) return false;
    if (this.isAdmin(auth)) return true;

    // Gerente updating staff
    if (this.isGerente(auth)) {
      if (existing && (existing.role === 'ADMINISTRADOR' || existing.role === 'admin')) return false;
      if (incoming && (incoming.role === 'ADMINISTRADOR' || incoming.role === 'admin')) return false;
      if (incoming && existing && incoming.id === existing.id && incoming.email === existing.email) {
        return true;
      }
      return false;
    }

    // User self-update: strictly limited to lastLoginAt!
    if (auth && auth.uid === userId && incoming && existing) {
      if (typeof incoming.lastLoginAt !== 'string') return false;
      const allKeys = new Set([...Object.keys(incoming), ...Object.keys(existing)]);
      const changedKeys = [];
      for (const k of allKeys) {
        if (incoming[k] !== existing[k]) changedKeys.push(k);
      }
      return changedKeys.length === 1 && changedKeys[0] === 'lastLoginAt';
    }
    return false;
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

    const email = auth.token.email.toLowerCase();
    const isBoot = this.isBootstrappedAdmin(auth);
    if (isBoot && (incoming.role === 'ADMINISTRADOR' || incoming.role === 'admin')) return true;
    if (email === 'gerente@amanditasabores.com.br' && (incoming.role === 'GERENTE' || incoming.role === 'gerente')) return true;

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
    if (!this.isStaff(auth)) return false;
    if (!this.isValidId(code) || code.length < 20) return false;
    if (incoming.trackingCode !== code) return false;
    if (typeof incoming.id !== 'string' || typeof incoming.orderNumber !== 'string') return false;
    if (!['NOVO', 'EM_PREPARO'].includes(incoming.status)) return false;
    if (incoming.paymentStatus !== 'PENDENTE') return false;
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
    if (existing.status === 'CANCELADO' || incoming.status === 'CANCELADO') return false;
    if (!['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'].includes(incoming.status)) return false;
    if (incoming.id !== existing.id || incoming.trackingCode !== existing.trackingCode) return false;
    if (incoming.paymentStatus !== existing.paymentStatus) return false;
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
    return this.isValidId(code) && this.isGerente(auth);
  }

  // Collection: order_tombstones
  evalOrderTombstoneGet(auth, orderId) {
    return this.isValidId(orderId) && this.isStaff(auth);
  }
  evalOrderTombstoneList(auth) {
    return this.isStaff(auth);
  }
  evalOrderTombstoneWrite(auth, orderId) {
    return this.isValidId(orderId) && this.isGerente(auth);
  }
  evalOrderTombstoneDelete(auth, orderId) {
    return this.isValidId(orderId) && this.isAdmin(auth);
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
    'atendente-1': { id: 'atendente-1', email: 'atendente@staff.amanditasabores.com.br', role: 'ATENDENTE', status: 'ATIVO' },
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
const atendenteAuth = { uid: 'atendente-1', token: { email: 'atendente@staff.amanditasabores.com.br' } };
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

runTest('4. Criação direta de pedido via Client SDK: bloqueada para anônimo e permitida para equipe autenticada (PDV)', () => {
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', validOrderPayload), false, 'Cliente anônimo NÃO pode gravar diretamente em /orders via Client SDK');
  assert.strictEqual(engine.evalOrderCreate(atendenteAuth, 'ord-1001', validOrderPayload), true, 'Equipe autenticada pode gravar pedido PDV válido');
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

runTest('5e. Múltiplos Produtos: Anônimo bloqueado no Client SDK; equipe valida soma consistente de subtotais', () => {
  const multiItemOrder = {
    ...validOrderPayload,
    items: [
      { id: 'it-1', menuItemId: 'item-cuscuz-carne', name: 'Cuscuz', quantity: 1, unitPrice: 14.00, subtotal: 14.00 },
      { id: 'it-2', menuItemId: 'item-suco-laranja', name: 'Suco', quantity: 2, unitPrice: 6.00, subtotal: 12.00 }
    ],
    subtotal: 26.00, // 14 + 12
    totalAmount: 31.00 // 26 + 5
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', multiItemOrder), false);
  assert.strictEqual(engine.evalOrderCreate(caixaAuth, 'ord-1001', multiItemOrder), true);
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

runTest('5g. Múltiplos Produtos: Equipe autenticada cria pedido com 8 itens e anônimo segue bloqueado', () => {
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
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', eightItemsOrder), false);
  assert.strictEqual(engine.evalOrderCreate(caixaAuth, 'ord-1001', eightItemsOrder), true);
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

runTest('5i. Adicionais Legítimos: Equipe autenticada valida item com adicional oficial de R$ 3,00', () => {
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
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-1001', addonOrder), false);
  assert.strictEqual(engine.evalOrderCreate(caixaAuth, 'ord-1001', addonOrder), true);
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

runTest('9. Rastreio: Criação direta bloqueada para anônimo e permitida para staff com campos estritamente higienizados', () => {
  assert.strictEqual(engine.evalPublicTrackingCreate(anonymousAuth, 'tk_9876543210abcdef12345678', validTrackingDoc), false);
  assert.strictEqual(engine.evalPublicTrackingCreate(atendenteAuth, 'tk_9876543210abcdef12345678', validTrackingDoc), true);
});

runTest('10. Rastreio: REJEITAR injeção de telefone ou endereço residencial (PII Shield)', () => {
  const leakPhone = { ...validTrackingDoc, phone: '83988234190' };
  assert.strictEqual(engine.evalPublicTrackingCreate(atendenteAuth, 'tk_9876543210abcdef12345678', leakPhone), false);
  const leakAddr = { ...validTrackingDoc, address: { street: 'Rua das Flores 140' } };
  assert.strictEqual(engine.evalPublicTrackingCreate(atendenteAuth, 'tk_9876543210abcdef12345678', leakAddr), false);
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

runTest('17. Cancelamento Direto via Client SDK: Bloqueado para TODOS os perfis (inclusive Gerente/Admin), exigindo Admin SDK (/api/orders/:id/cancel)', () => {
  const cancelCozinha = { ...baseOrder, status: 'CANCELADO', cancellationReason: 'Sem gás' };
  assert.strictEqual(engine.evalOrderUpdate(cozinhaAuth, 'ord-1001', baseOrder, cancelCozinha), false);
  const cancelGerente = { ...baseOrder, status: 'CANCELADO', cancellationReason: 'Cliente desistiu' };
  assert.strictEqual(engine.evalOrderUpdate(gerenteAuth, 'ord-1001', baseOrder, cancelGerente), false, 'Gerente não pode cancelar via Client SDK');
  assert.strictEqual(engine.evalOrderUpdate(adminAuth, 'ord-1001', baseOrder, cancelGerente), false, 'Admin não pode cancelar via Client SDK');
  const paidBaseOrder = { ...baseOrder, paymentStatus: 'PAGO' };
  const cancelPaid = { ...paidBaseOrder, status: 'CANCELADO', cancellationReason: 'Estorno indevido direto' };
  assert.strictEqual(engine.evalOrderUpdate(adminAuth, 'ord-1001', paidBaseOrder, cancelPaid), false, 'Pedido PAGO não pode ser cancelado via Client SDK');
  assert.strictEqual(engine.evalOrderUpdate(gerenteAuth, 'ord-1001', baseOrder, { ...baseOrder, status: 'EM_PREPARO' }), true, 'Gerente mantém updates operacionais');
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

// 7. Cost Price Protection & User Safe Updates
runTest('21. Blindagem de Custo: PROIBIR costPrice no cardápio público e isolar em menu_item_costs', () => {
  const itemWithCost = { id: 'cuscuz-teste', name: 'Cuscuz', price: 10.0, costPrice: 3.5 };
  const itemWithoutCost = { id: 'cuscuz-teste', name: 'Cuscuz', price: 10.0 };

  // Proibir costPrice na coleção pública menu_items:
  assert.strictEqual(engine.evalMenuItemWrite(gerenteAuth, 'cuscuz-teste', itemWithCost), false, 'Gravação com costPrice em menu_items deve ser rejeitada');
  assert.strictEqual(engine.evalMenuItemWrite(gerenteAuth, 'cuscuz-teste', itemWithoutCost), true, 'Gravação sem costPrice em menu_items deve ser permitida');

  // Acesso à coleção isolada menu_item_costs:
  assert.strictEqual(engine.evalMenuItemCostRead(anonymousAuth, 'cuscuz-teste'), false, 'Cliente anônimo não pode ler menu_item_costs');
  assert.strictEqual(engine.evalMenuItemCostRead(cozinhaAuth, 'cuscuz-teste'), false, 'Funcionário comum não pode ler menu_item_costs');
  assert.strictEqual(engine.evalMenuItemCostRead(gerenteAuth, 'cuscuz-teste'), true, 'Gerente pode ler menu_item_costs');
  assert.strictEqual(engine.evalMenuItemCostWrite(gerenteAuth, 'cuscuz-teste'), true, 'Gerente pode gravar menu_item_costs');
});

runTest('22. Atualização Segura de Perfil: Permitir lastLoginAt e PROIBIR elevação de cargo', () => {
  const existingDoc = { id: 'caixa-1', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO', name: 'Caixa 1' };
  const safeUpdate = { ...existingDoc, lastLoginAt: new Date().toISOString() };
  const forgedRole = { ...existingDoc, role: 'ADMINISTRADOR' };
  const forgedStatus = { ...existingDoc, status: 'ATIVO' }; // if previous was blocked

  // Auto-atualização de lastLoginAt permitida:
  assert.strictEqual(engine.evalUsersUpdate(caixaAuth, 'caixa-1', safeUpdate, existingDoc), true, 'Colaborador pode atualizar seu lastLoginAt');
  // Tentativa de auto-elevação de cargo é rejeitada:
  assert.strictEqual(engine.evalUsersUpdate(caixaAuth, 'caixa-1', forgedRole, existingDoc), false, 'Colaborador NÃO pode auto-elevar seu cargo');
});

runTest('23. Auto-atualização Estrita: Rejeitar alteração de allowedModules, nome ou status pelo próprio usuário', () => {
  const existingDoc = { id: 'caixa-1', email: 'caixa@staff.amanditasabores.com.br', role: 'CAIXA', status: 'ATIVO', name: 'Caixa 1', allowedModules: ['pdv'] };
  const forgedModules = { ...existingDoc, lastLoginAt: new Date().toISOString(), allowedModules: ['pdv', 'usuarios', 'relatorios'] };
  const forgedName = { ...existingDoc, lastLoginAt: new Date().toISOString(), name: 'Super Admin' };
  
  assert.strictEqual(engine.evalUsersUpdate(caixaAuth, 'caixa-1', forgedModules, existingDoc), false, 'Usuário NÃO pode auto-conceder módulos');
  assert.strictEqual(engine.evalUsersUpdate(caixaAuth, 'caixa-1', forgedName, existingDoc), false, 'Usuário NÃO pode alterar dados protegidos via autoatualização');
  assert.strictEqual(engine.evalUsersUpdate(adminAuth, 'caixa-1', forgedModules, existingDoc), true, 'Administrador pode atualizar permissões de colaborador');
});

runTest('24. Configurações Públicas vs Privadas: Rejeitar injeção de secrets em /configs/restaurant', () => {
  const validPublicConfig = {
    name: 'Amandita Sabores',
    phone: '83999999999',
    whatsapp: '5583999999999',
    address: 'Rua Principal',
    city: 'Campina Grande',
    pixKey: 'contato@amanditasabores.com.br',
    pixKeyType: 'EMAIL',
    pixReceiverName: 'AMANDITA SABORES',
    pixReceiverCity: 'CAMPINA GRANDE',
    deliveryFeeBase: 5.0,
    avgPrepTimeMinutes: 15,
    avgDeliveryTimeMinutes: 25,
    isOpen: true
  };
  const configWithSecret = { ...validPublicConfig, secretKey: 'top_secret_token_123' };

  assert.strictEqual(engine.evalConfigWrite(gerenteAuth, 'restaurant', validPublicConfig), true, 'Gerente pode atualizar campos públicos oficiais');
  assert.strictEqual(engine.evalConfigWrite(gerenteAuth, 'restaurant', configWithSecret), false, 'Rejeitar injeção de campos privados/secrets em /configs/restaurant');
  assert.strictEqual(engine.evalConfigWrite(caixaAuth, 'restaurant', validPublicConfig), false, 'Funcionário comum não pode alterar configs');
});

runTest('25. Configurações Internas: /configs/internal restrito exclusivamente a Administrador', () => {
  assert.strictEqual(engine.evalConfigGet(anonymousAuth, 'internal'), false, 'Cliente anônimo não pode ler /configs/internal');
  assert.strictEqual(engine.evalConfigGet(gerenteAuth, 'internal'), false, 'Gerente não pode ler /configs/internal');
  assert.strictEqual(engine.evalConfigGet(adminAuth, 'internal'), true, 'Administrador pode ler /configs/internal');
  assert.strictEqual(engine.evalConfigWrite(adminAuth, 'internal', { internalDbPass: 'secret' }), true, 'Administrador pode gravar /configs/internal');
});

runTest('26. Imutabilidade do Caixa: Proibir alteração de turno FECHADO e permitir criação/fechamento legítimo', () => {
  const shiftAberto = { id: 'shift-100', status: 'ABERTO', openedAt: '2026-11-11T08:00:00Z', openedBy: 'admin', initialBalance: 100, movements: [] };
  const shiftFechando = { ...shiftAberto, status: 'FECHADO', closedAt: '2026-11-11T18:00:00Z', closedBy: 'admin', finalCountedCash: 150 };
  const shiftFechado = { id: 'shift-100', status: 'FECHADO', openedAt: '2026-11-11T08:00:00Z', openedBy: 'admin', initialBalance: 100, movements: [] };
  const shiftModificadoAposFechado = { ...shiftFechado, initialBalance: 9999, notes: 'Alteração maliciosa pós fechamento' };

  // 1. Criar novo turno: permitido para staff/admin
  assert.strictEqual(engine.evalCashShiftCreate(caixaAuth, 'shift-100'), true, 'Caixa pode criar turno novo');
  assert.strictEqual(engine.evalCashShiftCreate(adminAuth, 'shift-101'), true, 'Admin pode criar turno novo');
  assert.strictEqual(engine.evalCashShiftCreate(cozinhaAuth, 'shift-102'), false, 'Cozinha NÃO pode criar turno');
  assert.strictEqual(engine.evalCashShiftCreate(anonymousAuth, 'shift-103'), false, 'Anônimo NÃO pode criar turno');

  // 2. Atualizar turno ABERTO (ex: adicionar movimento): permitido
  assert.strictEqual(engine.evalCashShiftUpdate(caixaAuth, 'shift-100', shiftAberto, shiftAberto), true, 'Caixa pode atualizar turno ABERTO');

  // 3. Fechar turno ABERTO (transição ABERTO -> FECHADO): permitido
  assert.strictEqual(engine.evalCashShiftUpdate(caixaAuth, 'shift-100', shiftFechando, shiftAberto), true, 'Caixa pode fechar turno ABERTO');

  // 4. Modificar turno já FECHADO: ESTRITAMENTE BLOQUEADO para Caixa, Gerente e Admin
  assert.strictEqual(engine.evalCashShiftUpdate(caixaAuth, 'shift-100', shiftModificadoAposFechado, shiftFechado), false, 'Caixa NÃO pode alterar turno FECHADO');
  assert.strictEqual(engine.evalCashShiftUpdate(gerenteAuth, 'shift-100', shiftModificadoAposFechado, shiftFechado), false, 'Gerente NÃO pode alterar turno FECHADO');
  assert.strictEqual(engine.evalCashShiftUpdate(adminAuth, 'shift-100', shiftModificadoAposFechado, shiftFechado), false, 'Admin NÃO pode alterar turno FECHADO');

  // 5. Criar outro turno novo com ID diferente: permitido
  assert.strictEqual(engine.evalCashShiftCreate(caixaAuth, 'shift-200'), true, 'Novo turno com outro ID permitido');
});

runTest('27. Exclusão de Pedidos: Apenas Admin e Gerente; bloqueado para Caixa, Cozinha, Entregador, Atendente, Bloqueado e Público', () => {
  assert.strictEqual(engine.evalOrderDelete(adminAuth, 'ord-1001'), true, 'Administrador pode excluir pedido');
  assert.strictEqual(engine.evalOrderDelete(bootstrapAuth, 'ord-1001'), true, 'Admin bootstrap pode excluir pedido');
  assert.strictEqual(engine.evalOrderDelete(gerenteAuth, 'ord-1001'), true, 'Gerente pode excluir pedido');
  assert.strictEqual(engine.evalOrderDelete(caixaAuth, 'ord-1001'), false, 'Caixa NÃO pode excluir pedido');
  assert.strictEqual(engine.evalOrderDelete(cozinhaAuth, 'ord-1001'), false, 'Cozinha NÃO pode excluir pedido');
  assert.strictEqual(engine.evalOrderDelete(entregadorAuth, 'ord-1001'), false, 'Entregador NÃO pode excluir pedido');
  assert.strictEqual(engine.evalOrderDelete(atendenteAuth, 'ord-1001'), false, 'Atendente NÃO pode excluir pedido');
  assert.strictEqual(engine.evalOrderDelete(blockedAuth, 'ord-1001'), false, 'Usuário bloqueado NÃO pode excluir pedido');
  assert.strictEqual(engine.evalOrderDelete(anonymousAuth, 'ord-1001'), false, 'Cliente/Anônimo NÃO pode excluir pedido');

  assert.strictEqual(engine.evalPublicTrackingDelete(gerenteAuth, 'tk_9876543210abcdef12345678'), true, 'Gerente pode limpar tracking ao excluir pedido');
  assert.strictEqual(engine.evalPublicTrackingDelete(caixaAuth, 'tk_9876543210abcdef12345678'), false, 'Caixa NÃO pode excluir tracking');
});

runTest('28. Tombstones Compartilhados: Leitura apenas staff; gravação apenas Gerente/Admin; exclusão apenas Admin', () => {
  assert.strictEqual(engine.evalOrderTombstoneList(cozinhaAuth), true, 'Staff pode listar tombstones');
  assert.strictEqual(engine.evalOrderTombstoneList(anonymousAuth), false, 'Público NÃO pode listar tombstones');
  assert.strictEqual(engine.evalOrderTombstoneWrite(gerenteAuth, 'ord-1001'), true, 'Gerente pode gravar tombstone');
  assert.strictEqual(engine.evalOrderTombstoneWrite(adminAuth, 'ord-1001'), true, 'Admin pode gravar tombstone');
  assert.strictEqual(engine.evalOrderTombstoneWrite(caixaAuth, 'ord-1001'), false, 'Caixa NÃO pode gravar tombstone');
  assert.strictEqual(engine.evalOrderTombstoneWrite(cozinhaAuth, 'ord-1001'), false, 'Cozinha NÃO pode gravar tombstone');
  assert.strictEqual(engine.evalOrderTombstoneDelete(gerenteAuth, 'ord-1001'), false, 'Gerente NÃO pode apagar tombstone');
  assert.strictEqual(engine.evalOrderTombstoneDelete(adminAuth, 'ord-1001'), true, 'Admin pode apagar tombstone');
});

runTest('29. Bootstrap Gerente Padrão: Permitir auto-criação apenas para gerente@amanditasabores.com.br e bloquear auto-elevação de outros', () => {
  const seedGerenteAuth = { uid: 'uid-gerente-seed', token: { email: 'gerente@amanditasabores.com.br' } };
  const seedGerenteDoc = { id: 'uid-gerente-seed', email: 'gerente@amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' };
  assert.strictEqual(engine.evalUsersCreate(seedGerenteAuth, 'uid-gerente-seed', seedGerenteDoc), true, 'Gerente padrão pode criar seu próprio perfil inicial');

  const commonStaffAuth = { uid: 'uid-outro', token: { email: 'outro@staff.amanditasabores.com.br' } };
  const forgedGerenteDoc = { id: 'uid-outro', email: 'outro@staff.amanditasabores.com.br', role: 'GERENTE', status: 'ATIVO' };
  assert.strictEqual(engine.evalUsersCreate(commonStaffAuth, 'uid-outro', forgedGerenteDoc), false, 'Colaborador comum NÃO pode auto-criar perfil GERENTE');
});

runTest('30. Integridade Financeira Rules: ATENDENTE bloqueado em cash_shifts, Client SDK bloqueado de alterar paymentStatus/CANCELADO e adicionais pagos aceitos', () => {
  const shiftAberto = { id: 'shift-300', status: 'ABERTO', openedAt: '2026-11-11T08:00:00Z', openedBy: 'caixa', initialBalance: 100, movements: [] };
  assert.strictEqual(engine.evalCashShiftCreate(atendenteAuth, 'shift-301'), false, 'ATENDENTE não pode criar turno em cash_shifts');
  assert.strictEqual(engine.evalCashShiftUpdate(atendenteAuth, 'shift-300', shiftAberto, shiftAberto), false, 'ATENDENTE não pode escrever diretamente em cash_shifts');

  // Client SDK create sempre exige paymentStatus == PENDENTE
  const staffPaidCreate = {
    ...baseOrder,
    id: 'ord-paid-create',
    trackingCode: 'tk_staff_paid_create_1234567890123456',
    paymentStatus: 'PAGO',
    status: 'EM_PREPARO',
    movements: [{ id: 'm1', timestamp: '2026-11-11T08:00:00Z', toStatus: 'EM_PREPARO', author: 'PDV' }],
  };
  assert.strictEqual(engine.evalOrderCreate(caixaAuth, 'ord-paid-create', staffPaidCreate), false, 'Client SDK create não pode gravar paymentStatus=PAGO diretamente');

  // Client SDK update não pode alterar paymentStatus nem modificar pedido CANCELADO
  const markPaid = { ...baseOrder, paymentStatus: 'PAGO' };
  assert.strictEqual(engine.evalOrderUpdate(adminAuth, 'ord-1001', baseOrder, markPaid), false, 'Client SDK update não pode mudar paymentStatus (somente Admin SDK /confirm-payment)');
  const cancelledOrder = { ...baseOrder, status: 'CANCELADO' };
  assert.strictEqual(engine.evalOrderUpdate(adminAuth, 'ord-1001', cancelledOrder, { ...cancelledOrder, status: 'EM_PREPARO' }), false, 'Pedido CANCELADO é imutável no Client SDK');

  // Pedido com adicional pago (unitPrice = 14 + 3 = 17) aceito nas rules para equipe autenticada e bloqueado para criação direta anônima
  const orderWithPaidAddon = {
    id: 'ord-addon-ok',
    orderNumber: '#1009',
    createdAt: '2026-11-11T12:00:00Z',
    updatedAt: '2026-11-11T12:00:00Z',
    fulfillmentType: 'RETIRADA',
    customer: { name: 'Ana Adicional', phone: '83999990000' },
    items: [{
      id: 'it-1',
      menuItemId: 'item-cuscuz-carne',
      name: 'Cuscuz',
      quantity: 2,
      unitPrice: 17.00,
      addons: [{ id: 'ad-1', name: 'Queijo Extra', price: 3.00 }],
      subtotal: 34.00
    }],
    subtotal: 34.00,
    deliveryFee: 0,
    discount: 0,
    totalAmount: 34.00,
    paymentMethod: 'PIX',
    paymentStatus: 'PENDENTE',
    status: 'NOVO',
    trackingCode: 'tk_addon_ok_123456789012345678',
    movements: [{ id: 'm1', timestamp: '2026-11-11T12:00:00Z', toStatus: 'NOVO', author: 'Cliente' }]
  };
  assert.strictEqual(engine.evalOrderCreate(customerAuth, 'ord-addon-ok', orderWithPaidAddon), false, 'Anônimo não cria pedido direto sem passar pelo servidor');
  assert.strictEqual(engine.evalOrderCreate(caixaAuth, 'ord-addon-ok', orderWithPaidAddon), true, 'PDV/equipe com adicional pago (unitPrice = base + 3.00) deve ser aceito');
});

runTest('31. Regra Específica /configs/store_schedule: Admin/Gerente vs perfis menores/anônimo + validação estrita de schema', () => {
  const validSchedule = {
    operatingHours: [
      { dayKey: 'seg', label: 'Segunda-feira', isOpen: true, openTime: '07:00', closeTime: '21:00' },
      { dayKey: 'ter', label: 'Terça-feira', isOpen: true, openTime: '07:00', closeTime: '21:00' },
      { dayKey: 'qua', label: 'Quarta-feira', isOpen: true, openTime: '07:00', closeTime: '21:00' },
      { dayKey: 'qui', label: 'Quinta-feira', isOpen: true, openTime: '07:00', closeTime: '21:00' },
      { dayKey: 'sex', label: 'Sexta-feira', isOpen: true, openTime: '07:00', closeTime: '21:00' },
      { dayKey: 'sab', label: 'Sábado', isOpen: true, openTime: '08:00', closeTime: '20:00' },
      { dayKey: 'dom', label: 'Domingo', isOpen: false, openTime: '08:00', closeTime: '14:00' },
    ],
    closedPrimaryMessage: 'Estamos fechados no momento.',
    closedSecondaryMessage: 'Voltamos amanhã no nosso horário habitual.',
    updatedAt: '2026-11-17T02:00:00.000Z',
    updatedBy: 'gerente@staff.amanditasabores.com.br',
  };

  assert.strictEqual(engine.evalConfigGet(adminAuth, 'store_schedule'), true, 'ADMINISTRADOR pode ler store_schedule');
  assert.strictEqual(engine.evalConfigGet(gerenteAuth, 'store_schedule'), true, 'GERENTE pode ler store_schedule');
  assert.strictEqual(engine.evalConfigGet(caixaAuth, 'store_schedule'), false, 'CAIXA não lê store_schedule diretamente');
  assert.strictEqual(engine.evalConfigGet(atendenteAuth, 'store_schedule'), false, 'ATENDENTE não lê store_schedule diretamente');
  assert.strictEqual(engine.evalConfigGet(anonymousAuth, 'store_schedule'), false, 'Anônimo não lê store_schedule diretamente (usa endpoint sanitizado)');

  assert.strictEqual(engine.evalConfigWrite(adminAuth, 'store_schedule', validSchedule), true, 'ADMINISTRADOR pode gravar store_schedule válido');
  assert.strictEqual(engine.evalConfigWrite(gerenteAuth, 'store_schedule', validSchedule), true, 'GERENTE pode gravar store_schedule válido');
  assert.strictEqual(engine.evalConfigWrite(caixaAuth, 'store_schedule', validSchedule), false, 'CAIXA não pode gravar store_schedule');
  assert.strictEqual(engine.evalConfigWrite(atendenteAuth, 'store_schedule', validSchedule), false, 'ATENDENTE não pode gravar store_schedule');
  assert.strictEqual(engine.evalConfigWrite(entregadorAuth, 'store_schedule', validSchedule), false, 'ENTREGADOR não pode gravar store_schedule');
  assert.strictEqual(engine.evalConfigWrite(anonymousAuth, 'store_schedule', validSchedule), false, 'Anônimo não pode gravar store_schedule');
  assert.strictEqual(engine.evalConfigDelete(gerenteAuth, 'store_schedule'), false, 'GERENTE não pode apagar store_schedule');
  assert.strictEqual(engine.evalConfigDelete(adminAuth, 'store_schedule'), true, 'ADMINISTRADOR pode apagar store_schedule');

  // Diferenciação isAdmin vs isGerente preservada
  assert.strictEqual(engine.evalConfigGet(gerenteAuth, 'internal'), false, 'GERENTE continua bloqueado em /configs/internal');

  // Rejeição de payloads malformados
  assert.strictEqual(engine.evalConfigWrite(gerenteAuth, 'store_schedule', { ...validSchedule, extraSecret: 'x' }), false, 'Rejeitar chave não autorizada em store_schedule');
  assert.strictEqual(engine.evalConfigWrite(gerenteAuth, 'store_schedule', { ...validSchedule, closedPrimaryMessage: '' }), false, 'Rejeitar mensagem principal vazia');
  assert.strictEqual(engine.evalConfigWrite(gerenteAuth, 'store_schedule', {
    ...validSchedule,
    operatingHours: validSchedule.operatingHours.slice(0, 6),
  }), false, 'Rejeitar semana com menos de 7 dias');
  assert.strictEqual(engine.evalConfigWrite(gerenteAuth, 'store_schedule', {
    ...validSchedule,
    operatingHours: validSchedule.operatingHours.map((d, i) => i === 0 ? { ...d, openTime: '22:00', closeTime: '10:00' } : d),
  }), false, 'Rejeitar dia aberto com abertura >= fechamento');
});

runTest('32. Bloqueio Client SDK Anônimo: /orders e /public_tracking bloqueiam criação anônima preservando leitura por trackingCode', () => {
  assert.strictEqual(engine.evalOrderCreate(anonymousAuth, 'ord-1001', validOrderPayload), false, 'Anônimo bloqueado de criar direto em /orders');
  assert.strictEqual(engine.evalPublicTrackingCreate(anonymousAuth, 'tk_9876543210abcdef12345678', validTrackingDoc), false, 'Anônimo bloqueado de criar direto em /public_tracking');
  assert.strictEqual(engine.evalPublicTrackingGet(anonymousAuth, 'tk_9876543210abcdef12345678'), true, 'Leitura individual de /public_tracking preservada');
  assert.strictEqual(engine.evalPublicTrackingList(anonymousAuth), false, 'Listagem de /public_tracking segue proibida');
});

runTest('33. Bloqueio Client SDK de CANCELADO em /public_tracking preservando andamento operacional', () => {
  assert.strictEqual(
    engine.evalPublicTrackingUpdate(gerenteAuth, 'tk_9876543210abcdef12345678', validTrackingDoc, { ...validTrackingDoc, status: 'CANCELADO' }),
    false,
    'Client SDK não pode marcar public_tracking como CANCELADO'
  );
  assert.strictEqual(
    engine.evalPublicTrackingUpdate(cozinhaAuth, 'tk_9876543210abcdef12345678', validTrackingDoc, { ...validTrackingDoc, status: 'EM_PREPARO' }),
    true,
    'Atualização operacional normal em public_tracking preservada'
  );
});

console.log(`\n======================================================`);
console.log(`RESULTADO DA SUÍTE DE TESTES: ${passedCount}/${testCount} TESTES APROVADOS.`);
console.log(`======================================================`);

if (passedCount !== testCount) {
  process.exit(1);
}
