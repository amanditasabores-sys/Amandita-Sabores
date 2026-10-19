import {
  MenuItem,
  Order,
  OrderStatus,
  OrderMovementLog,
  RestaurantConfig,
  User,
  PaymentMethod,
  CashRegisterShift,
  CashMovement,
  CashMovementType,
  UserAccessLog
} from '../types';
import { soundService } from './audio';
import { generatePixCopiaECola } from '../utils/pix';
import { INITIAL_MENU, INITIAL_CONFIG, INITIAL_USERS, INITIAL_ORDERS } from '../data/initialData';

interface PendingVerification {
  email: string;
  username: string;
  passwordHash: string;
  code: string;
  expiresAt: number;
}

class StoreService {
  private broadcastChannel: BroadcastChannel | null = null;

  constructor() {
    this.initStorage();
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('gestaofood_sync_channel');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'ORDER_CREATED') {
            soundService.playNewOrderAlert();
          }
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: event.data }));
        };
      } catch {
        // BroadcastChannel unavailable
      }
    }
  }

  private initStorage() {
    // Menu items migration check
    const currentMenuData = localStorage.getItem('gf_menu_items');
    if (!currentMenuData || currentMenuData.includes('Smash Burger') || !currentMenuData.includes('Gostosinho')) {
      localStorage.setItem('gf_menu_items', JSON.stringify(INITIAL_MENU));
    }

    // Orders migration check
    const currentOrdersData = localStorage.getItem('gf_orders');
    if (!currentOrdersData || currentOrdersData.includes('Smash Burger') || currentOrdersData.includes('Pizza Margherita')) {
      localStorage.setItem('gf_orders', JSON.stringify(INITIAL_ORDERS));
    }

    // Restaurant config migration check
    const currentConfigData = localStorage.getItem('gf_restaurant_config');
    if (!currentConfigData || currentConfigData.includes('Brasa & Sabor')) {
      localStorage.setItem('gf_restaurant_config', JSON.stringify(INITIAL_CONFIG));
    }

    // Users and permissions migration check
    const currentUsersData = localStorage.getItem('gf_users');
    if (!currentUsersData || !currentUsersData.includes('allowedModules')) {
      localStorage.setItem('gf_users', JSON.stringify(INITIAL_USERS));
    }

    // Default passwords storage for staff
    if (!localStorage.getItem('gf_user_passwords')) {
      const defaultPasswords: Record<string, string> = {
        'user-admin': '123456',
        'user-caixa': '123456',
        'user-cozinha': '123456',
        'user-entregador': '123456',
        'user-gerente': '123456',
      };
      localStorage.setItem('gf_user_passwords', JSON.stringify(defaultPasswords));
    }

    // Access logs storage
    if (!localStorage.getItem('gf_access_logs')) {
      const initialLogs: UserAccessLog[] = [
        {
          id: 'log-1',
          userId: 'user-admin',
          username: 'admin',
          role: 'ADMINISTRADOR',
          timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          action: 'LOGIN_SUCESSO',
          details: 'Acesso inicial ao Painel Administrativo Amandita Sabores',
        },
        {
          id: 'log-2',
          userId: 'user-caixa',
          username: 'caixa',
          role: 'CAIXA',
          timestamp: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
          action: 'LOGIN_SUCESSO',
          details: 'Abertura do Caixa e Frente de Vendas PDV',
        }
      ];
      localStorage.setItem('gf_access_logs', JSON.stringify(initialLogs));
    }

    // Set default logged user if none exists or update to Amandita admin
    const currUser = localStorage.getItem('gf_current_user');
    if (!currUser || !currUser.includes('allowedModules')) {
      localStorage.setItem('gf_current_user', JSON.stringify(INITIAL_USERS[0]));
    }
  }

  private notify(type: string, payload?: unknown) {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type, payload });
    }
    window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type, payload } }));
  }

  // ---- Menu Items ----
  public getMenuItems(): MenuItem[] {
    try {
      const data = localStorage.getItem('gf_menu_items');
      return data ? JSON.parse(data) : INITIAL_MENU;
    } catch {
      return INITIAL_MENU;
    }
  }

  public saveMenuItem(item: MenuItem): void {
    const items = this.getMenuItems();
    const index = items.findIndex((i) => i.id === item.id);
    if (index >= 0) {
      items[index] = item;
    } else {
      items.push(item);
    }
    localStorage.setItem('gf_menu_items', JSON.stringify(items));
    this.notify('MENU_UPDATED', item);
  }

  public deleteMenuItem(id: string): void {
    const items = this.getMenuItems().filter((i) => i.id !== id);
    localStorage.setItem('gf_menu_items', JSON.stringify(items));
    this.notify('MENU_UPDATED', { id });
  }

  // ---- Orders ----
  public getOrders(): Order[] {
    try {
      const data = localStorage.getItem('gf_orders');
      return data ? JSON.parse(data) : INITIAL_ORDERS;
    } catch {
      return INITIAL_ORDERS;
    }
  }

  public getOrderById(id: string): Order | undefined {
    const orders = this.getOrders();
    return orders.find((o) => o.id === id || o.orderNumber.replace('#', '') === id.replace('#', ''));
  }

  public createOrder(orderInput: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'movements' | 'status'> & { status?: OrderStatus }): Order {
    const orders = this.getOrders();
    const nextNumber = 1000 + orders.length + 1;
    const now = new Date().toISOString();
    const orderId = `ord-${Date.now()}`;

    const isRetirada = orderInput.fulfillmentType === 'RETIRADA';
    const effectiveDeliveryFee = isRetirada ? 0 : orderInput.deliveryFee;
    const effectiveTotal = orderInput.subtotal + effectiveDeliveryFee - (orderInput.discount || 0);

    const newOrder: Order = {
      ...orderInput,
      id: orderId,
      orderNumber: `#${nextNumber}`,
      createdAt: now,
      updatedAt: now,
      deliveryFee: effectiveDeliveryFee,
      totalAmount: effectiveTotal,
      status: orderInput.status || 'NOVO',
      movements: [
        {
          id: `mov-${Date.now()}`,
          timestamp: now,
          toStatus: orderInput.status || 'NOVO',
          author: 'Cliente via Cardápio Web',
          notes: isRetirada ? 'Pedido para retirada no balcão' : 'Pedido para entrega via delivery',
        }
      ]
    };

    // If payment method is PIX, generate official PIX payload with exact purchase amount
    if (newOrder.paymentMethod === 'PIX') {
      const cfg = this.getRestaurantConfig();
      if (cfg.pixKey) {
        try {
          newOrder.pixCode = generatePixCopiaECola({
            pixKey: cfg.pixKey,
            receiverName: cfg.pixReceiverName || cfg.name,
            receiverCity: cfg.pixReceiverCity || 'SAO PAULO',
            amount: newOrder.totalAmount,
            txId: newOrder.orderNumber.replace(/[^a-zA-Z0-9]/g, ''),
            description: `Pedido ${newOrder.orderNumber}`
          });
        } catch {
          newOrder.pixCode = cfg.pixKey;
        }
      }
    }

    const updated = [newOrder, ...orders];
    localStorage.setItem('gf_orders', JSON.stringify(updated));

    // When an order is placed from the cardápio (status NOVO):
    const isCustomerMenuOrder = (orderInput.status === 'NOVO') || 
      newOrder.movements[0]?.author?.includes('Cardápio Web');

    if (isCustomerMenuOrder) {
      // User requirement: persistent audio alert until operator acknowledges as seen!
      this.recordUnseenCustomerOrder(newOrder.id);
      soundService.startPersistentOrderAlert(3500);
    } else {
      soundService.playNewOrderAlert();
    }

    this.notify('ORDER_CREATED', newOrder);
    return newOrder;
  }

  // ---- Unseen Customer Orders & Persistent Alert Management ----
  public getUnseenCustomerOrderIds(): string[] {
    try {
      const data = localStorage.getItem('gf_unseen_order_ids');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public recordUnseenCustomerOrder(orderId: string) {
    try {
      const ids = this.getUnseenCustomerOrderIds();
      if (!ids.includes(orderId)) {
        ids.push(orderId);
        localStorage.setItem('gf_unseen_order_ids', JSON.stringify(ids));
      }
    } catch {
      // fallback
    }
  }

  public markOrderSeen(orderId: string) {
    try {
      const ids = this.getUnseenCustomerOrderIds().filter((id) => id !== orderId);
      localStorage.setItem('gf_unseen_order_ids', JSON.stringify(ids));
      if (ids.length === 0) {
        soundService.stopPersistentOrderAlert();
      }
      this.notify('ORDER_SEEN', { orderId, remainingUnseen: ids.length });
    } catch {
      soundService.stopPersistentOrderAlert();
    }
  }

  public silenceAllAlerts() {
    try {
      localStorage.setItem('gf_unseen_order_ids', JSON.stringify([]));
    } catch {
      // fallback
    }
    soundService.stopPersistentOrderAlert();
    this.notify('ALERTS_SILENCED', {});
  }

  public updateOrderStatus(orderId: string, newStatus: OrderStatus, author: string, notes?: string): Order | null {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;

    const previousStatus = order.status;
    if (previousStatus === newStatus) return order;

    const now = new Date().toISOString();
    order.status = newStatus;
    order.updatedAt = now;

    // Additional status actions
    if (newStatus === 'ENTREGUE') {
      order.paymentStatus = 'PAGO';
      if (order.deliveryPerson) {
        order.deliveryPerson.deliveredAt = now;
      }
      // Automatically record into open cash register
      const shift = this.getCurrentCashShift();
      if (shift && shift.status === 'ABERTO') {
        const alreadyExists = shift.movements.some((m: CashMovement) => m.orderId === order.id);
        if (!alreadyExists) {
          shift.movements.push({
            id: `cash-sale-${order.id}`,
            timestamp: now,
            type: 'VENDA',
            amount: order.totalAmount,
            paymentMethod: order.paymentMethod,
            description: `Venda Pedido ${order.orderNumber} - ${order.customer.name}`,
            orderId: order.id,
            orderNumber: order.orderNumber,
            author: author,
          });
          this.saveCurrentCashShift(shift);
        }
      }
    } else if (newStatus === 'EM_ROTA') {
      if (!order.deliveryPerson) {
        order.deliveryPerson = {
          id: 'entregador-web',
          name: author.includes('Entregador') ? author : 'Entregador de Plantão',
          phone: '(11) 99999-8888',
          assignedAt: now,
        };
      }
    }

    const newMovement: OrderMovementLog = {
      id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: now,
      fromStatus: previousStatus,
      toStatus: newStatus,
      author,
      notes: notes || `Status alterado de ${previousStatus} para ${newStatus}`,
    };

    order.movements.push(newMovement);
    localStorage.setItem('gf_orders', JSON.stringify(orders));

    soundService.playSuccessTone();
    this.notify('ORDER_UPDATED', order);
    return order;
  }

  public assignDeliveryPerson(orderId: string, deliveryPerson: { id: string; name: string; phone: string }): Order | null {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;

    order.deliveryPerson = {
      ...deliveryPerson,
      assignedAt: new Date().toISOString(),
    };
    order.updatedAt = new Date().toISOString();
    order.movements.push({
      id: `mov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      toStatus: order.status,
      author: deliveryPerson.name,
      notes: `Atribuído ao entregador ${deliveryPerson.name}`,
    });

    localStorage.setItem('gf_orders', JSON.stringify(orders));
    this.notify('ORDER_UPDATED', order);
    return order;
  }

  public deleteOrder(orderId: string): boolean {
    const orders = this.getOrders();
    const target = orders.find((o) => o.id === orderId);
    if (!target) return false;

    const filtered = orders.filter((o) => o.id !== orderId);
    localStorage.setItem('gf_orders', JSON.stringify(filtered));

    // Also remove from current open cash register if linked
    const currentShift = this.getCurrentCashShift();
    if (currentShift) {
      const updatedMovements = currentShift.movements.filter((m: CashMovement) => m.orderId !== orderId);
      if (updatedMovements.length !== currentShift.movements.length) {
        currentShift.movements = updatedMovements;
        this.saveCurrentCashShift(currentShift);
      }
    }

    this.notify('ORDER_DELETED', { orderId, orderNumber: target.orderNumber });
    return true;
  }

  // ---- Frente de Caixa / Cash Register ----
  public getCurrentCashShift(): CashRegisterShift | null {
    try {
      const data = localStorage.getItem('gf_current_cash_shift');
      if (data) return JSON.parse(data);

      // Default initial open shift for demonstration
      const initialShift: CashRegisterShift = {
        id: 'shift-' + new Date().toISOString().slice(0, 10),
        openedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
        status: 'ABERTO',
        openedBy: 'admin',
        initialBalance: 150.00,
        movements: [
          {
            id: 'mov-cash-1',
            timestamp: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
            type: 'SUPRIMENTO',
            amount: 50.00,
            paymentMethod: 'DINHEIRO',
            description: 'Reforço de troco para notas de R$ 5 e R$ 2',
            author: 'admin',
          },
          {
            id: 'mov-cash-2',
            timestamp: new Date(Date.now() - 95 * 60 * 1000).toISOString(),
            type: 'VENDA',
            amount: 105.70,
            paymentMethod: 'PIX',
            description: 'Venda Pedido #1000 - Lucas Nogueira',
            orderId: 'ord-1000',
            orderNumber: '#1000',
            author: 'Sistema',
          },
          {
            id: 'mov-cash-3',
            timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            type: 'SANGRIA',
            amount: 40.00,
            paymentMethod: 'DINHEIRO',
            description: 'Compra de hortaliças e gelo para reposição imediata',
            author: 'admin',
          }
        ]
      };
      localStorage.setItem('gf_current_cash_shift', JSON.stringify(initialShift));
      return initialShift;
    } catch {
      return null;
    }
  }

  public saveCurrentCashShift(shift: CashRegisterShift | null): void {
    if (shift) {
      localStorage.setItem('gf_current_cash_shift', JSON.stringify(shift));
    } else {
      localStorage.removeItem('gf_current_cash_shift');
    }
    this.notify('CASH_SHIFT_UPDATED', shift);
  }

  public getCashShiftHistory(): CashRegisterShift[] {
    try {
      const data = localStorage.getItem('gf_cash_shifts_history');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public openCashRegister(initialBalance: number, openedBy: string): CashRegisterShift {
    const newShift: CashRegisterShift = {
      id: `shift-${Date.now()}`,
      openedAt: new Date().toISOString(),
      status: 'ABERTO',
      openedBy,
      initialBalance: Math.max(0, initialBalance),
      movements: [],
    };
    this.saveCurrentCashShift(newShift);
    return newShift;
  }

  public closeCashRegister(countedCash: number, closedBy: string, notes?: string): CashRegisterShift | null {
    const shift = this.getCurrentCashShift();
    if (!shift || shift.status !== 'ABERTO') return null;

    const now = new Date().toISOString();
    
    // Calculate total expected cash in drawer
    let expectedCashInDrawer = shift.initialBalance;
    shift.movements.forEach((m: CashMovement) => {
      if (m.type === 'SUPRIMENTO') {
        expectedCashInDrawer += m.amount;
      } else if (m.type === 'SANGRIA' || m.type === 'VALE') {
        expectedCashInDrawer -= m.amount;
      } else if (m.type === 'VENDA' && m.paymentMethod === 'DINHEIRO') {
        expectedCashInDrawer += m.amount;
      }
    });

    const difference = countedCash - expectedCashInDrawer; // > 0 sobra, < 0 quebra

    const closedShift: CashRegisterShift = {
      ...shift,
      closedAt: now,
      status: 'FECHADO',
      closedBy,
      finalCalculatedBalance: expectedCashInDrawer,
      finalCountedCash: countedCash,
      difference,
      notes: notes || undefined,
    };

    // Save into history
    const history = this.getCashShiftHistory();
    history.unshift(closedShift);
    localStorage.setItem('gf_cash_shifts_history', JSON.stringify(history));

    // Clear current open shift
    this.saveCurrentCashShift(null);
    return closedShift;
  }

  public addCashMovement(
    type: CashMovementType,
    amount: number,
    description: string,
    author: string,
    paymentMethod: PaymentMethod = 'DINHEIRO',
    employeeName?: string
  ): CashMovement | null {
    const shift = this.getCurrentCashShift();
    if (!shift || shift.status !== 'ABERTO') return null;

    const movement: CashMovement = {
      id: `cash-mov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type,
      amount: Math.abs(amount),
      paymentMethod,
      description: description.trim(),
      employeeName: employeeName?.trim() || undefined,
      author,
    };

    shift.movements.push(movement);
    this.saveCurrentCashShift(shift);
    return movement;
  }

  public deleteCashMovement(movementId: string): boolean {
    const shift = this.getCurrentCashShift();
    if (!shift || shift.status !== 'ABERTO') return false;

    const initialLen = shift.movements.length;
    shift.movements = shift.movements.filter((m: CashMovement) => m.id !== movementId);

    if (shift.movements.length !== initialLen) {
      this.saveCurrentCashShift(shift);
      return true;
    }
    return false;
  }

  // ---- Restaurant Config ----
  public getRestaurantConfig(): RestaurantConfig {
    try {
      const data = localStorage.getItem('gf_restaurant_config');
      return data ? JSON.parse(data) : INITIAL_CONFIG;
    } catch {
      return INITIAL_CONFIG;
    }
  }

  public updateRestaurantConfig(config: RestaurantConfig): void {
    localStorage.setItem('gf_restaurant_config', JSON.stringify(config));
    this.notify('CONFIG_UPDATED', config);
  }

  // ---- Users, Staff & Permissions ----
  public getUsers(): User[] {
    try {
      const data = localStorage.getItem('gf_users');
      return data ? JSON.parse(data) : INITIAL_USERS;
    } catch {
      return INITIAL_USERS;
    }
  }

  public getUserById(id: string): User | undefined {
    return this.getUsers().find((u) => u.id === id);
  }

  public getCurrentUser(): User | null {
    try {
      const data = localStorage.getItem('gf_current_user');
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  public setCurrentUser(user: User | null): void {
    if (user) {
      localStorage.setItem('gf_current_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('gf_current_user');
    }
    this.notify('AUTH_CHANGED', user);
  }

  private getUserPasswords(): Record<string, string> {
    try {
      const data = localStorage.getItem('gf_user_passwords');
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  private saveUserPasswords(passwords: Record<string, string>): void {
    localStorage.setItem('gf_user_passwords', JSON.stringify(passwords));
  }

  public getUserPassword(userId: string): string {
    const passwords = this.getUserPasswords();
    return passwords[userId] || '123456';
  }

  public createUser(
    userData: Omit<User, 'id' | 'createdAt'>,
    initialPassword = '123456'
  ): { success: boolean; user?: User; message: string } {
    const users = this.getUsers();
    const cleanUsername = userData.username.trim().toLowerCase();
    const cleanEmail = userData.email.trim().toLowerCase();

    if (users.some((u) => u.username.toLowerCase() === cleanUsername)) {
      return { success: false, message: 'Nome de usuário já cadastrado.' };
    }
    if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      return { success: false, message: 'E-mail já cadastrado para outro funcionário.' };
    }

    const newUser: User = {
      ...userData,
      id: `usr-${Date.now()}`,
      username: cleanUsername,
      email: cleanEmail,
      isEmailVerified: true,
      status: userData.status || 'ATIVO',
      allowedModules: userData.allowedModules || ['pdv', 'kanban'],
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    localStorage.setItem('gf_users', JSON.stringify(users));

    // Save initial password
    const passwords = this.getUserPasswords();
    passwords[newUser.id] = initialPassword;
    this.saveUserPasswords(passwords);

    // Audit log
    this.logAccess({
      userId: newUser.id,
      username: newUser.username,
      role: newUser.role,
      action: 'LOGIN_SUCESSO',
      details: `Novo funcionário criado: ${newUser.name || newUser.username} (${newUser.role})`,
    });

    this.notify('USERS_UPDATED', newUser);
    return { success: true, user: newUser, message: 'Funcionário cadastrado com sucesso!' };
  }

  public updateUser(id: string, updates: Partial<User>): { success: boolean; user?: User; message: string } {
    const users = this.getUsers();
    const index = users.findIndex((u) => u.id === id);
    if (index === -1) {
      return { success: false, message: 'Funcionário não encontrado.' };
    }

    const updatedUser = { ...users[index], ...updates };
    users[index] = updatedUser;
    localStorage.setItem('gf_users', JSON.stringify(users));

    // If current logged-in user was updated, sync session
    const current = this.getCurrentUser();
    if (current && current.id === id) {
      this.setCurrentUser(updatedUser);
    }

    this.notify('USERS_UPDATED', updatedUser);
    return { success: true, user: updatedUser, message: 'Dados do funcionário atualizados!' };
  }

  public resetUserPassword(userId: string, newPassword: string): { success: boolean; message: string } {
    if (!newPassword || newPassword.length < 4) {
      return { success: false, message: 'A nova senha deve ter no mínimo 4 caracteres.' };
    }

    const passwords = this.getUserPasswords();
    passwords[userId] = newPassword;
    this.saveUserPasswords(passwords);

    const user = this.getUserById(userId);
    if (user) {
      this.logAccess({
        userId,
        username: user.username,
        role: user.role,
        action: 'SENHA_ALTERADA',
        details: `Senha redefinida pelo administrador para ${user.name || user.username}`,
      });
    }

    this.notify('USERS_UPDATED', { userId });
    return { success: true, message: 'Senha redefinida com sucesso!' };
  }

  public deleteUser(id: string): { success: boolean; message: string } {
    const users = this.getUsers();
    const user = users.find((u) => u.id === id);
    if (!user) return { success: false, message: 'Usuário não encontrado.' };

    if (user.username === 'admin') {
      return { success: false, message: 'A conta do Administrador Geral não pode ser excluída.' };
    }

    const filtered = users.filter((u) => u.id !== id);
    localStorage.setItem('gf_users', JSON.stringify(filtered));

    const passwords = this.getUserPasswords();
    delete passwords[id];
    this.saveUserPasswords(passwords);

    this.notify('USERS_UPDATED', { id });
    return { success: true, message: 'Funcionário removido com sucesso!' };
  }

  // ---- Audit Access Logs ----
  public getAccessLogs(): UserAccessLog[] {
    try {
      const data = localStorage.getItem('gf_access_logs');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public logAccess(entry: Omit<UserAccessLog, 'id' | 'timestamp'>): void {
    const logs = this.getAccessLogs();
    const newLog: UserAccessLog = {
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    logs.unshift(newLog);
    // Keep max 200 logs
    const trimmed = logs.slice(0, 200);
    localStorage.setItem('gf_access_logs', JSON.stringify(trimmed));
    this.notify('ACCESS_LOG_UPDATED', newLog);
  }

  // ---- Cancel Order with Reason & Operator ----
  public cancelOrder(orderId: string, reason: string, cancelledBy: string): boolean {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return false;

    const previousStatus = order.status;
    const now = new Date().toISOString();

    order.status = 'CANCELADO';
    order.cancellationReason = reason.trim();
    order.cancelledBy = cancelledBy.trim();
    order.updatedAt = now;

    order.movements.push({
      id: `mov-${Date.now()}`,
      timestamp: now,
      fromStatus: previousStatus,
      toStatus: 'CANCELADO',
      author: cancelledBy,
      notes: `Venda Cancelada. Motivo: ${reason}`,
    });

    localStorage.setItem('gf_orders', JSON.stringify(orders));

    // If order was in cash shift, remove it and adjust balance
    const currentShift = this.getCurrentCashShift();
    if (currentShift && currentShift.status === 'ABERTO') {
      const initialCount = currentShift.movements.length;
      currentShift.movements = currentShift.movements.filter((m) => m.orderId !== order.id);
      if (currentShift.movements.length !== initialCount) {
        currentShift.movements.push({
          id: `cash-estorno-${Date.now()}`,
          timestamp: now,
          type: 'AJUSTE',
          amount: order.totalAmount,
          description: `Estorno de Cancelamento Pedido ${order.orderNumber} - Motivo: ${reason}`,
          author: cancelledBy,
          orderId: order.id,
          orderNumber: order.orderNumber,
        });
        this.saveCurrentCashShift(currentShift);
      }
    }

    soundService.playSuccessTone();
    this.notify('ORDER_UPDATED', order);
    return true;
  }

  // ---- Login & Authentication ----
  public login(loginOrEmail: string, password: string): { success: boolean; message: string; user?: User } {
    const users = this.getUsers();
    const term = loginOrEmail.trim().toLowerCase();
    const user = users.find((u) => u.username.toLowerCase() === term || u.email.toLowerCase() === term);

    if (!user) {
      this.logAccess({
        username: loginOrEmail,
        action: 'LOGIN_FALHA',
        details: 'Tentativa de login com usuário inexistente',
      });
      return { success: false, message: 'Usuário ou e-mail não encontrado.' };
    }

    if (user.status === 'BLOQUEADO') {
      this.logAccess({
        userId: user.id,
        username: user.username,
        role: user.role,
        action: 'CONTA_BLOQUEADA',
        details: 'Tentativa de acesso em conta bloqueada',
      });
      return { success: false, message: 'Esta conta está bloqueada pelo administrador. Contate a gerência.' };
    }

    if (user.status === 'DESATIVADO') {
      return { success: false, message: 'Esta conta foi desativada no sistema.' };
    }

    // Verify password
    const passwords = this.getUserPasswords();
    const storedPass = passwords[user.id] || '123456';

    if (password.trim() !== storedPass.trim()) {
      this.logAccess({
        userId: user.id,
        username: user.username,
        role: user.role,
        action: 'LOGIN_FALHA',
        details: 'Senha incorreta digitada',
      });
      return { success: false, message: 'Senha incorreta.' };
    }

    // Update lastLoginAt
    user.lastLoginAt = new Date().toISOString();
    this.updateUser(user.id, { lastLoginAt: user.lastLoginAt });

    this.setCurrentUser(user);

    this.logAccess({
      userId: user.id,
      username: user.username,
      role: user.role,
      action: 'LOGIN_SUCESSO',
      details: `Acesso realizado com perfil ${user.role}`,
    });

    return { success: true, message: 'Login realizado com sucesso!', user };
  }

  public logout(): void {
    const current = this.getCurrentUser();
    if (current) {
      this.logAccess({
        userId: current.id,
        username: current.username,
        role: current.role,
        action: 'LOGOUT',
        details: 'Logout efetuado da sessão',
      });
    }
    this.setCurrentUser(null);
  }

  // Reset to initial demo data
  public resetToSampleData(): void {
    localStorage.setItem('gf_menu_items', JSON.stringify(INITIAL_MENU));
    localStorage.setItem('gf_orders', JSON.stringify(INITIAL_ORDERS));
    localStorage.setItem('gf_restaurant_config', JSON.stringify(INITIAL_CONFIG));
    localStorage.setItem('gf_users', JSON.stringify(INITIAL_USERS));
    localStorage.setItem('gf_current_user', JSON.stringify(INITIAL_USERS[0]));
    
    const defaultPasswords: Record<string, string> = {
      'user-admin': '123456',
      'user-caixa': '123456',
      'user-cozinha': '123456',
      'user-entregador': '123456',
      'user-gerente': '123456',
    };
    localStorage.setItem('gf_user_passwords', JSON.stringify(defaultPasswords));

    this.notify('FULL_RESET');
  }
}

export const store = new StoreService();
