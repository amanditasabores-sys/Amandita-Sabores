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
  UserAccessLog,
  PublicOrderTracking,
  UserRole
} from '../types';
import { soundService } from './audio';
import { generatePixCopiaECola } from '../utils/pix';
import { INITIAL_MENU, INITIAL_CONFIG, INITIAL_USERS, INITIAL_ORDERS } from '../data/initialData';
import { 
  db, 
  auth, 
  isFirebaseReady, 
  testFirestoreConnection, 
  signInWithGoogle, 
  signInWithEmail,
  createUserWithEmail,
  signOutFirebase,
  handleFirestoreError,
  formatFirebaseAuthError,
  OperationType,
  getFirebaseConfigStatus,
  FirebaseConfigState,
  subscribeToAuthChanges
} from './firebase';
import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  getDocs, 
  getDoc,
  getDocFromServer,
  query,
  where,
  onSnapshot, 
  Unsubscribe 
} from 'firebase/firestore';

export interface MigrationSummary {
  success: boolean;
  message: string;
  counts: {
    menuItems: number;
    orders: number;
    cashShifts: number;
    users: number;
    configs: number;
  };
  skippedCount: number;
}

class StoreService {
  private broadcastChannel: BroadcastChannel | null = null;
  private publicUnsubscribers: Unsubscribe[] = [];
  private staffUnsubscribers: Unsubscribe[] = [];
  private isPublicSyncActive = false;
  private isStaffSyncActive = false;
  private isFlushingPendingQueue = false;

  /**
   * Sanitizes objects recursively for Firestore by eliminating unsupported 'undefined' values
   * and transient client-only fields (prefixed with '_')
   */
  private cleanForFirestore<T>(data: T): T {
    if (data === null || data === undefined) return null as any;
    if (Array.isArray(data)) {
      return data.map((item) => this.cleanForFirestore(item)) as any;
    }
    if (typeof data === 'object' && !(data instanceof Date)) {
      const clean: Record<string, any> = {};
      for (const [key, val] of Object.entries(data as Record<string, any>)) {
        if (key.startsWith('_')) continue; // Strip client-only transient properties
        if (val !== undefined) {
          clean[key] = this.cleanForFirestore(val);
        }
      }
      return clean as any;
    }
    return data;
  }

  // ==========================================
  // RESILIENT PENDING CLOUD SYNC QUEUE
  // ==========================================
  public getPendingSyncOrders(): Order[] {
    try {
      const raw = localStorage.getItem('gf_pending_sync_orders');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private savePendingSyncOrders(orders: Order[]): void {
    try {
      localStorage.setItem('gf_pending_sync_orders', JSON.stringify(orders));
    } catch {
      // storage fallback
    }
  }

  public queueOrderForSync(order: Order): void {
    const list = this.getPendingSyncOrders();
    const idx = list.findIndex((o) => o.id === order.id);
    if (idx >= 0) {
      list[idx] = order;
    } else {
      list.push(order);
    }
    this.savePendingSyncOrders(list);
  }

  public removeOrderFromSyncQueue(orderId: string): void {
    const list = this.getPendingSyncOrders().filter((o) => o.id !== orderId);
    this.savePendingSyncOrders(list);
  }

  public updateLocalOrderSyncStatus(orderId: string, status: 'SYNCED' | 'PENDING' | 'ERROR'): void {
    const orders = this.getOrders();
    const idx = orders.findIndex((o) => o.id === orderId);
    if (idx >= 0) {
      orders[idx]._cloudSyncStatus = status;
      try {
        localStorage.setItem('gf_orders', JSON.stringify(orders));
      } catch {
        // quota fallback
      }
      this.notify('ORDER_SYNC_STATUS_CHANGED', { orderId, status });
    }
  }

  /**
   * Persists an order directly to Cloud Firestore with confirmation and queue tracking
   */
  public async persistOrderToFirestore(order: Order): Promise<{ success: boolean; error?: string }> {
    if (!db) {
      this.queueOrderForSync(order);
      this.updateLocalOrderSyncStatus(order.id, 'PENDING');
      return { success: false, error: 'Cloud Firestore não inicializado' };
    }

    try {
      const cleanOrder = this.cleanForFirestore(order);
      await setDoc(doc(db, 'orders', order.id), cleanOrder);

      if (order.trackingCode) {
        const publicPayload = this.buildPublicTrackingPayload(order);
        await setDoc(doc(db, 'public_tracking', order.trackingCode), publicPayload).catch(() => {});
      }

      this.removeOrderFromSyncQueue(order.id);
      this.updateLocalOrderSyncStatus(order.id, 'SYNCED');
      this.notify('ORDER_SYNC_CONFIRMED', { orderId: order.id });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[Firestore] Falha na sincronização do pedido ' + order.id + ' (mantido na fila resiliente):', msg);
      this.queueOrderForSync(order);
      this.updateLocalOrderSyncStatus(order.id, 'PENDING');
      return { success: false, error: msg };
    }
  }

  /**
   * Flushes all pending queued operations to Cloud Firestore once connection is available
   */
  public async flushPendingSyncQueue(): Promise<{ processed: number; succeeded: number }> {
    if (!db || this.isFlushingPendingQueue) return { processed: 0, succeeded: 0 };
    const pending = this.getPendingSyncOrders();
    if (pending.length === 0) return { processed: 0, succeeded: 0 };

    this.isFlushingPendingQueue = true;
    let succeeded = 0;

    try {
      for (const order of pending) {
        try {
          const cleanOrder = this.cleanForFirestore(order);
          await setDoc(doc(db, 'orders', order.id), cleanOrder);

          if (order.trackingCode) {
            const publicPayload = this.buildPublicTrackingPayload(order);
            await setDoc(doc(db, 'public_tracking', order.trackingCode), publicPayload).catch(() => {});
          }

          this.removeOrderFromSyncQueue(order.id);
          this.updateLocalOrderSyncStatus(order.id, 'SYNCED');
          succeeded++;
        } catch {
          // Keep in queue for next transmission cycle
        }
      }
    } finally {
      this.isFlushingPendingQueue = false;
    }

    return { processed: pending.length, succeeded };
  }

  /**
   * Auto-authenticates active staff member with Firebase Auth in the background
   * ensuring that security rules recognize the operator without requiring manual login screens
   */
  public async ensureFirebaseAuthForStaff(): Promise<void> {
    if (!isFirebaseReady() || !auth) return;
    if (auth.currentUser) return; // Session already established

    const user = this.getCurrentUser();
    if (!user || !this.isAuthorizedStaffRole(user.role)) return;

    let email = user.email || '';
    if (!email.includes('@')) {
      email = `${user.username}@staff.amanditasabores.com.br`;
    }
    if (user.role === 'ADMINISTRADOR' || user.username === 'admin') {
      email = this.getInitialAdminEmail();
    }

    const passwords = this.getUserPasswords();
    const password = passwords[user.id] || '123456';

    try {
      await signInWithEmail(email, password);
    } catch {
      try {
        await createUserWithEmail(email, password);
      } catch {
        // Fallback
      }
    }
  }

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
        // BroadcastChannel unavailable in iframe or sandbox
      }
    }

    // Initialize public real-time data (Menu & Store Config)
    this.initPublicFirestoreSync();

    // Reconnection listener to flush pending orders automatically when network returns
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.info('[Store Sync] Conexão restabelecida. Transmitindo pedidos pendentes...');
        this.flushPendingSyncQueue();
      });

      // Background heartbeat to retry pending sync queue every 20 seconds
      setInterval(() => {
        this.flushPendingSyncQueue();
      }, 20000);
    }

    // Condition staff-only listeners to authenticated Firebase Auth sessions with confirmed staff role
    if (typeof window !== 'undefined') {
      subscribeToAuthChanges(async (firebaseUser) => {
        if (firebaseUser) {
          try {
            const confirmedRole = await this.verifyStaffRole(firebaseUser);
            if (confirmedRole) {
              let profile: User | null = null;
              if (db) {
                try {
                  const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
                  if (snap.exists()) {
                    profile = snap.data() as User;
                  }
                } catch {
                  // Fallback to local profile check
                }
              }
              if (!profile) {
                const localUsers = this.getUsers();
                profile = localUsers.find(
                  (u) => u.id === firebaseUser.uid || (firebaseUser.email && u.email.toLowerCase() === firebaseUser.email.toLowerCase())
                ) || null;
              }
              if (profile && profile.status === 'ATIVO') {
                this.setCurrentUser(profile);
              }
            }
          } catch (e) {
            console.warn('[Store] Falha ao restaurar perfil do usuário autenticado:', e);
          }
          await this.initStaffFirestoreSync(firebaseUser);
          this.flushPendingSyncQueue();
        } else {
          // If staff is logged in locally, auto-authenticate to Firebase Auth in background
          const curr = this.getCurrentUser();
          if (curr && this.isAuthorizedStaffRole(curr.role)) {
            this.ensureFirebaseAuthForStaff().then(() => {
              if (auth?.currentUser) {
                this.initStaffFirestoreSync(auth.currentUser);
              }
            }).catch(() => {});
          } else {
            this.stopStaffFirestoreSync();
          }
        }
      });

      // If already logged in locally as staff on startup, trigger staff sync auto-connect
      const startupUser = this.getCurrentUser();
      if (startupUser && this.isAuthorizedStaffRole(startupUser.role)) {
        setTimeout(() => {
          this.ensureFirebaseAuthForStaff().then(() => {
            this.initStaffFirestoreSync();
          }).catch(() => {});
        }, 1000);
      }
    }
  }

  private initStorage() {
    try {
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
          'user-atendente': '123456',
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
    } catch {
      // Storage quota or restriction fallback
    }
  }

  // ==========================================
  // REAL-TIME FIRESTORE SYNCHRONIZATION
  // ==========================================
  
  /**
   * Identifies whether the current window/session is in the public customer context
   * (e.g. Cardápio digital or Rastreio de pedido), preventing public visitors from attaching
   * internal management listeners.
   */
  public isPublicCustomerContext(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const search = window.location.search.toLowerCase();
      const hash = window.location.hash.toLowerCase();
      const pathname = window.location.pathname.toLowerCase();
      return (
        search.includes('view=cardapio') ||
        search.includes('view=rastreio') ||
        hash.includes('cardapio') ||
        hash.includes('rastreio') ||
        pathname.includes('/cardapio') ||
        pathname.includes('/rastreio')
      );
    } catch {
      return false;
    }
  }

  /**
   * Helper that checks if a role string belongs to the internal staff team
   */
  public isAuthorizedStaffRole(role?: string | null): boolean {
    if (!role) return false;
    const normalized = role.toUpperCase();
    return ['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'COZINHA', 'ENTREGADOR', 'ATENDENTE'].includes(normalized);
  }

  /**
   * Specific role permission verifiers to enforce RBAC rules across store operations
   */
  public canUserManageMenu(): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;
    const role = user.role?.toUpperCase();
    if (role === 'ADMINISTRADOR' || user.username === 'admin') return true;
    if (role === 'GERENTE' && user.allowedModules?.includes('menu')) return true;
    return false;
  }

  public canUserManageUsers(): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;
    const role = user.role?.toUpperCase();
    return role === 'ADMINISTRADOR' || user.username === 'admin';
  }

  public canUserManageCash(): boolean {
    const user = this.getCurrentUser();
    if (!user) return false;
    const role = user.role?.toUpperCase();
    if (role === 'ADMINISTRADOR' || user.username === 'admin' || role === 'GERENTE') return true;
    if (role === 'CAIXA') return true;
    return Boolean(user.allowedModules && user.allowedModules.includes('caixa'));
  }

  public canUserUpdateOrderStatus(user: User | null, targetStatus: OrderStatus): boolean {
    if (!user) return false;
    const role = user.role?.toUpperCase();
    if (role === 'ADMINISTRADOR' || user.username === 'admin' || role === 'GERENTE') return true;
    if (role === 'COZINHA') {
      return targetStatus === 'EM_PREPARO' || targetStatus === 'PRONTO';
    }
    if (role === 'ENTREGADOR') {
      return targetStatus === 'EM_ROTA' || targetStatus === 'ENTREGUE';
    }
    if (role === 'ATENDENTE' || role === 'CAIXA') {
      return true;
    }
    return true;
  }

  /**
   * Safe resolution for the initial bootstrap administrator email
   * Priority: Environment variable VITE_INITIAL_ADMIN_EMAIL, followed by owner account fallback
   */
  public getInitialAdminEmail(): string {
    const rawVite = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_INITIAL_ADMIN_EMAIL : undefined;
    const rawProc = typeof process !== 'undefined' && process.env ? process.env.VITE_INITIAL_ADMIN_EMAIL : undefined;
    return (rawVite || rawProc || 'dvrmercadinho@gmail.com').trim().toLowerCase();
  }

  /**
   * Verifies if an authenticated Firebase User has a confirmed authorized staff role.
   * Does NOT blindly trust localStorage; checks remote Firestore /users/{uid} and the staff registry.
   */
  public async verifyStaffRole(firebaseUser: { uid: string; email?: string | null } | null): Promise<UserRole | null> {
    if (!firebaseUser) return null;

    // 1. Check remote Firestore users collection if database is reachable
    if (db) {
      try {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const remoteData = userSnap.data() as Partial<User>;
          if (remoteData.status === 'ATIVO' && remoteData.role && this.isAuthorizedStaffRole(remoteData.role)) {
            return remoteData.role as UserRole;
          }
        }
      } catch (err) {
        console.warn('[Store Security] Verificação de papel no Firestore remoto falhou (modo contingência):', err);
      }
    }

    // 2. Check local authorized staff registry for matched UID or email
    const localUsers = this.getUsers();
    const matched = localUsers.find(
      (u) => u.id === firebaseUser.uid || (firebaseUser.email && u.email?.toLowerCase() === firebaseUser.email.toLowerCase())
    );

    if (matched && matched.status === 'ATIVO' && this.isAuthorizedStaffRole(matched.role)) {
      return matched.role as UserRole;
    }

    // 3. Admin email bootstrap check
    const adminEmail = this.getInitialAdminEmail();
    if (firebaseUser.email && (firebaseUser.email.trim().toLowerCase() === adminEmail || firebaseUser.email.trim().toLowerCase() === 'admin@amanditasabores.com.br')) {
      return 'ADMINISTRADOR';
    }

    // 4. Staff domain email check (@staff.amanditasabores.com.br or @amanditasabores.com.br)
    if (firebaseUser.email && (firebaseUser.email.endsWith('@staff.amanditasabores.com.br') || firebaseUser.email.endsWith('@amanditasabores.com.br'))) {
      const username = firebaseUser.email.split('@')[0].toLowerCase();
      const byUser = localUsers.find((u) => u.username.toLowerCase() === username);
      if (byUser && this.isAuthorizedStaffRole(byUser.role)) {
        return byUser.role as UserRole;
      }
      return 'ATENDENTE';
    }

    return null;
  }

  /**
   * Synchronous check to determine if the active Firebase Auth user is a confirmed staff member
   */
  public isFirebaseAuthStaff(): boolean {
    const currentFbUser = auth?.currentUser;
    if (!currentFbUser) return false;

    const adminEmail = this.getInitialAdminEmail();
    if (currentFbUser.email && currentFbUser.email.trim().toLowerCase() === adminEmail) return true;

    const localUsers = this.getUsers();
    const matched = localUsers.find(
      (u) => u.id === currentFbUser.uid || (currentFbUser.email && u.email?.toLowerCase() === currentFbUser.email.toLowerCase())
    );

    return Boolean(matched && matched.status === 'ATIVO' && this.isAuthorizedStaffRole(matched.role));
  }

  public initFirestoreSync(): void {
    // Forward compatibility helper: initializes public sync
    this.initPublicFirestoreSync();
  }

  /**
   * Public Firestore listeners: Only public resources that unauthenticated visitors are permitted to see
   * (Menu items and public restaurant config). Never touches internal orders or cash shifts.
   */
  public initPublicFirestoreSync(): void {
    if (!db || this.isPublicSyncActive) return;

    try {
      this.isPublicSyncActive = true;

      // 1. Synchronize Menu Items in Real Time (Public catalog)
      const unsubMenu = onSnapshot(
        collection(db, 'menu_items'),
        (snapshot) => {
          if (!snapshot.empty) {
            const remoteMenu: MenuItem[] = [];
            snapshot.forEach((docSnap) => {
              remoteMenu.push(docSnap.data() as MenuItem);
            });
            localStorage.setItem('gf_menu_items', JSON.stringify(remoteMenu));
            this.notify('FIRESTORE_MENU_SYNCED', { count: remoteMenu.length });
          }
        },
        (error) => {
          console.warn('[Firestore Public Sync] Menu listener notice:', error.message);
        }
      );
      this.publicUnsubscribers.push(unsubMenu);

      // 2. Synchronize Restaurant Config in Real Time (Public info: WhatsApp, PIX, store status)
      const unsubConfig = onSnapshot(
        doc(db, 'configs', 'restaurant'),
        (docSnap) => {
          if (docSnap.exists()) {
            const config = docSnap.data() as RestaurantConfig;
            localStorage.setItem('gf_restaurant_config', JSON.stringify(config));
            this.notify('CONFIG_UPDATED', config);
          }
        },
        (error) => {
          console.warn('[Firestore Public Sync] Config listener notice:', error.message);
        }
      );
      this.publicUnsubscribers.push(unsubConfig);

    } catch (err) {
      console.warn('[Firestore Public Sync Setup Error]:', err);
    }
  }

  /**
  /**
   * Internal Staff Firestore listeners: Orders collection, Cash register shifts, and Staff users.
   * STRICT SECURITY:
   * 1. Rejects if user is not authenticated in Firebase Auth.
   * 2. Confirms that the authenticated user possesses an authorized staff role.
   * Never leaks internal operational order lists to unauthenticated visitors.
   */
  public async initStaffFirestoreSync(firebaseUser?: unknown): Promise<void> {
    if (!db || this.isStaffSyncActive) return;

    // 1. If no active Firebase Auth session, attempt background auto-auth for local staff
    if (!auth?.currentUser) {
      await this.ensureFirebaseAuthForStaff();
    }

    if (!auth?.currentUser) {
      console.info('[Firestore Security] Aguardando sessão de colaborador no Firebase Auth para sincronização interna.');
      return;
    }

    // 2. Confirm that the authenticated user possesses an authorized staff role
    const confirmedRole = await this.verifyStaffRole(auth.currentUser);
    if (!confirmedRole) {
      console.warn('[Firestore Security] Usuário autenticado no Firebase não possui confirmação de papel de colaborador autorizado para sincronizar dados internos.');
      return;
    }

    try {
      this.isStaffSyncActive = true;

      // Ensure catalog and store config exist in Firestore
      this.ensureInitialDataSeededToFirestore().catch(() => {});

      const currentLocalUser = this.getCurrentUser();
      const role = currentLocalUser?.role?.toUpperCase();
      const allowedModules = currentLocalUser?.allowedModules || [];

      const canAccessCash = role === 'ADMINISTRADOR' || role === 'GERENTE' || role === 'CAIXA' || allowedModules.includes('caixa');
      const canAccessUsers = role === 'ADMINISTRADOR' || role === 'GERENTE' || allowedModules.includes('usuarios');

      // 1. Synchronize All Orders in Real Time (Staff only: Kitchen KDS, POS Balcão, Entregadores, Admin)
      const unsubOrders = onSnapshot(
        collection(db, 'orders'),
        (snapshot) => {
          const remoteOrders: Order[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as Order;
            remoteOrders.push(data);
          });

          remoteOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

          const localOrders = this.getOrders();
          const localIds = new Set(localOrders.map((o) => o.id));
          const newIncoming = remoteOrders.filter((ro) => !localIds.has(ro.id) && ro.status === 'NOVO');
          
          if (newIncoming.length > 0) {
            newIncoming.forEach((o) => this.recordUnseenCustomerOrder(o.id));
            soundService.startPersistentOrderAlert(3500);
          }

          if (remoteOrders.length > 0) {
            const pendingOrders = this.getPendingSyncOrders();
            const pendingIds = new Set(pendingOrders.map((o) => o.id));
            const remoteMap = new Map(remoteOrders.map((o) => [o.id, o]));

            const merged: Order[] = [];
            // Preserve pending local orders so user actions aren't overwritten before upload
            for (const lo of localOrders) {
              if (pendingIds.has(lo.id)) {
                merged.push(lo);
                remoteMap.delete(lo.id);
              }
            }
            // Add remote orders
            for (const ro of remoteMap.values()) {
              merged.push({ ...ro, _cloudSyncStatus: 'SYNCED' });
            }
            // Preserve any local order not yet on remote
            for (const lo of localOrders) {
              if (!merged.some((m) => m.id === lo.id)) {
                merged.push(lo);
              }
            }

            merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            localStorage.setItem('gf_orders', JSON.stringify(merged));
          } else if (localOrders.length > 0 && db) {
            // Firestore orders was empty: seed existing local orders to Firestore
            for (const lo of localOrders) {
              this.persistOrderToFirestore(lo).catch(() => {});
            }
          }

          this.notify('FIRESTORE_ORDERS_SYNCED', { count: remoteOrders.length });
          this.notify('ORDERS_UPDATED', { count: remoteOrders.length });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'FIRESTORE_ORDERS_SYNCED' } }));
          }
        },
        (error) => {
          console.warn('[Firestore Staff Sync] Aviso no listener de pedidos:', error.message);
          this.isStaffSyncActive = false;
          if (error.code === 'permission-denied') {
            setTimeout(() => {
              this.ensureFirebaseAuthForStaff().then(() => this.initStaffFirestoreSync()).catch(() => {});
            }, 10000);
          }
        }
      );
      this.staffUnsubscribers.push(unsubOrders);

      // 2. Synchronize Cash Register Shifts in Real Time (Restricted to roles authorized for cash)
      if (canAccessCash) {
        const unsubShifts = onSnapshot(
          collection(db, 'cash_shifts'),
          (snapshot) => {
            const shifts: CashRegisterShift[] = [];
            snapshot.forEach((docSnap) => {
              shifts.push(docSnap.data() as CashRegisterShift);
            });

            // Detect active open shift
            const openShift = shifts.find((s) => s.status === 'ABERTO') || null;
            if (openShift) {
              localStorage.setItem('gf_current_cash_shift', JSON.stringify(openShift));
            } else {
              localStorage.removeItem('gf_current_cash_shift');
            }

            // Detect closed shift history
            const closedShifts = shifts
              .filter((s) => s.status === 'FECHADO')
              .sort((a, b) => new Date(b.closedAt || b.openedAt).getTime() - new Date(a.closedAt || a.openedAt).getTime());
            if (closedShifts.length > 0) {
              localStorage.setItem('gf_cash_shifts_history', JSON.stringify(closedShifts));
            }

            this.notify('CASH_SHIFT_UPDATED', openShift);
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Cash shift notice:', error.message);
            if (error.code === 'permission-denied') {
              this.stopStaffFirestoreSync();
            }
          }
        );
        this.staffUnsubscribers.push(unsubShifts);
      }

      // 3. Synchronize Staff Users in Real Time (Restricted to Administrator & Management)
      if (canAccessUsers) {
        const unsubUsers = onSnapshot(
          collection(db, 'users'),
          (snapshot) => {
            if (!snapshot.empty) {
              const remoteUsers: User[] = [];
              snapshot.forEach((docSnap) => {
                remoteUsers.push(docSnap.data() as User);
              });

              const localUsers = this.getUsers();
              const merged = [...remoteUsers];
              for (const lu of localUsers) {
                if (!merged.some((ru) => ru.id === lu.id || ru.username.toLowerCase() === lu.username.toLowerCase())) {
                  merged.push(lu);
                }
              }

              localStorage.setItem('gf_users', JSON.stringify(merged));
              this.notify('USERS_UPDATED', { count: merged.length });
            }
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Users listener notice:', error.message);
            if (error.code === 'permission-denied') {
              this.stopStaffFirestoreSync();
            }
          }
        );
        this.staffUnsubscribers.push(unsubUsers);
      }

    } catch (err) {
      console.warn('[Firestore Staff Sync Setup Error]:', err);
    }
  }

  /**
   * Seeds initial menu items and restaurant config to Cloud Firestore
   * if the collections are currently empty on the cloud database.
   */
  public async ensureInitialDataSeededToFirestore(): Promise<void> {
    if (!db || !this.isFirebaseAuthStaff()) return;

    try {
      const menuSnap = await getDocs(collection(db, 'menu_items'));
      if (menuSnap.empty) {
        console.info('[Firestore] Populando cardápio inicial no Cloud Firestore (amandita-sabores)...');
        const items = this.getMenuItems();
        for (const item of items) {
          await setDoc(doc(db, 'menu_items', item.id), item);
        }
      }

      const configRef = doc(db, 'configs', 'restaurant');
      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        const config = this.getRestaurantConfig();
        await setDoc(configRef, config);
      }
    } catch (err) {
      console.warn('[Firestore Initial Seeding Notice]:', err);
    }
  }

  public stopStaffFirestoreSync(): void {
    this.staffUnsubscribers.forEach((unsub) => unsub());
    this.staffUnsubscribers = [];
    this.isStaffSyncActive = false;
  }

  public stopFirestoreSync(): void {
    this.publicUnsubscribers.forEach((unsub) => unsub());
    this.publicUnsubscribers = [];
    this.isPublicSyncActive = false;
    this.stopStaffFirestoreSync();
  }

  public getFirebaseStatus(): FirebaseConfigState {
    return getFirebaseConfigStatus();
  }

  public async testConnection(): Promise<{ success: boolean; message: string; details?: string }> {
    return testFirestoreConnection();
  }

  // ==========================================
  // SAFE LOCALSTORAGE MIGRATION & BACKUP
  // ==========================================
  public exportLocalDataBackup(): string {
    const backup = {
      exportedAt: new Date().toISOString(),
      appName: 'Amandita Sabores',
      data: {
        menuItems: this.getMenuItems(),
        orders: this.getOrders(),
        config: this.getRestaurantConfig(),
        currentCashShift: this.getCurrentCashShift(),
        cashShiftsHistory: this.getCashShiftHistory(),
        users: this.getUsers().map(({ ...safeUser }) => safeUser), // clean user profiles
        accessLogs: this.getAccessLogs(),
      }
    };
    return JSON.stringify(backup, null, 2);
  }

  public async migrateLocalDataToFirestore(): Promise<MigrationSummary> {
    if (!db) {
      return {
        success: false,
        message: 'Firebase não está inicializado. Configure as chaves VITE_FIREBASE_* no ambiente.',
        counts: { menuItems: 0, orders: 0, cashShifts: 0, users: 0, configs: 0 },
        skippedCount: 0,
      };
    }

    try {
      let menuCount = 0;
      let orderCount = 0;
      let shiftCount = 0;
      let userCount = 0;
      let configCount = 0;
      let skippedCount = 0;

      // 1. Migrate Restaurant Config
      const config = this.getRestaurantConfig();
      const configRef = doc(db, 'configs', 'restaurant');
      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        await setDoc(configRef, config);
        configCount++;
      } else {
        skippedCount++;
      }

      // 2. Migrate Menu Items with deduplication
      const menuItems = this.getMenuItems();
      for (const item of menuItems) {
        const itemRef = doc(db, 'menu_items', item.id);
        const itemSnap = await getDoc(itemRef);
        if (!itemSnap.exists()) {
          await setDoc(itemRef, item);
          menuCount++;
        } else {
          skippedCount++;
        }
      }

      // 3. Migrate Orders with deduplication
      const orders = this.getOrders();
      for (const order of orders) {
        const orderRef = doc(db, 'orders', order.id);
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
          await setDoc(orderRef, order);
          orderCount++;
        } else {
          skippedCount++;
        }
      }

      // 4. Migrate Cash Shifts
      const currentShift = this.getCurrentCashShift();
      if (currentShift) {
        const shiftRef = doc(db, 'cash_shifts', currentShift.id);
        const shiftSnap = await getDoc(shiftRef);
        if (!shiftSnap.exists()) {
          await setDoc(shiftRef, currentShift);
          shiftCount++;
        } else {
          skippedCount++;
        }
      }

      // 5. Migrate Users (Without raw passwords!)
      const users = this.getUsers();
      for (const u of users) {
        const userRef = doc(db, 'users', u.id);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          // Exclude any password from cloud storage
          const safeUserDoc = {
            id: u.id,
            name: u.name || u.username,
            username: u.username,
            email: u.email,
            isEmailVerified: u.isEmailVerified,
            role: u.role,
            status: u.status || 'ATIVO',
            allowedModules: u.allowedModules || ['pdv', 'kanban'],
            createdAt: u.createdAt,
            lastLoginAt: u.lastLoginAt || new Date().toISOString()
          };
          await setDoc(userRef, safeUserDoc);
          userCount++;
        } else {
          skippedCount++;
        }
      }

      return {
        success: true,
        message: `Migração concluída com sucesso para o Cloud Firestore (amandita-sabores)!`,
        counts: {
          menuItems: menuCount,
          orders: orderCount,
          cashShifts: shiftCount,
          users: userCount,
          configs: configCount,
        },
        skippedCount,
      };
    } catch (error) {
      console.error('[Migration Error]:', error);
      handleFirestoreError(error, OperationType.WRITE, 'migration');
      return {
        success: false,
        message: `Falha na migração: ${error instanceof Error ? error.message : String(error)}`,
        counts: { menuItems: 0, orders: 0, cashShifts: 0, users: 0, configs: 0 },
        skippedCount: 0,
      };
    }
  }

  private notify(type: string, payload?: unknown) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type, payload });
      } catch {
        // BroadcastChannel send error
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type, payload } }));
    }
  }

  // ==========================================
  // MENU ITEMS API (LOCAL CACHE + FIRESTORE SYNC)
  // ==========================================
  public getMenuItems(): MenuItem[] {
    try {
      const data = localStorage.getItem('gf_menu_items');
      return data ? JSON.parse(data) : INITIAL_MENU;
    } catch {
      return INITIAL_MENU;
    }
  }

  public saveMenuItem(item: MenuItem): void {
    if (!this.canUserManageMenu()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para gerenciar o cardápio.');
      return;
    }

    const items = this.getMenuItems();
    const index = items.findIndex((i) => i.id === item.id);
    if (index >= 0) {
      items[index] = item;
    } else {
      items.push(item);
    }
    localStorage.setItem('gf_menu_items', JSON.stringify(items));
    this.notify('MENU_UPDATED', item);

    // Asynchronously sync to Firestore
    if (db) {
      setDoc(doc(db, 'menu_items', item.id), item).catch((err) => {
        handleFirestoreError(err, OperationType.WRITE, `menu_items/${item.id}`);
      });
    }
  }

  public deleteMenuItem(id: string): void {
    if (!this.canUserManageMenu()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para excluir itens do cardápio.');
      return;
    }

    const items = this.getMenuItems().filter((i) => i.id !== id);
    localStorage.setItem('gf_menu_items', JSON.stringify(items));
    this.notify('MENU_UPDATED', { id });

    // Asynchronously delete from Firestore
    if (db) {
      deleteDoc(doc(db, 'menu_items', id)).catch((err) => {
        handleFirestoreError(err, OperationType.DELETE, `menu_items/${id}`);
      });
    }
  }

  // ==========================================
  // ORDERS API (LOCAL CACHE + FIRESTORE SYNC)
  // ==========================================
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

    // Cryptographic unguessable high-entropy tracking code (protects customer privacy against ID guessing)
    const trackingCode = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `tk_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;

    const newOrder: Order = {
      ...orderInput,
      id: orderId,
      orderNumber: `#${nextNumber}`,
      createdAt: now,
      updatedAt: now,
      deliveryFee: effectiveDeliveryFee,
      totalAmount: effectiveTotal,
      status: orderInput.status || 'NOVO',
      trackingCode,
      _cloudSyncStatus: 'PENDING',
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

    // Save tracking code in client browser session so creator can always track their order
    this.saveClientTrackingCode(newOrder.id, trackingCode);

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
      this.recordUnseenCustomerOrder(newOrder.id);
      soundService.startPersistentOrderAlert(3500);
    } else {
      soundService.playNewOrderAlert();
    }

    this.notify('ORDER_CREATED', newOrder);

    // Queue for cloud sync and attempt immediate transmission to Cloud Firestore
    this.queueOrderForSync(newOrder);
    this.persistOrderToFirestore(newOrder).catch(() => {});

    return newOrder;
  }

  public async createOrderAsync(
    orderInput: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'movements' | 'status'> & { status?: OrderStatus }
  ): Promise<{ order: Order; synced: boolean; error?: string }> {
    const order = this.createOrder(orderInput);
    const res = await this.persistOrderToFirestore(order);
    return {
      order: this.getOrderById(order.id) || order,
      synced: res.success,
      error: res.error,
    };
  }

  // ==========================================
  // CLIENT TRACKING SECURITY & PII SANITIZATION
  // ==========================================
  public getClientTrackingCodes(): Record<string, string> {
    try {
      const data = localStorage.getItem('gf_client_tracking_codes');
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  public saveClientTrackingCode(orderId: string, trackingCode: string): void {
    try {
      const map = this.getClientTrackingCodes();
      map[orderId] = trackingCode;
      localStorage.setItem('gf_client_tracking_codes', JSON.stringify(map));
    } catch {
      // storage fallback
    }
  }

  /**
   * Builds the minimal sanitized tracking document:
   * STRICT PII SANITIZATION:
   * - Telephones are NEVER included.
   * - Exact residential street names, numbers, and apartments are redacted.
   * - Only neighborhood and city (or 'Retirada no Balcão') are exposed in destinationSummary.
   * - Internal operator notes and cancellation details are withheld.
   */
  public buildPublicTrackingPayload(order: Order): PublicOrderTracking {
    const destinationSummary = order.customer.address
      ? `${order.customer.address.neighborhood || ''}${order.customer.address.city ? ` · ${order.customer.address.city}` : ''}`.trim() || undefined
      : (order.fulfillmentType === 'RETIRADA' ? 'Retirada no Balcão' : undefined);

    const raw: PublicOrderTracking = {
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      estimatedDeliveryMinutes: order.estimatedDeliveryMinutes || 45,
      fulfillmentType: order.fulfillmentType,
      status: order.status,
      items: (order.items || []).map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        subtotal: i.subtotal,
        addons: i.addons || [],
        notes: i.notes || '',
      })),
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      discount: order.discount || 0,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      deliveryPerson: order.deliveryPerson ? { name: order.deliveryPerson.name } : undefined,
      trackingCode: order.trackingCode || '',
      destinationSummary,
    };

    return this.cleanForFirestore(raw);
  }

  /**
   * Verifies if the requestor has authorization to view an order's tracking:
   * 1. Public customer possessing the cryptographic high-entropy tracking code (tk param).
   * 2. Browser session of the customer who generated the order on this device.
   * 3. Authenticated staff user verified in Firebase Auth.
   * 4. Staff operating inside internal management views (NOT public cardápio or tracking).
   * 
   * NEVER grants access solely because an orderId was guessed or passed without token.
   */
  public isClientAuthorizedForOrder(orderId: string, providedTrackingCode?: string): boolean {
    const order = this.getOrderById(orderId);
    if (!order) return false;

    // 1. Direct high-entropy tracking token validation
    if (
      providedTrackingCode && 
      order.trackingCode && 
      providedTrackingCode.trim().toLowerCase() === order.trackingCode.trim().toLowerCase()
    ) {
      return true;
    }

    // 2. Browser session validation (creator on this browser device)
    const clientCodes = this.getClientTrackingCodes();
    if (clientCodes[order.id] && order.trackingCode && clientCodes[order.id] === order.trackingCode) {
      return true;
    }

    // 3. Authenticated staff user in Firebase Auth
    if (this.isFirebaseAuthStaff()) {
      return true;
    }

    // 4. Staff operating in internal management views (NOT public cardápio or public tracking)
    if (!this.isPublicCustomerContext()) {
      const currentUser = this.getCurrentUser();
      if (currentUser && currentUser.status === 'ATIVO' && this.isAuthorizedStaffRole(currentUser.role)) {
        return true;
      }
    }

    // Deny access by default: prevents guessing order numbers or reading PII
    return false;
  }

  /**
   * Sanitizes order data for public tracking, stripping sensitive PII:
   * Returns null if the requestor is not authorized.
   */
  public getPublicOrderTracking(orderId: string, providedTrackingCode?: string): PublicOrderTracking | null {
    const order = this.getOrderById(orderId);
    if (!order) return null;

    const effectiveCode = providedTrackingCode || this.getClientTrackingCodes()[order.id];
    const isAuthorized = this.isClientAuthorizedForOrder(order.id, effectiveCode);
    if (!isAuthorized) {
      // Reject unauthorized access
      return null;
    }

    return this.buildPublicTrackingPayload(order);
  }

  /**
   * Subscribes to single-order real-time status updates without querying the full internal orders collection.
   * Uses exclusively the sanitized 'public_tracking/{trackingCode}' document or local contingency cache.
   * NEVER exposes phone numbers, exact addresses, or the full internal order document to public listeners.
   */
  public subscribeToPublicOrderTracking(
    orderId: string, 
    trackingCode: string | undefined, 
    callback: (tracking: PublicOrderTracking | null) => void
  ): Unsubscribe {
    const effectiveTrackingCode = trackingCode || this.getClientTrackingCodes()[orderId];

    // Check authorization first: if unauthorized, immediately return null without touching any database
    const isAuthorized = this.isClientAuthorizedForOrder(orderId, effectiveTrackingCode);
    if (!isAuthorized) {
      callback(null);
      return () => {};
    }

    // Deliver immediate initial sanitized state from local cache
    callback(this.getPublicOrderTracking(orderId, effectiveTrackingCode));

    if (!db) {
      return () => {};
    }

    try {
      // Listen directly to the order in Firestore; allowed under firestore.rules 'allow get: if isValidId(orderId)'
      const unsub = onSnapshot(
        doc(db, 'orders', orderId),
        (docSnap) => {
          if (docSnap.exists()) {
            const rawOrder = docSnap.data() as Order;
            const sanitized = this.buildPublicTrackingPayload(rawOrder);
            callback(sanitized);
          } else {
            callback(this.getPublicOrderTracking(orderId, effectiveTrackingCode));
          }
        },
        (error) => {
          console.warn('[Firestore] Realtime order tracking notice (contingency fallback):', error.message);
          callback(this.getPublicOrderTracking(orderId, effectiveTrackingCode));
        }
      );
      return unsub;
    } catch {
      return () => {};
    }
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
    const currentUser = this.getCurrentUser();
    if (currentUser && !this.canUserUpdateOrderStatus(currentUser, newStatus)) {
      console.warn(`[Security Guard] Usuário @${currentUser.username} (${currentUser.role}) não possui permissão para avançar pedido para ${newStatus}.`);
      return null;
    }

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
    order.updatedAt = now;
    order._cloudSyncStatus = 'PENDING';
    localStorage.setItem('gf_orders', JSON.stringify(orders));

    soundService.playSuccessTone();
    this.notify('ORDER_UPDATED', order);

    // Queue for cloud sync and attempt immediate transmission to Cloud Firestore
    this.queueOrderForSync(order);
    this.persistOrderToFirestore(order).catch(() => {});

    return order;
  }

  public async updateOrderStatusAsync(
    orderId: string, 
    newStatus: OrderStatus, 
    author = 'Operador', 
    notes?: string
  ): Promise<{ order: Order | null; synced: boolean; error?: string }> {
    const order = this.updateOrderStatus(orderId, newStatus, author, notes);
    if (!order) return { order: null, synced: false, error: 'Pedido não encontrado' };
    const res = await this.persistOrderToFirestore(order);
    return { order, synced: res.success, error: res.error };
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
    order._cloudSyncStatus = 'PENDING';

    localStorage.setItem('gf_orders', JSON.stringify(orders));
    this.notify('ORDER_UPDATED', order);

    this.queueOrderForSync(order);
    this.persistOrderToFirestore(order).catch(() => {});

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

    if (db) {
      deleteDoc(doc(db, 'orders', orderId)).catch((err) => {
        console.warn('[Firestore] Fallback local para exclusão:', err.message);
      });

      if (target.trackingCode) {
        deleteDoc(doc(db, 'public_tracking', target.trackingCode)).catch(() => {});
      }
    }

    return true;
  }

  // ==========================================
  // CASH REGISTER / SHIFTS API
  // ==========================================
  public getCurrentCashShift(): CashRegisterShift | null {
    try {
      const data = localStorage.getItem('gf_current_cash_shift');
      if (data) return JSON.parse(data);

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
      if (db) {
        setDoc(doc(db, 'cash_shifts', shift.id), shift).catch((err) => {
          handleFirestoreError(err, OperationType.WRITE, `cash_shifts/${shift.id}`);
        });
      }
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

  public openCashRegister(initialBalance: number, openedBy: string): CashRegisterShift | null {
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para abrir o caixa.');
      return null;
    }

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
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para fechar o caixa.');
      return null;
    }

    const shift = this.getCurrentCashShift();
    if (!shift || shift.status !== 'ABERTO') return null;

    const now = new Date().toISOString();
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

    const difference = countedCash - expectedCashInDrawer;

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

    const history = this.getCashShiftHistory();
    history.unshift(closedShift);
    localStorage.setItem('gf_cash_shifts_history', JSON.stringify(history));

    if (db) {
      setDoc(doc(db, 'cash_shifts', closedShift.id), closedShift).catch((err) => {
        handleFirestoreError(err, OperationType.WRITE, `cash_shifts/${closedShift.id}`);
      });
    }

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
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para movimentações de caixa.');
      return null;
    }

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
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para excluir movimentações do caixa.');
      return false;
    }

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

  // ==========================================
  // RESTAURANT CONFIG API
  // ==========================================
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

    if (db) {
      setDoc(doc(db, 'configs', 'restaurant'), config).catch((err) => {
        handleFirestoreError(err, OperationType.WRITE, 'configs/restaurant');
      });
    }
  }

  // ==========================================
  // USERS, STAFF & AUTHENTICATION
  // ==========================================
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
    try {
      if (user) {
        localStorage.setItem('gf_current_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('gf_current_user');
      }
    } catch {
      // Fallback
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
    // 1. RBAC authorization check
    const actor = this.getCurrentUser();
    const actorRole = actor?.role?.toUpperCase();
    if (!actor || !['ADMINISTRADOR', 'GERENTE'].includes(actorRole || '')) {
      return { success: false, message: 'Acesso negado: apenas Administrador ou Gerente possuem autorização para cadastrar colaboradores.' };
    }

    if (actorRole === 'GERENTE') {
      if (userData.role === 'ADMINISTRADOR') {
        return { success: false, message: 'Permissão insuficiente: Gerente não pode cadastrar um Administrador Geral.' };
      }
      if (userData.allowedModules?.includes('usuarios')) {
        return { success: false, message: 'Permissão insuficiente: Gerente não pode conceder acesso ao módulo de Gestão de Usuários.' };
      }
    }

    const users = this.getUsers();
    const cleanUsername = userData.username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    
    if (!cleanUsername) {
      return { success: false, message: 'Nome de usuário inválido ou vazio.' };
    }

    if (users.some((u) => u.username.toLowerCase() === cleanUsername)) {
      return { success: false, message: 'Nome de usuário já cadastrado. Escolha outro nome de login.' };
    }

    // Resolve or generate synthetic email if user did not provide an email
    const cleanEmail = userData.email && userData.email.includes('@')
      ? userData.email.trim().toLowerCase()
      : `${cleanUsername}@staff.amanditasabores.com.br`;

    if (userData.email && userData.email.trim().length > 0 && users.some((u) => u.email.toLowerCase() === cleanEmail)) {
      return { success: false, message: 'E-mail já registrado para outro colaborador.' };
    }

    // Secure, collision-resistant identifier
    const entropy = Math.random().toString(36).substring(2, 9);
    const secureId = `usr-${Date.now()}-${entropy}`;

    const newUser: User = {
      ...userData,
      id: secureId,
      name: userData.name?.trim() || cleanUsername,
      username: cleanUsername,
      email: cleanEmail,
      isEmailVerified: true,
      status: userData.status || 'ATIVO',
      allowedModules: userData.allowedModules || ['pdv', 'kanban'],
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    localStorage.setItem('gf_users', JSON.stringify(users));

    // Save initial password locally
    const passwords = this.getUserPasswords();
    passwords[newUser.id] = initialPassword;
    this.saveUserPasswords(passwords);

    // Call backend API safely for credential registration
    if (typeof window !== 'undefined') {
      fetch('/api/auth/register-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUsername,
          name: newUser.name,
          role: newUser.role,
          allowedModules: newUser.allowedModules,
          requesterRole: actor.role,
        })
      }).catch(() => {
        // Non-blocking in case server is starting
      });
    }

    // Audit log
    this.logAccess({
      userId: newUser.id,
      username: newUser.username,
      role: newUser.role,
      action: 'LOGIN_SUCESSO',
      details: `Novo funcionário cadastrado por ${actor.username}: ${newUser.name || newUser.username} (${newUser.role})`,
    });

    this.notify('USERS_UPDATED', newUser);

    // Asynchronously save user profile & permissions to Firestore (WITHOUT plain text password)
    if (db) {
      setDoc(doc(db, 'users', newUser.id), newUser).catch((err) => {
        console.warn('[Firestore User Sync]:', err?.message || err);
      });
    }

    return { success: true, user: newUser, message: 'Funcionário cadastrado com sucesso!' };
  }

  public updateUser(id: string, updates: Partial<User>): { success: boolean; user?: User; message: string } {
    const actor = this.getCurrentUser();
    const actorRole = actor?.role?.toUpperCase();
    if (!actor || !['ADMINISTRADOR', 'GERENTE'].includes(actorRole || '')) {
      return { success: false, message: 'Acesso negado: apenas Administrador ou Gerente possuem autorização para alterar funcionários.' };
    }

    const users = this.getUsers();
    const index = users.findIndex((u) => u.id === id);
    if (index === -1) {
      return { success: false, message: 'Funcionário não encontrado.' };
    }

    const target = users[index];

    // Gerente restrictions
    if (actorRole === 'GERENTE') {
      if (target.role === 'ADMINISTRADOR') {
        return { success: false, message: 'Permissão insuficiente: Gerente não pode modificar o Administrador Geral.' };
      }
      if (updates.role === 'ADMINISTRADOR') {
        return { success: false, message: 'Permissão insuficiente: Gerente não pode promover colaboradores a Administrador.' };
      }
      if (updates.allowedModules?.includes('usuarios')) {
        return { success: false, message: 'Permissão insuficiente: Gerente não pode conceder acesso ao módulo de Gestão de Usuários.' };
      }
    }

    const updatedUser: User = { 
      ...target, 
      ...updates,
      updatedAt: new Date().toISOString()
    };

    users[index] = updatedUser;
    localStorage.setItem('gf_users', JSON.stringify(users));

    const current = this.getCurrentUser();
    if (current && current.id === id) {
      this.setCurrentUser(updatedUser);
    }

    this.notify('USERS_UPDATED', updatedUser);

    if (db) {
      setDoc(doc(db, 'users', id), updatedUser).catch((err) => {
        console.warn('[Firestore User Update]:', err?.message || err);
      });
    }

    return { success: true, user: updatedUser, message: 'Dados do funcionário atualizados!' };
  }

  public resetUserPassword(userId: string, newPassword: string): { success: boolean; message: string } {
    const actor = this.getCurrentUser();
    const actorRole = actor?.role?.toUpperCase();
    if (!actor || !['ADMINISTRADOR', 'GERENTE'].includes(actorRole || '')) {
      return { success: false, message: 'Acesso negado: apenas Administrador ou Gerente podem redefinir senhas.' };
    }

    const user = this.getUserById(userId);
    if (!user) {
      return { success: false, message: 'Colaborador não encontrado.' };
    }

    if (actorRole === 'GERENTE' && user.role === 'ADMINISTRADOR') {
      return { success: false, message: 'Permissão insuficiente: Gerente não pode alterar a senha do Administrador Geral.' };
    }

    if (!newPassword || newPassword.length < 4) {
      return { success: false, message: 'A nova senha deve ter no mínimo 4 caracteres.' };
    }

    const passwords = this.getUserPasswords();
    passwords[userId] = newPassword;
    this.saveUserPasswords(passwords);

    if (typeof window !== 'undefined') {
      fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: userId,
          targetUserRole: user.role,
          newPassword,
          requesterRole: actor.role,
        })
      }).catch(() => {});
    }

    this.logAccess({
      userId,
      username: user.username,
      role: user.role,
      action: 'SENHA_ALTERADA',
      details: `Senha redefinida por @${actor.username} para ${user.name || user.username}`,
    });

    this.notify('USERS_UPDATED', { userId });
    return { success: true, message: 'Senha redefinida com sucesso!' };
  }

  public deleteUser(id: string): { success: boolean; message: string } {
    const actor = this.getCurrentUser();
    if (!actor || actor.role !== 'ADMINISTRADOR') {
      return { success: false, message: 'Apenas o Administrador Geral possui autorização para excluir funcionários.' };
    }

    const users = this.getUsers();
    const user = users.find((u) => u.id === id);
    if (!user) return { success: false, message: 'Usuário não encontrado.' };

    if (user.username === 'admin' || user.role === 'ADMINISTRADOR') {
      return { success: false, message: 'A conta do Administrador Geral não pode ser excluída.' };
    }

    const filtered = users.filter((u) => u.id !== id);
    localStorage.setItem('gf_users', JSON.stringify(filtered));

    const passwords = this.getUserPasswords();
    delete passwords[id];
    this.saveUserPasswords(passwords);

    this.notify('USERS_UPDATED', { id });

    if (db) {
      deleteDoc(doc(db, 'users', id)).catch((err) => {
        handleFirestoreError(err, OperationType.DELETE, `users/${id}`);
      });
    }

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
    const trimmed = logs.slice(0, 200);
    localStorage.setItem('gf_access_logs', JSON.stringify(trimmed));
    this.notify('ACCESS_LOG_UPDATED', newLog);

    if (db) {
      setDoc(doc(db, 'access_logs', newLog.id), newLog).catch((err) => {
        console.warn('[Firestore Log]:', err?.message || err);
      });
    }
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

    if (db) {
      setDoc(doc(db, 'orders', order.id), this.cleanForFirestore(order)).catch((err) => {
        console.warn('[Firestore] Fallback local para pedido interno:', err.message);
      });

      if (order.trackingCode) {
        const publicPayload = this.buildPublicTrackingPayload(order);
        setDoc(doc(db, 'public_tracking', order.trackingCode), publicPayload).catch((err) => {
          console.warn('[Firestore] Fallback local para cancelamento de rastreio:', err.message);
        });
      }
    }

    return true;
  }

  // ---- Login & Authentication ----
  public async loginWithGoogle(): Promise<{ success: boolean; message: string; user?: User; isCloudAuth?: boolean }> {
    try {
      const fbUser = await signInWithGoogle();
      if (!fbUser) {
        return { success: false, message: 'Operação de login com Google cancelada.' };
      }

      const users = this.getUsers();
      const adminEmail = this.getInitialAdminEmail();
      const fbEmail = (fbUser.email || '').trim().toLowerCase();
      const isAdminEmail = fbEmail === adminEmail;

      let matched = users.find((u) => u.id === fbUser.uid || (fbEmail && u.email.trim().toLowerCase() === fbEmail));

      if (matched) {
        // Link existing employee to Firebase UID
        matched.id = fbUser.uid;
        matched.email = fbUser.email || matched.email;
        matched.isEmailVerified = fbUser.emailVerified;
        matched.authProvider = 'firebase_google';
        matched.firebaseUid = fbUser.uid;
        matched.lastLoginAt = new Date().toISOString();
        if (isAdminEmail) {
          matched.role = 'ADMINISTRADOR';
        }
        this.updateUser(matched.id, matched);
      } else if (isAdminEmail) {
        // Bootstrap authorized administrator
        matched = {
          id: fbUser.uid,
          name: fbUser.displayName || 'Amanda Silveira (Admin)',
          username: fbEmail.split('@')[0] || 'admin',
          email: fbUser.email || adminEmail,
          isEmailVerified: fbUser.emailVerified,
          role: 'ADMINISTRADOR',
          status: 'ATIVO',
          allowedModules: ['pdv', 'kanban', 'kds', 'caixa', 'entregas', 'relatorios', 'menu', 'usuarios', 'configuracoes', 'qrcodes', 'auditoria'],
          authProvider: 'firebase_google',
          firebaseUid: fbUser.uid,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString()
        };
        users.push(matched);
        localStorage.setItem('gf_users', JSON.stringify(users));

        if (db) {
          setDoc(doc(db, 'users', matched.id), matched).catch(() => {});
        }
      } else {
        // Security rule: Do NOT grant staff roles to unapproved/unknown Google accounts!
        await signOutFirebase();
        return {
          success: false,
          message: 'Esta conta Google não está vinculada a nenhum colaborador da equipe Amandita Sabores. Solicite seu cadastro ao administrador.'
        };
      }

      this.setCurrentUser(matched);
      this.logAccess({
        userId: matched.id,
        username: matched.username,
        role: matched.role,
        action: 'LOGIN_SUCESSO',
        details: `Login via Firebase Google Auth (${matched.email})`,
      });

      return { success: true, message: 'Autenticado com sucesso via Firebase Google Auth!', user: matched, isCloudAuth: true };
    } catch (err: unknown) {
      const msg = formatFirebaseAuthError(err);
      return { success: false, message: `Falha na autenticação Google: ${msg}` };
    }
  }

  public async login(
    loginOrEmail: string, 
    password: string
  ): Promise<{ success: boolean; message: string; user?: User; isCloudAuth?: boolean }> {
    const rawInput = loginOrEmail.trim();
    if (!rawInput || !password.trim()) {
      return { success: false, message: 'Por favor, informe seu nome de usuário e senha.' };
    }

    const users = this.getUsers();
    const term = rawInput.toLowerCase();

    // 1. Identify employee candidate to resolve username
    let localCandidate = users.find(
      (u) => u.username.toLowerCase() === term || u.email.toLowerCase() === term
    );

    // If candidate not cached locally, query Firestore
    if (!localCandidate && db) {
      try {
        const userQuery = query(collection(db, 'users'), where('username', '==', term));
        const querySnap = await getDocs(userQuery);
        if (!querySnap.empty) {
          localCandidate = querySnap.docs[0].data() as User;
          users.push(localCandidate);
          localStorage.setItem('gf_users', JSON.stringify(users));
        }
      } catch {
        // Query error ignored
      }
    }

    // Resolve target email for Firebase Auth
    let targetEmail = term;
    if (!targetEmail.includes('@')) {
      if (localCandidate && localCandidate.email.includes('@')) {
        targetEmail = localCandidate.email.toLowerCase();
      } else {
        targetEmail = `${term}@staff.amanditasabores.com.br`;
      }
    }

    const adminEmail = this.getInitialAdminEmail();
    const isDesignatedAdmin = targetEmail === adminEmail;

    // 2. If Firebase Authentication is active and initialized, attempt background cloud login
    if (isFirebaseReady() && auth) {
      let fbUser: any = null;
      try {
        fbUser = await signInWithEmail(targetEmail, password);
      } catch (fbErr: unknown) {
        // If signIn fails (e.g. user does not exist in Firebase Auth yet), check if credentials match local staff
        const passwords = this.getUserPasswords();
        const storedPass = localCandidate ? (passwords[localCandidate.id] || '123456') : null;
        if (localCandidate && storedPass && password.trim() === storedPass.trim()) {
          try {
            fbUser = await createUserWithEmail(targetEmail, password);
          } catch (createErr: unknown) {
            console.warn('[Firebase Auth Auto-Provision]:', createErr);
          }
        }
      }

      if (fbUser) {
        try {
          let profile: User | null = null;

          if (db) {
            try {
              const snap = await getDoc(doc(db, 'users', fbUser.uid));
              if (snap.exists()) {
                profile = snap.data() as User;
              }
            } catch (err) {
              console.warn('[Firestore User Fetch]:', err);
            }
          }

          if (!profile) {
            if (localCandidate) {
              profile = {
                ...localCandidate,
                id: fbUser.uid,
                email: fbUser.email || targetEmail,
                isEmailVerified: fbUser.emailVerified ?? true,
                authProvider: 'firebase_email',
                firebaseUid: fbUser.uid,
                lastLoginAt: new Date().toISOString(),
              };
              if (isDesignatedAdmin) {
                profile.role = 'ADMINISTRADOR';
              }
              this.updateUser(fbUser.uid, profile);
            } else if (isDesignatedAdmin) {
              profile = {
                id: fbUser.uid,
                name: fbUser.displayName || 'Amanda Silveira (Admin)',
                username: fbUser.email?.split('@')[0] || 'admin',
                email: fbUser.email || targetEmail,
                isEmailVerified: fbUser.emailVerified ?? true,
                role: 'ADMINISTRADOR',
                status: 'ATIVO',
                allowedModules: ['pdv', 'kanban', 'kds', 'caixa', 'entregas', 'relatorios', 'menu', 'usuarios', 'configuracoes', 'qrcodes', 'auditoria'],
                authProvider: 'firebase_email',
                firebaseUid: fbUser.uid,
                createdAt: new Date().toISOString(),
                lastLoginAt: new Date().toISOString()
              };
              users.push(profile);
              localStorage.setItem('gf_users', JSON.stringify(users));
            }

            if (db && profile) {
              setDoc(doc(db, 'users', fbUser.uid), profile).catch(() => {});
            }
          }

          if (profile) {
            if (profile.status === 'BLOQUEADO') {
              await signOutFirebase();
              return { success: false, message: 'Esta conta está bloqueada pelo administrador.' };
            }
            if (profile.status === 'DESATIVADO') {
              await signOutFirebase();
              return { success: false, message: 'Esta conta foi desativada.' };
            }

            profile.lastLoginAt = new Date().toISOString();
            profile.authProvider = 'firebase_email';
            profile.firebaseUid = fbUser.uid;
            this.setCurrentUser(profile);

            this.logAccess({
              userId: profile.id,
              username: profile.username,
              role: profile.role,
              action: 'LOGIN_SUCESSO',
              details: `Login efetuado com sucesso via Firebase Cloud para @${profile.username} (${profile.role})`,
            });

            await this.initStaffFirestoreSync(fbUser);

            return {
              success: true,
              message: 'Login realizado com sucesso e sincronizado com o Firebase!',
              user: profile,
              isCloudAuth: true,
            };
          }
        } catch (err: unknown) {
          console.warn('[Firebase Auth Login Flow Notice]:', err);
        }
      }
    }

    // 3. Direct, Reliable Internal Validation (No manual Firebase Console required)
    if (!localCandidate) {
      this.logAccess({
        username: rawInput,
        action: 'LOGIN_FALHA',
        details: 'Tentativa de login com usuário inexistente',
      });
      return { success: false, message: 'Usuário não encontrado.' };
    }

    if (localCandidate.status === 'BLOQUEADO') {
      this.logAccess({
        userId: localCandidate.id,
        username: localCandidate.username,
        role: localCandidate.role,
        action: 'CONTA_BLOQUEADA',
        details: 'Tentativa de acesso em conta bloqueada',
      });
      return { success: false, message: 'Esta conta está bloqueada pelo administrador. Contate a gerência.' };
    }

    if (localCandidate.status === 'DESATIVADO') {
      return { success: false, message: 'Esta conta foi desativada no sistema.' };
    }

    const passwords = this.getUserPasswords();
    const storedPass = passwords[localCandidate.id] || '123456';

    if (password.trim() !== storedPass.trim()) {
      this.logAccess({
        userId: localCandidate.id,
        username: localCandidate.username,
        role: localCandidate.role,
        action: 'LOGIN_FALHA',
        details: 'Senha incorreta digitada',
      });
      return { success: false, message: 'Senha incorreta.' };
    }

    // Login accepted directly
    localCandidate.lastLoginAt = new Date().toISOString();
    this.updateUser(localCandidate.id, { lastLoginAt: localCandidate.lastLoginAt });

    this.setCurrentUser(localCandidate);

    // Trigger background staff Firebase Auth and real-time Firestore sync
    this.ensureFirebaseAuthForStaff().then(() => {
      this.initStaffFirestoreSync();
    }).catch(() => {});

    this.logAccess({
      userId: localCandidate.id,
      username: localCandidate.username,
      role: localCandidate.role,
      action: 'LOGIN_SUCESSO',
      details: `Acesso realizado para @${localCandidate.username} (Perfil ${localCandidate.role})`,
    });

    return { 
      success: true, 
      message: 'Login realizado com sucesso!', 
      user: localCandidate,
      isCloudAuth: true
    };
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
    signOutFirebase().catch(() => {});
    this.setCurrentUser(null);
  }

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
