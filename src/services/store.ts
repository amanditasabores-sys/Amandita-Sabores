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
  UserRole,
  Combo,
  ComboComponent,
  DailyMenuConfig,
  DeliveryPermissions,
  DeliveryShift,
  DeliveryShiftSummary,
  OrderRefundInfo,
  PublicStoreAvailability,
  StoreClosedSettings,
  DayOperatingHours
} from '../types';
import { formatCurrency, getFortalezaDateKey } from '../utils/formatters';
import { soundService } from './audio';
import { thermalPrinterService } from './thermalPrinter';
import { generatePurchasePixPayload, generateOrderPixTxId, validatePixKey, validatePixReceiver, validatePixPayload, inferPixKeyType, type PixKeyType } from '../utils/pix';
import {
  DEFAULT_CLOSED_PRIMARY_MESSAGE,
  DEFAULT_CLOSED_SECONDARY_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  normalizeClosedSettings,
  validateOperatingHours,
  validateWhatsAppNumber,
} from '../utils/storeHours';

const roundCurrency = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};
import { INITIAL_MENU, INITIAL_CONFIG, INITIAL_USERS, INITIAL_ORDERS, OFFICIAL_ADDONS, INITIAL_COMBOS, INITIAL_DAILY_MENU } from '../data/initialData';
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
  updateDoc,
  deleteDoc, 
  getDocs, 
  getDocsFromServer,
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

export function isOrderPrepStaffRole(role?: string | null): boolean {
  if (!role) return false;
  const normalized = role.toUpperCase();
  return ['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'COZINHA', 'ATENDENTE'].includes(normalized);
}

export type CashShiftSyncStatus = 'IDLE' | 'SYNCING' | 'CONFIRMED' | 'ERROR';

export interface CashShiftSyncState {
  status: CashShiftSyncStatus;
  confirmedAt: string | null;
  source: 'firestore_snapshot' | 'server_api' | 'local_contingency' | 'none';
  error: string | null;
}

export type OfficialPixConfigStatus = 'LOADING' | 'READY' | 'MISSING' | 'UNAVAILABLE';

export interface OfficialPixConfigState {
  status: OfficialPixConfigStatus;
  source: 'firestore' | 'local_contingency' | 'none';
  hasValidPixKey: boolean;
  error: string | null;
  message: string | null;
  lastSyncedAt: string | null;
}

class StoreService {
  private broadcastChannel: BroadcastChannel | null = null;
  private publicUnsubscribers: Unsubscribe[] = [];
  private staffUnsubscribers: Unsubscribe[] = [];
  private isPublicSyncActive = false;
  private isStaffSyncActive = false;
  private isFlushingPendingQueue = false;
  private inFlightOrderWrites = new Set<string>();
  private inFlightOrderDeletes = new Set<string>();
  private pendingOrderRewrites = new Set<string>();
  private orderWriteChains = new Map<string, Promise<any>>();
  private staffSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private publicSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPublicMenuRefreshAt = 0;
  private serverAtomicPaymentTestOverride = false;
  private requireExplicitCashConfirmationTestOverride = false;
  private cashShiftSyncPromise: Promise<boolean> | null = null;
  private cashShiftSyncState: CashShiftSyncState = {
    status: 'IDLE',
    confirmedAt: null,
    source: 'none',
    error: null,
  };
  private hasReceivedFirestoreConfig = false;
  private officialPixState: OfficialPixConfigState = {
    status: 'LOADING',
    source: 'none',
    hasValidPixKey: false,
    error: null,
    message: 'Carregando configuração oficial do PIX...',
    lastSyncedAt: null,
  };
  private lastPublicAvailability: PublicStoreAvailability | null = null;
  private uncertainServerOps = new Map<string, number>();
  private lastUncertainOpenShiftId: string | null = null;
  private cloudSyncState: {
    status: 'IDLE' | 'SYNCING' | 'CONNECTED' | 'ERROR';
    lastSyncedAt: string | null;
    lastError: string | null;
  } = {
    status: 'IDLE',
    lastSyncedAt: null,
    lastError: null,
  };

  private evaluatePixConfigValidity(cfg: Partial<RestaurantConfig>): {
    valid: boolean;
    keyType?: PixKeyType;
    normalizedKey?: string;
    error?: string;
  } {
    const rawKey = (cfg.pixKey || '').trim();
    if (!rawKey) {
      return { valid: false, error: 'Chave PIX oficial não configurada nas Configurações da loja.' };
    }
    const resolvedType = cfg.pixKeyType || inferPixKeyType(rawKey);
    if (!resolvedType) {
      return { valid: false, error: 'Tipo de chave PIX inválido ou não identificado.' };
    }
    const keyCheck = validatePixKey(rawKey, resolvedType);
    if (!keyCheck.valid) {
      return { valid: false, keyType: resolvedType, error: keyCheck.error || 'Chave PIX configurada é inválida.' };
    }
    const receiverCheck = validatePixReceiver(cfg.pixReceiverName, cfg.pixReceiverCity);
    if (!receiverCheck.valid) {
      return { valid: false, keyType: resolvedType, error: receiverCheck.error || 'Nome ou cidade do recebedor PIX inválidos.' };
    }
    return { valid: true, keyType: resolvedType, normalizedKey: keyCheck.normalized };
  }

  private syncOfficialPixStateFromFirestore(cfg: Partial<RestaurantConfig>, docExists: boolean): void {
    this.hasReceivedFirestoreConfig = true;
    const now = new Date().toISOString();
    if (!docExists) {
      this.officialPixState = {
        status: 'MISSING',
        source: 'firestore',
        hasValidPixKey: false,
        error: 'Documento configs/restaurant não encontrado no Firestore.',
        message: 'Configuração oficial do PIX não encontrada no Firestore. Cadastre a chave em Configurações ou selecione outra forma de pagamento.',
        lastSyncedAt: now,
      };
      return;
    }

    const check = this.evaluatePixConfigValidity(cfg);
    if (check.valid) {
      this.officialPixState = {
        status: 'READY',
        source: 'firestore',
        hasValidPixKey: true,
        error: null,
        message: null,
        lastSyncedAt: now,
      };
    } else {
      this.officialPixState = {
        status: 'MISSING',
        source: 'firestore',
        hasValidPixKey: false,
        error: check.error || 'Configuração oficial do PIX incompleta.',
        message: check.error || 'Configuração oficial do PIX indisponível no momento. Escolha outra forma de pagamento.',
        lastSyncedAt: now,
      };
    }
  }

  public getCloudSyncState() {
    return { ...this.cloudSyncState };
  }

  private isCloudCashConfirmationRequired(): boolean {
    return isFirebaseReady() || Boolean(db) || this.requireExplicitCashConfirmationTestOverride;
  }

  public getCashShiftSyncState(): CashShiftSyncState {
    if (!this.shouldUseServerAtomicPayment()) {
      return {
        status: 'CONFIRMED',
        confirmedAt: null,
        source: 'local_contingency',
        error: null,
      };
    }
    if (!this.isCloudCashConfirmationRequired()) {
      try {
        const raw = localStorage.getItem('gf_current_cash_shift');
        if (raw) {
          return {
            status: 'CONFIRMED',
            confirmedAt: null,
            source: 'server_api',
            error: null,
          };
        }
      } catch {
        // ignore
      }
    }
    return { ...this.cashShiftSyncState };
  }

  public isCashShiftConfirmed(): boolean {
    return this.getCashShiftSyncState().status === 'CONFIRMED';
  }

  public getAuthSessionMode(): 'firebase_cloud' | 'local_contingency' | 'unauthenticated' {
    const current = this.getCurrentUser();
    if (!current) return 'unauthenticated';
    if (isFirebaseReady()) {
      return auth?.currentUser ? 'firebase_cloud' : 'unauthenticated';
    }
    return 'local_contingency';
  }

  private async waitForFirebaseAuthReady(): Promise<void> {
    if (isFirebaseReady() && auth && !auth.currentUser && typeof (auth as any).authStateReady === 'function') {
      try {
        await (auth as any).authStateReady();
      } catch {
        // ignore
      }
    }
  }

  private isOfflineErrorMessage(msg?: string): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const lower = (msg || '').toLowerCase();
    return (
      lower.includes('failed to fetch') ||
      lower.includes('networkerror') ||
      lower.includes('network request failed') ||
      lower.includes('unavailable') ||
      lower.includes('offline') ||
      lower.includes('timeout')
    );
  }

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

  // ==========================================
  // COMBOS API (LOCAL CACHE + FIRESTORE INTEGRATION)
  // ==========================================
  public getCombos(): Combo[] {
    try {
      const data = localStorage.getItem('gf_combos');
      let combosList: Combo[] = [];
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            combosList = parsed;
          }
        } catch {}
      }

      if (combosList.length === 0) {
        combosList = [...INITIAL_COMBOS];
      }

      // Check current availability of component items
      const catalogItems = this.getMenuItems();
      const catalogMap = new Map(catalogItems.map((i) => [i.id, i]));

      return combosList.map((combo) => {
        // Validate if all component items are available
        const allComponentsAvailable = combo.items.every((comp) => {
          const found = catalogMap.get(comp.menuItemId);
          return found && found.available !== false;
        });

        // Calculate current reference sum of components
        const currentSum = combo.items.reduce((acc, comp) => {
          const found = catalogMap.get(comp.menuItemId);
          const unit = found ? found.price : comp.originalPrice;
          return acc + (unit * comp.quantity);
        }, 0);

        return {
          ...combo,
          originalPrice: currentSum > 0 ? currentSum : combo.originalPrice,
          available: combo.active !== false && allComponentsAvailable,
        };
      });
    } catch {
      return INITIAL_COMBOS;
    }
  }

  public saveCombo(combo: Combo): void {
    if (!this.canUserManageMenu()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para gerenciar combos.');
      return;
    }

    const combos = this.getCombos();
    const index = combos.findIndex((c) => c.id === combo.id);
    if (index >= 0) {
      combos[index] = { ...combo, updatedAt: new Date().toISOString() };
    } else {
      combos.push({ ...combo, createdAt: new Date().toISOString() });
    }
    localStorage.setItem('gf_combos', JSON.stringify(combos));
    this.notify('COMBOS_UPDATED', combo);

    // Also register combo in the menu items store so it is synced and visible
    const menuItemRepresentation: MenuItem = {
      id: combo.id,
      name: combo.name,
      description: combo.description,
      category: 'Combos',
      price: combo.comboPrice,
      prepTimeMinutes: 20,
      imageUrl: combo.imageUrl || 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=700&q=80',
      available: combo.available && combo.active !== false,
      featured: combo.featured,
      tags: combo.tags || ['Combo', 'Especial'],
      addons: [],
    };
    this.saveMenuItem(menuItemRepresentation);
  }

  public deleteCombo(id: string): void {
    if (!this.canUserManageMenu()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para excluir combos.');
      return;
    }

    const combos = this.getCombos().filter((c) => c.id !== id);
    localStorage.setItem('gf_combos', JSON.stringify(combos));
    this.deleteMenuItem(id);
    this.notify('COMBOS_UPDATED', { id });
  }

  public duplicateCombo(id: string): Combo | null {
    if (!this.canUserManageMenu()) return null;
    const combos = this.getCombos();
    const source = combos.find((c) => c.id === id);
    if (!source) return null;

    const newCombo: Combo = {
      ...source,
      id: `combo-${Date.now()}`,
      name: `${source.name} (Cópia)`,
      createdAt: new Date().toISOString(),
      updatedAt: undefined,
    };
    this.saveCombo(newCombo);
    return newCombo;
  }

  public toggleComboActive(id: string): void {
    if (!this.canUserManageMenu()) return;
    const combos = this.getCombos();
    const target = combos.find((c) => c.id === id);
    if (target) {
      target.active = !target.active;
      this.saveCombo(target);
    }
  }

  // ==========================================
  // CARDÁPIO DO DIA API (SELEÇÃO DIÁRIA DE PRODUTOS)
  // ==========================================
  public getDailyMenuConfig(): DailyMenuConfig {
    try {
      const data = localStorage.getItem('gf_daily_menu');
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed.enabled === 'boolean') {
          return parsed;
        }
      }
      return INITIAL_DAILY_MENU;
    } catch {
      return INITIAL_DAILY_MENU;
    }
  }

  private isSyncingDailyMenu = false;
  private lastDailyMenuServerSyncTime = 0;

  public saveDailyMenuConfig(config: DailyMenuConfig): void {
    if (!this.canUserManageMenu()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para gerenciar o cardápio do dia.');
      return;
    }
    localStorage.setItem('gf_daily_menu', JSON.stringify(config));
    this.notify('DAILY_MENU_UPDATED', config);

    // 1. Cross-Device Server Persistence: Broadcast to /api/daily-menu so desktop browsers immediately see updates
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      fetch('/api/daily-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }).catch((err) => {
        console.warn('[Daily Menu API Sync] Notice:', err);
      });
    }

    // 2. Cloud Firestore Persistence (for authenticated staff / admin)
    if (db) {
      setDoc(doc(db, 'configs', 'daily_menu'), this.cleanForFirestore(config), { merge: true }).catch((err) => {
        console.warn('[Firestore Daily Menu] Set notice:', err);
      });
    }
  }

  /**
   * Synchronizes the Daily Menu across all devices (mobile phones, desktop computers, customer views).
   * Fetches latest state from /api/daily-menu. If the current device already had an active menu published locally
   * but the server didn't have it yet, self-heals by uploading it.
   */
  public async syncDailyMenuWithServer(force = false): Promise<DailyMenuConfig | null> {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
    const now = Date.now();
    if (!force && this.isSyncingDailyMenu) return null;
    if (!force && now - this.lastDailyMenuServerSyncTime < 3000) return null;

    this.isSyncingDailyMenu = true;
    try {
      const res = await fetch('/api/daily-menu', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const json = await res.json();
        const serverConfig = json?.dailyMenu as DailyMenuConfig | undefined;
        const localConfig = this.getDailyMenuConfig();

        if (serverConfig && serverConfig.enabled) {
          const changed =
            !localConfig.enabled ||
            localConfig.publishedAt !== serverConfig.publishedAt ||
            (localConfig.selectedItemIds?.length !== serverConfig.selectedItemIds?.length) ||
            (localConfig.selectedComboIds?.length !== serverConfig.selectedComboIds?.length);

          if (changed) {
            localStorage.setItem('gf_daily_menu', JSON.stringify(serverConfig));
            this.notify('DAILY_MENU_UPDATED', serverConfig);
          }
          this.lastDailyMenuServerSyncTime = Date.now();
          return serverConfig;
        } else if (localConfig && localConfig.enabled && (!serverConfig || !serverConfig.enabled)) {
          // Self-heal: the active device (e.g. mobile admin) had published the menu locally.
          // Push it to the server and database so all desktop browsers immediately receive it!
          await fetch('/api/daily-menu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localConfig),
          }).catch(() => {});
          this.lastDailyMenuServerSyncTime = Date.now();
          return localConfig;
        }
      }
    } catch (err) {
      // Non-blocking fallback for offline environments
    } finally {
      this.isSyncingDailyMenu = false;
    }
    return null;
  }

  public publishDailyMenu(selectedItemIds: string[], selectedComboIds: string[]): void {
    if (!this.canUserManageMenu()) return;
    const today = new Date().toISOString().split('T')[0];
    const newConfig: DailyMenuConfig = {
      enabled: true,
      publishedAt: new Date().toISOString(),
      referenceDate: today,
      selectedItemIds: Array.from(new Set(selectedItemIds)),
      selectedComboIds: Array.from(new Set(selectedComboIds)),
      draftItemIds: selectedItemIds,
      draftComboIds: selectedComboIds,
    };
    this.saveDailyMenuConfig(newConfig);
  }

  public unpublishDailyMenu(): void {
    if (!this.canUserManageMenu()) return;
    const current = this.getDailyMenuConfig();
    const newConfig: DailyMenuConfig = {
      ...current,
      enabled: false,
    };
    this.saveDailyMenuConfig(newConfig);
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

  // ==========================================
  // DELETED ORDERS TOMBSTONE REGISTRY
  // Prevents deleted orders from resurrecting on snapshot reconciliation or refresh
  // ==========================================
  public getDeletedOrderIds(): Set<string> {
    try {
      const data = localStorage.getItem('gf_deleted_order_ids');
      if (data) {
        const list = JSON.parse(data);
        if (Array.isArray(list)) return new Set(list);
      }
    } catch {}
    return new Set();
  }

  public recordDeletedOrderId(orderId: string): void {
    try {
      const set = this.getDeletedOrderIds();
      set.add(orderId);
      const list = Array.from(set).slice(-500); // Retain last 500 tombstones
      localStorage.setItem('gf_deleted_order_ids', JSON.stringify(list));
    } catch {}
  }

  public isOrderDeleted(orderId: string): boolean {
    return this.getDeletedOrderIds().has(orderId);
  }

  public removeDeletedOrderId(orderId: string): void {
    try {
      const set = this.getDeletedOrderIds();
      if (set.has(orderId)) {
        set.delete(orderId);
        localStorage.setItem('gf_deleted_order_ids', JSON.stringify(Array.from(set)));
      }
    } catch {}
  }

  public getSyncedOrderIds(): Set<string> {
    try {
      const data = localStorage.getItem('gf_synced_order_ids');
      if (data) {
        const list = JSON.parse(data);
        if (Array.isArray(list)) return new Set(list);
      }
    } catch {}
    return new Set();
  }

  public recordSyncedOrderId(orderId: string): void {
    try {
      const set = this.getSyncedOrderIds();
      set.add(orderId);
      const list = Array.from(set).slice(-800);
      localStorage.setItem('gf_synced_order_ids', JSON.stringify(list));
    } catch {}
  }

  public recordSyncedOrderIds(orderIds: string[]): void {
    try {
      if (orderIds.length === 0) return;
      const set = this.getSyncedOrderIds();
      orderIds.forEach((id) => set.add(id));
      const list = Array.from(set).slice(-800);
      localStorage.setItem('gf_synced_order_ids', JSON.stringify(list));
    } catch {}
  }

  public removeSyncedOrderId(orderId: string): void {
    try {
      const set = this.getSyncedOrderIds();
      if (set.has(orderId)) {
        set.delete(orderId);
        localStorage.setItem('gf_synced_order_ids', JSON.stringify(Array.from(set)));
      }
    } catch {}
  }

  private applyRemoteTombstonesLocally(remoteDeletedIds: string[]): number {
    if (!remoteDeletedIds || remoteDeletedIds.length === 0) return 0;
    const set = this.getDeletedOrderIds();
    let changedTombstones = false;
    for (const id of remoteDeletedIds) {
      if (id && !set.has(id)) {
        set.add(id);
        changedTombstones = true;
      }
    }
    if (changedTombstones) {
      try {
        localStorage.setItem('gf_deleted_order_ids', JSON.stringify(Array.from(set).slice(-500)));
      } catch {}
    }

    const orders = this.getOrders();
    const filteredOrders = orders.filter((o) => !set.has(o.id));
    const removedCount = orders.length - filteredOrders.length;
    if (removedCount > 0) {
      try {
        localStorage.setItem('gf_orders', JSON.stringify(filteredOrders));
      } catch {}
    }

    const pending = this.getPendingSyncOrders();
    const filteredPending = pending.filter((o) => !set.has(o.id));
    if (filteredPending.length !== pending.length) {
      this.savePendingSyncOrders(filteredPending);
    }

    if (removedCount > 0) {
      this.notify('ORDERS_UPDATED', { reason: 'REMOTE_TOMBSTONE_APPLIED', removedCount });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_DELETED' } }));
      }
    }
    return removedCount;
  }

  public async syncTombstonesFromServer(): Promise<string[]> {
    if (typeof window === 'undefined' || !auth?.currentUser) return [];
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (!idToken) return [];
      const res = await fetch('/api/orders/tombstones', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.deletedOrderIds)) {
        this.applyRemoteTombstonesLocally(data.deletedOrderIds);
        return data.deletedOrderIds;
      }
    } catch {}
    return [];
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
   * Persists an order directly to Cloud Firestore with per-order promise serialization,
   * deletion-resurrection guard, and backend status/order fallback.
   */
  public persistOrderToFirestore(
    order: Order,
    options?: { isStatusTransition?: boolean; requireServerConfirmation?: boolean; publicMenuOrder?: boolean; timeoutMs?: number }
  ): Promise<{ success: boolean; error?: string; rejected?: boolean; isStoreClosed?: boolean; offline?: boolean; uncertain?: boolean; recoveredFromTimeout?: boolean; serverOrder?: Order }> {
    const prevChain = this.orderWriteChains.get(order.id) || Promise.resolve();
    const run = prevChain
      .catch(() => {})
      .then(() => this.persistOrderToFirestoreInternal(order, options));
    this.orderWriteChains.set(order.id, run);
    run.finally(() => {
      if (this.orderWriteChains.get(order.id) === run) {
        this.orderWriteChains.delete(order.id);
      }
    });
    return run;
  }

  private async getFirebaseAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    await this.waitForFirebaseAuthReady();
    if (auth?.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken(forceRefresh);
        if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
      } catch {
        // fallback
      }
    }
    return headers;
  }

  private async readServerJsonResponse(res: Response): Promise<{
    status: number;
    ok: boolean;
    contentType: string;
    rawText: string;
    isHtml: boolean;
    isValidJson: boolean;
    data: Record<string, any> | null;
  }> {
    const status = typeof res?.status === 'number' ? res.status : 0;
    const ok = Boolean(res?.ok);
    const rawContentType =
      res?.headers && typeof res.headers.get === 'function'
        ? String(res.headers.get('content-type') || '').trim()
        : '';
    const contentTypeLower = rawContentType.toLowerCase();

    let rawText = '';
    let data: Record<string, any> | null = null;
    let isValidJson = false;
    let isHtml =
      contentTypeLower.includes('text/html') ||
      contentTypeLower.includes('application/xhtml+xml');

    if (typeof res?.text === 'function') {
      try {
        rawText = await res.text();
      } catch {
        rawText = '';
      }
      const trimmed = rawText.trim();
      if (!isHtml && trimmed) {
        const lowerHead = trimmed.slice(0, 300).toLowerCase();
        if (
          lowerHead.startsWith('<!doctype') ||
          lowerHead.startsWith('<html') ||
          /<(html|head|body|title)\b/i.test(lowerHead)
        ) {
          isHtml = true;
        }
      }

      const expectsNonJsonType =
        Boolean(contentTypeLower) &&
        !contentTypeLower.includes('application/json') &&
        !contentTypeLower.includes('+json') &&
        !contentTypeLower.includes('text/plain');

      if (!isHtml && !expectsNonJsonType && trimmed) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = parsed as Record<string, any>;
            isValidJson = true;
          }
        } catch {
          isValidJson = false;
        }
      }
    } else if (typeof (res as any)?.json === 'function') {
      if (!isHtml) {
        try {
          const parsed = await (res as any).json();
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            data = parsed as Record<string, any>;
            isValidJson = true;
          }
        } catch {
          isValidJson = false;
        }
      }
    }

    return {
      status,
      ok,
      contentType: rawContentType,
      rawText,
      isHtml,
      isValidJson,
      data,
    };
  }

  private async checkServerAdminSdkHealth(): Promise<{
    reachable: boolean;
    hasAdminSdk: boolean | null;
  }> {
    if (typeof fetch !== 'function') {
      return { reachable: false, hasAdminSdk: null };
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
    try {
      const healthRes = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(healthRes);
      if (parsed.ok && !parsed.isHtml && parsed.isValidJson && parsed.data) {
        return {
          reachable: true,
          hasAdminSdk:
            typeof parsed.data.hasAdminSdk === 'boolean' ? parsed.data.hasAdminSdk : null,
        };
      }
      return { reachable: parsed.status > 0, hasAdminSdk: null };
    } catch {
      return { reachable: false, hasAdminSdk: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async consultCashShiftState(
    shiftId: string,
    authHeaders: Record<string, string>
  ): Promise<{
    verified: boolean;
    exists: boolean;
    shift: CashRegisterShift | null;
    isHtml: boolean;
    status: number;
  }> {
    if (typeof fetch !== 'function') {
      return { verified: false, exists: false, shift: null, isHtml: false, status: 0 };
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
    try {
      const stateRes = await fetch(`/api/cash-shifts/${encodeURIComponent(shiftId)}/state`, {
        method: 'GET',
        headers: authHeaders,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(stateRes);
      if (parsed.ok && !parsed.isHtml && parsed.isValidJson && parsed.data?.success === true) {
        return {
          verified: true,
          exists: Boolean(parsed.data.exists),
          shift: (parsed.data.shift as CashRegisterShift) || null,
          isHtml: false,
          status: parsed.status,
        };
      }
      return {
        verified: false,
        exists: false,
        shift: null,
        isHtml: parsed.isHtml,
        status: parsed.status,
      };
    } catch {
      return { verified: false, exists: false, shift: null, isHtml: false, status: 0 };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async consultOrderPaymentState(
    orderId: string,
    authHeaders: Record<string, string>
  ): Promise<{ verified: boolean; data: Record<string, any> | null; isHtml: boolean; status: number }> {
    if (typeof fetch !== 'function') {
      return { verified: false, data: null, isHtml: false, status: 0 };
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
    try {
      const stateRes = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment-state`, {
        method: 'GET',
        headers: authHeaders,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(stateRes);
      if (parsed.ok && !parsed.isHtml && parsed.isValidJson && parsed.data?.success === true) {
        return { verified: true, data: parsed.data, isHtml: false, status: parsed.status };
      }
      return { verified: false, data: null, isHtml: parsed.isHtml, status: parsed.status };
    } catch {
      return { verified: false, data: null, isHtml: false, status: 0 };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async consultOrderCancelState(
    orderId: string,
    authHeaders: Record<string, string>
  ): Promise<{ verified: boolean; data: Record<string, any> | null; isHtml: boolean; status: number }> {
    if (typeof fetch !== 'function') {
      return { verified: false, data: null, isHtml: false, status: 0 };
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 4000) : null;
    try {
      const stateRes = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel-state`, {
        method: 'GET',
        headers: authHeaders,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(stateRes);
      if (parsed.ok && !parsed.isHtml && parsed.isValidJson && parsed.data?.success === true) {
        return { verified: true, data: parsed.data, isHtml: false, status: parsed.status };
      }
      return { verified: false, data: null, isHtml: parsed.isHtml, status: parsed.status };
    } catch {
      return { verified: false, data: null, isHtml: false, status: 0 };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private formatHttpErrorWithStatus(message: string, status: number): string {
    const clean = message.trim();
    if (!status || clean.includes(`HTTP ${status}`) || clean.includes(`(${status})`)) {
      return clean;
    }
    return `${clean} (HTTP ${status})`;
  }

  private isTimeoutFetchError(err: unknown): boolean {
    if (!err) return false;
    const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as any).name) : '';
    const msg = err instanceof Error ? err.message : String(err);
    return name === 'AbortError' || /aborted|abort|timeout|timed out|tempo esgotado/i.test(msg);
  }

  private clearUncertainOpPrefix(prefix: string): void {
    for (const key of Array.from(this.uncertainServerOps.keys())) {
      if (key.startsWith(prefix)) {
        this.uncertainServerOps.delete(key);
      }
    }
  }

  private async resolveFinancialHttpFailure(
    parsed: {
      status: number;
      ok: boolean;
      isHtml: boolean;
      isValidJson: boolean;
      data: Record<string, any> | null;
    },
    actionLabel: string
  ): Promise<
    | { kind: 'rejected'; error: string }
    | { kind: 'needs_state_check'; nonCommittedError: string; uncertainError: string }
  > {
    const statusLabel = parsed.status ? `HTTP ${parsed.status}` : 'sem status HTTP';
    const serverMsg = typeof parsed.data?.message === 'string' ? parsed.data.message.trim() : '';
    const errorCode = typeof parsed.data?.code === 'string' ? parsed.data.code.trim() : '';

    // 1. Gateway errors (502/504) even with JSON might have happened after commit -> check state
    const isGatewayError = parsed.status === 502 || parsed.status === 504;

    // 2. Explicit valid JSON rejection (4xx, 503 ADMIN_SDK_UNAVAILABLE, 500, or HTTP 200 with success: false)
    if (
      !isGatewayError &&
      !parsed.isHtml &&
      parsed.isValidJson &&
      parsed.data &&
      (!parsed.ok || parsed.data.success === false)
    ) {
      if (parsed.status === 503 || errorCode === 'ADMIN_SDK_UNAVAILABLE') {
        const base =
          serverMsg ||
          `Operação bloqueada para ${actionLabel}: Firebase Admin SDK não configurado/indisponível no servidor.`;
        return {
          kind: 'rejected',
          error: this.formatHttpErrorWithStatus(base, parsed.status || 503),
        };
      }

      if (parsed.status === 409 || errorCode === 'SHIFT_ALREADY_CLOSED') {
        const base = serverMsg || `Operação recusada por conflito de estado ao ${actionLabel}.`;
        return {
          kind: 'rejected',
          error: this.formatHttpErrorWithStatus(base, parsed.status || 409),
        };
      }

      if (serverMsg) {
        return {
          kind: 'rejected',
          error: this.formatHttpErrorWithStatus(serverMsg, parsed.status),
        };
      }

      return {
        kind: 'rejected',
        error:
          parsed.status === 200
            ? `Servidor recusou ${actionLabel} sem detalhar o motivo (${statusLabel}).`
            : `Servidor recusou ${actionLabel} (${statusLabel}).`,
      };
    }

    // 3. Unexpected response: HTML (including proxy converting 503->200), invalid/empty JSON, or 2xx JSON missing required fields
    const health = await this.checkServerAdminSdkHealth();
    if (health.reachable && health.hasAdminSdk === false) {
      const reasonDetail = parsed.isHtml
        ? 'o servidor/proxy retornou uma página HTML inesperada'
        : !parsed.isValidJson
        ? 'a resposta do servidor não é um JSON válido'
        : 'os dados obrigatórios da operação não foram retornados';
      return {
        kind: 'rejected',
        error: `Não foi possível confirmar ${actionLabel} (${statusLabel}): Firebase Admin SDK indisponível no servidor (hasAdminSdk: false) e ${reasonDetail}. Nenhuma alteração foi gravada.`,
      };
    }

    const detail = parsed.isHtml
      ? `resposta HTML inesperada em vez de JSON (${statusLabel})`
      : !parsed.isValidJson
      ? `resposta JSON inválida ou vazia (${statusLabel})`
      : `resposta JSON incompleta sem os campos obrigatórios (${statusLabel})`;

    return {
      kind: 'needs_state_check',
      nonCommittedError: `Não foi possível confirmar ${actionLabel}: ${detail}. Consulta ao servidor confirmou que a operação não foi concluída.`,
      uncertainError: `Não foi possível confirmar ${actionLabel}: ${detail} e não foi possível verificar o estado atual no servidor. Não repita automaticamente antes de conferir o estado.`,
    };
  }

  private async persistOrderStatusViaBackend(
    order: Order,
    authHeaders: Record<string, string>
  ): Promise<{ success: boolean; error?: string; rejected?: boolean; offline?: boolean; deleted?: boolean }> {
    if (typeof window === 'undefined') {
      return { success: false, offline: true, error: 'Ambiente sem janela para chamada HTTP.' };
    }
    try {
      const cleanOrder = this.cleanForFirestore(order);
      const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          status: order.status,
          updatedAt: order.updatedAt,
          movements: cleanOrder.movements,
          deliveryPerson: cleanOrder.deliveryPerson,
          deliveryPersonId: cleanOrder.deliveryPersonId,
          deliveryPersonName: cleanOrder.deliveryPersonName,
          deliveryAssignmentHistory: cleanOrder.deliveryAssignmentHistory,
          paymentStatus: cleanOrder.paymentStatus,
          cancellationReason: cleanOrder.cancellationReason,
          cancelledBy: cleanOrder.cancelledBy,
          cancelledAt: cleanOrder.cancelledAt,
          refundInfo: cleanOrder.refundInfo,
          order: cleanOrder,
        }),
      });
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data || {};
      if (parsed.status === 410 || data?.deleted) {
        this.applyRemoteTombstonesLocally([order.id]);
        this.removeSyncedOrderId(order.id);
        return { success: false, rejected: true, deleted: true, error: data.message || 'Pedido excluído definitivamente em outro dispositivo.' };
      }
      if (parsed.ok && !parsed.isHtml && parsed.isValidJson && data.success === true) {
        this.removeOrderFromSyncQueue(order.id);
        this.recordSyncedOrderId(order.id);
        this.updateLocalOrderSyncStatus(order.id, 'SYNCED');
        this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
        this.notify('ORDER_SYNC_CONFIRMED', { orderId: order.id });
        return { success: true };
      }
      const isRejected = parsed.status === 400 || parsed.status === 401 || parsed.status === 403 || parsed.status === 404 || parsed.status === 409;
      return {
        success: false,
        rejected: isRejected,
        error:
          data.message ||
          (parsed.isHtml
            ? `Resposta HTML inesperada ao sincronizar status (HTTP ${parsed.status}).`
            : `Erro HTTP ${parsed.status} ao sincronizar status.`),
      };
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return {
        success: false,
        offline: this.isOfflineErrorMessage(msg),
        error: msg,
      };
    }
  }

  private async verifyPublicOrderConfirmationOnServer(order: Order): Promise<boolean> {
    if (!order.trackingCode || order.trackingCode.length < 20) return false;
    // 1. Check backend confirmation endpoint if fetch is available
    if (typeof fetch === 'function') {
      try {
        const res = await fetch(
          `/api/orders/${encodeURIComponent(order.id)}/public-confirmation?trackingCode=${encodeURIComponent(order.trackingCode)}`,
          { method: 'GET' }
        );
        const parsed = await this.readServerJsonResponse(res);
        if (parsed.ok && !parsed.isHtml && parsed.isValidJson && parsed.data) {
          const data = parsed.data;
          if (
            data?.confirmed === true &&
            data?.orderId === order.id &&
            Math.abs(roundCurrency(Number(data?.totalAmount) || 0) - roundCurrency(order.totalAmount)) <= 0.01
          ) {
            return true;
          }
        }
      } catch {
        // Fallback to direct Firestore public_tracking read below if SDK active
      }
    }
    // 2. Check Firestore public_tracking document directly via Client SDK
    if (db) {
      try {
        const snap = await getDoc(doc(db, 'public_tracking', order.trackingCode));
        if (snap.exists()) {
          const data = snap.data() as Record<string, any>;
          if (
            data?.id === order.id &&
            Math.abs(roundCurrency(Number(data?.totalAmount) || 0) - roundCurrency(order.totalAmount)) <= 0.01
          ) {
            return true;
          }
        }
      } catch {}
    }
    return false;
  }

  private async persistOrderToFirestoreInternal(
    order: Order,
    options?: { isStatusTransition?: boolean; requireServerConfirmation?: boolean; publicMenuOrder?: boolean; timeoutMs?: number }
  ): Promise<{ success: boolean; error?: string; rejected?: boolean; isStoreClosed?: boolean; offline?: boolean; uncertain?: boolean; recoveredFromTimeout?: boolean; serverOrder?: Order }> {
    const requireServerConfirmation = Boolean(options?.requireServerConfirmation);
    const isPublicMenuOrder = Boolean(options?.publicMenuOrder || this.isPublicCustomerContext());

    if (this.isOrderDeleted(order.id)) {
      this.removeOrderFromSyncQueue(order.id);
      return { success: false, rejected: true, error: 'Pedido já excluído e marcado para não ressincronização.' };
    }

    if (!db) {
      if (requireServerConfirmation && typeof fetch === 'function') {
        const timeoutMs = options?.timeoutMs ?? 15000;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const authHeaders = await this.getFirebaseAuthHeaders();
          const res = await fetch('/api/orders', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ order, ...(isPublicMenuOrder ? { source: 'PUBLIC_MENU' } : {}) }),
            ...(controller ? { signal: controller.signal } : {}),
          });
          const parsed = await this.readServerJsonResponse(res);
          const data = parsed.data || {};
          if (parsed.ok && !parsed.isHtml && parsed.isValidJson && data?.success === true) {
            this.removeOrderFromSyncQueue(order.id);
            this.recordSyncedOrderId(order.id);
            this.updateLocalOrderSyncStatus(order.id, 'SYNCED');
            this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
            this.notify('ORDER_SYNC_CONFIRMED', { orderId: order.id });
            return { success: true, ...(data?.order ? { serverOrder: data.order as Order } : {}) };
          }
          const isStoreClosed = Boolean(data?.isStoreClosed || data?.code === 'STORE_CLOSED' || data?.code === 'STORE_AVAILABILITY_UNVERIFIED');
          if (isStoreClosed) {
            this.markLastPublicAvailabilityClosed(data?.reason === 'UNABLE_TO_VERIFY_CASH' ? 'UNABLE_TO_VERIFY_CASH' : 'CASH_CLOSED', data?.message);
          }
          const isRejected = parsed.status === 400 || parsed.status === 401 || parsed.status === 403 || parsed.status === 409;
          return {
            success: false,
            rejected: isRejected,
            ...(isStoreClosed ? { isStoreClosed: true } : {}),
            error:
              data?.message ||
              (parsed.isHtml
                ? `Resposta HTML inesperada do servidor ao enviar pedido (HTTP ${parsed.status}).`
                : `Erro HTTP ${parsed.status} ao confirmar pedido no servidor.`),
          };
        } catch (err: unknown) {
          const confirmedAfterDrop = await this.verifyPublicOrderConfirmationOnServer(order);
          if (confirmedAfterDrop) {
            this.removeOrderFromSyncQueue(order.id);
            this.recordSyncedOrderId(order.id);
            this.updateLocalOrderSyncStatus(order.id, 'SYNCED');
            this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
            this.notify('ORDER_SYNC_CONFIRMED', { orderId: order.id });
            return { success: true, recoveredFromTimeout: true };
          }
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            uncertain: true,
            offline: this.isOfflineErrorMessage(msg),
            error: msg || 'Não foi possível confirmar o registro do pedido no servidor.',
          };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }

      if (!requireServerConfirmation && !isPublicMenuOrder) {
        this.queueOrderForSync(order);
        this.updateLocalOrderSyncStatus(order.id, 'PENDING');
      }
      return { success: false, offline: true, error: 'Cloud Firestore não inicializado' };
    }

    this.inFlightOrderWrites.add(order.id);
    try {
      await this.waitForFirebaseAuthReady();
      const currentSnapshot = this.getOrderById(order.id) || order;
      const authHeaders = await this.getFirebaseAuthHeaders();

      // For status transitions on existing/queued orders, prefer targeted updateDoc / backend status endpoint
      if (options?.isStatusTransition) {
        if (currentSnapshot.status === 'CANCELADO') {
          return {
            success: false,
            rejected: true,
            error: 'Cancelamento de pedidos deve ser executado exclusivamente pelo procedimento oficial /api/orders/:id/cancel.',
          };
        }
        if (isFirebaseReady() && !auth?.currentUser) {
          return {
            success: false,
            rejected: true,
            error: 'Sessão Firebase não autenticada. Faça login novamente para atualizar o pedido.',
          };
        }

        const cleanOrder = this.cleanForFirestore(currentSnapshot);
        let directPermissionDenied = false;
        if (auth?.currentUser && db) {
          try {
            await updateDoc(doc(db, 'orders', currentSnapshot.id), {
              status: cleanOrder.status,
              updatedAt: cleanOrder.updatedAt,
              movements: cleanOrder.movements || [],
              ...(cleanOrder.deliveryPerson !== undefined ? { deliveryPerson: cleanOrder.deliveryPerson } : {}),
              ...(cleanOrder.deliveryPersonId !== undefined ? { deliveryPersonId: cleanOrder.deliveryPersonId } : {}),
              ...(cleanOrder.deliveryPersonName !== undefined ? { deliveryPersonName: cleanOrder.deliveryPersonName } : {}),
              ...(cleanOrder.deliveryAssignmentHistory !== undefined ? { deliveryAssignmentHistory: cleanOrder.deliveryAssignmentHistory } : {}),
              ...(cleanOrder.cancellationReason !== undefined ? { cancellationReason: cleanOrder.cancellationReason } : {}),
              ...(cleanOrder.cancelledBy !== undefined ? { cancelledBy: cleanOrder.cancelledBy } : {}),
              ...(cleanOrder.cancelledAt !== undefined ? { cancelledAt: cleanOrder.cancelledAt } : {}),
              ...(cleanOrder.refundInfo !== undefined ? { refundInfo: cleanOrder.refundInfo } : {}),
            } as Record<string, any>);

            if (currentSnapshot.trackingCode) {
              const publicPayload = this.buildPublicTrackingPayload(currentSnapshot);
              await setDoc(doc(db, 'public_tracking', currentSnapshot.trackingCode), publicPayload).catch(() => {});
            }

            this.removeOrderFromSyncQueue(currentSnapshot.id);
            this.recordSyncedOrderId(currentSnapshot.id);
            this.updateLocalOrderSyncStatus(currentSnapshot.id, 'SYNCED');
            this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
            this.notify('ORDER_SYNC_CONFIRMED', { orderId: currentSnapshot.id });
            return { success: true };
          } catch (directErr: any) {
            const code = String(directErr?.code || '');
            const msg = String(directErr?.message || directErr || '');
            if (code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
              directPermissionDenied = true;
            } else if (code === 'not-found' || msg.includes('No document to update')) {
              const wasPreviouslySynced = this.getSyncedOrderIds().has(currentSnapshot.id);
              if (wasPreviouslySynced) {
                this.applyRemoteTombstonesLocally([currentSnapshot.id]);
                this.removeSyncedOrderId(currentSnapshot.id);
                return { success: false, rejected: true, error: 'Este pedido foi excluído definitivamente em outro dispositivo.' };
              }
            }
            console.warn('[Firestore Status] updateDoc direto falhou, acionando /api/orders/:id/status:', code || msg);
          }
        }

        const backendStatusRes = await this.persistOrderStatusViaBackend(currentSnapshot, authHeaders);
        if (backendStatusRes.success) {
          return { success: true };
        }
        if (backendStatusRes.rejected || directPermissionDenied) {
          const finalErr = backendStatusRes.error || 'Permissão negada no Cloud Firestore (403). Verifique se o usuário possui perfil ATIVO em /users/{uid}.';
          this.cloudSyncState = { status: 'ERROR', lastSyncedAt: this.cloudSyncState.lastSyncedAt, lastError: finalErr };
          return { success: false, rejected: true, error: finalErr };
        }
        const errMsg = backendStatusRes.error || 'Falha ao sincronizar alteração de status.';
        this.queueOrderForSync(currentSnapshot);
        this.updateLocalOrderSyncStatus(currentSnapshot.id, 'PENDING');
        this.cloudSyncState = { status: 'ERROR', lastSyncedAt: this.cloudSyncState.lastSyncedAt, lastError: errMsg };
        return { success: false, offline: this.isOfflineErrorMessage(errMsg), error: errMsg };
      }

      // Route ALL public menu orders and large carts (> 8 items) strictly through the backend /api/orders
      // so open cash-register validation and catalog pricing invariants can NEVER be bypassed via Client SDK.
      if (isPublicMenuOrder || (currentSnapshot.items && currentSnapshot.items.length > 8)) {
        const timeoutMs = options?.timeoutMs ?? 15000;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const res = await fetch('/api/orders', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ order: currentSnapshot, ...(isPublicMenuOrder ? { source: 'PUBLIC_MENU' } : {}) }),
            ...(controller ? { signal: controller.signal } : {}),
          });
          const rawText = await res.text().catch(() => '');
          let data: any = {};
          if (rawText && rawText.trim()) {
            try { data = JSON.parse(rawText); } catch {}
          }
          if (res.status === 410 || data?.deleted) {
            this.applyRemoteTombstonesLocally([currentSnapshot.id]);
            return { success: false, rejected: true, error: data.message || 'Pedido excluído em outro dispositivo.' };
          }
          if (res.ok && data.success) {
            this.removeOrderFromSyncQueue(currentSnapshot.id);
            this.recordSyncedOrderId(currentSnapshot.id);
            this.updateLocalOrderSyncStatus(currentSnapshot.id, 'SYNCED');
            this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
            this.notify('ORDER_SYNC_CONFIRMED', { orderId: currentSnapshot.id });
            return { success: true, ...(data?.order ? { serverOrder: data.order as Order } : {}) };
          } else {
            const errorMsg = data.message || `Erro ${res.status} no backend (${rawText.slice(0, 60)})`;
            const isStoreClosed = Boolean(data?.isStoreClosed || data?.code === 'STORE_CLOSED' || data?.code === 'STORE_AVAILABILITY_UNVERIFIED');
            if (isStoreClosed) {
              this.markLastPublicAvailabilityClosed(data?.reason === 'UNABLE_TO_VERIFY_CASH' ? 'UNABLE_TO_VERIFY_CASH' : 'CASH_CLOSED', errorMsg);
            }
            const isRejected = res.status === 400 || res.status === 401 || res.status === 403 || res.status === 409;
            console.warn('[Firestore] Backend recusou persistência do pedido ' + currentSnapshot.id + ':', errorMsg);
            if (!isRejected && !requireServerConfirmation && !isPublicMenuOrder) {
              this.queueOrderForSync(currentSnapshot);
              this.updateLocalOrderSyncStatus(currentSnapshot.id, 'PENDING');
            }
            this.cloudSyncState = { status: 'ERROR', lastSyncedAt: this.cloudSyncState.lastSyncedAt, lastError: errorMsg };
            return { success: false, rejected: isRejected, ...(isStoreClosed ? { isStoreClosed: true } : {}), error: errorMsg };
          }
        } catch (fetchErr: unknown) {
          if (requireServerConfirmation) {
            const confirmedAfterDrop = await this.verifyPublicOrderConfirmationOnServer(currentSnapshot);
            if (confirmedAfterDrop) {
              this.removeOrderFromSyncQueue(currentSnapshot.id);
              this.recordSyncedOrderId(currentSnapshot.id);
              this.updateLocalOrderSyncStatus(currentSnapshot.id, 'SYNCED');
              this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
              this.notify('ORDER_SYNC_CONFIRMED', { orderId: currentSnapshot.id });
              return { success: true, recoveredFromTimeout: true };
            }
          }
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          if (!requireServerConfirmation && !isPublicMenuOrder) {
            this.queueOrderForSync(currentSnapshot);
            this.updateLocalOrderSyncStatus(currentSnapshot.id, 'PENDING');
          }
          this.cloudSyncState = { status: 'ERROR', lastSyncedAt: this.cloudSyncState.lastSyncedAt, lastError: msg };
          return { success: false, uncertain: requireServerConfirmation, offline: this.isOfflineErrorMessage(msg), error: msg };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }

      if (isPublicMenuOrder) {
        return {
          success: false,
          rejected: true,
          error: 'Pedidos públicos devem ser confirmados pelo servidor antes da finalização.',
        };
      }

      if (currentSnapshot.status === 'CANCELADO') {
        this.removeOrderFromSyncQueue(currentSnapshot.id);
        return {
          success: false,
          rejected: true,
          error: 'Cancelamento de pedidos deve ser executado exclusivamente pelo procedimento oficial /api/orders/:id/cancel.',
        };
      }

      const cleanOrder = this.cleanForFirestore(currentSnapshot);
      const isPreviouslySynced = this.getSyncedOrderIds().has(currentSnapshot.id);

      if (isPreviouslySynced && auth?.currentUser) {
        try {
          await updateDoc(doc(db, 'orders', currentSnapshot.id), cleanOrder as Record<string, any>);
        } catch (updateErr: any) {
          if (updateErr?.code === 'not-found' || String(updateErr?.message || '').includes('No document to update')) {
            this.applyRemoteTombstonesLocally([currentSnapshot.id]);
            this.removeSyncedOrderId(currentSnapshot.id);
            return { success: false, rejected: true, error: 'Este pedido foi excluído em outro dispositivo.' };
          }
          throw updateErr;
        }
      } else {
        await setDoc(doc(db, 'orders', currentSnapshot.id), cleanOrder);
      }

      if (currentSnapshot.trackingCode) {
        const publicPayload = this.buildPublicTrackingPayload(currentSnapshot);
        await setDoc(doc(db, 'public_tracking', currentSnapshot.trackingCode), publicPayload).catch(() => {});
      }

      this.removeOrderFromSyncQueue(currentSnapshot.id);
      this.recordSyncedOrderId(currentSnapshot.id);
      this.updateLocalOrderSyncStatus(currentSnapshot.id, 'SYNCED');
      this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
      this.notify('ORDER_SYNC_CONFIRMED', { orderId: currentSnapshot.id });

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      if (typeof window !== 'undefined' || requireServerConfirmation) {
        const timeoutMs = options?.timeoutMs ?? 15000;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
          const authHeaders = await this.getFirebaseAuthHeaders();
          const fallbackRes = await fetch('/api/orders', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ order }),
            ...(controller ? { signal: controller.signal } : {}),
          });
          const rawFallbackText = await fallbackRes.text().catch(() => '');
          let fallbackData: any = {};
          if (rawFallbackText && rawFallbackText.trim()) {
            try { fallbackData = JSON.parse(rawFallbackText); } catch {}
          }
          if (fallbackRes.status === 410 || fallbackData?.deleted) {
            this.applyRemoteTombstonesLocally([order.id]);
            this.removeSyncedOrderId(order.id);
            return { success: false, rejected: true, error: fallbackData.message || 'Pedido excluído em outro dispositivo.' };
          }
          if (fallbackRes.ok && fallbackData.success) {
            this.removeOrderFromSyncQueue(order.id);
            this.recordSyncedOrderId(order.id);
            this.updateLocalOrderSyncStatus(order.id, 'SYNCED');
            this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
            this.notify('ORDER_SYNC_CONFIRMED', { orderId: order.id });
            return { success: true };
          } else {
            const errMsg = fallbackData.message || rawFallbackText.slice(0, 120) || msg;
            const isRejected = fallbackRes.status === 400 || fallbackRes.status === 401 || fallbackRes.status === 403 || fallbackRes.status === 409;
            console.warn('[Firestore] Backend fallback não persistiu o pedido ' + order.id + ':', errMsg);
            if (isRejected) {
              return { success: false, rejected: true, error: errMsg };
            }
          }
        } catch {
          if (requireServerConfirmation) {
            const confirmedAfterDrop = await this.verifyPublicOrderConfirmationOnServer(order);
            if (confirmedAfterDrop) {
              this.removeOrderFromSyncQueue(order.id);
              this.recordSyncedOrderId(order.id);
              this.updateLocalOrderSyncStatus(order.id, 'SYNCED');
              this.cloudSyncState = { status: 'CONNECTED', lastSyncedAt: new Date().toISOString(), lastError: null };
              this.notify('ORDER_SYNC_CONFIRMED', { orderId: order.id });
              return { success: true, recoveredFromTimeout: true };
            }
          }
        } finally {
          if (timer) clearTimeout(timer);
        }
      }

      if (requireServerConfirmation) {
        this.cloudSyncState = { status: 'ERROR', lastSyncedAt: this.cloudSyncState.lastSyncedAt, lastError: msg };
        return { success: false, uncertain: true, offline: this.isOfflineErrorMessage(msg), error: msg };
      }

      console.warn('[Firestore] Falha na sincronização do pedido ' + order.id + ' (mantido na fila resiliente):', msg);
      this.queueOrderForSync(order);
      this.updateLocalOrderSyncStatus(order.id, 'PENDING');
      this.cloudSyncState = { status: 'ERROR', lastSyncedAt: this.cloudSyncState.lastSyncedAt, lastError: msg };
      return { success: false, offline: this.isOfflineErrorMessage(msg), error: msg };
    } finally {
      this.inFlightOrderWrites.delete(order.id);
    }
  }

  /**
   * Flushes all pending queued operations to Cloud Firestore safely,
   * checking tombstones and remote state first so stale queues never overwrite newer cloud data.
   */
  public async flushPendingSyncQueue(): Promise<{ processed: number; succeeded: number }> {
    if (!db || this.isFlushingPendingQueue || this.isPublicCustomerContext()) return { processed: 0, succeeded: 0 };
    const deletedIds = this.getDeletedOrderIds();
    const syncedIds = this.getSyncedOrderIds();
    const pending = this.getPendingSyncOrders();
    const activePending = pending.filter((o) => {
      if (deletedIds.has(o.id)) {
        this.removeOrderFromSyncQueue(o.id);
        return false;
      }
      return true;
    });
    if (activePending.length === 0) return { processed: 0, succeeded: 0 };

    const STATUS_PRECEDENCE: Record<string, number> = {
      NOVO: 1,
      EM_PREPARO: 2,
      PRONTO: 3,
      EM_ROTA: 4,
      ENTREGUE: 5,
      CANCELADO: 6,
    };

    this.isFlushingPendingQueue = true;
    let succeeded = 0;

    try {
      for (const order of activePending) {
        if (this.inFlightOrderWrites.has(order.id) || this.isOrderDeleted(order.id)) {
          continue;
        }

        // Before overwriting an existing remote document, check if Firestore was updated/deleted by another device
        if (auth?.currentUser && syncedIds.has(order.id)) {
          try {
            const remoteSnap = await getDoc(doc(db, 'orders', order.id));
            if (!remoteSnap.exists()) {
              this.applyRemoteTombstonesLocally([order.id]);
              this.removeSyncedOrderId(order.id);
              continue;
            }
            const ro = remoteSnap.data() as Order;
            const roRank = STATUS_PRECEDENCE[ro.status] || 0;
            const loRank = STATUS_PRECEDENCE[order.status] || 0;
            const roTime = ro.updatedAt ? new Date(ro.updatedAt).getTime() : 0;
            const loTime = order.updatedAt ? new Date(order.updatedAt).getTime() : 0;
            if (roRank > loRank || (roRank === loRank && roTime > loTime)) {
              // Remote is already newer — let remote win instead of overwriting with stale queue entry
              this.reconcileRemoteOrders([ro], { authoritative: false });
              this.removeOrderFromSyncQueue(order.id);
              succeeded++;
              continue;
            }
          } catch {
            // Proceed to persistOrderToFirestore (which handles fallback)
          }
        }

        const res = await this.persistOrderToFirestore(order);
        if (res.success) {
          succeeded++;
        }
      }
    } finally {
      this.isFlushingPendingQueue = false;
    }

    return { processed: activePending.length, succeeded };
  }

  /**
   * Synchronizes the active authenticated Firebase user profile to /users/{uid}
   * WITHOUT silently falling back to hardcoded default passwords or faking sessions.
   */
  public async ensureFirebaseAuthForStaff(): Promise<void> {
    if (!isFirebaseReady() || !auth) return;

    await this.waitForFirebaseAuthReady();
    if (!auth.currentUser) {
      return;
    }

    const user = this.getCurrentUser();
    if (!user || !this.isAuthorizedStaffRole(user.role) || user.status !== 'ATIVO') return;

    const fbUid = auth.currentUser.uid;

    // Ensure staff profile document exists at /users/{uid} so hasActiveProfile() rule succeeds
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken && typeof window !== 'undefined') {
        await fetch('/api/auth/sync-profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            name: user.name,
            username: user.username,
            allowedModules: user.allowedModules,
          }),
        }).catch(() => {});
      }
    } catch {
      // ignore network fetch error
    }

    if (db) {
      try {
        const userDocRef = doc(db, 'users', fbUid);
        const snap = await getDoc(userDocRef);
        if (!snap.exists()) {
          const verifiedRole = await this.verifyStaffRole(auth.currentUser);
          if (verifiedRole) {
            const profile: User = {
              id: fbUid,
              name: user.name || 'Colaborador',
              username: user.username || 'colaborador',
              email: auth.currentUser.email || user.email || '',
              role: verifiedRole,
              status: 'ATIVO',
              allowedModules: user.allowedModules || [],
              createdAt: user.createdAt || new Date().toISOString(),
              lastLoginAt: new Date().toISOString(),
              isEmailVerified: Boolean(auth.currentUser.emailVerified),
              authProvider: user.authProvider || 'firebase_email',
              firebaseUid: fbUid,
            };
            await setDoc(userDocRef, this.cleanForFirestore(profile));
          }
        }
      } catch {
        // Handled safely by caller / rules
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
            // Strictly isolate public customer views & drivers: customers & drivers NEVER hear internal kitchen/cashier bells
            if (!this.isPublicCustomerContext()) {
              const current = this.getCurrentUser();
              if (current && this.isOrderPrepStaffRole(current.role)) {
                soundService.playNewOrderAlert();
              }
            }
          }
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: event.data }));
        };
      } catch {
        // BroadcastChannel unavailable in iframe or sandbox
      }
    }

    // Initialize public real-time data (Menu & Store Config)
    this.initPublicFirestoreSync();
    this.syncDailyMenuWithServer(true).catch(() => {});

    // Reconnection listener to flush pending orders and sync daily menu / public catalog automatically
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.info('[Store Sync] Conexão restabelecida. Transmitindo pedidos pendentes e sincronizando cardápio...');
        this.flushPendingSyncQueue();
        this.refreshPublicMenuSync(true).catch(() => {});
        this.syncDailyMenuWithServer(true).catch(() => {});
        const current = this.getCurrentUser();
        if (current && this.isAuthorizedStaffRole(current.role)) {
          this.refreshStaffSync();
        }
      });

      window.addEventListener('focus', () => {
        this.refreshPublicMenuSync(false).catch(() => {});
        this.syncDailyMenuWithServer().catch(() => {});
      });

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            console.info('[Store Sync] Retorno do segundo plano: verificando conexões e cardápio...');
            this.flushPendingSyncQueue();
            this.refreshPublicMenuSync(true).catch(() => {});
            this.syncDailyMenuWithServer(true).catch(() => {});
            const current = this.getCurrentUser();
            if (current && this.isAuthorizedStaffRole(current.role)) {
              this.refreshStaffSync();
            }
          }
        });
      }

      // Background heartbeat to retry pending sync queue and keep daily menu & public listener alive across all devices
      setInterval(() => {
        this.flushPendingSyncQueue();
        if (!this.isPublicSyncActive && !this.publicSyncRetryTimer) {
          this.initPublicFirestoreSync();
        }
        this.syncDailyMenuWithServer().catch(() => {});
      }, 10000);
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
                  // Fallback to local profile check if offline
                }
              }
              if (!profile) {
                const localUsers = this.getUsers();
                const matched = localUsers.find(
                  (u) => u.id === firebaseUser.uid || (firebaseUser.email && (u.email || '').toLowerCase() === firebaseUser.email.toLowerCase())
                );
                if (matched) {
                  profile = {
                    ...matched,
                    id: firebaseUser.uid,
                    firebaseUid: firebaseUser.uid,
                    role: confirmedRole,
                  };
                }
              }
              if (profile && profile.status === 'ATIVO') {
                this.setCurrentUser(profile);
                await this.initStaffFirestoreSync(firebaseUser);
                this.flushPendingSyncQueue();
              } else {
                this.stopStaffFirestoreSync();
                if (isFirebaseReady()) {
                  this.setCurrentUser(null);
                  signOutFirebase().catch(() => {});
                }
              }
            } else {
              this.stopStaffFirestoreSync();
              if (isFirebaseReady()) {
                this.setCurrentUser(null);
              }
            }
          } catch (e) {
            console.warn('[Store] Falha ao restaurar perfil do usuário autenticado:', e);
          }
        } else {
          await this.waitForFirebaseAuthReady();
          if (auth?.currentUser) return;
          this.stopStaffFirestoreSync();
          // When Firebase is configured, never allow a stale local session without a real Firebase Auth session
          if (isFirebaseReady()) {
            const curr = this.getCurrentUser();
            if (curr) {
              this.setCurrentUser(null);
            }
          }
        }
      });
    }
  }

  private initStorage() {
    try {
      // Menu items robust preservation check
      const currentMenuData = localStorage.getItem('gf_menu_items');
      let needsMenuInit = false;
      if (!currentMenuData) {
        needsMenuInit = true;
      } else {
        try {
          const parsed = JSON.parse(currentMenuData);
          if (!Array.isArray(parsed) || parsed.length === 0 || currentMenuData.includes('Smash Burger')) {
            needsMenuInit = true;
          }
        } catch {
          needsMenuInit = true;
        }
      }
      if (needsMenuInit) {
        localStorage.setItem('gf_menu_items', JSON.stringify(INITIAL_MENU));
      }

      // Orders migration check
      const currentOrdersData = localStorage.getItem('gf_orders');
      if (!currentOrdersData || currentOrdersData.includes('Smash Burger') || currentOrdersData.includes('Pizza Margherita')) {
        localStorage.setItem('gf_orders', JSON.stringify(INITIAL_ORDERS));
      }

      // Restaurant config migration check (also purge legacy demo PIX key if cached locally)
      const currentConfigData = localStorage.getItem('gf_restaurant_config');
      if (!currentConfigData || currentConfigData.includes('Brasa & Sabor')) {
        localStorage.setItem('gf_restaurant_config', JSON.stringify(INITIAL_CONFIG));
      } else if (currentConfigData.includes('contato@amanditasabores.com.br')) {
        try {
          const parsedCfg = JSON.parse(currentConfigData) as Partial<RestaurantConfig>;
          if ((parsedCfg.pixKey || '').trim().toLowerCase() === 'contato@amanditasabores.com.br') {
            localStorage.setItem(
              'gf_restaurant_config',
              JSON.stringify({ ...parsedCfg, pixKey: '', pixKeyType: undefined })
            );
          }
        } catch {
          localStorage.setItem('gf_restaurant_config', JSON.stringify(INITIAL_CONFIG));
        }
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

      // Security Isolation: Never auto-log in visitors as staff.
      // Visitor sessions start unauthenticated (currentUser is null).
      // Only retain gf_current_user if the user legitimately logged in with authorized modules.
      const currUser = localStorage.getItem('gf_current_user');
      if (currUser) {
        try {
          const parsed = JSON.parse(currUser);
          if (!parsed || !parsed.allowedModules || !parsed.role) {
            localStorage.removeItem('gf_current_user');
          }
        } catch {
          localStorage.removeItem('gf_current_user');
        }
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
   * Helper that checks if a role belongs to staff responsible for order reception & preparation.
   * Strictly excludes ENTREGADOR so drivers NEVER receive kitchen/cashier new order alarms.
   */
  public isOrderPrepStaffRole(role?: string | null): boolean {
    return isOrderPrepStaffRole(role);
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

  public setServerAtomicPaymentMode(enabled: boolean): void {
    this.serverAtomicPaymentTestOverride = enabled;
    this.uncertainServerOps.clear();
    this.lastUncertainOpenShiftId = null;
    this.cashShiftSyncPromise = null;
    this.cashShiftSyncState = {
      status: 'IDLE',
      confirmedAt: null,
      source: 'none',
      error: null,
    };
  }

  public setExplicitCashConfirmationModeForTest(enabled: boolean): void {
    this.requireExplicitCashConfirmationTestOverride = enabled;
    this.cashShiftSyncPromise = null;
    this.cashShiftSyncState = {
      status: 'IDLE',
      confirmedAt: null,
      source: 'none',
      error: null,
    };
  }

  public beginCashShiftSyncForTest(): void {
    this.cashShiftSyncState = {
      status: 'SYNCING',
      confirmedAt: null,
      source: 'none',
      error: null,
    };
    this.notify('CASH_SHIFT_SYNC_STATE', this.getCashShiftSyncState());
  }

  public simulateFirestoreCashShiftSnapshotForTest(
    shifts: CashRegisterShift[],
    options?: { fromCache?: boolean; isFullCollection?: boolean }
  ): void {
    this.applyFirestoreCashShiftSnapshot(shifts, {
      fromCache: Boolean(options?.fromCache),
      isFullCollection: options?.isFullCollection ?? true,
      skipServerReconcileOnCache: true,
    });
  }

  public simulateFirestoreCashShiftErrorForTest(message = 'Falha simulada na sincronização do caixa.'): void {
    this.cashShiftSyncState = {
      status: 'ERROR',
      confirmedAt: null,
      source: 'none',
      error: message,
    };
    this.notify('CASH_SHIFT_UPDATED', null);
  }

  private shouldUseServerAtomicPayment(): boolean {
    return isFirebaseReady() || Boolean(db) || this.serverAtomicPaymentTestOverride;
  }

  public isCloudAtomicRequired(): boolean {
    return this.shouldUseServerAtomicPayment();
  }

  public canUserManageCash(): boolean {
    const user = this.getCurrentUser();
    if (!user || user.status !== 'ATIVO') return false;
    const role = user.role?.toUpperCase();
    if (role === 'ADMINISTRADOR' || role === 'GERENTE' || role === 'CAIXA') return true;
    return user.username === 'admin' && role !== 'ATENDENTE' && role !== 'COZINHA' && role !== 'ENTREGADOR';
  }

  public canUserConfirmPayments(user?: User | null): boolean {
    const target = user !== undefined ? user : this.getCurrentUser();
    if (!target || target.status !== 'ATIVO') return false;
    const role = (target.role || '').toUpperCase();
    return ['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE'].includes(role);
  }

  public canUserDeleteOrder(user?: User | null): boolean {
    const target = user !== undefined ? user : this.getCurrentUser();
    if (!target || target.status !== 'ATIVO') return false;
    const role = (target.role || '').toUpperCase();
    return role === 'ADMINISTRADOR' || role === 'GERENTE' || (target.username === 'admin' && role !== 'ATENDENTE' && role !== 'CAIXA' && role !== 'COZINHA' && role !== 'ENTREGADOR');
  }

  public canUserManageConfig(user?: User | null): boolean {
    const target = user !== undefined ? user : this.getCurrentUser();
    if (!target || target.status !== 'ATIVO') return false;
    const role = (target.role || '').toUpperCase();
    return role === 'ADMINISTRADOR' || role === 'GERENTE';
  }

  public canUserUpdateOrderStatus(user: User | null, targetStatus: OrderStatus): boolean {
    if (!user || user.status !== 'ATIVO') return false;
    if (targetStatus === 'CANCELADO') return false;
    const role = user.role?.toUpperCase();
    if (role === 'ADMINISTRADOR' || user.username === 'admin' || role === 'GERENTE') {
      return ['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'].includes(targetStatus);
    }
    if (role === 'COZINHA') {
      return targetStatus === 'EM_PREPARO' || targetStatus === 'PRONTO';
    }
    if (role === 'ENTREGADOR') {
      return targetStatus === 'EM_ROTA' || targetStatus === 'ENTREGUE';
    }
    if (role === 'ATENDENTE' || role === 'CAIXA') {
      return ['NOVO', 'EM_PREPARO', 'PRONTO', 'EM_ROTA', 'ENTREGUE'].includes(targetStatus);
    }
    return false;
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
   * Helper to identify bootstrapped emergency administrator accounts
   */
  public isBootstrappedAdminEmail(email?: string | null): boolean {
    if (!email) return false;
    const clean = email.trim().toLowerCase();
    const configuredAdmin = this.getInitialAdminEmail();
    return (
      clean === configuredAdmin ||
      clean === 'admin@amanditasabores.com.br' ||
      clean === 'amanditasabore@gmail.com' ||
      clean === 'amanditasabores@gmail.com' ||
      clean === 'dvrmercadinho@gmail.com'
    );
  }

  /**
   * Verifies if an authenticated Firebase User has a confirmed authorized staff role.
   * Trusts Firestore /users/{uid} authoritatively when reachable and never auto-promotes
   * non-bootstrap users to ADMINISTRADOR from local storage.
   */
  public async verifyStaffRole(firebaseUser: { uid: string; email?: string | null } | null): Promise<UserRole | null> {
    if (!firebaseUser) return null;

    // 1. Check remote Firestore users/{uid} document first (authoritative source of truth)
    if (db) {
      try {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const remoteData = userSnap.data() as Partial<User>;
          if (remoteData.status && remoteData.status !== 'ATIVO') {
            return null;
          }
          if (remoteData.role && this.isAuthorizedStaffRole(remoteData.role)) {
            return remoteData.role.toUpperCase() as UserRole;
          }
          return null;
        }
      } catch (err) {
        console.warn('[Store Security] Verificação de papel no Firestore remoto falhou:', err);
      }
    }

    // 2. Whitelisted bootstrap administrator emails (matches firestore.rules isBootstrappedAdmin())
    if (firebaseUser.email && this.isBootstrappedAdminEmail(firebaseUser.email)) {
      return 'ADMINISTRADOR';
    }

    // 3. Seeded Gerente account (matches firestore.rules line 530)
    if (firebaseUser.email && firebaseUser.email.trim().toLowerCase() === 'gerente@amanditasabores.com.br') {
      return 'GERENTE';
    }

    // 4. Local operational staff registry match (never elevates to ADMINISTRADOR via localStorage)
    const localUsers = this.getUsers();
    const cleanEmail = (firebaseUser.email || '').trim().toLowerCase();
    const matched = localUsers.find(
      (u) => u.id === firebaseUser.uid || (cleanEmail && (u.email || '').trim().toLowerCase() === cleanEmail)
    );

    if (matched) {
      if (matched.status !== 'ATIVO') return null;
      const roleUpper = (matched.role || '').toUpperCase();
      if (roleUpper !== 'ADMINISTRADOR' && this.isAuthorizedStaffRole(roleUpper)) {
        return roleUpper as UserRole;
      }
    }

    // 5. Base operational roles for @staff.amanditasabores.com.br (matches firestore.rules line 534-537)
    if (cleanEmail.endsWith('@staff.amanditasabores.com.br') || cleanEmail.endsWith('@amanditasabores.com.br')) {
      const username = cleanEmail.split('@')[0].toLowerCase();
      const byUser = localUsers.find((u) => (u.username || '').toLowerCase() === username);
      if (byUser) {
        if (byUser.status !== 'ATIVO') return null;
        const roleUpper = (byUser.role || '').toUpperCase();
        if (roleUpper !== 'ADMINISTRADOR' && this.isAuthorizedStaffRole(roleUpper)) {
          return roleUpper as UserRole;
        }
      }
      if (username.startsWith('cozinha')) return 'COZINHA';
      if (username.startsWith('entregador')) return 'ENTREGADOR';
      if (username.startsWith('caixa')) return 'CAIXA';
      if (username.startsWith('atendente')) return 'ATENDENTE';
    }

    return null;
  }

  /**
   * Synchronous check to determine if the active Firebase Auth user is a confirmed staff member
   */
  public isFirebaseAuthStaff(): boolean {
    const currentFbUser = auth?.currentUser;
    if (!currentFbUser) return false;

    if (currentFbUser.email && this.isBootstrappedAdminEmail(currentFbUser.email)) return true;

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

  private teardownPublicListenersOnly(): void {
    if (this.publicSyncRetryTimer) {
      clearTimeout(this.publicSyncRetryTimer);
      this.publicSyncRetryTimer = null;
    }
    this.publicUnsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch {
        // ignore unsubscribe errors
      }
    });
    this.publicUnsubscribers = [];
    this.isPublicSyncActive = false;
  }

  private schedulePublicSyncRetry(delayMs = 5000): void {
    if (!db || this.publicSyncRetryTimer || this.isPublicSyncActive) return;
    this.publicSyncRetryTimer = setTimeout(() => {
      this.publicSyncRetryTimer = null;
      if (!this.isPublicSyncActive) {
        this.initPublicFirestoreSync();
      }
    }, delayMs);
  }

  private applyRemoteMenuItems(remoteDocs: Array<{ id: string; data: Partial<MenuItem> }>): void {
    if (!Array.isArray(remoteDocs) || remoteDocs.length === 0) return;

    const currentList = this.getMenuItems();
    const currentMap = new Map<string, MenuItem>();
    for (const it of currentList) {
      currentMap.set(it.id, it);
    }

    let validRemoteCount = 0;
    for (const entry of remoteDocs) {
      const d = entry.data;
      if (entry.id && d && d.name) {
        validRemoteCount++;
        const base = currentMap.get(entry.id);
        currentMap.set(entry.id, {
          ...(base || {}),
          ...d,
          id: entry.id,
          available: d.available !== false,
        } as MenuItem);
      }
    }

    if (validRemoteCount === 0) return;

    const merged = Array.from(currentMap.values());
    if (merged.length > 0) {
      const nextJson = JSON.stringify(merged);
      let prevJson: string | null = null;
      try {
        prevJson = localStorage.getItem('gf_menu_items');
      } catch {
        prevJson = null;
      }

      if (nextJson !== prevJson) {
        try {
          localStorage.setItem('gf_menu_items', nextJson);
        } catch (storageErr) {
          console.warn('[Firestore Public Sync] Falha ao gravar cache local do cardápio:', storageErr);
        }
        this.notify('FIRESTORE_MENU_SYNCED', { count: merged.length });
      }
    }
  }

  private async fetchPublicMenuFromServer(): Promise<void> {
    if (!db) return;
    this.lastPublicMenuRefreshAt = Date.now();
    try {
      const serverSnap = await getDocsFromServer(collection(db, 'menu_items'));
      if (!serverSnap.empty) {
        const remoteDocs: Array<{ id: string; data: Partial<MenuItem> }> = [];
        serverSnap.forEach((docSnap) => {
          remoteDocs.push({ id: docSnap.id, data: docSnap.data() as Partial<MenuItem> });
        });
        this.applyRemoteMenuItems(remoteDocs);
      }
    } catch (error: any) {
      const code = String(error?.code || '');
      const msg = String(error?.message || error || '');
      if (code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
        console.warn('[Firestore Public Sync] Server menu fetch permission denied:', msg);
      } else {
        console.warn('[Firestore Public Sync] Server menu fetch notice:', msg);
      }
    }
  }

  public async refreshPublicMenuSync(forceServer = false): Promise<void> {
    if (!db) return;
    if (!this.isPublicSyncActive) {
      this.initPublicFirestoreSync();
      return;
    }
    const now = Date.now();
    if (!forceServer && now - this.lastPublicMenuRefreshAt < 10000) {
      return;
    }
    await this.fetchPublicMenuFromServer();
  }

  /**
   * Public Firestore listeners: Only public resources that unauthenticated visitors are permitted to see
   * (Menu items and public restaurant config). Never touches internal orders or cash shifts.
   */
  public initPublicFirestoreSync(): void {
    if (!db || this.isPublicSyncActive) return;

    this.teardownPublicListenersOnly();
    if (!this.hasReceivedFirestoreConfig) {
      this.officialPixState = {
        status: 'LOADING',
        source: 'none',
        hasValidPixKey: false,
        error: null,
        message: 'Carregando configuração oficial do PIX do Firebase...',
        lastSyncedAt: null,
      };
    }

    try {
      this.isPublicSyncActive = true;

      // 1. Synchronize Menu Items in Real Time (Public catalog)
      const unsubMenu = onSnapshot(
        collection(db, 'menu_items'),
        (snapshot) => {
          if (!snapshot.empty) {
            const remoteDocs: Array<{ id: string; data: Partial<MenuItem> }> = [];
            snapshot.forEach((docSnap) => {
              remoteDocs.push({ id: docSnap.id, data: docSnap.data() as Partial<MenuItem> });
            });
            this.applyRemoteMenuItems(remoteDocs);
          }
        },
        (error: any) => {
          const code = String(error?.code || '');
          const msg = String(error?.message || error || '');
          const isPermissionError =
            code === 'permission-denied' || msg.includes('Missing or insufficient permissions');
          if (isPermissionError) {
            console.warn('[Firestore Public Sync] Menu listener permission denied:', msg);
          } else {
            console.warn('[Firestore Public Sync] Menu listener notice:', msg);
          }
          this.teardownPublicListenersOnly();
          this.schedulePublicSyncRetry(isPermissionError ? 15000 : 5000);
        }
      );
      this.publicUnsubscribers.push(unsubMenu);

      // Ensure fresh server fetch on app open so updated menu items are recovered even if local IndexedDB cache is stale
      this.fetchPublicMenuFromServer().catch(() => {});

      // 2. Synchronize Restaurant Config in Real Time (Public info: WhatsApp, PIX, store status)
      // Merges into existing config so internal/private fields (receiptFooterText, defaultDeliveryPersonId, notify*) are never wiped.
      const applyRemotePublicConfig = (remotePublic: Partial<RestaurantConfig>) => {
        const currentLocal = this.getRestaurantConfig();
        const remoteKey = typeof remotePublic.pixKey === 'string' ? remotePublic.pixKey.trim() : undefined;
        const resolvedRemoteType =
          remotePublic.pixKeyType || (remoteKey ? inferPixKeyType(remoteKey) : undefined);
        const mergedConfig: RestaurantConfig = {
          ...currentLocal,
          ...remotePublic,
          ...(remoteKey !== undefined ? { pixKey: remoteKey } : {}),
          ...(resolvedRemoteType ? { pixKeyType: resolvedRemoteType } : {}),
        };
        try {
          localStorage.setItem('gf_restaurant_config', JSON.stringify(mergedConfig));
        } catch (storageErr) {
          console.warn('[Firestore Public Sync] Falha ao gravar config local:', storageErr);
        }
        this.syncOfficialPixStateFromFirestore(mergedConfig, true);
        this.notify('CONFIG_UPDATED', mergedConfig);
      };

      const markConfigUnavailable = (errMsg: string) => {
        if (!this.hasReceivedFirestoreConfig) {
          this.officialPixState = {
            status: 'UNAVAILABLE',
            source: 'none',
            hasValidPixKey: false,
            error: errMsg,
            message: 'Não foi possível carregar a configuração oficial do PIX no Firebase. Use outra forma de pagamento ou tente novamente.',
            lastSyncedAt: null,
          };
          this.notify('CONFIG_UPDATED', this.getRestaurantConfig());
        }
      };

      const unsubConfig = onSnapshot(
        doc(db, 'configs', 'restaurant'),
        (docSnap) => {
          if (docSnap.exists()) {
            applyRemotePublicConfig(docSnap.data() as Partial<RestaurantConfig>);
          } else {
            this.syncOfficialPixStateFromFirestore(this.getRestaurantConfig(), false);
            this.notify('CONFIG_UPDATED', this.getRestaurantConfig());
          }
        },
        (error) => {
          console.warn('[Firestore Public Sync] Config listener notice:', error.message);
          markConfigUnavailable(error.message || 'Falha ao escutar configs/restaurant no Firestore.');
        }
      );
      this.publicUnsubscribers.push(unsubConfig);

      // Ensure fresh server fetch on app open so updated PIX key is always recovered immediately
      getDocFromServer(doc(db, 'configs', 'restaurant'))
        .then((serverSnap) => {
          if (serverSnap.exists()) {
            applyRemotePublicConfig(serverSnap.data() as Partial<RestaurantConfig>);
          } else {
            this.syncOfficialPixStateFromFirestore(this.getRestaurantConfig(), false);
            this.notify('CONFIG_UPDATED', this.getRestaurantConfig());
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          markConfigUnavailable(msg || 'Falha ao consultar configs/restaurant no servidor.');
        });

    } catch (err) {
      console.warn('[Firestore Public Sync Setup Error]:', err);
      if (!this.hasReceivedFirestoreConfig) {
        const msg = err instanceof Error ? err.message : String(err);
        this.officialPixState = {
          status: 'UNAVAILABLE',
          source: 'none',
          hasValidPixKey: false,
          error: msg,
          message: 'Não foi possível conectar ao Firebase para carregar o PIX oficial. Utilize outra forma de pagamento.',
          lastSyncedAt: null,
        };
      }
      this.teardownPublicListenersOnly();
      this.schedulePublicSyncRetry(5000);
    }
  }

  /**
   * Internal Staff Firestore listeners: Orders collection, Cash register shifts, and Staff users.
   * STRICT SECURITY:
   * 1. Rejects if user is not authenticated in Firebase Auth.
   * 2. Confirms that the authenticated user possesses an authorized staff role.
   * Never leaks internal operational order lists to unauthenticated visitors.
   */
  public async initStaffFirestoreSync(_firebaseUser?: unknown): Promise<void> {
    if (!db || this.isStaffSyncActive) return;

    await this.waitForFirebaseAuthReady();
    if (!auth?.currentUser) {
      console.info('[Firestore Security] Aguardando sessão real de colaborador no Firebase Auth para sincronização interna.');
      return;
    }

    // 2. Confirm that the authenticated user possesses an authorized staff role
    const confirmedRole = await this.verifyStaffRole(auth.currentUser);
    if (!confirmedRole) {
      console.warn('[Firestore Security] Usuário autenticado no Firebase não possui confirmação de papel de colaborador autorizado para sincronizar dados internos.');
      this.cashShiftSyncState = {
        status: 'ERROR',
        confirmedAt: null,
        source: 'none',
        error: 'Papel de colaborador não confirmado no Firestore.',
      };
      this.notify('CASH_SHIFT_UPDATED', null);
      return;
    }

    try {
      this.isStaffSyncActive = true;

      // Ensure catalog and store config exist in Firestore
      this.ensureInitialDataSeededToFirestore().catch(() => {});

      const currentLocalUser = this.getCurrentUser();
      const role = currentLocalUser?.role?.toUpperCase();
      const allowedModules = currentLocalUser?.allowedModules || [];

      const canAccessCash = role === 'ADMINISTRADOR' || role === 'GERENTE' || role === 'CAIXA';
      const canAccessUsers = role === 'ADMINISTRADOR' || role === 'GERENTE' || allowedModules.includes('usuarios');
      const canManageMenu = role === 'ADMINISTRADOR' || role === 'GERENTE' || allowedModules.includes('menu') || allowedModules.includes('relatorios');

      if (canAccessCash || role === 'ATENDENTE') {
        this.cashShiftSyncState = {
          status: 'SYNCING',
          confirmedAt: null,
          source: 'none',
          error: null,
        };
        this.notify('CASH_SHIFT_SYNC_STATE', this.getCashShiftSyncState());
      }

      // Sync shared tombstones before attaching snapshot so deleted orders never resurrect
      this.syncTombstonesFromServer().catch(() => {});

      // 1. Synchronize All Orders in Real Time (Staff only: Kitchen KDS, POS Balcão, Entregadores, Admin)
      const unsubOrders = onSnapshot(
        collection(db, 'orders'),
        (snapshot) => {
          // Process explicit Firestore removals immediately
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'removed') {
              this.recordDeletedOrderId(change.doc.id);
              this.removeOrderFromSyncQueue(change.doc.id);
              this.removeSyncedOrderId(change.doc.id);
            }
          });

          const remoteOrders: Order[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as Order;
            remoteOrders.push(data);
          });

          const reconcileSummary = this.reconcileRemoteOrders(remoteOrders, {
            authoritative: !snapshot.metadata.fromCache,
          });
          this.cloudSyncState = {
            status: 'CONNECTED',
            lastSyncedAt: new Date().toISOString(),
            lastError: null,
          };

          this.notify('FIRESTORE_ORDERS_SYNCED', { count: reconcileSummary.count });
          this.notify('ORDERS_UPDATED', { count: reconcileSummary.count });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'FIRESTORE_ORDERS_SYNCED' } }));
          }
        },
        (error) => {
          console.warn('[Firestore Staff Sync] Aviso no listener de pedidos:', error.message);
          this.cloudSyncState = {
            status: 'ERROR',
            lastSyncedAt: this.cloudSyncState.lastSyncedAt,
            lastError: error.message || 'Erro no listener em tempo real do Firestore.',
          };
          this.stopStaffFirestoreSync();
          this.notify('FIRESTORE_SYNC_ERROR', { error: error.message });
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'FIRESTORE_SYNC_ERROR' } }));
          }
          // Reschedule resilient reconnect on ANY transient or permission error
          if (this.staffSyncRetryTimer) {
            clearTimeout(this.staffSyncRetryTimer);
          }
          this.staffSyncRetryTimer = setTimeout(() => {
            this.staffSyncRetryTimer = null;
            if (error.code === 'permission-denied') {
              this.ensureFirebaseAuthForStaff().then(() => this.initStaffFirestoreSync()).catch(() => {});
            } else {
              this.initStaffFirestoreSync().catch(() => {});
            }
          }, 5000);
        }
      );
      this.staffUnsubscribers.push(unsubOrders);

      // 2. Synchronize Cash Register Shifts in Real Time
      if (canAccessCash) {
        const unsubShifts = onSnapshot(
          collection(db, 'cash_shifts'),
          (snapshot) => {
            const shifts: CashRegisterShift[] = [];
            snapshot.forEach((docSnap) => {
              shifts.push(docSnap.data() as CashRegisterShift);
            });
            this.applyFirestoreCashShiftSnapshot(shifts, {
              fromCache: snapshot.metadata.fromCache,
              isFullCollection: true,
            });
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Cash shift notice:', error.message);
            if (this.cashShiftSyncState.status !== 'CONFIRMED') {
              this.cashShiftSyncState = {
                status: 'ERROR',
                confirmedAt: null,
                source: 'none',
                error: error.message || 'Erro ao sincronizar turnos de caixa.',
              };
              this.notify('CASH_SHIFT_UPDATED', null);
            }
            this.reconcileCashShiftWithServerOnSync(true).catch(() => {});
          }
        );
        this.staffUnsubscribers.push(unsubShifts);
      } else if (role === 'ATENDENTE') {
        // ATENDENTE can strictly observe ONLY active ABERTO shift (zero access to closed shifts/history)
        const openShiftsQuery = query(collection(db, 'cash_shifts'), where('status', '==', 'ABERTO'));
        const unsubOpenShift = onSnapshot(
          openShiftsQuery,
          (snapshot) => {
            const shifts: CashRegisterShift[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data() as CashRegisterShift;
              if (data) shifts.push(data);
            });
            this.applyFirestoreCashShiftSnapshot(shifts, {
              fromCache: snapshot.metadata.fromCache,
              isFullCollection: false,
            });
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Open shift notice (Atendente):', error.message);
            if (this.cashShiftSyncState.status !== 'CONFIRMED') {
              this.cashShiftSyncState = {
                status: 'ERROR',
                confirmedAt: null,
                source: 'none',
                error: error.message || 'Erro ao sincronizar caixa aberto.',
              };
              this.notify('CASH_SHIFT_UPDATED', null);
            }
            this.reconcileCashShiftWithServerOnSync(false).catch(() => {});
          }
        );
        this.staffUnsubscribers.push(unsubOpenShift);
      }

      // 2b. Synchronize Internal Config for Administrator (receipt footer, default driver, push flags)
      if (role === 'ADMINISTRADOR') {
        const unsubInternalConfig = onSnapshot(
          doc(db, 'configs', 'internal'),
          (docSnap) => {
            if (docSnap.exists()) {
              const remoteInternal = docSnap.data() as Partial<RestaurantConfig>;
              const currentLocal = this.getRestaurantConfig();
              const mergedConfig: RestaurantConfig = {
                ...currentLocal,
                ...remoteInternal,
              };
              localStorage.setItem('gf_restaurant_config', JSON.stringify(mergedConfig));
              this.notify('CONFIG_UPDATED', mergedConfig);
            }
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Internal config notice:', error.message);
          }
        );
        this.staffUnsubscribers.push(unsubInternalConfig);
      }

      // 2c. Synchronize Store Schedule & Closed Messages for Administrator & Gerente
      if (role === 'ADMINISTRADOR' || role === 'GERENTE') {
        const unsubScheduleConfig = onSnapshot(
          doc(db, 'configs', 'store_schedule'),
          (docSnap) => {
            if (docSnap.exists()) {
              const closedSettings = normalizeClosedSettings(docSnap.data() as Partial<StoreClosedSettings>);
              const currentLocal = this.getRestaurantConfig();
              const mergedConfig: RestaurantConfig = {
                ...currentLocal,
                operatingHours: closedSettings.operatingHours,
                closedPrimaryMessage: closedSettings.closedPrimaryMessage,
                closedSecondaryMessage: closedSettings.closedSecondaryMessage,
              };
              localStorage.setItem('gf_restaurant_config', JSON.stringify(mergedConfig));
              this.notify('CONFIG_UPDATED', mergedConfig);
            }
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Store schedule notice:', error.message);
          }
        );
        this.staffUnsubscribers.push(unsubScheduleConfig);
      }

      // 3. Synchronize Staff Users in Real Time (Restricted to Administrator & Management)
      if (canAccessUsers) {
        const unsubUsers = onSnapshot(
          collection(db, 'users'),
          (snapshot) => {
            if (!snapshot.empty) {
              const rawRemoteUsers: User[] = [];
              snapshot.forEach((docSnap) => {
                const data = docSnap.data() as Partial<User>;
                if (data) {
                  const sanitizedUser: User = {
                    id: docSnap.id || data.id || `user-${Date.now()}`,
                    name: data.name || (data.email ? data.email.split('@')[0] : 'Colaborador'),
                    username: (data.username || (data.email ? data.email.split('@')[0] : `user_${docSnap.id.slice(0, 6)}`)).toLowerCase(),
                    email: data.email || '',
                    isEmailVerified: Boolean(data.isEmailVerified),
                    role: data.role || 'ATENDENTE',
                    status: data.status || 'ATIVO',
                    allowedModules: Array.isArray(data.allowedModules) ? data.allowedModules : [],
                    phone: data.phone || '',
                    lastLoginAt: data.lastLoginAt,
                    createdAt: data.createdAt || new Date().toISOString(),
                    authProvider: data.authProvider,
                    firebaseUid: data.firebaseUid || (docSnap.id && !docSnap.id.startsWith('user-') && !docSnap.id.startsWith('usr-') ? docSnap.id : undefined),
                  };
                  rawRemoteUsers.push(sanitizedUser);
                }
              });

              // Deduplicate remote users preferring real Firebase UID documents over legacy placeholder IDs
              const dedupedRemote: User[] = [];
              const findMatchIdx = (candidate: User) => {
                const cUser = (candidate.username || '').trim().toLowerCase();
                const cEmail = (candidate.email || '').trim().toLowerCase();
                return dedupedRemote.findIndex((existing) => {
                  if (existing.id === candidate.id) return true;
                  const eEmail = (existing.email || '').trim().toLowerCase();
                  if (cEmail && eEmail && cEmail === eEmail) return true;
                  const eUser = (existing.username || '').trim().toLowerCase();
                  if (cUser && eUser && cUser === eUser) return true;
                  return false;
                });
              };
              const isRealUid = (id: string) => Boolean(id && !id.startsWith('user-') && !id.startsWith('usr-'));

              for (const ru of rawRemoteUsers) {
                const idx = findMatchIdx(ru);
                if (idx === -1) {
                  dedupedRemote.push(ru);
                } else {
                  const existing = dedupedRemote[idx];
                  if (isRealUid(ru.id) && !isRealUid(existing.id)) {
                    dedupedRemote[idx] = ru;
                  }
                }
              }

              const localUsers = this.getUsers();
              const merged = [...dedupedRemote];
              for (const lu of localUsers) {
                const luUser = (lu.username || '').trim().toLowerCase();
                const luEmail = (lu.email || '').trim().toLowerCase();
                const alreadyInMerged = merged.some((ru) => {
                  if (ru.id && lu.id && ru.id === lu.id) return true;
                  const ruUser = (ru.username || '').trim().toLowerCase();
                  if (ruUser && luUser && ruUser === luUser) return true;
                  const ruEmail = (ru.email || '').trim().toLowerCase();
                  if (ruEmail && luEmail && ruEmail === luEmail) return true;
                  return false;
                });
                if (!alreadyInMerged) {
                  merged.push(lu);
                }
              }

              localStorage.setItem('gf_users', JSON.stringify(merged));
              this.notify('USERS_UPDATED', { count: merged.length });
            }
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Users listener notice:', error.message);
          }
        );
        this.staffUnsubscribers.push(unsubUsers);
      }

      // 4. Synchronize Confidential Menu Costs in Real Time (Restricted to Manager / Admin)
      if (canManageMenu) {
        const unsubCosts = onSnapshot(
          collection(db, 'menu_item_costs'),
          (snapshot) => {
            if (!snapshot.empty) {
              const costsMap = new Map<string, number>();
              snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                if (typeof data.costPrice === 'number') {
                  costsMap.set(docSnap.id, data.costPrice);
                }
              });

              const items = this.getMenuItems();
              let updated = false;
              for (const item of items) {
                if (costsMap.has(item.id) && item.costPrice !== costsMap.get(item.id)) {
                  item.costPrice = costsMap.get(item.id);
                  updated = true;
                }
              }

              if (updated) {
                localStorage.setItem('gf_menu_items', JSON.stringify(items));
                this.notify('MENU_UPDATED', {});
              }
            }
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Confidential cost listener notice:', error.message);
          }
        );
        this.staffUnsubscribers.push(unsubCosts);

        // 5. Synchronize Daily Menu Config in Real Time (Staff / Admin)
        const unsubDailyMenu = onSnapshot(
          doc(db, 'configs', 'daily_menu'),
          (docSnap) => {
            if (docSnap.exists()) {
              const remote = docSnap.data() as DailyMenuConfig;
              if (remote && typeof remote.enabled === 'boolean') {
                const local = this.getDailyMenuConfig();
                const changed =
                  local.enabled !== remote.enabled ||
                  local.publishedAt !== remote.publishedAt ||
                  (local.selectedItemIds?.length !== remote.selectedItemIds?.length) ||
                  (local.selectedComboIds?.length !== remote.selectedComboIds?.length);
                if (changed) {
                  localStorage.setItem('gf_daily_menu', JSON.stringify(remote));
                  this.notify('DAILY_MENU_UPDATED', remote);
                }
              }
            }
          },
          (error) => {
            console.warn('[Firestore Staff Sync] Daily menu notice:', error.message);
          }
        );
        this.staffUnsubscribers.push(unsubDailyMenu);
      }

    } catch (err) {
      console.warn('[Firestore Staff Sync Setup Error]:', err);
    }
  }

  /**
   * Seeds initial menu items and restaurant config to Cloud Firestore
   * if the collections are currently empty on the cloud database.
   * Strips costPrice from public menu_items and isolates it in menu_item_costs.
   */
  public async ensureInitialDataSeededToFirestore(): Promise<void> {
    if (!db || !this.isFirebaseAuthStaff()) return;

    try {
      const menuSnap = await getDocs(collection(db, 'menu_items'));
      if (menuSnap.empty) {
        console.info('[Firestore] Populando cardápio inicial no Cloud Firestore (amandita-sabores)...');
        const items = this.getMenuItems();
        for (const item of items) {
          const { costPrice, ...publicItem } = item;
          await setDoc(doc(db, 'menu_items', item.id), this.cleanForFirestore(publicItem));
          if (costPrice !== undefined) {
            await setDoc(doc(db, 'menu_item_costs', item.id), {
              id: item.id,
              costPrice,
              updatedAt: new Date().toISOString()
            }, { merge: true }).catch(() => {});
          }
        }
      } else {
        // Coleção já existe: migra com segurança e limpa qualquer 'costPrice' residual
        await this.migrateAndCleanseLegacyMenuItemCosts();
      }

      const configRef = doc(db, 'configs', 'restaurant');
      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        const config = this.getRestaurantConfig();
        const resolvedPixKeyType = config.pixKeyType || inferPixKeyType(config.pixKey || '');
        const publicPayload = {
          name: config.name,
          phone: config.phone,
          whatsapp: config.whatsapp,
          address: config.address,
          city: config.city,
          pixKey: config.pixKey,
          ...(resolvedPixKeyType ? { pixKeyType: resolvedPixKeyType } : {}),
          pixReceiverName: config.pixReceiverName || config.name,
          pixReceiverCity: config.pixReceiverCity || 'CAMPINA GRANDE',
          deliveryFeeBase: config.deliveryFeeBase ?? 5.0,
          avgPrepTimeMinutes: config.avgPrepTimeMinutes ?? 15,
          avgDeliveryTimeMinutes: config.avgDeliveryTimeMinutes ?? 25,
          isOpen: Boolean(config.isOpen),
          ...(config.customPublicUrl ? { customPublicUrl: config.customPublicUrl } : {}),
          updatedAt: new Date().toISOString()
        };
        await setDoc(configRef, publicPayload);
      }
    } catch (err) {
      console.warn('[Firestore Initial Seeding Notice]:', err);
    }
  }

  /**
   * Safe migration to sanitize legacy /menu_items in Cloud Firestore:
   * Finds any documents that still contain `costPrice`, transfers their cost
   * to /menu_item_costs/{itemId} and rewrites /menu_items/{itemId} without costPrice.
   * Completely preserves all prices, products, addons, descriptions and images.
   */
  public async migrateAndCleanseLegacyMenuItemCosts(): Promise<{
    inspected: number;
    costsPreserved: number;
    sanitized: number;
    errors: number;
  }> {
    if (!db) {
      return { inspected: 0, costsPreserved: 0, sanitized: 0, errors: 0 };
    }

    let inspected = 0;
    let costsPreserved = 0;
    let sanitized = 0;
    let errors = 0;

    try {
      const snapshot = await getDocs(collection(db, 'menu_items'));
      inspected = snapshot.size;

      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        if (data && 'costPrice' in data && data.costPrice !== undefined) {
          try {
            const costVal = Number(data.costPrice);
            // 1. Grava na coleção confidencial protegida /menu_item_costs
            if (!Number.isNaN(costVal)) {
              await setDoc(doc(db, 'menu_item_costs', docSnap.id), {
                id: docSnap.id,
                costPrice: costVal,
                updatedAt: new Date().toISOString()
              }, { merge: true });
              costsPreserved++;
            }

            // 2. Remove o campo costPrice do documento público /menu_items
            const cleanedData = { ...data };
            delete cleanedData.costPrice;
            await setDoc(doc(db, 'menu_items', docSnap.id), this.cleanForFirestore(cleanedData));
            sanitized++;
          } catch (err) {
            console.warn(`[Menu Cost Migration] Falha no item ${docSnap.id}:`, err);
            errors++;
          }
        }
      }

      if (sanitized > 0) {
        console.info(`[Menu Cost Migration] ${sanitized} itens de cardápio tiveram seus custos isolados em /menu_item_costs.`);
      }
    } catch (err) {
      console.warn('[Menu Cost Migration] Erro ao inspecionar menu_items:', err);
    }

    return { inspected, costsPreserved, sanitized, errors };
  }

  public reconcileRemoteOrders(
    remoteOrders: Order[],
    options: { authoritative: boolean }
  ): { count: number; updated: number; removed: number } {
    const deletedIds = this.getDeletedOrderIds();
    const syncedIds = this.getSyncedOrderIds();

    // Discard remote orders that were deleted locally (tombstones) and trigger remote cleanup if needed
    const activeRemoteOrders: Order[] = [];
    for (const ro of remoteOrders) {
      if (deletedIds.has(ro.id)) {
        if (db) {
          deleteDoc(doc(db, 'orders', ro.id)).catch(() => {});
          if (ro.trackingCode) {
            deleteDoc(doc(db, 'public_tracking', ro.trackingCode)).catch(() => {});
          }
        }
      } else {
        activeRemoteOrders.push(ro);
      }
    }

    activeRemoteOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    this.recordSyncedOrderIds(activeRemoteOrders.map((o) => o.id));

    const localOrders = this.getOrders().filter((lo) => !deletedIds.has(lo.id));
    const localIds = new Set(localOrders.map((o) => o.id));
    const newIncoming = activeRemoteOrders.filter((ro) => !localIds.has(ro.id) && ro.status === 'NOVO');

    if (newIncoming.length > 0) {
      newIncoming.forEach((o) => this.recordUnseenCustomerOrder(o.id));
      const activeUser = this.getCurrentUser();
      if (activeUser && this.isOrderPrepStaffRole(activeUser.role)) {
        soundService.startPersistentOrderAlert(3500);
      }

      try {
        const printerCfg = thermalPrinterService.getConfig();
        if (printerCfg.enabled && printerCfg.autoPrintPickup) {
          newIncoming.forEach((o) => {
            if (o.fulfillmentType === 'RETIRADA' && !thermalPrinterService.hasOrderBeenPrinted(o.id)) {
              thermalPrinterService.printOrder(o).catch((err) => {
                console.info('[Impressora Térmica 58mm] Aviso ao auto-imprimir pedido:', err);
              });
            }
          });
        }
      } catch {
        // Non-blocking
      }
    }

    const newlyReadyDeliveries = activeRemoteOrders.filter((ro) => {
      if (ro.status !== 'PRONTO' || ro.fulfillmentType !== 'DELIVERY') return false;
      const prev = localOrders.find((lo) => lo.id === ro.id);
      return !prev || prev.status !== 'PRONTO';
    });

    if (newlyReadyDeliveries.length > 0) {
      newlyReadyDeliveries.forEach((o) => this.recordDriverReadyOrder(o.id));
      const activeUser = this.getCurrentUser();
      const relevantReady = newlyReadyDeliveries.find((o) => this.isDriverAssignedToOrder(o, activeUser));
      if (activeUser && relevantReady) {
        soundService.startDriverReadyAlert(3500, 4, relevantReady.id);
      }
      this.notify('DRIVER_ORDER_READY', newlyReadyDeliveries);
    }

    const pendingOrders = this.getPendingSyncOrders();
    const pendingIds = new Set(pendingOrders.map((o) => o.id));
    const remoteMap = new Map(activeRemoteOrders.map((o) => [o.id, o]));

    const STATUS_PRECEDENCE: Record<string, number> = {
      NOVO: 1,
      EM_PREPARO: 2,
      PRONTO: 3,
      EM_ROTA: 4,
      ENTREGUE: 5,
      CANCELADO: 6,
    };

    const merged: Order[] = [];
    let updatedCount = 0;
    let removedCount = 0;

    for (const lo of localOrders) {
      const ro = remoteMap.get(lo.id);
      if (!ro) {
        // Missing in Firestore: if this snapshot is authoritative from server AND either
        // the order was previously synced OR is not an unuploaded offline creation, it was deleted remotely.
        const isUnuploadedOfflineCreation = pendingIds.has(lo.id) && !syncedIds.has(lo.id);
        if (options.authoritative && !isUnuploadedOfflineCreation) {
          this.recordDeletedOrderId(lo.id);
          this.removeOrderFromSyncQueue(lo.id);
          this.removeSyncedOrderId(lo.id);
          removedCount++;
        } else {
          merged.push(lo);
        }
      } else {
        remoteMap.delete(lo.id);

        const roRank = STATUS_PRECEDENCE[ro.status] || 0;
        const loRank = STATUS_PRECEDENCE[lo.status] || 0;
        const roTime = ro.updatedAt ? new Date(ro.updatedAt).getTime() : 0;
        const loTime = lo.updatedAt ? new Date(lo.updatedAt).getTime() : 0;
        const roMovesCount = ro.movements?.length || 0;
        const loMovesCount = lo.movements?.length || 0;

        const isLocalPendingAhead =
          pendingIds.has(lo.id) &&
          (loRank > roRank || (loRank === roRank && loTime > roTime));

        if (isLocalPendingAhead) {
          merged.push(lo);
        } else {
          if (
            ro.status !== lo.status ||
            ro.updatedAt !== lo.updatedAt ||
            ro.deliveryPersonId !== lo.deliveryPersonId ||
            ro.paymentStatus !== lo.paymentStatus
          ) {
            updatedCount++;
          }
          this.removeOrderFromSyncQueue(lo.id);
          merged.push({ ...ro, _cloudSyncStatus: 'SYNCED' });
        }
      }
    }

    for (const ro of remoteMap.values()) {
      if (!deletedIds.has(ro.id)) {
        merged.push({ ...ro, _cloudSyncStatus: 'SYNCED' });
        updatedCount++;
      }
    }

    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    try {
      localStorage.setItem('gf_orders', JSON.stringify(merged));
    } catch {}

    return { count: merged.length, updated: updatedCount, removed: removedCount };
  }

  /**
   * Manual order refresh: fetches authoritative orders from Firestore server
   * WITHOUT destroying real-time onSnapshot listeners, preserving unsynced local creations
   * and removing remotely deleted orders.
   */
  public async refreshOrdersFromFirestore(): Promise<{
    success: boolean;
    count: number;
    updated: number;
    removed: number;
    message: string;
    error?: string;
  }> {
    if (!db) {
      const msg = 'Cloud Firestore não configurado neste ambiente.';
      return { success: false, count: this.getOrders().length, updated: 0, removed: 0, message: msg, error: msg };
    }

    try {
      if (!auth?.currentUser) {
        await this.ensureFirebaseAuthForStaff();
      }

      await this.syncTombstonesFromServer();
      await this.flushPendingSyncQueue();

      const snapshot = await getDocsFromServer(collection(db, 'orders'));
      const remoteOrders: Order[] = [];
      snapshot.forEach((docSnap) => {
        remoteOrders.push(docSnap.data() as Order);
      });

      const summary = this.reconcileRemoteOrders(remoteOrders, { authoritative: true });
      this.cloudSyncState = {
        status: 'CONNECTED',
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      };

      // Restart real-time listener in background ONLY if it was stopped due to prior error
      if (!this.isStaffSyncActive) {
        this.initStaffFirestoreSync().catch(() => {});
      }

      this.notify('FIRESTORE_ORDERS_SYNCED', { count: summary.count, manualRefresh: true });
      this.notify('ORDERS_UPDATED', { count: summary.count, manualRefresh: true });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'MANUAL_ORDERS_REFRESH' } }));
      }

      return {
        success: true,
        count: summary.count,
        updated: summary.updated,
        removed: summary.removed,
        message:
          summary.updated > 0 || summary.removed > 0
            ? `Pedidos atualizados do servidor (${summary.updated} atualizado(s), ${summary.removed} removido(s)).`
            : `Pedidos sincronizados com o servidor (${summary.count} registro(s)).`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.cloudSyncState = {
        status: 'ERROR',
        lastSyncedAt: this.cloudSyncState.lastSyncedAt,
        lastError: msg,
      };
      return {
        success: false,
        count: this.getOrders().length,
        updated: 0,
        removed: 0,
        message: `Falha ao atualizar pedidos do servidor: ${msg}`,
        error: msg,
      };
    }
  }

  private applyFirestoreCashShiftSnapshot(
    shifts: CashRegisterShift[],
    options: { fromCache: boolean; isFullCollection: boolean; skipServerReconcileOnCache?: boolean }
  ): void {
    const openShifts = shifts
      .filter((s) => s && s.status === 'ABERTO')
      .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());

    if (options.isFullCollection) {
      const closedShifts = shifts
        .filter((s) => s && s.status === 'FECHADO')
        .sort((a, b) => new Date(b.closedAt || b.openedAt).getTime() - new Date(a.closedAt || a.openedAt).getTime());
      if (closedShifts.length > 0) {
        try {
          localStorage.setItem('gf_cash_shifts_history', JSON.stringify(closedShifts));
        } catch {}
      }
    }

    if (options.fromCache) {
      // Cached IndexedDB data is NOT authoritative server confirmation.
      if (this.cashShiftSyncState.status !== 'CONFIRMED') {
        this.cashShiftSyncState = {
          status: 'SYNCING',
          confirmedAt: null,
          source: 'none',
          error: null,
        };
        this.notify('CASH_SHIFT_SYNC_STATE', this.getCashShiftSyncState());
      }
      if (!options.skipServerReconcileOnCache) {
        this.reconcileCashShiftWithServerOnSync(options.isFullCollection).catch(() => {});
      }
      return;
    }

    if (options.isFullCollection) {
      if (openShifts.length > 1) {
        console.warn(`[Firestore Staff Sync] ALERTA: Existem ${openShifts.length} turnos de caixa ABERTO simultaneamente.`);
        try {
          localStorage.setItem('gf_multiple_open_shifts_count', String(openShifts.length));
        } catch {}
      } else {
        try {
          localStorage.removeItem('gf_multiple_open_shifts_count');
        } catch {}
      }
    }

    const openShift = openShifts[0] || null;
    try {
      if (openShift) {
        localStorage.setItem('gf_current_cash_shift', JSON.stringify(openShift));
      } else {
        localStorage.setItem('gf_current_cash_shift', 'null');
      }
    } catch {}

    this.cashShiftSyncState = {
      status: 'CONFIRMED',
      confirmedAt: new Date().toISOString(),
      source: 'firestore_snapshot',
      error: null,
    };
    this.notify('CASH_SHIFT_UPDATED', openShift);
  }

  private async reconcileCashShiftWithServerOnSync(canAccessCash: boolean): Promise<boolean> {
    if (this.cashShiftSyncPromise) {
      return this.cashShiftSyncPromise;
    }

    const run = async (): Promise<boolean> => {
      if (db && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        try {
          const snap = canAccessCash
            ? await getDocsFromServer(collection(db, 'cash_shifts'))
            : await getDocsFromServer(query(collection(db, 'cash_shifts'), where('status', '==', 'ABERTO')));
          const shifts: CashRegisterShift[] = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as CashRegisterShift;
            if (data) shifts.push(data);
          });
          this.applyFirestoreCashShiftSnapshot(shifts, {
            fromCache: false,
            isFullCollection: canAccessCash,
          });
          return true;
        } catch (err) {
          console.warn('[Cash Sync] Falha na consulta direta ao servidor Firestore:', err);
        }
      }

      if (typeof fetch === 'function' && typeof window !== 'undefined') {
        try {
          const avail = await this.fetchPublicStoreAvailability({ timeoutMs: 5000 });
          if (avail.verified) {
            if (!avail.isOpen || !avail.activeShiftId) {
              try {
                localStorage.setItem('gf_current_cash_shift', 'null');
              } catch {}
              this.cashShiftSyncState = {
                status: 'CONFIRMED',
                confirmedAt: new Date().toISOString(),
                source: 'server_api',
                error: null,
              };
              this.notify('CASH_SHIFT_UPDATED', null);
              return true;
            }
            if (canAccessCash) {
              const authHeaders = await this.getFirebaseAuthHeaders();
              const state = await this.consultCashShiftState(avail.activeShiftId, authHeaders);
              if (state.verified && state.exists && state.shift?.status === 'ABERTO') {
                this.commitOpenShiftLocally(state.shift);
                return true;
              }
            }
          }
        } catch {
          // ignore and mark error below
        }
      }

      if (this.cashShiftSyncState.status !== 'CONFIRMED') {
        this.cashShiftSyncState = {
          status: 'ERROR',
          confirmedAt: null,
          source: 'none',
          error: 'Não foi possível confirmar o estado do caixa com o servidor.',
        };
        this.notify('CASH_SHIFT_UPDATED', null);
      }
      return false;
    };

    this.cashShiftSyncPromise = run().finally(() => {
      this.cashShiftSyncPromise = null;
    });
    return this.cashShiftSyncPromise;
  }

  private async ensureCashShiftReadyForServerSale(
    explicitShiftId?: string
  ): Promise<{ ok: true; shiftId?: string } | { ok: false; error: string }> {
    if (!this.isCloudCashConfirmationRequired()) {
      const current = this.getCurrentCashShift();
      return { ok: true, shiftId: explicitShiftId || current?.id };
    }

    if (this.cashShiftSyncState.status !== 'CONFIRMED') {
      await this.reconcileCashShiftWithServerOnSync(this.canUserManageCash());
    }

    if (this.cashShiftSyncState.status !== 'CONFIRMED') {
      return {
        ok: false,
        error:
          this.cashShiftSyncState.error ||
          'Sincronização do caixa com o servidor pendente ou indisponível. Aguarde a confirmação do caixa antes de finalizar a venda.',
      };
    }

    if (explicitShiftId) {
      return { ok: true, shiftId: explicitShiftId };
    }

    const confirmedShift = this.getCurrentCashShift();
    if (!confirmedShift || confirmedShift.status !== 'ABERTO') {
      return {
        ok: false,
        error:
          'Nenhum turno de caixa ABERTO confirmado pelo servidor. Abra o caixa antes de registrar ou confirmar vendas pagas.',
      };
    }

    return { ok: true, shiftId: confirmedShift.id };
  }

  public stopStaffFirestoreSync(): void {
    if (this.staffSyncRetryTimer) {
      clearTimeout(this.staffSyncRetryTimer);
      this.staffSyncRetryTimer = null;
    }
    this.staffUnsubscribers.forEach((unsub) => unsub());
    this.staffUnsubscribers = [];
    this.isStaffSyncActive = false;
    this.cashShiftSyncPromise = null;
    if (this.isCloudCashConfirmationRequired()) {
      this.cashShiftSyncState = {
        status: 'IDLE',
        confirmedAt: null,
        source: 'none',
        error: null,
      };
    }
  }

  public async refreshStaffSync(): Promise<void> {
    if (!db) return;
    this.stopStaffFirestoreSync();
    await this.initStaffFirestoreSync();
  }

  public stopFirestoreSync(): void {
    this.teardownPublicListenersOnly();
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

      // 1. Migrate Restaurant Config (Public data only)
      const config = this.getRestaurantConfig();
      const configRef = doc(db, 'configs', 'restaurant');
      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        const resolvedPixKeyType = config.pixKeyType || inferPixKeyType(config.pixKey || '');
        const publicPayload = {
          name: config.name,
          phone: config.phone,
          whatsapp: config.whatsapp,
          address: config.address,
          city: config.city,
          pixKey: config.pixKey,
          ...(resolvedPixKeyType ? { pixKeyType: resolvedPixKeyType } : {}),
          pixReceiverName: config.pixReceiverName || config.name,
          pixReceiverCity: config.pixReceiverCity || 'CAMPINA GRANDE',
          deliveryFeeBase: config.deliveryFeeBase ?? 5.0,
          avgPrepTimeMinutes: config.avgPrepTimeMinutes ?? 15,
          avgDeliveryTimeMinutes: config.avgDeliveryTimeMinutes ?? 25,
          isOpen: Boolean(config.isOpen),
          ...(config.customPublicUrl ? { customPublicUrl: config.customPublicUrl } : {}),
          updatedAt: new Date().toISOString()
        };
        await setDoc(configRef, publicPayload);
        configCount++;
      } else {
        skippedCount++;
      }

      // 2. Migrate Menu Items with deduplication and costPrice protection
      const menuItems = this.getMenuItems();
      for (const item of menuItems) {
        const itemRef = doc(db, 'menu_items', item.id);
        const itemSnap = await getDoc(itemRef);
        if (!itemSnap.exists()) {
          const { costPrice, ...publicItem } = item;
          await setDoc(itemRef, this.cleanForFirestore(publicItem));
          if (costPrice !== undefined) {
            await setDoc(doc(db, 'menu_item_costs', item.id), {
              id: item.id,
              costPrice,
              updatedAt: new Date().toISOString()
            }, { merge: true }).catch(() => {});
          }
          menuCount++;
        } else {
          skippedCount++;
        }
      }
      // Migrate and cleanse any legacy items on Firestore
      await this.migrateAndCleanseLegacyMenuItemCosts();

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
      const itemMap = new Map<string, MenuItem>();

      // 1. Seed with full official catalog (72 items from INITIAL_MENU)
      for (const item of INITIAL_MENU) {
        itemMap.set(item.id, {
          ...item,
          available: item.available !== false,
          addons: item.addons || OFFICIAL_ADDONS,
        });
      }

      // 2. Overlay any locally saved or updated items
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && item.id) {
                const base = itemMap.get(item.id);
                itemMap.set(item.id, {
                  ...(base || {}),
                  ...item,
                  available: item.available !== false,
                  addons: item.addons || base?.addons || OFFICIAL_ADDONS,
                });
              }
            }
          }
        } catch {
          // fallback
        }
      }

      const mergedList = Array.from(itemMap.values());
      return mergedList;
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
      const { costPrice, ...publicItem } = item;
      setDoc(doc(db, 'menu_items', item.id), this.cleanForFirestore(publicItem)).catch((err) => {
        handleFirestoreError(err, OperationType.WRITE, `menu_items/${item.id}`);
      });
      if (this.canUserManageMenu() && costPrice !== undefined) {
        setDoc(doc(db, 'menu_item_costs', item.id), {
          id: item.id,
          costPrice,
          updatedAt: new Date().toISOString()
        }).catch(() => {});
      }
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
      deleteDoc(doc(db, 'menu_item_costs', id)).catch(() => {});
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

  private buildSanitizedOrderObject(
    orderInput: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'movements' | 'status'> & {
      id?: string;
      orderNumber?: string;
      trackingCode?: string;
      status?: OrderStatus;
      pixDescription?: string;
    }
  ): Order {
    const orders = this.getOrders();
    const maxOrderNum = orders.reduce((max, o) => {
      const parsed = parseInt((o.orderNumber || '').replace(/\D/g, ''), 10);
      return Number.isFinite(parsed) && parsed > max ? parsed : max;
    }, 1000);
    const nextNumber = maxOrderNum + 1;
    const now = new Date().toISOString();
    const orderId =
      orderInput.id && /^[a-zA-Z0-9_\-]+$/.test(orderInput.id)
        ? orderInput.id
        : `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const resolvedOrderNumber =
      orderInput.orderNumber && /^#\d+$/.test(orderInput.orderNumber.trim())
        ? orderInput.orderNumber.trim()
        : `#${nextNumber}`;

    const { pixDescription, id: _ignoredId, orderNumber: _ignoredNum, trackingCode: _ignoredTk, ...cleanOrderInput } = orderInput;
    const isRetirada = cleanOrderInput.fulfillmentType === 'RETIRADA';
    const roundedItems = (cleanOrderInput.items || []).map((it) => ({
      ...it,
      unitPrice: roundCurrency(it.unitPrice),
      subtotal: roundCurrency(it.subtotal),
    }));
    const roundedSubtotal = roundCurrency(cleanOrderInput.subtotal);
    const effectiveDeliveryFee = isRetirada ? 0 : roundCurrency(cleanOrderInput.deliveryFee);
    const effectiveDiscount = roundCurrency(cleanOrderInput.discount || 0);
    const effectiveTotal = Math.max(0, roundCurrency(roundedSubtotal + effectiveDeliveryFee - effectiveDiscount));

    // Cryptographic unguessable high-entropy tracking code (protects customer privacy against ID guessing)
    const trackingCode =
      orderInput.trackingCode && /^[a-zA-Z0-9_\-]+$/.test(orderInput.trackingCode) && orderInput.trackingCode.length >= 20
        ? orderInput.trackingCode
        : typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : `tk_${Date.now()}_${Math.random().toString(36).substring(2, 12)}_${Math.random().toString(36).substring(2, 8)}`;

    const cfg = this.getRestaurantConfig();
    let assignedDriver: { id: string; name: string; phone: string } | undefined = undefined;
    let initialAssignmentHistory: any[] | undefined = undefined;

    const activeStaffCaller = this.getCurrentUser();
    const isStaffOrderCreator = Boolean(
      activeStaffCaller &&
        this.isAuthorizedStaffRole(activeStaffCaller.role) &&
        !this.isPublicCustomerContext()
    );

    if (!isRetirada && isStaffOrderCreator) {
      const activeDrivers = this.getActiveDeliveryDrivers();
      if (activeDrivers.length === 1) {
        const soleDriver = activeDrivers[0];
        const dName = soleDriver.name || soleDriver.username;
        assignedDriver = {
          id: soleDriver.id,
          name: dName,
          phone: soleDriver.phone || '',
        };
        initialAssignmentHistory = [
          {
            assignedAt: now,
            newDriverId: soleDriver.id,
            newDriverName: dName,
            assignedBy: 'Sistema (Atribuição Automática - Único Entregador Ativo)',
            reason: 'Atribuição automática: 1 entregador ativo no estabelecimento',
          }
        ];
      } else if (cfg.defaultDeliveryPersonId && activeDrivers.length > 1) {
        const driver = activeDrivers.find((u) => u.id === cfg.defaultDeliveryPersonId);
        if (driver) {
          const dName = driver.name || driver.username;
          assignedDriver = {
            id: driver.id,
            name: dName,
            phone: driver.phone || '',
          };
          initialAssignmentHistory = [
            {
              assignedAt: now,
              newDriverId: driver.id,
              newDriverName: dName,
              assignedBy: 'Atribuição Padrão (Configurações)',
            }
          ];
        }
      }
    }

    const newOrder: Order = {
      ...cleanOrderInput,
      items: roundedItems,
      id: orderId,
      orderNumber: resolvedOrderNumber,
      createdAt: now,
      updatedAt: now,
      subtotal: roundedSubtotal,
      deliveryFee: effectiveDeliveryFee,
      discount: effectiveDiscount,
      totalAmount: effectiveTotal,
      status: cleanOrderInput.status || 'NOVO',
      deliveryPersonId: assignedDriver?.id,
      deliveryPersonName: assignedDriver?.name,
      deliveryPerson: assignedDriver,
      deliveryAssignmentHistory: initialAssignmentHistory,
      trackingCode,
      _cloudSyncStatus: 'PENDING',
      movements: [
        {
          id: `mov-${Date.now()}`,
          timestamp: now,
          toStatus: cleanOrderInput.status || 'NOVO',
          author: cleanOrderInput.createdBy || (isRetirada ? 'Balcão' : 'Cliente via Cardápio Web'),
          notes: isRetirada 
            ? 'Pedido para retirada no balcão' 
            : (assignedDriver ? `Pedido delivery atribuído a ${assignedDriver.name}` : 'Pedido delivery aguardando atribuição de entregador'),
        }
      ]
    };

    if (newOrder.paymentMethod === 'PIX') {
      const officialPixState = this.getOfficialPixConfigState();
      if (!officialPixState.hasValidPixKey) {
        delete newOrder.pixCode;
        delete newOrder.pixTxId;
      } else {
        const effectiveKeyType = cfg.pixKeyType || inferPixKeyType(cfg.pixKey || '');
        let reusedValidPreview = false;
        if (cleanOrderInput.pixCode && cleanOrderInput.pixTxId && cfg.pixKey) {
          const previewAudit = validatePixPayload(cleanOrderInput.pixCode);
          const keyCheck = effectiveKeyType ? validatePixKey(cfg.pixKey, effectiveKeyType) : null;
          const expectedNormalizedKey = keyCheck?.valid ? keyCheck.normalized : undefined;
          const previewAmount = roundCurrency(parseFloat(previewAudit.amount || '0'));
          if (
            previewAudit.valid &&
            previewAudit.txId === cleanOrderInput.pixTxId &&
            (!expectedNormalizedKey || previewAudit.pixKey === expectedNormalizedKey) &&
            previewAmount === effectiveTotal
          ) {
            newOrder.pixCode = cleanOrderInput.pixCode;
            newOrder.pixTxId = cleanOrderInput.pixTxId;
            reusedValidPreview = true;
          }
        }

        if (!reusedValidPreview) {
          const txId = cleanOrderInput.pixTxId || generateOrderPixTxId(newOrder.orderNumber, newOrder.id);
          const pixResult = generatePurchasePixPayload({
            pixKey: cfg.pixKey,
            keyType: effectiveKeyType,
            receiverName: cfg.pixReceiverName,
            receiverCity: cfg.pixReceiverCity,
            storeName: cfg.name,
            amount: newOrder.totalAmount,
            txId,
            orderNumber: newOrder.orderNumber,
            orderId: newOrder.id,
            description: pixDescription || `Pedido ${newOrder.orderNumber}`,
          });
          if (pixResult.success) {
            newOrder.pixCode = pixResult.payload;
            newOrder.pixTxId = pixResult.txId;
          } else {
            delete newOrder.pixCode;
            delete newOrder.pixTxId;
          }
        }
      }
    }

    return newOrder;
  }

  private commitConfirmedServerOrderAndShift(confirmedOrder: Order, confirmedShift?: CashRegisterShift | null): Order {
    const syncedOrder: Order = { ...confirmedOrder, _cloudSyncStatus: 'SYNCED' };
    const orders = this.getOrders();
    const idx = orders.findIndex((o) => o.id === syncedOrder.id);
    if (idx >= 0) {
      orders[idx] = syncedOrder;
    } else {
      orders.unshift(syncedOrder);
    }
    try {
      localStorage.setItem('gf_orders', JSON.stringify(orders));
    } catch {}

    if (syncedOrder.trackingCode) {
      this.saveClientTrackingCode(syncedOrder.id, syncedOrder.trackingCode);
    }
    this.removeOrderFromSyncQueue(syncedOrder.id);
    this.recordSyncedOrderId(syncedOrder.id);

    if (confirmedShift) {
      try {
        localStorage.setItem('gf_current_cash_shift', JSON.stringify(confirmedShift));
      } catch {}
      this.cashShiftSyncState = {
        status: 'CONFIRMED',
        confirmedAt: new Date().toISOString(),
        source: 'server_api',
        error: null,
      };
      this.notify('CASH_SHIFT_UPDATED', confirmedShift);
    }

    return syncedOrder;
  }

  public createOrder(
    orderInput: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'movements' | 'status'> & {
      id?: string;
      status?: OrderStatus;
      pixDescription?: string;
    },
    autoPersist = true
  ): Order {
    const orders = this.getOrders();
    const newOrder = this.buildSanitizedOrderObject(orderInput);

    // Save tracking code in client browser session so creator can always track their order
    if (newOrder.trackingCode) {
      this.saveClientTrackingCode(newOrder.id, newOrder.trackingCode);
    }

    const updated = [newOrder, ...orders];
    localStorage.setItem('gf_orders', JSON.stringify(updated));

    const activeStaffUser = this.getCurrentUser();
    const isStaffSession = Boolean(activeStaffUser && this.isAuthorizedStaffRole(activeStaffUser.role));
    const isPrepStaffSession = Boolean(activeStaffUser && this.isOrderPrepStaffRole(activeStaffUser.role));

    // CRITICAL: Public customer sessions & delivery drivers must NEVER play kitchen/cashier new order alarms!
    if (!this.isPublicCustomerContext() && isPrepStaffSession) {
      soundService.playNewOrderAlert();
    }

    this.notify('ORDER_CREATED', newOrder);

    // Auto-print on 58mm thermal printer if order is RETIRADA and auto-print is enabled
    try {
      const isPdvOrStaffContext = isStaffSession || newOrder.status === 'EM_PREPARO' || (newOrder.movements[0]?.author && !newOrder.movements[0]?.author.includes('Cardápio Web'));
      const printerCfg = thermalPrinterService.getConfig();
      if (!isPdvOrStaffContext && printerCfg.enabled && printerCfg.autoPrintPickup && newOrder.fulfillmentType === 'RETIRADA' && !thermalPrinterService.hasOrderBeenPrinted(newOrder.id)) {
        thermalPrinterService.printOrder(newOrder).catch(() => {});
      }
    } catch {
      // Non-blocking
    }

    // Queue for cloud sync and attempt immediate transmission to Cloud Firestore if autoPersist is true
    this.queueOrderForSync(newOrder);
    if (autoPersist) {
      this.persistOrderToFirestore(newOrder).catch(() => {});
      this.dispatchOrderPushNotification(newOrder, 'NEW_ORDER');
    }

    return newOrder;
  }

  public async createOrderAsync(
    orderInput: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'movements' | 'status'> & {
      id?: string;
      orderNumber?: string;
      trackingCode?: string;
      status?: OrderStatus;
      pixDescription?: string;
    },
    options?: { requireServerConfirmation?: boolean; publicMenuOrder?: boolean; timeoutMs?: number }
  ): Promise<{ order: Order; synced: boolean; isStoreClosed?: boolean; rejected?: boolean; recoveredFromTimeout?: boolean; error?: string }> {
    const isPublicOrder = Boolean(options?.publicMenuOrder || this.isPublicCustomerContext());
    if (options?.requireServerConfirmation || isPublicOrder) {
      const draft = this.buildSanitizedOrderObject(orderInput);
      const res = await this.persistOrderToFirestore(draft, {
        requireServerConfirmation: true,
        publicMenuOrder: isPublicOrder,
        timeoutMs: options?.timeoutMs,
      });
      if (!res.success) {
        this.removeOrderFromSyncQueue(draft.id);
        return {
          order: draft,
          synced: false,
          ...(res.rejected ? { rejected: true } : {}),
          ...(res.isStoreClosed ? { isStoreClosed: true } : {}),
          error: res.error || 'Não foi possível confirmar a gravação do pedido no servidor.',
        };
      }
      const committed = this.commitConfirmedServerOrderAndShift(res.serverOrder || draft);
      const activeStaffUser = this.getCurrentUser();
      if (!this.isPublicCustomerContext() && activeStaffUser && this.isOrderPrepStaffRole(activeStaffUser.role)) {
        soundService.playNewOrderAlert();
      }
      this.notify('ORDER_CREATED', committed);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_CREATED', payload: committed } }));
      }
      this.dispatchOrderPushNotification(committed, 'NEW_ORDER');
      return {
        order: committed,
        synced: true,
        ...(res.recoveredFromTimeout ? { recoveredFromTimeout: true } : {}),
      };
    }

    const order = this.createOrder(orderInput, false);
    const res = await this.persistOrderToFirestore(order);
    this.dispatchOrderPushNotification(order, 'NEW_ORDER');
    return {
      order: this.getOrderById(order.id) || order,
      synced: res.success,
      error: res.error,
    };
  }

  public async createAndConfirmPaidOrderAsync(
    orderInput: Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'movements' | 'status'> & {
      id?: string;
      status?: OrderStatus;
      pixDescription?: string;
    },
    author = 'Caixa',
    options?: { shiftId?: string; timeoutMs?: number }
  ): Promise<{
    order: Order | null;
    shift?: CashRegisterShift | null;
    synced: boolean;
    rejected?: boolean;
    uncertain?: boolean;
    recoveredFromTimeout?: boolean;
    alreadyConfirmed?: boolean;
    error?: string;
  }> {
    const currentUser = this.getCurrentUser();
    if (!this.canUserConfirmPayments(currentUser)) {
      return {
        order: null,
        synced: false,
        rejected: true,
        error: `Permissão insuficiente: perfil ${currentUser?.role || 'não autenticado'} não pode confirmar vendas pagas.`,
      };
    }

    const draftOrder = this.buildSanitizedOrderObject({
      ...orderInput,
      paymentStatus: 'PAGO',
    });

    if (roundCurrency(draftOrder.totalAmount) <= 0) {
      return {
        order: null,
        synced: false,
        rejected: true,
        error: 'Valor total da venda deve ser maior que zero.',
      };
    }

    if (!this.shouldUseServerAtomicPayment()) {
      const localShift = this.getCurrentCashShift();
      if (!localShift || localShift.status !== 'ABERTO') {
        return {
          order: null,
          synced: false,
          rejected: true,
          error: 'Nenhum turno de caixa aberto para registrar a venda.',
        };
      }
      const movementId = `cash-sale-${draftOrder.id}`;
      if (!localShift.movements.some((m: CashMovement) => m.orderId === draftOrder.id || m.id === movementId)) {
        localShift.movements.push({
          id: movementId,
          timestamp: new Date().toISOString(),
          type: 'VENDA',
          amount: roundCurrency(draftOrder.totalAmount),
          paymentMethod: draftOrder.paymentMethod,
          description: `Recebimento Pedido ${draftOrder.orderNumber} - ${draftOrder.customer?.name || 'Cliente'}`.slice(0, 300),
          orderId: draftOrder.id,
          orderNumber: draftOrder.orderNumber,
          author,
        });
      }
      localStorage.setItem('gf_current_cash_shift', JSON.stringify(localShift));
      const orders = this.getOrders();
      localStorage.setItem('gf_orders', JSON.stringify([draftOrder, ...orders]));
      if (draftOrder.trackingCode) {
        this.saveClientTrackingCode(draftOrder.id, draftOrder.trackingCode);
      }
      this.notify('ORDER_CREATED', draftOrder);
      this.notify('CASH_SHIFT_UPDATED', localShift);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_CREATED', payload: draftOrder } }));
      }
      return { order: draftOrder, shift: localShift, synced: false };
    }

    if (isFirebaseReady()) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser) {
        return {
          order: null,
          synced: false,
          rejected: true,
          error: 'Sessão Firebase não autenticada. Faça login novamente antes de finalizar a venda.',
        };
      }
    }

    if (typeof fetch !== 'function') {
      return {
        order: null,
        synced: false,
        rejected: true,
        error: 'Cliente HTTP indisponível para confirmar venda atômica no servidor.',
      };
    }

    const shiftCheck = await this.ensureCashShiftReadyForServerSale(options?.shiftId);
    if (!shiftCheck.ok) {
      return {
        order: null,
        synced: false,
        rejected: true,
        error: shiftCheck.error,
      };
    }

    const authHeaders = await this.getFirebaseAuthHeaders();
    const opKey = `pay:${draftOrder.id}`;

    if (this.uncertainServerOps.has(opKey)) {
      const preState = await this.consultOrderPaymentState(draftOrder.id, authHeaders);
      if (
        preState.verified &&
        preState.data?.exists &&
        preState.data?.paymentStatus === 'PAGO' &&
        preState.data?.cashRecorded &&
        preState.data?.order
      ) {
        this.uncertainServerOps.delete(opKey);
        const recovered = this.commitConfirmedServerOrderAndShift(
          preState.data.order as Order,
          (preState.data.shift as CashRegisterShift) || null
        );
        this.notify('ORDER_CREATED', recovered);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_CREATED', payload: recovered } }));
        }
        return {
          order: recovered,
          shift: (preState.data.shift as CashRegisterShift) || this.getCurrentCashShift(),
          synced: true,
          recoveredFromTimeout: true,
        };
      }
      if (preState.verified && (!preState.data?.exists || preState.data?.paymentStatus !== 'PAGO')) {
        this.uncertainServerOps.delete(opKey);
      } else {
        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          return {
            order: null,
            synced: false,
            rejected: true,
            error:
              'Não foi possível confirmar a venda paga: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }
        return {
          order: null,
          synced: false,
          uncertain: true,
          error:
            'Não foi possível verificar o estado anterior desta venda no servidor. A operação não foi repetida automaticamente para evitar duplicidade.',
        };
      }
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const recoverFromPaymentState = async () => {
      const state = await this.consultOrderPaymentState(draftOrder.id, authHeaders);
      if (
        state.verified &&
        state.data?.exists &&
        state.data?.paymentStatus === 'PAGO' &&
        state.data?.cashRecorded &&
        state.data?.order
      ) {
        this.uncertainServerOps.delete(opKey);
        const recovered = this.commitConfirmedServerOrderAndShift(
          state.data.order as Order,
          (state.data.shift as CashRegisterShift) || null
        );
        this.notify('ORDER_CREATED', recovered);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_CREATED', payload: recovered } }));
        }
        return {
          status: 'recovered' as const,
          result: {
            order: recovered,
            shift: (state.data.shift as CashRegisterShift) || this.getCurrentCashShift(),
            synced: true,
            recoveredFromTimeout: true,
          },
        };
      }
      if (state.verified && (!state.data?.exists || state.data?.paymentStatus !== 'PAGO')) {
        this.uncertainServerOps.delete(opKey);
        return { status: 'not_committed' as const };
      }
      return { status: 'unknown' as const };
    };

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(draftOrder.id)}/confirm-payment`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          newOrder: this.cleanForFirestore(draftOrder),
          author,
          shiftId: shiftCheck.shiftId,
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data;

      if (
        parsed.ok &&
        !parsed.isHtml &&
        parsed.isValidJson &&
        data?.success === true &&
        data?.order &&
        data.order.id &&
        data.order.paymentStatus === 'PAGO'
      ) {
        this.uncertainServerOps.delete(opKey);
        const committed = this.commitConfirmedServerOrderAndShift(
          data.order as Order,
          (data.shift as CashRegisterShift) || null
        );
        if (!data.alreadyConfirmed) {
          const activeStaffUser = this.getCurrentUser();
          if (!this.isPublicCustomerContext() && activeStaffUser && this.isOrderPrepStaffRole(activeStaffUser.role)) {
            soundService.playNewOrderAlert();
          }
          this.notify('ORDER_CREATED', committed);
          this.dispatchOrderPushNotification(committed, 'NEW_ORDER');
        } else {
          this.notify('ORDER_UPDATED', committed);
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_CREATED', payload: committed } }));
        }
        return {
          order: committed,
          shift: (data.shift as CashRegisterShift) || this.getCurrentCashShift(),
          synced: true,
          alreadyConfirmed: Boolean(data.alreadyConfirmed),
        };
      }

      const resolution = await this.resolveFinancialHttpFailure(parsed, 'o registro da venda paga');
      if (resolution.kind === 'rejected') {
        this.uncertainServerOps.delete(opKey);
        return {
          order: null,
          synced: false,
          rejected: true,
          error: resolution.error,
        };
      }

      const rec = await recoverFromPaymentState();
      if (rec.status === 'recovered') return rec.result;
      if (rec.status === 'not_committed') {
        return {
          order: null,
          synced: false,
          rejected: false,
          uncertain: false,
          error: resolution.nonCommittedError,
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        order: null,
        synced: false,
        rejected: false,
        uncertain: true,
        error: resolution.uncertainError,
      };
    } catch (fetchErr: unknown) {
      const rec = await recoverFromPaymentState();
      if (rec.status === 'recovered') return rec.result;

      const isTimeout = this.isTimeoutFetchError(fetchErr);
      if (rec.status === 'not_committed') {
        return {
          order: null,
          synced: false,
          rejected: false,
          uncertain: false,
          error: isTimeout
            ? 'Tempo esgotado ao registrar a venda; consulta ao servidor confirmou que a venda não foi gravada.'
            : 'Falha de conexão ao registrar a venda; consulta ao servidor confirmou que a venda não foi gravada.',
        };
      }

      const health = await this.checkServerAdminSdkHealth();
      if (health.reachable && health.hasAdminSdk === false) {
        this.uncertainServerOps.delete(opKey);
        return {
          order: null,
          synced: false,
          rejected: true,
          error:
            'Não foi possível confirmar a venda paga: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        order: null,
        synced: false,
        rejected: false,
        uncertain: true,
        error: isTimeout
          ? 'Tempo esgotado ao registrar a venda no servidor e o resultado permanece desconhecido. Antes de reenviar, o sistema consultará o estado do pedido.'
          : 'Falha de comunicação com o servidor ao registrar a venda e não foi possível confirmar o resultado. O carrinho foi mantido sem alterações.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Dispatches background Web Push notifications restricted to ONLY the authorized events:
   * Event A: 'NEW_ORDER' (Arrival of a new order to kitchen & attendants)
   * Event B: 'READY_FOR_DELIVERY' (Order ready for pickup and delivery to assigned driver)
   * Event C: 'DELIVERY_CONFIRMED' (Delivery completion confirmed by driver)
   * Respects independent configuration toggles and prevents intermediate operational spam.
   */
  public dispatchOrderPushNotification(
    order: Order, 
    event: 'NEW_ORDER' | 'DELIVERY_CONFIRMED' | 'READY_FOR_DELIVERY'
  ): void {
    if (typeof window === 'undefined' || !order || !order.id) return;
    const cfg = this.getRestaurantConfig();

    if (event === 'NEW_ORDER' && cfg.notifyNewOrders === false) {
      return;
    }
    if (event === 'DELIVERY_CONFIRMED' && cfg.notifyDeliveryConfirmed === false) {
      return;
    }
    if (event === 'READY_FOR_DELIVERY' && cfg.notifyReadyForDelivery === false) {
      return;
    }

    (async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (auth?.currentUser) {
          const idToken = await auth.currentUser.getIdToken().catch(() => null);
          if (idToken) {
            headers['Authorization'] = `Bearer ${idToken}`;
          }
        }
        await fetch('/api/push/notify-order', {
          method: 'POST',
          headers,
          body: JSON.stringify({ order, event }),
        });
      } catch (err: any) {
        console.warn('[Web Push Dispatch Notice]:', err?.message || err);
      }
    })();
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
      if (effectiveTrackingCode) {
        // Unauthenticated customer listens exclusively to the sanitized tracking document
        const unsub = onSnapshot(
          doc(db, 'public_tracking', effectiveTrackingCode),
          (docSnap) => {
            if (docSnap.exists()) {
              const trackingData = docSnap.data() as PublicOrderTracking;
              callback(trackingData);
            } else {
              callback(this.getPublicOrderTracking(orderId, effectiveTrackingCode));
            }
          },
          (error) => {
            console.warn('[Firestore] Realtime public tracking notice:', error.message);
            callback(this.getPublicOrderTracking(orderId, effectiveTrackingCode));
          }
        );
        return unsub;
      }

      // If authenticated staff member tracking without tracking code
      if (this.isFirebaseAuthStaff()) {
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
      }

      return () => {};
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

  // ---- Driver Ready Delivery Orders & Controlled Sound Alert Management ----

  /**
   * Checks if an order is destined for and assigned to the specified driver.
   * If driver is specified and order has an assigned driver, strictly matches IDs/names.
   * If order is ready but unassigned, returns true for any active delivery driver.
   */
  public isDriverAssignedToOrder(order: Order, driverUser?: User | null): boolean {
    if (!driverUser) return false;
    if (order.fulfillmentType !== 'DELIVERY') return false;

    const driverId = driverUser.id;
    const cleanCurrentDriver = (driverUser.name || driverUser.username || '').toLowerCase().replace(/entregador\s*/g, '').trim();

    // 1. If order has an assigned delivery person:
    const assignedId = order.deliveryPersonId || order.deliveryPerson?.id;
    const assignedName = (order.deliveryPerson?.name || order.deliveryPersonName || '').toLowerCase().replace(/entregador\s*/g, '').trim();

    if (assignedId || assignedName) {
      if (assignedId && (assignedId === driverId || assignedId === `driver-${driverId}` || `driver-${assignedId}` === driverId)) {
        return true;
      }
      if (assignedName && cleanCurrentDriver && (
        assignedName === cleanCurrentDriver ||
        assignedName.includes(cleanCurrentDriver) ||
        cleanCurrentDriver.includes(assignedName)
      )) {
        return true;
      }
      // Order belongs specifically to another driver
      return false;
    }

    // 2. If order has NO assigned driver yet:
    // Active delivery drivers can receive notification that an unassigned order is ready
    if (driverUser.role?.toUpperCase() === 'ENTREGADOR') {
      return true;
    }

    // 3. Admin / Gerente / Supervisor
    const role = driverUser.role?.toUpperCase();
    if (role === 'ADMINISTRADOR' || role === 'GERENTE') {
      return true;
    }

    return false;
  }

  public getAcknowledgedDriverReadyOrderIds(): string[] {
    try {
      const data = localStorage.getItem('gf_driver_acknowledged_ready_orders');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public hasDriverAcknowledgedReadyOrder(orderId: string): boolean {
    return this.getAcknowledgedDriverReadyOrderIds().includes(orderId);
  }

  public getUnseenDriverReadyOrderIds(driverUser?: User | null): string[] {
    try {
      const acknowledged = new Set(this.getAcknowledgedDriverReadyOrderIds());
      const allOrders = this.getOrders();

      const readyDeliveries = allOrders.filter((o) => {
        if (o.status !== 'PRONTO' || o.fulfillmentType !== 'DELIVERY') return false;
        if (acknowledged.has(o.id)) return false;
        if (driverUser) {
          return this.isDriverAssignedToOrder(o, driverUser);
        }
        return true;
      });

      return readyDeliveries.map((o) => o.id);
    } catch {
      return [];
    }
  }

  public recordDriverReadyOrder(orderId: string) {
    try {
      if (this.hasDriverAcknowledgedReadyOrder(orderId)) return;
      const data = localStorage.getItem('gf_driver_unseen_ready_orders');
      const ids: string[] = data ? JSON.parse(data) : [];
      if (!ids.includes(orderId)) {
        ids.push(orderId);
        localStorage.setItem('gf_driver_unseen_ready_orders', JSON.stringify(ids));
      }
    } catch {}
  }

  public markDriverReadyOrderSeen(orderId: string) {
    try {
      // 1. Remove from unseen
      const data = localStorage.getItem('gf_driver_unseen_ready_orders');
      const ids: string[] = data ? JSON.parse(data) : [];
      const remaining = ids.filter((id) => id !== orderId);
      localStorage.setItem('gf_driver_unseen_ready_orders', JSON.stringify(remaining));

      // 2. Add to acknowledged
      const ackIds = this.getAcknowledgedDriverReadyOrderIds();
      if (!ackIds.includes(orderId)) {
        ackIds.push(orderId);
        localStorage.setItem('gf_driver_acknowledged_ready_orders', JSON.stringify(ackIds));
      }

      // 3. Stop sound if no remaining unseen orders
      if (remaining.length === 0) {
        soundService.stopDriverReadyAlert();
      }

      this.notify('DRIVER_READY_ORDER_SEEN', { orderId, remainingCount: remaining.length });
    } catch {
      soundService.stopDriverReadyAlert();
    }
  }

  public silenceDriverReadyAlerts() {
    soundService.stopDriverReadyAlert();
    this.notify('DRIVER_READY_ALERTS_SILENCED', {});
  }

  public acknowledgeAllDriverReadyOrders(driverUser?: User | null) {
    try {
      const unseen = this.getUnseenDriverReadyOrderIds(driverUser);
      const ackIds = this.getAcknowledgedDriverReadyOrderIds();
      for (const id of unseen) {
        if (!ackIds.includes(id)) ackIds.push(id);
      }
      localStorage.setItem('gf_driver_acknowledged_ready_orders', JSON.stringify(ackIds));
      localStorage.setItem('gf_driver_unseen_ready_orders', JSON.stringify([]));
    } catch {}
    soundService.stopDriverReadyAlert();
    this.notify('DRIVER_READY_ALERTS_SILENCED', {});
  }

  public updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    author: string,
    notes?: string,
    autoPersist = true,
    options?: { suppressSound?: boolean }
  ): Order | null {
    if (newStatus === 'CANCELADO') {
      console.warn('[Security Guard] Cancelamento de pedidos deve usar exclusivamente cancelOrderAsync() (/api/orders/:id/cancel).');
      return null;
    }

    const currentUser = this.getCurrentUser();
    if (currentUser && !this.canUserUpdateOrderStatus(currentUser, newStatus)) {
      console.warn(`[Security Guard] Usuário @${currentUser.username} (${currentUser.role}) não possui permissão para avançar pedido para ${newStatus}.`);
      return null;
    }

    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status === 'CANCELADO') return null;

    const previousStatus = order.status;
    if (previousStatus === newStatus) return order;

    const now = new Date().toISOString();
    order.status = newStatus;
    order.updatedAt = now;

    // Additional status actions
    if (newStatus === 'ENTREGUE') {
      // Concluding delivery automatically marks ready order as seen and silences audio
      this.markDriverReadyOrderSeen(order.id);
      soundService.stopDriverReadyAlert();

      const cleanDriverName = author.replace(/^Entregador\s*/i, '').trim() || 'Entregador de Plantão';
      if (!order.deliveryPerson) {
        order.deliveryPerson = {
          id: currentUser?.id || `driver-${cleanDriverName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          name: cleanDriverName,
          phone: currentUser?.phone || '',
          assignedAt: now,
          deliveredAt: now,
        };
        order.deliveryPersonId = order.deliveryPerson.id;
        order.deliveryPersonName = order.deliveryPerson.name;
      } else {
        order.deliveryPerson.deliveredAt = now;
        if (!order.deliveryPerson.name || order.deliveryPerson.name === 'Entregador de Plantão') {
          order.deliveryPerson.name = cleanDriverName;
        }
      }
    } else if (newStatus === 'EM_ROTA') {
      // Driver took the order: immediately silence and dismiss ready alert
      this.markDriverReadyOrderSeen(order.id);
      soundService.stopDriverReadyAlert();

      const cleanDriverName = author.replace(/^Entregador\s*/i, '').trim() || 'Entregador de Plantão';
      if (!order.deliveryPerson) {
        order.deliveryPerson = {
          id: currentUser?.id || `driver-${cleanDriverName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          name: cleanDriverName,
          phone: currentUser?.phone || '',
          assignedAt: now,
        };
        order.deliveryPersonId = order.deliveryPerson.id;
        order.deliveryPersonName = order.deliveryPerson.name;
      } else if (!order.deliveryPerson.assignedAt) {
        order.deliveryPerson.assignedAt = now;
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

    if (!options?.suppressSound) {
      soundService.playSuccessTone();
    }
    this.notify('ORDER_UPDATED', order);

    // Queue for cloud sync and attempt immediate transmission to Cloud Firestore if autoPersist is true
    this.queueOrderForSync(order);
    if (autoPersist) {
      this.persistOrderToFirestore(order, { isStatusTransition: true }).catch(() => {});
      if (newStatus === 'ENTREGUE') {
        this.dispatchOrderPushNotification(order, 'DELIVERY_CONFIRMED');
      } else if (newStatus === 'PRONTO' && order.fulfillmentType === 'DELIVERY') {
        this.recordDriverReadyOrder(order.id);
        this.dispatchOrderPushNotification(order, 'READY_FOR_DELIVERY');
        this.notify('DRIVER_ORDER_READY', order);
        const activeUser = this.getCurrentUser();
        if (activeUser && this.isDriverAssignedToOrder(order, activeUser)) {
          soundService.startDriverReadyAlert(3500, 4, order.id);
        }
      }
    }

    return order;
  }

  public async updateOrderStatusAsync(
    orderId: string,
    newStatus: OrderStatus,
    author = 'Operador',
    notes?: string
  ): Promise<{ order: Order | null; synced: boolean; rejected?: boolean; offlineQueued?: boolean; error?: string }> {
    if (newStatus === 'CANCELADO') {
      return {
        order: this.getOrderById(orderId) || null,
        synced: false,
        rejected: true,
        error: 'Cancelamento de pedidos deve ser executado exclusivamente pelo procedimento oficial cancelOrderAsync() (/api/orders/:id/cancel).',
      };
    }

    const currentUser = this.getCurrentUser();
    if (currentUser && !this.canUserUpdateOrderStatus(currentUser, newStatus)) {
      return {
        order: this.getOrderById(orderId) || null,
        synced: false,
        rejected: true,
        error: `Permissão insuficiente: perfil ${currentUser.role} não pode alterar pedido para ${newStatus}.`,
      };
    }

    const previousOrder = this.getOrderById(orderId);
    if (!previousOrder) {
      return { order: null, synced: false, rejected: true, error: 'Pedido não encontrado.' };
    }
    if (previousOrder.status === newStatus) {
      return { order: previousOrder, synced: previousOrder._cloudSyncStatus === 'SYNCED' };
    }

    await this.waitForFirebaseAuthReady();
    if (isFirebaseReady() && !auth?.currentUser) {
      return {
        order: previousOrder,
        synced: false,
        rejected: true,
        error: 'Sessão Firebase não autenticada. Faça login novamente com sua conta de colaborador antes de alterar o status.',
      };
    }

    const previousOrdersSnapshot = localStorage.getItem('gf_orders');
    const previousShiftSnapshot = localStorage.getItem('gf_current_cash_shift');

    const order = this.updateOrderStatus(orderId, newStatus, author, notes, false, { suppressSound: true });
    if (!order) {
      return { order: null, synced: false, rejected: true, error: 'Não foi possível aplicar alteração de status.' };
    }

    const res = await this.persistOrderToFirestore(order, { isStatusTransition: true });

    if (res.success) {
      const confirmed = this.getOrderById(orderId) || order;
      soundService.playSuccessTone();
      this.notify('ORDER_UPDATED', confirmed);
      if (newStatus === 'ENTREGUE') {
        this.dispatchOrderPushNotification(confirmed, 'DELIVERY_CONFIRMED');
      } else if (newStatus === 'PRONTO' && confirmed.fulfillmentType === 'DELIVERY') {
        this.recordDriverReadyOrder(confirmed.id);
        this.dispatchOrderPushNotification(confirmed, 'READY_FOR_DELIVERY');
        this.notify('DRIVER_ORDER_READY', confirmed);
        const activeUser = this.getCurrentUser();
        if (activeUser && this.isDriverAssignedToOrder(confirmed, activeUser)) {
          soundService.startDriverReadyAlert(3500, 4, confirmed.id);
        }
      }
      return { order: confirmed, synced: true };
    }

    const isOffline = Boolean(res.offline) || this.isOfflineErrorMessage(res.error);
    if (res.rejected || (isFirebaseReady() && !isOffline)) {
      // Rollback local mutations on server/Firestore rejection
      if (previousOrdersSnapshot !== null) {
        localStorage.setItem('gf_orders', previousOrdersSnapshot);
      }
      if (previousShiftSnapshot !== null) {
        localStorage.setItem('gf_current_cash_shift', previousShiftSnapshot);
      } else {
        localStorage.removeItem('gf_current_cash_shift');
      }
      this.removeOrderFromSyncQueue(orderId);
      this.notify('ORDERS_UPDATED', { reason: 'ROLLBACK_STATUS_REJECTED', orderId });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDERS_UPDATED' } }));
      }
      return {
        order: this.getOrderById(orderId) || previousOrder,
        synced: false,
        rejected: true,
        error: res.error || 'Alteração recusada pelo servidor/Firestore.',
      };
    }

    return {
      order: this.getOrderById(orderId) || order,
      synced: false,
      offlineQueued: true,
      error: res.error || 'Sem conexão com a internet: alteração salva na fila local.',
    };
  }

  public async recordOrderSaleMovementAsync(
    order: Order,
    author = 'Caixa'
  ): Promise<{ success: boolean; rejected?: boolean; uncertain?: boolean; recoveredFromTimeout?: boolean; error?: string; shift?: CashRegisterShift | null }> {
    const currentUser = this.getCurrentUser();
    if (!this.canUserConfirmPayments(currentUser)) {
      return {
        success: false,
        rejected: true,
        error: 'Permissão insuficiente: perfil não autorizado a registrar recebimento de venda no caixa.',
      };
    }

    if (order.status === 'CANCELADO') {
      return {
        success: false,
        rejected: true,
        error: 'Não é possível registrar recebimento de um pedido cancelado.',
      };
    }

    const roundedAmount = roundCurrency(order.totalAmount);
    if (roundedAmount <= 0) {
      return {
        success: false,
        rejected: true,
        error: 'Valor do pedido inválido para registro financeiro.',
      };
    }

    if (this.shouldUseServerAtomicPayment()) {
      if (isFirebaseReady()) {
        await this.waitForFirebaseAuthReady();
        if (!auth?.currentUser) {
          return {
            success: false,
            rejected: true,
            error: 'Sessão Firebase não autenticada. Faça login novamente antes de confirmar o pagamento.',
          };
        }
      }

      if (typeof fetch !== 'function') {
        return {
          success: false,
          rejected: true,
          error: 'Comunicação HTTP indisponível para operação financeira atômica.',
        };
      }

      const authHeaders = await this.getFirebaseAuthHeaders();
      const opKey = `record-sale:${order.id}`;

      if (this.uncertainServerOps.has(opKey)) {
        const preState = await this.consultOrderPaymentState(order.id, authHeaders);
        if (
          preState.verified &&
          preState.data?.exists &&
          preState.data?.paymentStatus === 'PAGO' &&
          preState.data?.cashRecorded
        ) {
          this.uncertainServerOps.delete(opKey);
          if (preState.data.order) {
            this.commitConfirmedServerOrderAndShift(
              preState.data.order as Order,
              (preState.data.shift as CashRegisterShift) || null
            );
          } else if (preState.data.shift) {
            this.commitOpenShiftLocally(preState.data.shift as CashRegisterShift);
          }
          return {
            success: true,
            recoveredFromTimeout: true,
            shift: (preState.data.shift as CashRegisterShift) || null,
          };
        }
        if (preState.verified && (!preState.data?.exists || !preState.data?.cashRecorded)) {
          this.uncertainServerOps.delete(opKey);
        } else {
          const health = await this.checkServerAdminSdkHealth();
          if (health.reachable && health.hasAdminSdk === false) {
            this.uncertainServerOps.delete(opKey);
            return {
              success: false,
              rejected: true,
              error:
                'Não foi possível registrar a venda no caixa: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
            };
          }
          return {
            success: false,
            uncertain: true,
            error:
              'Não foi possível confirmar o estado anterior do recebimento no servidor. A operação não foi repetida automaticamente.',
          };
        }
      }

      const recoverSaleState = async () => {
        const state = await this.consultOrderPaymentState(order.id, authHeaders);
        if (state.verified && state.data?.exists && state.data?.paymentStatus === 'PAGO' && state.data?.cashRecorded) {
          this.uncertainServerOps.delete(opKey);
          if (state.data.order) {
            this.commitConfirmedServerOrderAndShift(
              state.data.order as Order,
              (state.data.shift as CashRegisterShift) || null
            );
          } else if (state.data.shift) {
            this.commitOpenShiftLocally(state.data.shift as CashRegisterShift);
          }
          return {
            status: 'recovered' as const,
            result: {
              success: true,
              recoveredFromTimeout: true,
              shift: (state.data.shift as CashRegisterShift) || null,
            },
          };
        }
        if (state.verified && (!state.data?.exists || !state.data?.cashRecorded)) {
          this.uncertainServerOps.delete(opKey);
          return { status: 'not_committed' as const };
        }
        return { status: 'unknown' as const };
      };

      const shiftCheck = await this.ensureCashShiftReadyForServerSale();
      if (!shiftCheck.ok) {
        return {
          success: false,
          rejected: true,
          error: shiftCheck.error,
        };
      }

      try {
        const res = await fetch('/api/cash-shifts/record-sale', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            orderId: order.id,
            shiftId: shiftCheck.shiftId,
            author: String(author || currentUser?.name || currentUser?.username || 'Atendente').slice(0, 128),
          }),
        });
        const parsed = await this.readServerJsonResponse(res);
        const data = parsed.data;
        if (
          parsed.ok &&
          !parsed.isHtml &&
          parsed.isValidJson &&
          data?.success === true &&
          (Boolean(data?.order) || Boolean(data?.shift))
        ) {
          this.uncertainServerOps.delete(opKey);
          if (data.order) {
            this.commitConfirmedServerOrderAndShift(data.order as Order, (data.shift as CashRegisterShift) || null);
          } else if (data.shift) {
            localStorage.setItem('gf_current_cash_shift', JSON.stringify(data.shift));
            this.cashShiftSyncState = {
              status: 'CONFIRMED',
              confirmedAt: new Date().toISOString(),
              source: 'server_api',
              error: null,
            };
            this.notify('CASH_SHIFT_UPDATED', data.shift);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'CASH_SHIFT_UPDATED' } }));
          }
          return { success: true, shift: (data.shift as CashRegisterShift) || null };
        }

        const resolution = await this.resolveFinancialHttpFailure(parsed, 'o registro da venda no caixa');
        if (resolution.kind === 'rejected') {
          this.uncertainServerOps.delete(opKey);
          return {
            success: false,
            rejected: true,
            error: resolution.error,
          };
        }

        const rec = await recoverSaleState();
        if (rec.status === 'recovered') return rec.result;
        if (rec.status === 'not_committed') {
          return {
            success: false,
            rejected: false,
            uncertain: false,
            error: resolution.nonCommittedError,
          };
        }

        this.uncertainServerOps.set(opKey, Date.now());
        return {
          success: false,
          uncertain: true,
          error: resolution.uncertainError,
        };
      } catch (fetchErr: unknown) {
        const rec = await recoverSaleState();
        if (rec.status === 'recovered') return rec.result;
        const isTimeout = this.isTimeoutFetchError(fetchErr);
        if (rec.status === 'not_committed') {
          return {
            success: false,
            rejected: false,
            uncertain: false,
            error: isTimeout
              ? 'Tempo esgotado ao registrar venda no caixa; consulta ao servidor confirmou que o lançamento não foi gravado.'
              : 'Falha de conexão ao registrar venda no caixa; consulta ao servidor confirmou que o lançamento não foi gravado.',
          };
        }

        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          return {
            success: false,
            rejected: true,
            error:
              'Não foi possível registrar a venda no caixa: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }

        this.uncertainServerOps.set(opKey, Date.now());
        return {
          success: false,
          uncertain: true,
          error: isTimeout
            ? 'Tempo esgotado ao registrar venda atômica no servidor e não foi possível confirmar o resultado.'
            : 'Falha de comunicação ao registrar venda atômica no servidor e não foi possível confirmar o resultado.',
        };
      }
    }

    // Local contingency mode (ONLY when Firebase is not configured)
    const localShift = this.getCurrentCashShift();
    if (!localShift || localShift.status !== 'ABERTO') {
      return {
        success: false,
        rejected: true,
        error: 'Nenhum turno de caixa aberto para registrar a movimentação financeira.',
      };
    }

    const movementId = `cash-sale-${order.id}`;
    const alreadyRecorded = localShift.movements.some(
      (m: CashMovement) => m.type === 'VENDA' && (m.orderId === order.id || m.id === movementId)
    );
    if (!alreadyRecorded) {
      localShift.movements.push({
        id: movementId,
        timestamp: new Date().toISOString(),
        type: 'VENDA',
        amount: roundedAmount,
        paymentMethod: order.paymentMethod,
        description: `Recebimento Pedido ${order.orderNumber} - ${order.customer?.name || 'Cliente'}`.slice(0, 300),
        orderId: order.id,
        orderNumber: order.orderNumber,
        author: String(author || currentUser?.name || currentUser?.username || 'Atendente').slice(0, 128),
      });
      try {
        localStorage.setItem('gf_current_cash_shift', JSON.stringify(localShift));
      } catch {}
      this.notify('CASH_SHIFT_UPDATED', localShift);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'CASH_SHIFT_UPDATED' } }));
      }
    }
    return { success: true, shift: localShift };
  }

  public updatePaymentStatus(
    orderId: string,
    newPaymentStatus: 'PAGO' | 'PENDENTE',
    author = 'Caixa',
    notes?: string,
    autoPersist = true
  ): Order | null {
    const currentUser = this.getCurrentUser();
    if (!this.canUserConfirmPayments(currentUser)) {
      console.warn(`[Security Guard] Usuário @${currentUser?.username || 'anônimo'} (${currentUser?.role || 'N/A'}) não possui permissão para alterar status de pagamento.`);
      return null;
    }

    if (this.shouldUseServerAtomicPayment() && autoPersist) {
      console.warn('[Security Guard] Em modo nuvem/atômico, use exclusivamente updatePaymentStatusAsync().');
      return null;
    }

    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status === 'CANCELADO') return null;

    const previousPaymentStatus = order.paymentStatus;
    if (previousPaymentStatus === newPaymentStatus) return order;
    if (previousPaymentStatus === 'PAGO' && newPaymentStatus === 'PENDENTE') return null;

    const now = new Date().toISOString();
    if (newPaymentStatus === 'PAGO') {
      const shift = this.getCurrentCashShift();
      if (!shift || shift.status !== 'ABERTO') {
        return null;
      }
      const movementId = `cash-sale-${order.id}`;
      if (!shift.movements.some((m: CashMovement) => m.type === 'VENDA' && (m.orderId === order.id || m.id === movementId))) {
        shift.movements.push({
          id: movementId,
          timestamp: now,
          type: 'VENDA',
          amount: roundCurrency(order.totalAmount),
          paymentMethod: order.paymentMethod,
          description: `Recebimento Pedido ${order.orderNumber} - ${order.customer?.name || 'Cliente'}`.slice(0, 300),
          orderId: order.id,
          orderNumber: order.orderNumber,
          author,
        });
        try {
          localStorage.setItem('gf_current_cash_shift', JSON.stringify(shift));
        } catch {}
        this.notify('CASH_SHIFT_UPDATED', shift);
      }
    }

    order.paymentStatus = newPaymentStatus;
    order.updatedAt = now;
    order.movements.push({
      id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: now,
      toStatus: order.status,
      author,
      notes: notes || `Pagamento alterado de ${previousPaymentStatus} para ${newPaymentStatus}`,
    });

    localStorage.setItem('gf_orders', JSON.stringify(orders));
    this.notify('ORDER_UPDATED', order);
    return order;
  }

  public async updatePaymentStatusAsync(
    orderId: string,
    newPaymentStatus: 'PAGO' | 'PENDENTE',
    author = 'Caixa',
    notes?: string,
    options?: { timeoutMs?: number; shiftId?: string }
  ): Promise<{
    order: Order | null;
    shift?: CashRegisterShift | null;
    synced: boolean;
    rejected?: boolean;
    uncertain?: boolean;
    recoveredFromTimeout?: boolean;
    alreadyConfirmed?: boolean;
    error?: string;
  }> {
    const currentUser = this.getCurrentUser();
    if (!this.canUserConfirmPayments(currentUser)) {
      return {
        order: this.getOrderById(orderId) || null,
        synced: false,
        rejected: true,
        error: `Permissão insuficiente: perfil ${currentUser?.role || 'não autenticado'} não pode confirmar pagamentos.`,
      };
    }

    const previousOrder = this.getOrderById(orderId);
    if (!previousOrder) {
      return { order: null, synced: false, rejected: true, error: 'Pedido não encontrado' };
    }
    if (previousOrder.status === 'CANCELADO') {
      return {
        order: previousOrder,
        synced: false,
        rejected: true,
        error: 'Não é possível confirmar pagamento de um pedido cancelado.',
      };
    }
    if (previousOrder.paymentStatus === 'PAGO' && newPaymentStatus === 'PENDENTE') {
      return {
        order: previousOrder,
        synced: false,
        rejected: true,
        error: 'Não é permitido reverter um pagamento já confirmado para PENDENTE. Utilize o fluxo de cancelamento com estorno.',
      };
    }
    if (previousOrder.paymentStatus === newPaymentStatus && !this.shouldUseServerAtomicPayment()) {
      return { order: previousOrder, synced: false };
    }

    if (!this.shouldUseServerAtomicPayment()) {
      // Local contingency mode (Firebase NOT configured): validate open shift BEFORE any mutation
      const localShift = this.getCurrentCashShift();
      if (!localShift || localShift.status !== 'ABERTO') {
        return {
          order: previousOrder,
          synced: false,
          rejected: true,
          error: 'Nenhum turno de caixa aberto para confirmar o pagamento.',
        };
      }
      const updated = this.updatePaymentStatus(orderId, newPaymentStatus, author, notes, false);
      if (!updated) {
        return {
          order: previousOrder,
          synced: false,
          rejected: true,
          error: 'Não foi possível confirmar o pagamento no modo de contingência local.',
        };
      }
      return {
        order: updated,
        shift: this.getCurrentCashShift(),
        synced: false,
      };
    }

    // Cloud / Server Atomic Mode: NEVER mutate local gf_orders or gf_current_cash_shift before server commit!
    if (isFirebaseReady()) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser) {
        return {
          order: previousOrder,
          synced: false,
          rejected: true,
          error: 'Sessão Firebase não autenticada. Faça login novamente antes de confirmar o pagamento.',
        };
      }
    }

    if (typeof fetch !== 'function') {
      return {
        order: previousOrder,
        synced: false,
        rejected: true,
        error: 'Cliente HTTP indisponível para confirmação atômica no servidor.',
      };
    }

    const shiftCheck = await this.ensureCashShiftReadyForServerSale(options?.shiftId);
    if (!shiftCheck.ok) {
      return {
        order: previousOrder,
        synced: false,
        rejected: true,
        error: shiftCheck.error,
      };
    }

    const authHeaders = await this.getFirebaseAuthHeaders();
    const opKey = `pay:${orderId}`;

    if (this.uncertainServerOps.has(opKey)) {
      const preState = await this.consultOrderPaymentState(orderId, authHeaders);
      if (
        preState.verified &&
        preState.data?.exists &&
        preState.data?.paymentStatus === 'PAGO' &&
        preState.data?.cashRecorded &&
        preState.data?.order
      ) {
        this.uncertainServerOps.delete(opKey);
        const recovered = this.commitConfirmedServerOrderAndShift(
          preState.data.order as Order,
          (preState.data.shift as CashRegisterShift) || null
        );
        this.notify('ORDER_UPDATED', recovered);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_UPDATED', payload: recovered } }));
        }
        return {
          order: recovered,
          shift: (preState.data.shift as CashRegisterShift) || this.getCurrentCashShift(),
          synced: true,
          recoveredFromTimeout: true,
        };
      }
      if (preState.verified && (!preState.data?.exists || preState.data?.paymentStatus !== 'PAGO')) {
        this.uncertainServerOps.delete(opKey);
      } else {
        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          return {
            order: previousOrder,
            synced: false,
            rejected: true,
            error:
              'Não foi possível confirmar o pagamento: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }
        return {
          order: previousOrder,
          synced: false,
          uncertain: true,
          error:
            'Não foi possível verificar o estado atual do pagamento no servidor após falha anterior. A confirmação não foi repetida para evitar duplicidade.',
        };
      }
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const recoverPaymentState = async () => {
      const state = await this.consultOrderPaymentState(orderId, authHeaders);
      if (
        state.verified &&
        state.data?.exists &&
        state.data?.paymentStatus === 'PAGO' &&
        state.data?.cashRecorded &&
        state.data?.order
      ) {
        this.uncertainServerOps.delete(opKey);
        const recovered = this.commitConfirmedServerOrderAndShift(
          state.data.order as Order,
          (state.data.shift as CashRegisterShift) || null
        );
        this.notify('ORDER_UPDATED', recovered);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_UPDATED', payload: recovered } }));
        }
        return {
          status: 'recovered' as const,
          result: {
            order: recovered,
            shift: (state.data.shift as CashRegisterShift) || this.getCurrentCashShift(),
            synced: true,
            recoveredFromTimeout: true,
          },
        };
      }
      if (state.verified && (!state.data?.exists || state.data?.paymentStatus !== 'PAGO')) {
        this.uncertainServerOps.delete(opKey);
        return { status: 'not_committed' as const };
      }
      return { status: 'unknown' as const };
    };

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/confirm-payment`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          author,
          notes,
          shiftId: shiftCheck.shiftId,
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data;

      if (
        parsed.ok &&
        !parsed.isHtml &&
        parsed.isValidJson &&
        data?.success === true &&
        data?.order &&
        data.order.id &&
        data.order.paymentStatus === newPaymentStatus
      ) {
        this.uncertainServerOps.delete(opKey);
        const committed = this.commitConfirmedServerOrderAndShift(
          data.order as Order,
          (data.shift as CashRegisterShift) || null
        );
        this.notify('ORDER_UPDATED', committed);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_UPDATED', payload: committed } }));
        }
        return {
          order: committed,
          shift: (data.shift as CashRegisterShift) || this.getCurrentCashShift(),
          synced: true,
          alreadyConfirmed: Boolean(data.alreadyConfirmed),
        };
      }

      const resolution = await this.resolveFinancialHttpFailure(parsed, 'a confirmação do pagamento');
      if (resolution.kind === 'rejected') {
        this.uncertainServerOps.delete(opKey);
        return {
          order: previousOrder,
          synced: false,
          rejected: true,
          error: resolution.error,
        };
      }

      const rec = await recoverPaymentState();
      if (rec.status === 'recovered') return rec.result;
      if (rec.status === 'not_committed') {
        return {
          order: previousOrder,
          synced: false,
          rejected: false,
          uncertain: false,
          error: resolution.nonCommittedError,
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        order: previousOrder,
        synced: false,
        rejected: false,
        uncertain: true,
        error: resolution.uncertainError,
      };
    } catch (fetchErr: unknown) {
      const rec = await recoverPaymentState();
      if (rec.status === 'recovered') return rec.result;
      const isTimeout = this.isTimeoutFetchError(fetchErr);

      if (rec.status === 'not_committed') {
        return {
          order: previousOrder,
          synced: false,
          rejected: false,
          uncertain: false,
          error: isTimeout
            ? 'Tempo esgotado ao confirmar pagamento; consulta ao servidor confirmou que o pagamento permanece pendente.'
            : 'Falha de conexão ao confirmar pagamento; consulta ao servidor confirmou que o pagamento permanece pendente.',
        };
      }

      const health = await this.checkServerAdminSdkHealth();
      if (health.reachable && health.hasAdminSdk === false) {
        this.uncertainServerOps.delete(opKey);
        return {
          order: previousOrder,
          synced: false,
          rejected: true,
          error:
            'Não foi possível confirmar o pagamento: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        order: previousOrder,
        synced: false,
        rejected: false,
        uncertain: true,
        error: isTimeout
          ? 'Tempo esgotado ao confirmar pagamento no servidor e o resultado permanece desconhecido. Antes de reenviar, o sistema consultará o servidor.'
          : 'Falha de comunicação com o servidor ao confirmar pagamento. Nenhum dado local foi adulterado.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public assignDeliveryPerson(
    orderId: string, 
    deliveryPerson: { id: string; name: string; phone: string } | null,
    assignedBy = 'Administração',
    reason?: string,
    autoPersist = true
  ): Order | null {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;

    const previousDriverId = order.deliveryPersonId || order.deliveryPerson?.id;
    const previousDriverName = order.deliveryPersonName || order.deliveryPerson?.name;

    if (!deliveryPerson) {
      order.deliveryPersonId = undefined;
      order.deliveryPersonName = undefined;
      order.deliveryPerson = undefined;
      order.updatedAt = new Date().toISOString();

      if (!order.deliveryAssignmentHistory) {
        order.deliveryAssignmentHistory = [];
      }
      order.deliveryAssignmentHistory.push({
        assignedAt: new Date().toISOString(),
        previousDriverId,
        previousDriverName,
        newDriverId: undefined,
        newDriverName: undefined,
        assignedBy,
        reason: reason || 'Atribuição removida pela supervisão',
      });

      order.movements.push({
        id: `mov-${Date.now()}`,
        timestamp: new Date().toISOString(),
        toStatus: order.status,
        author: assignedBy,
        notes: `Entregador desvinculado por ${assignedBy}${reason ? ` (Motivo: ${reason})` : ''}`,
      });

      order._cloudSyncStatus = 'PENDING';
      localStorage.setItem('gf_orders', JSON.stringify(orders));
      this.notify('ORDER_UPDATED', order);
      this.queueOrderForSync(order);
      if (autoPersist) {
        this.persistOrderToFirestore(order, { isStatusTransition: true }).catch(() => {});
      }
      return order;
    }

    order.deliveryPersonId = deliveryPerson.id;
    order.deliveryPersonName = deliveryPerson.name;
    order.deliveryPerson = {
      id: deliveryPerson.id,
      name: deliveryPerson.name,
      phone: deliveryPerson.phone,
    };
    order.updatedAt = new Date().toISOString();

    if (!order.deliveryAssignmentHistory) {
      order.deliveryAssignmentHistory = [];
    }
    order.deliveryAssignmentHistory.push({
      assignedAt: new Date().toISOString(),
      previousDriverId,
      previousDriverName,
      newDriverId: deliveryPerson.id,
      newDriverName: deliveryPerson.name,
      assignedBy,
      reason,
    });

    order.movements.push({
      id: `mov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      toStatus: order.status,
      author: assignedBy,
      notes: previousDriverName
        ? `Reatribuído de ${previousDriverName} para ${deliveryPerson.name} por ${assignedBy}${reason ? ` (Motivo: ${reason})` : ''}`
        : `Atribuído ao entregador ${deliveryPerson.name} por ${assignedBy}${reason ? ` (Obs: ${reason})` : ''}`,
    });
    order._cloudSyncStatus = 'PENDING';

    localStorage.setItem('gf_orders', JSON.stringify(orders));
    this.notify('ORDER_UPDATED', order);

    this.queueOrderForSync(order);
    if (autoPersist) {
      this.persistOrderToFirestore(order, { isStatusTransition: true }).catch(() => {});
    }

    return order;
  }

  public async assignDeliveryPersonAsync(
    orderId: string,
    deliveryPerson: { id: string; name: string; phone: string } | null,
    assignedBy = 'Administração',
    reason?: string
  ): Promise<{ order: Order | null; synced: boolean; rejected?: boolean; error?: string }> {
    const currentUser = this.getCurrentUser();
    const role = (currentUser?.role || '').toUpperCase();
    if (currentUser && !['ADMINISTRADOR', 'GERENTE', 'CAIXA', 'ATENDENTE'].includes(role)) {
      return {
        order: this.getOrderById(orderId) || null,
        synced: false,
        rejected: true,
        error: 'Permissão insuficiente para atribuir entregador.',
      };
    }

    await this.waitForFirebaseAuthReady();
    if (isFirebaseReady() && !auth?.currentUser) {
      return {
        order: this.getOrderById(orderId) || null,
        synced: false,
        rejected: true,
        error: 'Sessão Firebase não autenticada. Faça login novamente para atribuir entregador.',
      };
    }

    const previousOrdersSnapshot = localStorage.getItem('gf_orders');

    const order = this.assignDeliveryPerson(orderId, deliveryPerson, assignedBy, reason, false);
    if (!order) {
      return { order: null, synced: false, rejected: true, error: 'Pedido não encontrado.' };
    }

    // Try direct Firestore updateDoc or backend /api/orders/:id/assign-driver
    let synced = false;
    let rejected = false;
    let errorMsg: string | undefined;

    if (db && auth?.currentUser) {
      try {
        const cleanOrder = this.cleanForFirestore(order);
        await updateDoc(doc(db, 'orders', order.id), {
          deliveryPerson: cleanOrder.deliveryPerson || null,
          deliveryPersonId: cleanOrder.deliveryPersonId || null,
          deliveryPersonName: cleanOrder.deliveryPersonName || null,
          deliveryAssignmentHistory: cleanOrder.deliveryAssignmentHistory || [],
          movements: cleanOrder.movements || [],
          updatedAt: cleanOrder.updatedAt,
        });
        synced = true;
      } catch (directErr: any) {
        const code = String(directErr?.code || '');
        errorMsg = directErr?.message;
        if (code === 'permission-denied' || String(errorMsg || '').includes('Missing or insufficient permissions')) {
          rejected = true;
        }
      }
    }

    if (!synced && typeof window !== 'undefined') {
      try {
        const authHeaders = await this.getFirebaseAuthHeaders();
        const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/assign-driver`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({
            deliveryPerson,
            deliveryAssignmentHistory: order.deliveryAssignmentHistory,
            movements: order.movements,
            updatedAt: order.updatedAt,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          synced = true;
          errorMsg = undefined;
        } else if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
          rejected = true;
          errorMsg = data.message || `Erro HTTP ${res.status} ao atribuir entregador.`;
        } else {
          errorMsg = data.message || `Erro HTTP ${res.status} ao atribuir entregador.`;
        }
      } catch (netErr: any) {
        errorMsg = netErr?.message || 'Erro de rede ao atribuir entregador.';
      }
    }

    if (synced) {
      this.removeOrderFromSyncQueue(orderId);
      this.recordSyncedOrderId(orderId);
      this.updateLocalOrderSyncStatus(orderId, 'SYNCED');
      return { order: this.getOrderById(orderId) || order, synced: true };
    }

    const isOffline = this.isOfflineErrorMessage(errorMsg);
    if (rejected || (isFirebaseReady() && !isOffline)) {
      if (previousOrdersSnapshot !== null) {
        localStorage.setItem('gf_orders', previousOrdersSnapshot);
      }
      this.removeOrderFromSyncQueue(orderId);
      this.notify('ORDERS_UPDATED', { reason: 'ROLLBACK_ASSIGN_DRIVER', orderId });
      return { order: this.getOrderById(orderId) || null, synced: false, rejected: true, error: errorMsg };
    }

    return { order, synced: false, error: errorMsg || 'Sem conexão: atribuição pendente.' };
  }

  public addOrderOccurrence(orderId: string, note: string, author = 'Supervisão'): Order | null {
    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return null;

    order.updatedAt = new Date().toISOString();
    order.movements.push({
      id: `mov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      toStatus: order.status,
      author,
      notes: `[OCORRÊNCIA]: ${note}`,
    });
    order._cloudSyncStatus = 'PENDING';

    localStorage.setItem('gf_orders', JSON.stringify(orders));
    this.notify('ORDER_UPDATED', order);

    this.queueOrderForSync(order);
    this.persistOrderToFirestore(order, { isStatusTransition: true }).catch(() => {});

    return order;
  }

  public async deleteOrderAsync(orderId: string): Promise<{ success: boolean; error?: string }> {
    const currentUser = this.getCurrentUser();
    if (!this.canUserDeleteOrder(currentUser)) {
      return {
        success: false,
        error: 'Permissão insuficiente: apenas Administrador ou Gerente podem excluir pedidos.',
      };
    }

    if (this.inFlightOrderDeletes.has(orderId)) {
      return { success: false, error: 'Exclusão já em andamento para este pedido. Aguarde a confirmação do servidor.' };
    }

    const orders = this.getOrders();
    const target = orders.find((o) => o.id === orderId);
    if (!target) {
      if (this.isOrderDeleted(orderId)) {
        return { success: true };
      }
      return { success: false, error: 'Pedido não encontrado no sistema.' };
    }

    this.inFlightOrderDeletes.add(orderId);
    try {
      await this.waitForFirebaseAuthReady();
      if (isFirebaseReady() && !auth?.currentUser) {
        return {
          success: false,
          error: 'Sessão Firebase não autenticada. Faça login novamente com uma conta de Administrador ou Gerente para excluir pedidos.',
        };
      }

      let firestoreDeleted = false;
      let deleteError: string | undefined;

      // 1. Try direct Firestore deletion ONLY if authenticated with Firebase Auth
      if (db && auth?.currentUser) {
        try {
          await deleteDoc(doc(db, 'orders', orderId));
          firestoreDeleted = true;
          if (target.trackingCode) {
            await deleteDoc(doc(db, 'public_tracking', target.trackingCode)).catch(() => {});
          }
          await setDoc(doc(db, 'order_tombstones', orderId), {
            id: orderId,
            deletedAt: new Date().toISOString(),
          }).catch(() => {});
        } catch (fsErr: any) {
          const code = String(fsErr?.code || '');
          const rawMsg = String(fsErr?.message || fsErr || '');
          console.warn('[Firestore] Exclusão direta pelo cliente falhou, acionando backend:', rawMsg);
          if (code === 'permission-denied' || rawMsg.includes('Missing or insufficient permissions')) {
            deleteError = 'Permissão negada no Firestore (403). Verifique se o seu usuário possui perfil ATIVO em /users/{uid} como ADMINISTRADOR ou GERENTE.';
          } else {
            deleteError = rawMsg;
          }
        }
      }

      // Inform server tombstone registry when client deleteDoc succeeded so sibling devices stay in sync
      if (firestoreDeleted && typeof window !== 'undefined' && auth?.currentUser) {
        try {
          const idToken = await auth.currentUser.getIdToken();
          if (idToken) {
            await fetch('/api/orders/tombstones', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({ orderId }),
            }).catch(() => {});
          }
        } catch {}
      }

      // 2. Backend fallback / authoritative server route (strictly awaits confirmation BEFORE removing local order)
      if (!firestoreDeleted && typeof window !== 'undefined') {
        try {
          const authHeaders = await this.getFirebaseAuthHeaders();
          const qs = target.trackingCode ? `?trackingCode=${encodeURIComponent(target.trackingCode)}` : '';
          const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}${qs}`, {
            method: 'DELETE',
            headers: authHeaders,
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.success) {
            firestoreDeleted = true;
            deleteError = undefined;
          } else {
            const postRes = await fetch('/api/orders/delete', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ orderId, trackingCode: target.trackingCode }),
            });
            const postData = await postRes.json().catch(() => ({}));
            if (postRes.ok && postData.success) {
              firestoreDeleted = true;
              deleteError = undefined;
            } else {
              deleteError = data.message || postData.message || `Erro ${res.status} ao excluir pedido no servidor.`;
            }
          }
        } catch (backendErr: any) {
          console.warn('[Backend] Erro de rede ao contatar API de exclusão:', backendErr);
          deleteError = backendErr?.message || 'Falha de comunicação com o servidor ao excluir.';
        }
      }

      // In local-only mode without Firebase configured and without backend, only allow local deletion if not cloud-configured
      if (!firestoreDeleted && !isFirebaseReady() && !db) {
        firestoreDeleted = true;
      }

      if (!firestoreDeleted) {
        return {
          success: false,
          error: deleteError || 'Não foi possível confirmar a exclusão do pedido no Cloud Firestore.',
        };
      }

      // 3. Confirmed! Now record tombstone and remove from local orders & open cash shift
      this.recordDeletedOrderId(orderId);
      this.removeOrderFromSyncQueue(orderId);
      this.removeSyncedOrderId(orderId);

      const latestOrders = this.getOrders().filter((o) => o.id !== orderId);
      localStorage.setItem('gf_orders', JSON.stringify(latestOrders));

      const currentShift = this.getCurrentCashShift();
      if (currentShift && currentShift.movements.some((m: CashMovement) => m.orderId === orderId)) {
        currentShift.movements = currentShift.movements.filter((m: CashMovement) => m.orderId !== orderId);
        this.saveCurrentCashShift(currentShift);
      }

      this.notify('ORDER_DELETED', { orderId, orderNumber: target.orderNumber });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_DELETED', payload: { orderId } } }));
      }

      return { success: true };
    } finally {
      this.inFlightOrderDeletes.delete(orderId);
    }
  }

  public deleteOrder(orderId: string): boolean {
    if (!this.canUserDeleteOrder()) return false;
    const orders = this.getOrders();
    const target = orders.find((o) => o.id === orderId);
    if (!target) return false;

    this.deleteOrderAsync(orderId).catch((err) => {
      console.warn('[Store] Exclusão assíncrona do pedido falhou:', err);
    });

    return true;
  }

  // ==========================================
  // CASH REGISTER / SHIFTS API
  // ==========================================
  public getCurrentCashShift(): CashRegisterShift | null {
    try {
      if (this.isCloudCashConfirmationRequired() && this.cashShiftSyncState.status !== 'CONFIRMED') {
        return null;
      }

      const data = localStorage.getItem('gf_current_cash_shift');
      if (data) return JSON.parse(data);

      // When Firebase or Server Atomic mode is active, NEVER create a synthetic ABERTO shift.
      if (this.shouldUseServerAtomicPayment()) {
        return null;
      }

      const initialShift: CashRegisterShift = {
        id: 'shift-' + getFortalezaDateKey(),
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
      const cleanShift = this.cleanForFirestore(shift);
      try {
        localStorage.setItem('gf_current_cash_shift', JSON.stringify(cleanShift));
      } catch {
        // storage fallback
      }
      if (db) {
        setDoc(doc(db, 'cash_shifts', shift.id), cleanShift).catch(async (err) => {
          console.warn('[Firestore Cash Shift] Direct write notice:', err);
          if (typeof window !== 'undefined' && typeof fetch === 'function') {
            try {
              let authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
              if (auth?.currentUser) {
                try {
                  const idToken = await auth.currentUser.getIdToken();
                  if (idToken) authHeaders['Authorization'] = `Bearer ${idToken}`;
                } catch {}
              }
              const res = await fetch('/api/cash-shifts', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ shift: cleanShift }),
              });
              if (res.ok) return;
              if (res.status === 409) {
                console.warn('[Cash Shift] Modificação bloqueada: turno já se encontra FECHADO.');
                return;
              }
            } catch {
              // Fallback error
            }
          }
          handleFirestoreError(err, OperationType.WRITE, `cash_shifts/${shift.id}`);
        });
      }
    } else {
      localStorage.setItem('gf_current_cash_shift', 'null');
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

  private commitClosedShiftHistoryLocally(closedShift: CashRegisterShift): void {
    this.clearUncertainOpPrefix(`close:${closedShift.id}:`);
    this.uncertainServerOps.delete(`open:${closedShift.id}`);
    if (this.lastUncertainOpenShiftId === closedShift.id) {
      this.lastUncertainOpenShiftId = null;
    }
    const history = this.getCashShiftHistory().filter((h) => h.id !== closedShift.id);
    history.unshift(closedShift);
    try {
      localStorage.setItem('gf_cash_shifts_history', JSON.stringify(history));
      localStorage.setItem('gf_current_cash_shift', 'null');
    } catch {}
    this.cashShiftSyncState = {
      status: 'CONFIRMED',
      confirmedAt: new Date().toISOString(),
      source: 'server_api',
      error: null,
    };
    this.notify('CASH_SHIFT_UPDATED', null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'CASH_SHIFT_UPDATED' } }));
    }
  }

  private commitOpenShiftLocally(shift: CashRegisterShift): void {
    this.uncertainServerOps.delete(`open:${shift.id}`);
    if (this.lastUncertainOpenShiftId === shift.id) {
      this.lastUncertainOpenShiftId = null;
    }
    const cleanShift = this.cleanForFirestore(shift);
    try {
      localStorage.setItem('gf_current_cash_shift', JSON.stringify(cleanShift));
    } catch {}
    this.cashShiftSyncState = {
      status: 'CONFIRMED',
      confirmedAt: new Date().toISOString(),
      source: 'server_api',
      error: null,
    };
    this.notify('CASH_SHIFT_UPDATED', cleanShift);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'CASH_SHIFT_UPDATED' } }));
    }
  }

  public openCashRegister(initialBalance: number, openedBy: string): CashRegisterShift | null {
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para abrir o caixa.');
      return null;
    }

    if (this.shouldUseServerAtomicPayment()) {
      console.warn('[Security Guard] Em modo nuvem/atômico, use exclusivamente openCashRegisterAsync().');
      return null;
    }

    const existing = this.getCurrentCashShift();
    if (existing && existing.status === 'ABERTO') {
      console.warn(`[Security Guard] Já existe um turno de caixa ABERTO (${existing.id}). Feche o turno atual antes de abrir outro.`);
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

  public async openCashRegisterAsync(
    initialBalance: number,
    openedBy: string,
    options?: { shiftId?: string; timeoutMs?: number }
  ): Promise<{
    success: boolean;
    synced: boolean;
    rejected?: boolean;
    uncertain?: boolean;
    recoveredFromTimeout?: boolean;
    shift: CashRegisterShift | null;
    error?: string;
  }> {
    if (!this.canUserManageCash()) {
      return {
        success: false,
        synced: false,
        rejected: true,
        shift: null,
        error: 'Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem abrir o caixa.',
      };
    }

    if (!this.shouldUseServerAtomicPayment()) {
      const existing = this.getCurrentCashShift();
      if (existing && existing.status === 'ABERTO') {
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: existing,
          error: `Já existe um turno de caixa ABERTO (${existing.id}).`,
        };
      }
      const created = this.openCashRegister(initialBalance, openedBy);
      return created
        ? { success: true, synced: false, shift: created }
        : { success: false, synced: false, rejected: true, shift: null, error: 'Não foi possível abrir o caixa localmente.' };
    }

    if (isFirebaseReady()) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser) {
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error: 'Sessão Firebase não autenticada. Faça login novamente antes de abrir o caixa.',
        };
      }
    }

    if (typeof fetch !== 'function') {
      return {
        success: false,
        synced: false,
        rejected: true,
        shift: null,
        error: 'Cliente HTTP indisponível para abertura de caixa no servidor.',
      };
    }

    const shiftId = options?.shiftId || this.lastUncertainOpenShiftId || `shift-${Date.now()}`;
    const opKey = `open:${shiftId}`;
    const authHeaders = await this.getFirebaseAuthHeaders();

    if (this.uncertainServerOps.has(opKey)) {
      const preState = await this.consultCashShiftState(shiftId, authHeaders);
      if (preState.verified && preState.exists && preState.shift?.status === 'ABERTO') {
        this.uncertainServerOps.delete(opKey);
        this.lastUncertainOpenShiftId = null;
        this.commitOpenShiftLocally(preState.shift);
        return { success: true, synced: true, recoveredFromTimeout: true, shift: preState.shift };
      }
      if (preState.verified && !preState.exists) {
        this.uncertainServerOps.delete(opKey);
        this.lastUncertainOpenShiftId = null;
      } else if (preState.verified && preState.exists && preState.shift?.status === 'FECHADO') {
        this.uncertainServerOps.delete(opKey);
        this.lastUncertainOpenShiftId = null;
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error: `O turno '${shiftId}' já consta como FECHADO no servidor (HTTP 409).`,
        };
      } else {
        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          this.lastUncertainOpenShiftId = null;
          return {
            success: false,
            synced: false,
            rejected: true,
            shift: null,
            error:
              'Não foi possível abrir o caixa: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }
        return {
          success: false,
          synced: false,
          uncertain: true,
          shift: null,
          error:
            'Não foi possível confirmar o estado atual da abertura de caixa no servidor após falha anterior. A requisição não foi repetida para evitar abertura duplicada.',
        };
      }
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const recoverOpenState = async () => {
      const state = await this.consultCashShiftState(shiftId, authHeaders);
      if (state.verified && state.exists && state.shift?.status === 'ABERTO') {
        this.uncertainServerOps.delete(opKey);
        this.lastUncertainOpenShiftId = null;
        this.commitOpenShiftLocally(state.shift);
        return {
          status: 'recovered' as const,
          result: { success: true, synced: true, recoveredFromTimeout: true, shift: state.shift },
        };
      }
      if (state.verified && !state.exists) {
        this.uncertainServerOps.delete(opKey);
        this.lastUncertainOpenShiftId = null;
        return { status: 'not_committed' as const };
      }
      return { status: 'unknown' as const };
    };

    try {
      const res = await fetch('/api/cash-shifts/open', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          shiftId,
          initialBalance: Math.max(0, roundCurrency(initialBalance)),
          openedBy: openedBy.trim() || 'admin',
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data;

      if (
        parsed.ok &&
        !parsed.isHtml &&
        parsed.isValidJson &&
        data?.success === true &&
        data?.shift &&
        data.shift.id &&
        data.shift.status === 'ABERTO'
      ) {
        this.uncertainServerOps.delete(opKey);
        this.lastUncertainOpenShiftId = null;
        const committed = data.shift as CashRegisterShift;
        this.commitOpenShiftLocally(committed);
        return { success: true, synced: true, shift: committed };
      }

      const resolution = await this.resolveFinancialHttpFailure(parsed, 'a abertura do caixa');
      if (resolution.kind === 'rejected') {
        this.uncertainServerOps.delete(opKey);
        this.lastUncertainOpenShiftId = null;
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error: resolution.error,
        };
      }

      const rec = await recoverOpenState();
      if (rec.status === 'recovered') return rec.result;
      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          shift: null,
          error: resolution.nonCommittedError,
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      this.lastUncertainOpenShiftId = shiftId;
      return {
        success: false,
        synced: false,
        uncertain: true,
        shift: null,
        error: resolution.uncertainError,
      };
    } catch (fetchErr: unknown) {
      const rec = await recoverOpenState();
      if (rec.status === 'recovered') return rec.result;
      const isTimeout = this.isTimeoutFetchError(fetchErr);

      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          shift: null,
          error: isTimeout
            ? 'Tempo esgotado ao abrir caixa; consulta ao servidor confirmou que nenhum turno foi aberto.'
            : 'Falha de conexão ao abrir caixa; consulta ao servidor confirmou que nenhum turno foi aberto.',
        };
      }

      const health = await this.checkServerAdminSdkHealth();
      if (health.reachable && health.hasAdminSdk === false) {
        this.uncertainServerOps.delete(opKey);
        this.lastUncertainOpenShiftId = null;
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error:
            'Não foi possível abrir o caixa: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      this.lastUncertainOpenShiftId = shiftId;
      return {
        success: false,
        synced: false,
        uncertain: true,
        shift: null,
        error: isTimeout
          ? 'Tempo esgotado ao abrir caixa no servidor e o resultado permanece desconhecido. Nenhum turno local falso foi criado.'
          : 'Falha de conexão ao abrir caixa no servidor e o resultado permanece desconhecido. Nenhum turno local falso foi criado.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public closeCashRegister(countedCash: number, closedBy: string, notes?: string): CashRegisterShift | null {
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para fechar o caixa.');
      return null;
    }

    if (this.shouldUseServerAtomicPayment()) {
      console.warn('[Security Guard] Em modo nuvem/atômico, use exclusivamente closeCashRegisterAsync().');
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
      } else if (m.type === 'ESTORNO' && m.paymentMethod === 'DINHEIRO') {
        expectedCashInDrawer -= m.amount;
      } else if (m.type === 'AJUSTE') {
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
    };
    if (notes && notes.trim()) {
      closedShift.notes = notes.trim();
    }

    const cleanClosed = this.cleanForFirestore(closedShift);
    const history = this.getCashShiftHistory();
    history.unshift(cleanClosed);
    localStorage.setItem('gf_cash_shifts_history', JSON.stringify(history));

    this.saveCurrentCashShift(null);
    return cleanClosed;
  }

  public async closeCashRegisterAsync(
    countedCash: number,
    closedBy: string,
    notes?: string,
    options?: { shiftId?: string; timeoutMs?: number }
  ): Promise<{
    success: boolean;
    synced: boolean;
    rejected?: boolean;
    uncertain?: boolean;
    recoveredFromTimeout?: boolean;
    shift: CashRegisterShift | null;
    error?: string;
  }> {
    if (!this.canUserManageCash()) {
      return {
        success: false,
        synced: false,
        rejected: true,
        shift: null,
        error: 'Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem fechar o caixa.',
      };
    }

    if (!this.shouldUseServerAtomicPayment()) {
      const closed = this.closeCashRegister(countedCash, closedBy, notes);
      return closed
        ? { success: true, synced: false, shift: closed }
        : { success: false, synced: false, rejected: true, shift: null, error: 'Nenhum turno de caixa aberto para fechar.' };
    }

    const shift = this.getCurrentCashShift();
    const targetShiftId = options?.shiftId || shift?.id;
    if (!targetShiftId) {
      return {
        success: false,
        synced: false,
        rejected: true,
        shift: null,
        error: 'Nenhum turno de caixa aberto encontrado para fechamento.',
      };
    }

    if (isFirebaseReady()) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser) {
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error: 'Sessão Firebase não autenticada. Faça login novamente antes de fechar o caixa.',
        };
      }
    }

    if (typeof fetch !== 'function') {
      return {
        success: false,
        synced: false,
        rejected: true,
        shift: null,
        error: 'Cliente HTTP indisponível para fechamento de caixa no servidor.',
      };
    }

    const authHeaders = await this.getFirebaseAuthHeaders();
    const opKey = `close:${targetShiftId}:${shift?.openedAt || ''}`;

    // Before sending a new close request after an uncertain outcome, consult authoritative server state first.
    if (this.uncertainServerOps.has(opKey)) {
      const preState = await this.consultCashShiftState(targetShiftId, authHeaders);
      if (preState.verified && preState.exists && preState.shift?.status === 'FECHADO') {
        this.uncertainServerOps.delete(opKey);
        this.commitClosedShiftHistoryLocally(preState.shift);
        return {
          success: true,
          synced: true,
          recoveredFromTimeout: true,
          shift: preState.shift,
        };
      }
      if (preState.verified && preState.exists && preState.shift?.status === 'ABERTO') {
        this.uncertainServerOps.delete(opKey);
      } else if (preState.verified && !preState.exists) {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error: `Turno de caixa '${targetShiftId}' não encontrado no servidor (HTTP 404).`,
        };
      } else {
        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          return {
            success: false,
            synced: false,
            rejected: true,
            shift: null,
            error:
              'Não foi possível confirmar o fechamento do caixa: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }
        return {
          success: false,
          synced: false,
          uncertain: true,
          shift: null,
          error:
            'Não foi possível confirmar o estado atual do turno no servidor após falha anterior. O fechamento não foi repetido automaticamente; verifique o estado do servidor antes de tentar novamente.',
        };
      }
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const recoverCloseState = async () => {
      const state = await this.consultCashShiftState(targetShiftId, authHeaders);
      if (state.verified && state.exists && state.shift?.status === 'FECHADO') {
        this.uncertainServerOps.delete(opKey);
        this.commitClosedShiftHistoryLocally(state.shift);
        return {
          status: 'recovered' as const,
          result: { success: true, synced: true, recoveredFromTimeout: true, shift: state.shift },
        };
      }
      if (state.verified && state.exists && state.shift?.status === 'ABERTO') {
        this.uncertainServerOps.delete(opKey);
        return { status: 'not_committed' as const };
      }
      if (state.verified && !state.exists) {
        this.uncertainServerOps.delete(opKey);
        return { status: 'not_found' as const };
      }
      return { status: 'unknown' as const };
    };

    try {
      const res = await fetch(`/api/cash-shifts/${encodeURIComponent(targetShiftId)}/close`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          countedCash: Math.max(0, roundCurrency(countedCash)),
          closedBy: closedBy.trim() || 'Operador',
          notes: notes?.trim() || undefined,
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data;

      if (
        parsed.ok &&
        !parsed.isHtml &&
        parsed.isValidJson &&
        data?.success === true &&
        data?.shift &&
        data.shift.id === targetShiftId &&
        data.shift.status === 'FECHADO'
      ) {
        this.uncertainServerOps.delete(opKey);
        const committed = data.shift as CashRegisterShift;
        this.commitClosedShiftHistoryLocally(committed);
        return { success: true, synced: true, shift: committed };
      }

      const resolution = await this.resolveFinancialHttpFailure(parsed, 'o fechamento do caixa');
      if (resolution.kind === 'rejected') {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error: resolution.error,
        };
      }

      const rec = await recoverCloseState();
      if (rec.status === 'recovered') return rec.result;
      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          shift: null,
          error: resolution.nonCommittedError,
        };
      }
      if (rec.status === 'not_found') {
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error: `Turno de caixa '${targetShiftId}' não encontrado no servidor.`,
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        shift: null,
        error: resolution.uncertainError,
      };
    } catch (fetchErr: unknown) {
      const rec = await recoverCloseState();
      if (rec.status === 'recovered') return rec.result;
      const isTimeout = this.isTimeoutFetchError(fetchErr);

      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          shift: null,
          error: isTimeout
            ? 'Tempo esgotado ao fechar o caixa; consulta ao servidor confirmou que o turno permanece ABERTO.'
            : 'Falha de conexão ao fechar o caixa; consulta ao servidor confirmou que o turno permanece ABERTO.',
        };
      }
      if (rec.status === 'not_found') {
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error: `Turno de caixa '${targetShiftId}' não encontrado no servidor.`,
        };
      }

      const health = await this.checkServerAdminSdkHealth();
      if (health.reachable && health.hasAdminSdk === false) {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          shift: null,
          error:
            'Não foi possível confirmar o fechamento do caixa: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        shift: null,
        error: isTimeout
          ? 'Tempo esgotado ao fechar caixa no servidor e não foi possível confirmar o resultado. O caixa local permanece intacto; o sistema consultará o estado antes de reenviar.'
          : 'Falha de conexão ao fechar caixa no servidor e não foi possível confirmar o resultado. O caixa local permanece intacto; o sistema consultará o estado antes de reenviar.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public addCashMovement(
    type: CashMovementType,
    amount: number,
    description: string,
    author: string,
    paymentMethod: PaymentMethod = 'DINHEIRO',
    employeeName?: string,
    orderId?: string,
    orderNumber?: string
  ): CashMovement | null {
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para movimentações de caixa.');
      return null;
    }

    if (this.shouldUseServerAtomicPayment()) {
      console.warn('[Security Guard] Em modo nuvem/atômico, use exclusivamente addCashMovementAsync().');
      return null;
    }

    const shift = this.getCurrentCashShift();
    if (!shift || shift.status !== 'ABERTO') return null;

    const movement: CashMovement = {
      id: `cash-mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      type,
      amount: Math.abs(amount),
      paymentMethod,
      description: description.trim(),
      author,
    };

    if (employeeName && employeeName.trim()) {
      movement.employeeName = employeeName.trim();
    }
    if (orderId && orderId.trim()) {
      movement.orderId = orderId.trim();
    }
    if (orderNumber && orderNumber.trim()) {
      movement.orderNumber = orderNumber.trim();
    }

    shift.movements.push(movement);
    this.saveCurrentCashShift(shift);
    return movement;
  }

  public async addCashMovementAsync(
    type: 'SANGRIA' | 'SUPRIMENTO' | 'VALE',
    amount: number,
    description: string,
    author: string,
    paymentMethod: PaymentMethod = 'DINHEIRO',
    employeeName?: string,
    options?: { movementId?: string; shiftId?: string; timeoutMs?: number }
  ): Promise<{
    success: boolean;
    synced: boolean;
    rejected?: boolean;
    uncertain?: boolean;
    recoveredFromTimeout?: boolean;
    movement: CashMovement | null;
    shift?: CashRegisterShift | null;
    error?: string;
  }> {
    if (!this.canUserManageCash()) {
      return {
        success: false,
        synced: false,
        rejected: true,
        movement: null,
        error: 'Permissão insuficiente: perfil não autorizado a lançar movimentações de caixa.',
      };
    }

    if (!this.shouldUseServerAtomicPayment()) {
      const mov = this.addCashMovement(type, amount, description, author, paymentMethod, employeeName);
      return mov
        ? { success: true, synced: false, movement: mov, shift: this.getCurrentCashShift() }
        : { success: false, synced: false, rejected: true, movement: null, error: 'Nenhum turno de caixa aberto.' };
    }

    const targetShiftId = options?.shiftId || this.getCurrentCashShift()?.id;
    if (!targetShiftId) {
      return {
        success: false,
        synced: false,
        rejected: true,
        movement: null,
        error: 'Nenhum turno de caixa aberto encontrado no momento.',
      };
    }

    if (isFirebaseReady()) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser) {
        return {
          success: false,
          synced: false,
          rejected: true,
          movement: null,
          error: 'Sessão Firebase não autenticada. Faça login novamente.',
        };
      }
    }

    if (typeof fetch !== 'function') {
      return {
        success: false,
        synced: false,
        rejected: true,
        movement: null,
        error: 'Cliente HTTP indisponível para movimentação de caixa.',
      };
    }

    const movementId = options?.movementId || `cash-mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const authHeaders = await this.getFirebaseAuthHeaders();
    const opKey = options?.movementId ? `mov:${targetShiftId}:${movementId}` : null;

    if (opKey && this.uncertainServerOps.has(opKey)) {
      const preState = await this.consultCashShiftState(targetShiftId, authHeaders);
      const remoteShift = preState.shift || undefined;
      const foundMov = remoteShift?.movements?.find((m) => m.id === movementId);
      if (preState.verified && remoteShift && foundMov) {
        this.uncertainServerOps.delete(opKey);
        if (remoteShift.status === 'ABERTO') this.commitOpenShiftLocally(remoteShift);
        return {
          success: true,
          synced: true,
          recoveredFromTimeout: true,
          movement: foundMov,
          shift: remoteShift,
        };
      }
      if (preState.verified && preState.exists && remoteShift?.status === 'FECHADO') {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          movement: null,
          error: `Operação recusada: O turno de caixa '${targetShiftId}' já está FECHADO (HTTP 409).`,
        };
      }
      if (preState.verified && preState.exists && remoteShift?.status === 'ABERTO' && !foundMov) {
        this.uncertainServerOps.delete(opKey);
      } else {
        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          return {
            success: false,
            synced: false,
            rejected: true,
            movement: null,
            error:
              'Não foi possível gravar a movimentação: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }
        return {
          success: false,
          synced: false,
          uncertain: true,
          movement: null,
          error:
            'Não foi possível verificar o lançamento anterior no servidor. A requisição não foi repetida para evitar duplicidade.',
        };
      }
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const recoverMovementState = async () => {
      const state = await this.consultCashShiftState(targetShiftId, authHeaders);
      const remoteShift = state.shift || undefined;
      const foundMov = remoteShift?.movements?.find((m) => m.id === movementId);
      if (state.verified && remoteShift && foundMov) {
        if (opKey) this.uncertainServerOps.delete(opKey);
        if (remoteShift.status === 'ABERTO') this.commitOpenShiftLocally(remoteShift);
        return {
          status: 'recovered' as const,
          result: {
            success: true,
            synced: true,
            recoveredFromTimeout: true,
            movement: foundMov,
            shift: remoteShift,
          },
        };
      }
      if (state.verified && (!state.exists || (remoteShift && !foundMov))) {
        if (opKey) this.uncertainServerOps.delete(opKey);
        return { status: 'not_committed' as const };
      }
      return { status: 'unknown' as const };
    };

    try {
      const res = await fetch(`/api/cash-shifts/${encodeURIComponent(targetShiftId)}/movements`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          movement: {
            id: movementId,
            type,
            amount: roundCurrency(Math.abs(amount)),
            paymentMethod,
            description: description.trim(),
            author: author.trim() || 'admin',
            ...(employeeName?.trim() ? { employeeName: employeeName.trim() } : {}),
          },
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data;

      if (
        parsed.ok &&
        !parsed.isHtml &&
        parsed.isValidJson &&
        data?.success === true &&
        data?.shift &&
        data.shift.id &&
        data?.movement &&
        data.movement.id
      ) {
        if (opKey) this.uncertainServerOps.delete(opKey);
        this.commitOpenShiftLocally(data.shift as CashRegisterShift);
        return {
          success: true,
          synced: true,
          movement: data.movement as CashMovement,
          shift: data.shift as CashRegisterShift,
        };
      }

      const resolution = await this.resolveFinancialHttpFailure(parsed, 'a movimentação de caixa');
      if (resolution.kind === 'rejected') {
        if (opKey) this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          movement: null,
          error: resolution.error,
        };
      }

      const rec = await recoverMovementState();
      if (rec.status === 'recovered') return rec.result;
      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          movement: null,
          error: resolution.nonCommittedError,
        };
      }

      if (opKey) this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        movement: null,
        error: resolution.uncertainError,
      };
    } catch (fetchErr: unknown) {
      const rec = await recoverMovementState();
      if (rec.status === 'recovered') return rec.result;
      const isTimeout = this.isTimeoutFetchError(fetchErr);

      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          movement: null,
          error: isTimeout
            ? 'Tempo esgotado ao gravar lançamento; consulta ao servidor confirmou que não foi registrado.'
            : 'Falha de conexão ao gravar lançamento; consulta ao servidor confirmou que não foi registrado.',
        };
      }

      const health = await this.checkServerAdminSdkHealth();
      if (health.reachable && health.hasAdminSdk === false) {
        if (opKey) this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          movement: null,
          error:
            'Não foi possível gravar a movimentação: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
        };
      }

      if (opKey) this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        movement: null,
        error: isTimeout
          ? 'Tempo esgotado ao gravar lançamento no servidor e o resultado permanece desconhecido.'
          : 'Falha de comunicação ao gravar lançamento no servidor e não foi possível confirmar o resultado.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public adjustDrawerBalance(newBalance: number, reason: string, author: string): CashMovement | null {
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para ajustar saldo do caixa.');
      return null;
    }

    if (this.shouldUseServerAtomicPayment()) {
      console.warn('[Security Guard] Em modo nuvem/atômico, use exclusivamente adjustDrawerBalanceAsync().');
      return null;
    }

    const shift = this.getCurrentCashShift();
    if (!shift || shift.status !== 'ABERTO') return null;

    let currentDrawer = shift.initialBalance;
    shift.movements.forEach((m: CashMovement) => {
      if (m.type === 'SUPRIMENTO') {
        currentDrawer += m.amount;
      } else if (m.type === 'SANGRIA' || m.type === 'VALE') {
        currentDrawer -= m.amount;
      } else if (m.type === 'VENDA' && m.paymentMethod === 'DINHEIRO') {
        currentDrawer += m.amount;
      } else if (m.type === 'ESTORNO' && m.paymentMethod === 'DINHEIRO') {
        currentDrawer -= m.amount;
      } else if (m.type === 'AJUSTE') {
        currentDrawer += m.amount;
      }
    });

    const diff = Number((newBalance - currentDrawer).toFixed(2));
    if (diff === 0) return null;

    const diffFormatted = diff > 0 ? `+R$ ${diff.toFixed(2)}` : `-R$ ${Math.abs(diff).toFixed(2)}`;
    const movement: CashMovement = {
      id: `cash-mov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'AJUSTE',
      amount: diff,
      paymentMethod: 'DINHEIRO',
      description: reason?.trim() 
        ? `Ajuste manual de saldo da gaveta (${diffFormatted}): ${reason.trim()}` 
        : `Ajuste manual de saldo da gaveta (${diffFormatted})`,
      author: author?.trim() || 'admin',
    };

    shift.movements.push(movement);
    this.saveCurrentCashShift(shift);
    return movement;
  }

  public async adjustDrawerBalanceAsync(
    newBalance: number,
    reason: string,
    author: string,
    options?: { movementId?: string; shiftId?: string; timeoutMs?: number }
  ): Promise<{
    success: boolean;
    synced: boolean;
    rejected?: boolean;
    uncertain?: boolean;
    recoveredFromTimeout?: boolean;
    movement: CashMovement | null;
    shift?: CashRegisterShift | null;
    error?: string;
  }> {
    if (!this.canUserManageCash()) {
      return {
        success: false,
        synced: false,
        rejected: true,
        movement: null,
        error: 'Permissão insuficiente: perfil não autorizado a ajustar saldo do caixa.',
      };
    }

    if (!this.shouldUseServerAtomicPayment()) {
      const mov = this.adjustDrawerBalance(newBalance, reason, author);
      return mov
        ? { success: true, synced: false, movement: mov, shift: this.getCurrentCashShift() }
        : { success: false, synced: false, rejected: true, movement: null, error: 'Nenhum ajuste necessário ou turno fechado.' };
    }

    const targetShiftId = options?.shiftId || this.getCurrentCashShift()?.id;
    if (!targetShiftId) {
      return {
        success: false,
        synced: false,
        rejected: true,
        movement: null,
        error: 'Nenhum turno de caixa aberto encontrado.',
      };
    }

    if (isFirebaseReady()) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser) {
        return {
          success: false,
          synced: false,
          rejected: true,
          movement: null,
          error: 'Sessão Firebase não autenticada. Faça login novamente.',
        };
      }
    }

    if (typeof fetch !== 'function') {
      return {
        success: false,
        synced: false,
        rejected: true,
        movement: null,
        error: 'Cliente HTTP indisponível.',
      };
    }

    const movementId = options?.movementId || `cash-adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const authHeaders = await this.getFirebaseAuthHeaders();
    const opKey = options?.movementId ? `adj:${targetShiftId}:${movementId}` : null;

    if (opKey && this.uncertainServerOps.has(opKey)) {
      const preState = await this.consultCashShiftState(targetShiftId, authHeaders);
      const remoteShift = preState.shift || undefined;
      const foundMov = remoteShift?.movements?.find((m) => m.id === movementId);
      if (preState.verified && remoteShift && foundMov) {
        this.uncertainServerOps.delete(opKey);
        if (remoteShift.status === 'ABERTO') this.commitOpenShiftLocally(remoteShift);
        return {
          success: true,
          synced: true,
          recoveredFromTimeout: true,
          movement: foundMov,
          shift: remoteShift,
        };
      }
      if (preState.verified && preState.exists && remoteShift?.status === 'FECHADO') {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          movement: null,
          error: `Operação recusada: O turno de caixa '${targetShiftId}' já está FECHADO (HTTP 409).`,
        };
      }
      if (preState.verified && preState.exists && remoteShift?.status === 'ABERTO' && !foundMov) {
        this.uncertainServerOps.delete(opKey);
      } else {
        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          return {
            success: false,
            synced: false,
            rejected: true,
            movement: null,
            error:
              'Não foi possível ajustar o saldo da gaveta: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }
        return {
          success: false,
          synced: false,
          uncertain: true,
          movement: null,
          error:
            'Não foi possível verificar o ajuste anterior no servidor. A requisição não foi repetida automaticamente.',
        };
      }
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const recoverAdjustState = async () => {
      const state = await this.consultCashShiftState(targetShiftId, authHeaders);
      const remoteShift = state.shift || undefined;
      const foundMov = remoteShift?.movements?.find((m) => m.id === movementId);
      if (state.verified && remoteShift && foundMov) {
        if (opKey) this.uncertainServerOps.delete(opKey);
        if (remoteShift.status === 'ABERTO') this.commitOpenShiftLocally(remoteShift);
        return {
          status: 'recovered' as const,
          result: {
            success: true,
            synced: true,
            recoveredFromTimeout: true,
            movement: foundMov,
            shift: remoteShift,
          },
        };
      }
      if (state.verified && (!state.exists || (remoteShift && !foundMov))) {
        if (opKey) this.uncertainServerOps.delete(opKey);
        return { status: 'not_committed' as const };
      }
      return { status: 'unknown' as const };
    };

    try {
      const res = await fetch(`/api/cash-shifts/${encodeURIComponent(targetShiftId)}/adjust`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          movementId,
          newBalance: roundCurrency(newBalance),
          reason: reason?.trim() || '',
          author: author?.trim() || 'admin',
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data;

      if (
        parsed.ok &&
        !parsed.isHtml &&
        parsed.isValidJson &&
        data?.success === true &&
        data?.shift &&
        data.shift.id &&
        data?.movement &&
        data.movement.id
      ) {
        if (opKey) this.uncertainServerOps.delete(opKey);
        this.commitOpenShiftLocally(data.shift as CashRegisterShift);
        return {
          success: true,
          synced: true,
          movement: data.movement as CashMovement,
          shift: data.shift as CashRegisterShift,
        };
      }

      const resolution = await this.resolveFinancialHttpFailure(parsed, 'o ajuste de saldo da gaveta');
      if (resolution.kind === 'rejected') {
        if (opKey) this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          movement: null,
          error: resolution.error,
        };
      }

      const rec = await recoverAdjustState();
      if (rec.status === 'recovered') return rec.result;
      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          movement: null,
          error: resolution.nonCommittedError,
        };
      }

      if (opKey) this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        movement: null,
        error: resolution.uncertainError,
      };
    } catch (fetchErr: unknown) {
      const rec = await recoverAdjustState();
      if (rec.status === 'recovered') return rec.result;
      const isTimeout = this.isTimeoutFetchError(fetchErr);

      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          movement: null,
          error: isTimeout
            ? 'Tempo esgotado ao ajustar saldo; consulta ao servidor confirmou que o ajuste não foi gravado.'
            : 'Falha de conexão ao ajustar saldo; consulta ao servidor confirmou que o ajuste não foi gravado.',
        };
      }

      const health = await this.checkServerAdminSdkHealth();
      if (health.reachable && health.hasAdminSdk === false) {
        if (opKey) this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          movement: null,
          error:
            'Não foi possível ajustar o saldo da gaveta: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
        };
      }

      if (opKey) this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        movement: null,
        error: isTimeout
          ? 'Tempo esgotado ao ajustar saldo no servidor e não foi possível confirmar o resultado.'
          : 'Falha de comunicação ao ajustar saldo no servidor e não foi possível confirmar o resultado.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public deleteCashMovement(movementId: string): boolean {
    if (!this.canUserManageCash()) {
      console.warn('[Security Guard] Acesso negado: Perfil não possui permissão para excluir movimentações do caixa.');
      return false;
    }

    if (this.shouldUseServerAtomicPayment()) {
      console.warn('[Security Guard] Em modo nuvem/atômico, use exclusivamente deleteCashMovementAsync().');
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

  public async deleteCashMovementAsync(
    movementId: string,
    options?: { shiftId?: string; timeoutMs?: number }
  ): Promise<{
    success: boolean;
    synced: boolean;
    rejected?: boolean;
    uncertain?: boolean;
    recoveredFromTimeout?: boolean;
    shift?: CashRegisterShift | null;
    error?: string;
  }> {
    if (!this.canUserManageCash()) {
      return {
        success: false,
        synced: false,
        rejected: true,
        error: 'Permissão insuficiente: perfil não autorizado a excluir lançamentos do caixa.',
      };
    }

    if (!this.shouldUseServerAtomicPayment()) {
      const ok = this.deleteCashMovement(movementId);
      return ok
        ? { success: true, synced: false, shift: this.getCurrentCashShift() }
        : { success: false, synced: false, rejected: true, error: 'Não foi possível excluir o lançamento.' };
    }

    const targetShiftId = options?.shiftId || this.getCurrentCashShift()?.id;
    if (!targetShiftId) {
      return {
        success: false,
        synced: false,
        rejected: true,
        error: 'Nenhum turno de caixa aberto encontrado.',
      };
    }

    if (isFirebaseReady()) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser) {
        return {
          success: false,
          synced: false,
          rejected: true,
          error: 'Sessão Firebase não autenticada. Faça login novamente.',
        };
      }
    }

    if (typeof fetch !== 'function') {
      return {
        success: false,
        synced: false,
        rejected: true,
        error: 'Cliente HTTP indisponível.',
      };
    }

    const authHeaders = await this.getFirebaseAuthHeaders();
    const opKey = `del:${targetShiftId}:${movementId}`;

    if (this.uncertainServerOps.has(opKey)) {
      const preState = await this.consultCashShiftState(targetShiftId, authHeaders);
      const remoteShift = preState.shift || undefined;
      if (preState.verified && remoteShift && remoteShift.status === 'ABERTO') {
        const stillExists = remoteShift.movements?.some((m) => m.id === movementId);
        this.uncertainServerOps.delete(opKey);
        if (!stillExists) {
          this.commitOpenShiftLocally(remoteShift);
          return {
            success: true,
            synced: true,
            recoveredFromTimeout: true,
            shift: remoteShift,
          };
        }
      } else if (preState.verified && remoteShift && remoteShift.status === 'FECHADO') {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          error: `Operação recusada: O turno de caixa '${targetShiftId}' já está FECHADO (HTTP 409).`,
        };
      } else {
        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          return {
            success: false,
            synced: false,
            rejected: true,
            error:
              'Não foi possível excluir o lançamento: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }
        return {
          success: false,
          synced: false,
          uncertain: true,
          error:
            'Não foi possível verificar o estado atual do lançamento no servidor. A exclusão não foi repetida automaticamente.',
        };
      }
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    const recoverDeleteState = async () => {
      const state = await this.consultCashShiftState(targetShiftId, authHeaders);
      const remoteShift = state.shift || undefined;
      if (state.verified && remoteShift && remoteShift.status === 'ABERTO') {
        const stillExists = remoteShift.movements?.some((m) => m.id === movementId);
        this.uncertainServerOps.delete(opKey);
        if (!stillExists) {
          this.commitOpenShiftLocally(remoteShift);
          return {
            status: 'recovered' as const,
            result: {
              success: true,
              synced: true,
              recoveredFromTimeout: true,
              shift: remoteShift,
            },
          };
        }
        return { status: 'not_committed' as const };
      }
      if (state.verified && (!state.exists || remoteShift?.status === 'FECHADO')) {
        this.uncertainServerOps.delete(opKey);
        return { status: 'not_committed' as const };
      }
      return { status: 'unknown' as const };
    };

    try {
      const res = await fetch(
        `/api/cash-shifts/${encodeURIComponent(targetShiftId)}/movements/${encodeURIComponent(movementId)}`,
        {
          method: 'DELETE',
          headers: authHeaders,
          ...(controller ? { signal: controller.signal } : {}),
        }
      );
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data;

      if (
        parsed.ok &&
        !parsed.isHtml &&
        parsed.isValidJson &&
        data?.success === true &&
        data?.shift &&
        data.shift.id &&
        data.shift.status === 'ABERTO'
      ) {
        this.uncertainServerOps.delete(opKey);
        this.commitOpenShiftLocally(data.shift as CashRegisterShift);
        return {
          success: true,
          synced: true,
          shift: data.shift as CashRegisterShift,
        };
      }

      const resolution = await this.resolveFinancialHttpFailure(parsed, 'a exclusão do lançamento no caixa');
      if (resolution.kind === 'rejected') {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          error: resolution.error,
        };
      }

      const rec = await recoverDeleteState();
      if (rec.status === 'recovered') return rec.result;
      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          error: resolution.nonCommittedError,
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        error: resolution.uncertainError,
      };
    } catch (fetchErr: unknown) {
      const rec = await recoverDeleteState();
      if (rec.status === 'recovered') return rec.result;
      const isTimeout = this.isTimeoutFetchError(fetchErr);

      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          error: isTimeout
            ? 'Tempo esgotado ao excluir lançamento; consulta ao servidor confirmou que o lançamento permanece ativo.'
            : 'Falha de conexão ao excluir lançamento; consulta ao servidor confirmou que o lançamento permanece ativo.',
        };
      }

      const health = await this.checkServerAdminSdkHealth();
      if (health.reachable && health.hasAdminSdk === false) {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          error:
            'Não foi possível excluir o lançamento: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        error: isTimeout
          ? 'Tempo esgotado ao excluir lançamento no servidor e o resultado permanece desconhecido.'
          : 'Falha de comunicação ao excluir lançamento no servidor e não foi possível confirmar o resultado.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ==========================================
  // DAILY DELIVERY SHIFTS API (SUPERVISÃO DE ENTREGAS)
  // ==========================================
  public getCurrentDeliveryShift(): DeliveryShift | null {
    try {
      const data = localStorage.getItem('gf_current_delivery_shift');
      if (data) return JSON.parse(data);

      // Default active open delivery shift for today (Fortaleza TZ)
      const today = getFortalezaDateKey();
      const defaultShift: DeliveryShift = {
        id: `del-shift-${today}`,
        date: today,
        status: 'ABERTO',
        openedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
        openedBy: {
          userId: 'usr-admin-1',
          userName: 'Administrador Geral',
          userRole: 'ADMINISTRADOR',
        },
        notes: 'Movimento diário de entregas iniciado automaticamente pelo sistema',
      };
      localStorage.setItem('gf_current_delivery_shift', JSON.stringify(defaultShift));
      return defaultShift;
    } catch {
      return null;
    }
  }

  public saveCurrentDeliveryShift(shift: DeliveryShift | null): void {
    if (shift) {
      const cleanShift = this.cleanForFirestore(shift);
      try {
        localStorage.setItem('gf_current_delivery_shift', JSON.stringify(cleanShift));
      } catch {}
      if (db) {
        setDoc(doc(db, 'delivery_shifts', shift.id), cleanShift).catch(async (err) => {
          console.warn('[Firestore Delivery Shift] Direct write notice:', err);
          if (typeof window !== 'undefined' && typeof fetch === 'function') {
            try {
              let authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
              if (auth?.currentUser) {
                try {
                  const idToken = await auth.currentUser.getIdToken();
                  if (idToken) authHeaders['Authorization'] = `Bearer ${idToken}`;
                } catch {}
              }
              const res = await fetch('/api/delivery-shifts', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ shift: cleanShift }),
              });
              if (res.ok) return;
            } catch {
              // Fallback error
            }
          }
          handleFirestoreError(err, OperationType.WRITE, `delivery_shifts/${shift.id}`);
        });
      }
    } else {
      localStorage.removeItem('gf_current_delivery_shift');
    }
    this.notify('DELIVERY_SHIFT_UPDATED', shift);
  }

  public getDeliveryShiftHistory(): DeliveryShift[] {
    try {
      const data = localStorage.getItem('gf_delivery_shifts_history');
      if (!data) return [];
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  public openDeliveryShift(
    openedBy: { userId: string; userName: string; userRole: string },
    notes?: string
  ): { success: boolean; shift?: DeliveryShift; message: string } {
    const current = this.getCurrentDeliveryShift();
    if (current && current.status === 'ABERTO') {
      return { success: false, shift: current, message: 'Já existe um movimento diário de entregas aberto.' };
    }

    const today = getFortalezaDateKey();
    const newShift: DeliveryShift = {
      id: `del-shift-${today}-${Date.now()}`,
      date: today,
      status: 'ABERTO',
      openedAt: new Date().toISOString(),
      openedBy,
      notes: notes || 'Abertura de movimento diário de entregas',
    };

    this.saveCurrentDeliveryShift(newShift);
    return { success: true, shift: newShift, message: 'Movimento diário de entregas aberto com sucesso!' };
  }

  public closeDeliveryShift(
    closedBy: { userId: string; userName: string; userRole: string },
    summary: DeliveryShiftSummary,
    notes?: string
  ): { success: boolean; shift?: DeliveryShift; message: string } {
    const shift = this.getCurrentDeliveryShift();
    if (!shift || shift.status !== 'ABERTO') {
      return { success: false, message: 'Não há movimento diário de entregas aberto para encerramento.' };
    }

    const closedShift: DeliveryShift = {
      ...shift,
      status: 'FECHADO',
      closedAt: new Date().toISOString(),
      closedBy,
      summary,
      notes: notes || shift.notes,
    };

    const history = this.getDeliveryShiftHistory();
    history.unshift(closedShift);
    try {
      localStorage.setItem('gf_delivery_shifts_history', JSON.stringify(history));
    } catch {}

    this.saveCurrentDeliveryShift(closedShift);

    return { 
      success: true, 
      shift: closedShift, 
      message: 'Movimento diário de entregas fechado com sucesso! Os pedidos pendentes continuam preservados para o próximo movimento.' 
    };
  }

  public reopenDeliveryShift(
    reopenedBy: { userId: string; userName: string; userRole: string }
  ): { success: boolean; shift?: DeliveryShift; message: string } {
    const shift = this.getCurrentDeliveryShift();
    if (shift && shift.status === 'ABERTO') {
      return { success: false, message: 'O movimento diário de entregas já está aberto.' };
    }

    const targetShift: DeliveryShift = shift ? {
      ...shift,
      status: 'ABERTO',
      closedAt: undefined,
      closedBy: undefined,
      notes: `${shift.notes || ''} (Reaberto por ${reopenedBy.userName})`.trim(),
    } : {
      id: `del-shift-${getFortalezaDateKey()}-${Date.now()}`,
      date: getFortalezaDateKey(),
      status: 'ABERTO',
      openedAt: new Date().toISOString(),
      openedBy: reopenedBy,
      notes: `Reabertura por ${reopenedBy.userName}`,
    };

    this.saveCurrentDeliveryShift(targetShift);
    return { success: true, shift: targetShift, message: 'Movimento diário de entregas reaberto com sucesso!' };
  }

  public getDeliveryDrivers(): User[] {
    return this.getUsers().filter((u) => u.role?.toUpperCase() === 'ENTREGADOR');
  }

  /**
   * Returns ONLY users with role ENTREGADOR and status ATIVO.
   * Strictly excludes disabled, blocked, or other roles.
   */
  public getActiveDeliveryDrivers(): User[] {
    return this.getUsers().filter(
      (u) => (u.role?.toUpperCase() === 'ENTREGADOR') && u.status === 'ATIVO'
    );
  }

  /**
   * Automatically assigns unassigned delivery orders if there is EXACTLY 1 active delivery driver.
   * - 1 active driver: automatically assigns without requiring admin manual choice.
   * - >= 2 active drivers: remains unassigned for admin manual selection.
   * - 0 active drivers: remains unassigned with clear alert for administration.
   * Operates idempotently: assigns an order once without duplicate log spam.
   */
  public applyAutomaticDriverAssignment(): boolean {
    const activeDrivers = this.getActiveDeliveryDrivers();
    if (activeDrivers.length !== 1) {
      return false;
    }

    const soleDriver = activeDrivers[0];
    const soleDriverName = soleDriver.name || soleDriver.username;
    const orders = this.getOrders();
    let hasModified = false;
    const now = new Date().toISOString();

    for (const order of orders) {
      if (
        order.fulfillmentType === 'DELIVERY' &&
        order.status !== 'ENTREGUE' &&
        order.status !== 'CANCELADO' &&
        !order.deliveryPersonId &&
        !order.deliveryPerson
      ) {
        order.deliveryPersonId = soleDriver.id;
        order.deliveryPersonName = soleDriverName;
        order.deliveryPerson = {
          id: soleDriver.id,
          name: soleDriverName,
          phone: soleDriver.phone || '',
          assignedAt: now,
        };
        if (!order.deliveryAssignmentHistory) {
          order.deliveryAssignmentHistory = [];
        }
        order.deliveryAssignmentHistory.push({
          assignedAt: now,
          newDriverId: soleDriver.id,
          newDriverName: soleDriverName,
          assignedBy: 'Sistema (Atribuição Automática - Único Entregador Ativo)',
          reason: 'Atribuição automática: 1 entregador ativo no estabelecimento',
        });
        if (!order.movements) {
          order.movements = [];
        }
        order.movements.push({
          id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          timestamp: now,
          toStatus: order.status,
          author: 'Sistema',
          notes: `Pedido delivery atribuído automaticamente a ${soleDriverName} (único entregador ativo)`,
        });
        order.updatedAt = now;
        order._cloudSyncStatus = 'PENDING';
        hasModified = true;
        this.persistOrderToFirestore(order).catch(() => {});
      }
    }

    if (hasModified) {
      localStorage.setItem('gf_orders', JSON.stringify(orders));
      this.notify('ORDERS_UPDATED', { reason: 'AUTOMATIC_DRIVER_ASSIGNMENT' });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDERS_UPDATED' } }));
      }
    }

    return hasModified;
  }

  // ==========================================
  // RESTAURANT CONFIG & PUBLIC AVAILABILITY API
  // ==========================================
  public getRestaurantConfig(): RestaurantConfig {
    try {
      const data = localStorage.getItem('gf_restaurant_config');
      const parsed = data ? (JSON.parse(data) as RestaurantConfig) : INITIAL_CONFIG;
      const closedNormalized = normalizeClosedSettings(parsed);
      const rawKey = (parsed.pixKey || '').trim();
      const resolvedKeyType = parsed.pixKeyType || (rawKey ? inferPixKeyType(rawKey) : undefined);
      return {
        ...INITIAL_CONFIG,
        ...parsed,
        pixKey: rawKey,
        pixKeyType: resolvedKeyType,
        operatingHours: closedNormalized.operatingHours,
        closedPrimaryMessage: closedNormalized.closedPrimaryMessage,
        closedSecondaryMessage: closedNormalized.closedSecondaryMessage,
      };
    } catch {
      return INITIAL_CONFIG;
    }
  }

  public getOfficialPixConfigState(): OfficialPixConfigState {
    if (isFirebaseReady() && db) {
      if (!this.hasReceivedFirestoreConfig) {
        if (this.officialPixState.status === 'UNAVAILABLE') {
          return { ...this.officialPixState };
        }
        return {
          status: 'LOADING',
          source: 'none',
          hasValidPixKey: false,
          error: null,
          message: 'Carregando configuração oficial do PIX do Firebase...',
          lastSyncedAt: null,
        };
      }
      return { ...this.officialPixState };
    }

    if (this.officialPixState.status === 'UNAVAILABLE') {
      return { ...this.officialPixState };
    }

    const cfg = this.getRestaurantConfig();
    const check = this.evaluatePixConfigValidity(cfg);
    if (check.valid) {
      return {
        status: 'READY',
        source: this.hasReceivedFirestoreConfig ? 'firestore' : 'local_contingency',
        hasValidPixKey: true,
        error: null,
        message: null,
        lastSyncedAt: this.officialPixState.lastSyncedAt,
      };
    }

    return {
      status: 'MISSING',
      source: 'none',
      hasValidPixKey: false,
      error: check.error || 'Configuração oficial do PIX não disponível.',
      message:
        check.error ||
        'Configuração oficial do PIX indisponível no momento. Cadastre a chave em Configurações ou escolha outra forma de pagamento.',
      lastSyncedAt: null,
    };
  }

  public async refreshPublicConfigFromServer(): Promise<OfficialPixConfigState> {
    if (!isFirebaseReady() || !db) {
      return this.getOfficialPixConfigState();
    }
    if (!this.hasReceivedFirestoreConfig) {
      this.officialPixState = {
        status: 'LOADING',
        source: 'none',
        hasValidPixKey: false,
        error: null,
        message: 'Carregando configuração oficial do PIX do Firebase...',
        lastSyncedAt: null,
      };
      this.notify('CONFIG_UPDATED', this.getRestaurantConfig());
    }
    try {
      const serverSnap = await getDocFromServer(doc(db, 'configs', 'restaurant'));
      if (serverSnap.exists()) {
        const remotePublic = serverSnap.data() as Partial<RestaurantConfig>;
        const currentLocal = this.getRestaurantConfig();
        const remoteKey = typeof remotePublic.pixKey === 'string' ? remotePublic.pixKey.trim() : undefined;
        const resolvedRemoteType =
          remotePublic.pixKeyType || (remoteKey ? inferPixKeyType(remoteKey) : undefined);
        const mergedConfig: RestaurantConfig = {
          ...currentLocal,
          ...remotePublic,
          ...(remoteKey !== undefined ? { pixKey: remoteKey } : {}),
          ...(resolvedRemoteType ? { pixKeyType: resolvedRemoteType } : {}),
        };
        localStorage.setItem('gf_restaurant_config', JSON.stringify(mergedConfig));
        this.syncOfficialPixStateFromFirestore(mergedConfig, true);
        this.notify('CONFIG_UPDATED', mergedConfig);
      } else {
        this.syncOfficialPixStateFromFirestore(this.getRestaurantConfig(), false);
        this.notify('CONFIG_UPDATED', this.getRestaurantConfig());
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!this.hasReceivedFirestoreConfig) {
        this.officialPixState = {
          status: 'UNAVAILABLE',
          source: 'none',
          hasValidPixKey: false,
          error: msg,
          message: 'Não foi possível carregar a configuração oficial do PIX no Firebase. Use outra forma de pagamento ou tente novamente.',
          lastSyncedAt: null,
        };
        this.notify('CONFIG_UPDATED', this.getRestaurantConfig());
      }
    }
    return this.getOfficialPixConfigState();
  }

  public getLastPublicStoreAvailability(): PublicStoreAvailability | null {
    return this.lastPublicAvailability;
  }

  private markLastPublicAvailabilityClosed(
    reason: PublicStoreAvailability['reason'] = 'CASH_CLOSED',
    message?: string
  ): void {
    const cfg = this.getRestaurantConfig();
    const closedSettings = normalizeClosedSettings(cfg);
    const closedAvailability: PublicStoreAvailability = {
      verified: reason !== 'UNABLE_TO_VERIFY_CASH',
      isOpen: false,
      reason,
      message,
      activeShiftId: null,
      closedSettings: this.lastPublicAvailability?.closedSettings || closedSettings,
      restaurantPublicInfo: this.lastPublicAvailability?.restaurantPublicInfo || {
        name: cfg.name || 'Amandita Sabores',
        whatsapp: cfg.whatsapp || '',
        phone: cfg.phone || '',
        address: cfg.address || '',
        city: cfg.city || '',
      },
      checkedAt: new Date().toISOString(),
    };
    this.lastPublicAvailability = closedAvailability;
    try {
      localStorage.setItem('gf_restaurant_config', JSON.stringify({ ...cfg, isOpen: false }));
    } catch {}
    this.notify('STORE_AVAILABILITY_UPDATED', closedAvailability);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'STORE_AVAILABILITY_UPDATED', payload: closedAvailability } }));
    }
  }

  public async fetchPublicStoreAvailability(options?: { timeoutMs?: number }): Promise<PublicStoreAvailability> {
    const cfg = this.getRestaurantConfig();
    const fallbackClosedSettings = normalizeClosedSettings(cfg);
    const failClosed = (message?: string): PublicStoreAvailability => {
      const result: PublicStoreAvailability = {
        verified: false,
        isOpen: false,
        reason: 'UNABLE_TO_VERIFY_CASH',
        message: message || 'Não foi possível verificar no servidor se o estabelecimento está aberto no momento.',
        activeShiftId: null,
        closedSettings: this.lastPublicAvailability?.closedSettings || fallbackClosedSettings,
        restaurantPublicInfo: this.lastPublicAvailability?.restaurantPublicInfo || {
          name: cfg.name || 'Amandita Sabores',
          whatsapp: cfg.whatsapp || '',
          phone: cfg.phone || '',
          address: cfg.address || '',
          city: cfg.city || '',
        },
        checkedAt: new Date().toISOString(),
      };
      this.lastPublicAvailability = result;
      this.notify('STORE_AVAILABILITY_UPDATED', result);
      return result;
    };

    if (typeof fetch !== 'function') {
      return failClosed('Cliente HTTP indisponível para verificar abertura do caixa.');
    }

    const timeoutMs = options?.timeoutMs ?? 8000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await fetch('/api/store/availability', {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        ...(controller ? { signal: controller.signal } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || typeof data !== 'object' || data.success === false) {
        return failClosed(data?.message || `Servidor retornou erro HTTP ${res.status} ao verificar disponibilidade.`);
      }

      const closedSettings = normalizeClosedSettings(data.closedSettings || cfg);
      const serverInfo = (data.restaurantPublicInfo || {}) as Partial<PublicStoreAvailability['restaurantPublicInfo']>;
      const hasServerInfo = Boolean(data.hasServerRestaurantInfo);

      const mergedRestaurantInfo = {
        name: (hasServerInfo && serverInfo.name) ? serverInfo.name : (cfg.name || 'Amandita Sabores'),
        whatsapp: (hasServerInfo && serverInfo.whatsapp) ? serverInfo.whatsapp : (cfg.whatsapp || ''),
        phone: (hasServerInfo && serverInfo.phone) ? serverInfo.phone : (cfg.phone || ''),
        address: (hasServerInfo && serverInfo.address) ? serverInfo.address : (cfg.address || ''),
        city: (hasServerInfo && serverInfo.city) ? serverInfo.city : (cfg.city || ''),
      };

      const availability: PublicStoreAvailability = {
        verified: Boolean(data.verified),
        isOpen: Boolean(data.verified && data.isOpen),
        reason: data.reason || (data.verified && data.isOpen ? 'CASH_OPEN' : 'CASH_CLOSED'),
        message: typeof data.message === 'string' ? data.message : undefined,
        activeShiftId: typeof data.activeShiftId === 'string' ? data.activeShiftId : null,
        closedSettings,
        restaurantPublicInfo: mergedRestaurantInfo,
        hasServerRestaurantInfo: hasServerInfo,
        checkedAt: typeof data.checkedAt === 'string' ? data.checkedAt : new Date().toISOString(),
      };

      this.lastPublicAvailability = availability;

      const nextCfg: RestaurantConfig = {
        ...cfg,
        isOpen: availability.isOpen,
        operatingHours: closedSettings.operatingHours,
        closedPrimaryMessage: closedSettings.closedPrimaryMessage,
        closedSecondaryMessage: closedSettings.closedSecondaryMessage,
        ...(hasServerInfo && serverInfo.name ? { name: serverInfo.name } : {}),
        ...(hasServerInfo && serverInfo.whatsapp ? { whatsapp: serverInfo.whatsapp } : {}),
        ...(hasServerInfo && serverInfo.phone ? { phone: serverInfo.phone } : {}),
        ...(hasServerInfo && serverInfo.address ? { address: serverInfo.address } : {}),
        ...(hasServerInfo && serverInfo.city ? { city: serverInfo.city } : {}),
      };

      try {
        localStorage.setItem('gf_restaurant_config', JSON.stringify(nextCfg));
      } catch {}

      this.notify('STORE_AVAILABILITY_UPDATED', availability);
      return availability;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return failClosed(msg);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async loadStoreSettingsFromCloud(): Promise<{
    success: boolean;
    localOnly?: boolean;
    config?: RestaurantConfig;
    hasScheduleDoc?: boolean;
    hasRestaurantDoc?: boolean;
    error?: string;
  }> {
    const actor = this.getCurrentUser();
    if (!this.canUserManageConfig(actor)) {
      return {
        success: false,
        error: 'Permissão insuficiente: apenas Administrador ou Gerente podem carregar configurações administrativas.',
      };
    }

    const currentLocal = this.getRestaurantConfig();

    if (isFirebaseReady() && db) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser) {
        return {
          success: false,
          error: 'Sessão Firebase não autenticada. Faça login novamente para carregar as configurações da nuvem.',
        };
      }

      const confirmedRole = await this.verifyStaffRole(auth.currentUser);
      if (!confirmedRole || !['ADMINISTRADOR', 'GERENTE'].includes(confirmedRole.toUpperCase())) {
        return {
          success: false,
          error: 'Perfil ativo sem permissão no Firebase para ler configurações administrativas.',
        };
      }

      try {
        const [restSnap, schedSnap] = await Promise.all([
          getDocFromServer(doc(db, 'configs', 'restaurant')),
          getDocFromServer(doc(db, 'configs', 'store_schedule')),
        ]);

        let internalData: Partial<RestaurantConfig> = {};
        if (confirmedRole.toUpperCase() === 'ADMINISTRADOR') {
          try {
            const internalSnap = await getDocFromServer(doc(db, 'configs', 'internal'));
            if (internalSnap.exists()) {
              internalData = internalSnap.data() as Partial<RestaurantConfig>;
            }
          } catch {}
        }

        const remoteRestaurant = restSnap.exists() ? (restSnap.data() as Partial<RestaurantConfig>) : {};
        const remoteSchedule = schedSnap.exists()
          ? normalizeClosedSettings(schedSnap.data() as Partial<StoreClosedSettings>)
          : {
              operatingHours: currentLocal.operatingHours || DEFAULT_OPERATING_HOURS,
              closedPrimaryMessage: currentLocal.closedPrimaryMessage || DEFAULT_CLOSED_PRIMARY_MESSAGE,
              closedSecondaryMessage: currentLocal.closedSecondaryMessage ?? DEFAULT_CLOSED_SECONDARY_MESSAGE,
            };

        const mergedConfig: RestaurantConfig = {
          ...currentLocal,
          ...internalData,
          ...remoteRestaurant,
          operatingHours: remoteSchedule.operatingHours,
          closedPrimaryMessage: remoteSchedule.closedPrimaryMessage,
          closedSecondaryMessage: remoteSchedule.closedSecondaryMessage,
        };

        localStorage.setItem('gf_restaurant_config', JSON.stringify(mergedConfig));
        this.syncOfficialPixStateFromFirestore(mergedConfig, restSnap.exists());
        this.notify('CONFIG_UPDATED', mergedConfig);
        return {
          success: true,
          config: mergedConfig,
          hasRestaurantDoc: restSnap.exists(),
          hasScheduleDoc: schedSnap.exists(),
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!this.hasReceivedFirestoreConfig) {
          this.officialPixState = {
            status: 'UNAVAILABLE',
            source: 'none',
            hasValidPixKey: false,
            error: msg,
            message: 'Não foi possível carregar a configuração oficial do PIX no Firebase.',
            lastSyncedAt: null,
          };
          this.notify('CONFIG_UPDATED', currentLocal);
        }
        return {
          success: false,
          error: `Falha ao carregar configurações persistidas no Cloud Firestore: ${msg}`,
        };
      }
    }

    if (typeof fetch === 'function') {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
      try {
        const authHeaders = await this.getFirebaseAuthHeaders();
        const res = await fetch('/api/store/schedule', {
          method: 'GET',
          headers: authHeaders,
          ...(controller ? { signal: controller.signal } : {}),
        });
        const data = await res.json().catch(() => null);

        if (res.ok && data?.success && data.scheduleLoadOk && data.restaurantLoadOk) {
          const remoteRestaurant = (data.restaurantConfig && typeof data.restaurantConfig === 'object')
            ? (data.restaurantConfig as Partial<RestaurantConfig>)
            : {};
          const closedSettings = normalizeClosedSettings(data.closedSettings);

          const mergedConfig: RestaurantConfig = {
            ...currentLocal,
            ...remoteRestaurant,
            operatingHours: closedSettings.operatingHours,
            closedPrimaryMessage: closedSettings.closedPrimaryMessage,
            closedSecondaryMessage: closedSettings.closedSecondaryMessage,
          };

          localStorage.setItem('gf_restaurant_config', JSON.stringify(mergedConfig));
          this.syncOfficialPixStateFromFirestore(mergedConfig, Boolean(data.hasRestaurantDoc));
          this.notify('CONFIG_UPDATED', mergedConfig);
          return {
            success: true,
            config: mergedConfig,
            hasRestaurantDoc: Boolean(data.hasRestaurantDoc),
            hasScheduleDoc: Boolean(data.hasScheduleDoc),
          };
        }

        if (!this.serverAtomicPaymentTestOverride && res.status === 503 && data?.code === 'ADMIN_SDK_UNAVAILABLE') {
          return {
            success: true,
            localOnly: true,
            config: currentLocal,
          };
        }

        return {
          success: false,
          error: data?.message || `Erro HTTP ${res.status} ao carregar configurações do servidor.`,
        };
      } catch (err: unknown) {
        if (!this.serverAtomicPaymentTestOverride) {
          return {
            success: true,
            localOnly: true,
            config: currentLocal,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `Falha de rede ao carregar configurações persistidas: ${msg}`,
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    if (!this.serverAtomicPaymentTestOverride) {
      return { success: true, localOnly: true, config: currentLocal };
    }
    return { success: false, error: 'Cliente HTTP indisponível para carregar configurações.' };
  }

  public async updateRestaurantConfigAsync(
    config: RestaurantConfig
  ): Promise<{
    success: boolean;
    synced: boolean;
    localOnly?: boolean;
    message: string;
    error?: string;
    config?: RestaurantConfig;
  }> {
    const actor = this.getCurrentUser();
    if (!this.canUserManageConfig(actor)) {
      const errMsg = 'Permissão insuficiente: somente Administrador ou Gerente ativos podem alterar o cadastro PIX e as configurações da loja.';
      return { success: false, synced: false, message: errMsg, error: errMsg };
    }

    const rawPixKey = (config.pixKey || '').trim();
    const keyType = config.pixKeyType || inferPixKeyType(rawPixKey);
    if (!rawPixKey) {
      const errMsg = 'Informe a chave PIX oficial antes de salvar as configurações.';
      return { success: false, synced: false, message: errMsg, error: errMsg };
    }
    if (!keyType) {
      const errMsg = 'Tipo de chave PIX não identificado. Selecione CPF, CNPJ, Telefone, E-mail ou Aleatória.';
      return { success: false, synced: false, message: errMsg, error: errMsg };
    }
    const pixValidation = validatePixKey(rawPixKey, keyType);
    if (!pixValidation.valid) {
      const errMsg = pixValidation.error || 'Chave PIX inválida para o tipo selecionado.';
      return { success: false, synced: false, message: errMsg, error: errMsg };
    }

    const receiverCheck = validatePixReceiver(config.pixReceiverName, config.pixReceiverCity);
    if (!receiverCheck.valid) {
      const errMsg = receiverCheck.error || 'Informe o Nome e a Cidade do Titular da conta PIX.';
      return { success: false, synced: false, message: errMsg, error: errMsg };
    }
    const receiverName = receiverCheck.receiverName;
    const receiverCity = receiverCheck.receiverCity;

    const waCheck = validateWhatsAppNumber(config.whatsapp);
    if (!waCheck.valid) {
      const errMsg = waCheck.error || 'Número de WhatsApp inválido.';
      return { success: false, synced: false, message: errMsg, error: errMsg };
    }

    let validatedHours: DayOperatingHours[] = DEFAULT_OPERATING_HOURS;
    if (config.operatingHours !== undefined) {
      const hoursCheck = validateOperatingHours(config.operatingHours);
      if (!hoursCheck.valid) {
        const errMsg = hoursCheck.error || 'Horários de funcionamento inválidos.';
        return { success: false, synced: false, message: errMsg, error: errMsg };
      }
      validatedHours = hoursCheck.hours;
    } else {
      const existingCfg = this.getRestaurantConfig();
      validatedHours = existingCfg.operatingHours || DEFAULT_OPERATING_HOURS;
    }

    let closedPrimaryMessage = DEFAULT_CLOSED_PRIMARY_MESSAGE;
    if (config.closedPrimaryMessage !== undefined) {
      if (!config.closedPrimaryMessage.trim()) {
        const errMsg = 'Informe a mensagem principal da página de estabelecimento fechado.';
        return { success: false, synced: false, message: errMsg, error: errMsg };
      }
      closedPrimaryMessage = config.closedPrimaryMessage.trim().slice(0, 200);
    } else {
      closedPrimaryMessage = this.getRestaurantConfig().closedPrimaryMessage || DEFAULT_CLOSED_PRIMARY_MESSAGE;
    }

    const closedSecondaryMessage =
      config.closedSecondaryMessage !== undefined
        ? config.closedSecondaryMessage.trim().slice(0, 500)
        : (this.getRestaurantConfig().closedSecondaryMessage ?? DEFAULT_CLOSED_SECONDARY_MESSAGE);

    const normalizedConfig: RestaurantConfig = {
      ...config,
      name: (config.name || 'Amandita Sabores').trim(),
      phone: (config.phone || '').trim(),
      whatsapp: waCheck.normalized,
      address: (config.address || '').trim(),
      city: (config.city || '').trim(),
      pixKeyType: keyType,
      pixKey: pixValidation.normalized,
      pixReceiverName: receiverName,
      pixReceiverCity: receiverCity,
      deliveryFeeBase: Number.isFinite(Number(config.deliveryFeeBase)) ? Math.max(0, Number(config.deliveryFeeBase)) : 0,
      avgPrepTimeMinutes: Number.isFinite(Number(config.avgPrepTimeMinutes)) ? Math.max(1, Math.round(Number(config.avgPrepTimeMinutes))) : 15,
      avgDeliveryTimeMinutes: Number.isFinite(Number(config.avgDeliveryTimeMinutes)) ? Math.max(1, Math.round(Number(config.avgDeliveryTimeMinutes))) : 25,
      isOpen: Boolean(config.isOpen),
      customPublicUrl: config.customPublicUrl?.trim() || undefined,
      receiptFooterText: config.receiptFooterText ?? '',
      defaultDeliveryPersonId: config.defaultDeliveryPersonId ?? '',
      operatingHours: validatedHours,
      closedPrimaryMessage,
      closedSecondaryMessage,
    };

    const buildPublicRestaurantPayload = (updatedAt: string): Record<string, unknown> => {
      const payload: Record<string, unknown> = {
        name: normalizedConfig.name,
        phone: normalizedConfig.phone,
        whatsapp: normalizedConfig.whatsapp,
        address: normalizedConfig.address,
        city: normalizedConfig.city,
        pixKey: normalizedConfig.pixKey,
        pixKeyType: normalizedConfig.pixKeyType,
        pixReceiverName: normalizedConfig.pixReceiverName,
        pixReceiverCity: normalizedConfig.pixReceiverCity,
        deliveryFeeBase: normalizedConfig.deliveryFeeBase,
        avgPrepTimeMinutes: normalizedConfig.avgPrepTimeMinutes,
        avgDeliveryTimeMinutes: normalizedConfig.avgDeliveryTimeMinutes,
        isOpen: normalizedConfig.isOpen,
        updatedAt,
      };
      if (normalizedConfig.customPublicUrl) {
        payload.customPublicUrl = normalizedConfig.customPublicUrl;
      }
      return payload;
    };

    if (isFirebaseReady()) {
      await this.waitForFirebaseAuthReady();
      if (!auth?.currentUser || !db) {
        const errMsg = 'Sessão Firebase não autenticada. Faça login novamente antes de salvar configurações na nuvem.';
        return { success: false, synced: false, message: errMsg, error: errMsg };
      }

      const confirmedRole = await this.verifyStaffRole(auth.currentUser);
      if (!confirmedRole || !['ADMINISTRADOR', 'GERENTE'].includes(confirmedRole.toUpperCase())) {
        const errMsg = 'Permissão negada no Firebase (403): apenas Administrador ou Gerente com perfil ativo em /users/{uid} podem gravar configurações PIX.';
        return { success: false, synced: false, message: errMsg, error: errMsg };
      }

      if (typeof fetch !== 'function') {
        const errMsg = 'Cliente HTTP indisponível para confirmar gravação atômica das configurações no servidor.';
        return { success: false, synced: false, message: errMsg, error: errMsg };
      }

      const updatedAt = new Date().toISOString();
      const publicPayload = buildPublicRestaurantPayload(updatedAt);

      try {
        const authHeaders = await this.getFirebaseAuthHeaders();
        const schedRes = await fetch('/api/store/schedule', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            operatingHours: normalizedConfig.operatingHours,
            closedPrimaryMessage: normalizedConfig.closedPrimaryMessage,
            closedSecondaryMessage: normalizedConfig.closedSecondaryMessage,
            whatsapp: normalizedConfig.whatsapp,
            restaurantConfig: publicPayload,
          }),
        });
        const schedData = await schedRes.json().catch(() => null);
        if (!schedRes.ok || !schedData?.success || schedData?.persistedToFirestore !== true) {
          const msg =
            schedData?.message ||
            `Não foi possível confirmar a gravação no Cloud Firestore (HTTP ${schedRes.status}).`;
          return { success: false, synced: false, message: msg, error: msg };
        }
      } catch (schedFetchErr: unknown) {
        const msg = schedFetchErr instanceof Error ? schedFetchErr.message : String(schedFetchErr);
        return {
          success: false,
          synced: false,
          message: `Falha de comunicação ao gravar configurações no Cloud Firestore: ${msg}`,
          error: msg,
        };
      }

      // Persist internal/private fields in configs/internal when Administrator (best-effort; never blocks save for Gerente)
      if (confirmedRole.toUpperCase() === 'ADMINISTRADOR') {
        const internalPayload = {
          receiptFooterText: normalizedConfig.receiptFooterText || '',
          defaultDeliveryPersonId: normalizedConfig.defaultDeliveryPersonId || '',
          notifyNewOrders: normalizedConfig.notifyNewOrders !== false,
          notifyDeliveryConfirmed: normalizedConfig.notifyDeliveryConfirmed !== false,
          notifyReadyForDelivery: normalizedConfig.notifyReadyForDelivery !== false,
          updatedAt,
        };
        await setDoc(doc(db, 'configs', 'internal'), this.cleanForFirestore(internalPayload), { merge: true }).catch((intErr) => {
          console.warn('[Firestore Internal Config] Aviso ao gravar configs/internal:', intErr);
        });
      }

      localStorage.setItem('gf_restaurant_config', JSON.stringify(normalizedConfig));
      this.syncOfficialPixStateFromFirestore(normalizedConfig, true);
      this.notify('CONFIG_UPDATED', normalizedConfig);
      return {
        success: true,
        synced: true,
        message: 'Configurações, chave PIX e horários salvos atomicamente no Cloud Firestore!',
        config: normalizedConfig,
      };
    }

    // In atomic test/server mode, persist BOTH configs/restaurant and configs/store_schedule atomically via backend (NEVER false local success)
    if (this.serverAtomicPaymentTestOverride) {
      if (typeof fetch !== 'function') {
        const errMsg = 'Cliente HTTP indisponível para persistir configurações no servidor.';
        return { success: false, synced: false, message: errMsg, error: errMsg };
      }
      try {
        const updatedAt = new Date().toISOString();
        const publicPayload = buildPublicRestaurantPayload(updatedAt);
        const authHeaders = await this.getFirebaseAuthHeaders();
        const schedRes = await fetch('/api/store/schedule', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            operatingHours: normalizedConfig.operatingHours,
            closedPrimaryMessage: normalizedConfig.closedPrimaryMessage,
            closedSecondaryMessage: normalizedConfig.closedSecondaryMessage,
            whatsapp: normalizedConfig.whatsapp,
            restaurantConfig: publicPayload,
          }),
        });
        const schedData = await schedRes.json().catch(() => null);
        if (!schedRes.ok || !schedData?.success || schedData?.persistedToFirestore !== true) {
          const errMsg =
            schedData?.message ||
            `Erro HTTP ${schedRes.status} ao confirmar gravação das configurações no Cloud Firestore.`;
          return { success: false, synced: false, message: errMsg, error: errMsg };
        }
        localStorage.setItem('gf_restaurant_config', JSON.stringify(normalizedConfig));
        this.syncOfficialPixStateFromFirestore(normalizedConfig, true);
        this.notify('CONFIG_UPDATED', normalizedConfig);
        return {
          success: true,
          synced: true,
          message: 'Configurações, chave PIX e horários salvos atomicamente no Cloud Firestore!',
          config: normalizedConfig,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, synced: false, message: msg, error: msg };
      }
    }

    // Local contingency mode (Firebase not configured)
    localStorage.setItem('gf_restaurant_config', JSON.stringify(normalizedConfig));
    this.officialPixState = {
      status: 'READY',
      source: 'local_contingency',
      hasValidPixKey: true,
      error: null,
      message: null,
      lastSyncedAt: new Date().toISOString(),
    };
    this.notify('CONFIG_UPDATED', normalizedConfig);
    return {
      success: true,
      synced: false,
      localOnly: true,
      message: 'Configurações salvas em modo de contingência local (este dispositivo apenas — Firebase não configurado).',
      config: normalizedConfig,
    };
  }

  public updateRestaurantConfig(config: RestaurantConfig): void {
    this.updateRestaurantConfigAsync(config).catch((err) => {
      console.warn('[Store] Erro ao atualizar configuração do restaurante:', err);
    });
  }

  // ==========================================
  // USERS, STAFF & AUTHENTICATION
  // ==========================================
  public getUsers(): User[] {
    try {
      const data = localStorage.getItem('gf_users');
      const list: User[] = data ? JSON.parse(data) : INITIAL_USERS;
      return (Array.isArray(list) ? list : INITIAL_USERS).map((u) => ({
        ...u,
        name: u.name || 'Colaborador',
        username: (u.username || (u.email ? u.email.split('@')[0] : u.id) || 'usuario').toLowerCase(),
        email: u.email || '',
        isEmailVerified: Boolean(u.isEmailVerified),
        role: u.role || 'ATENDENTE',
        status: u.status || 'ATIVO',
        allowedModules: Array.isArray(u.allowedModules) ? u.allowedModules : [],
      }));
    } catch {
      return INITIAL_USERS;
    }
  }

  public getUserById(id: string): User | undefined {
    return this.getUsers().find((u) => u.id === id);
  }

  public getDeliveryPermissions(user?: User | null): DeliveryPermissions {
    if (!user) {
      return {
        canViewDeliveryDashboard: false,
        canManageDrivers: false,
        canAssignDeliveries: false,
        canOpenDailyShift: false,
        canCloseDailyShift: false,
        canViewShiftHistory: false,
        canReopenDailyShift: false,
      };
    }
    const role = (user.role || '').toUpperCase();
    if (role === 'ADMINISTRADOR' || user.username === 'admin') {
      return {
        canViewDeliveryDashboard: true,
        canManageDrivers: true,
        canAssignDeliveries: true,
        canOpenDailyShift: true,
        canCloseDailyShift: true,
        canViewShiftHistory: true,
        canReopenDailyShift: true,
      };
    }
    if (role === 'GERENTE') {
      return {
        canViewDeliveryDashboard: true,
        canManageDrivers: true,
        canAssignDeliveries: true,
        canOpenDailyShift: true,
        canCloseDailyShift: true,
        canViewShiftHistory: true,
        canReopenDailyShift: false,
        ...(user.deliveryPermissions || {}),
      };
    }
    if (role === 'ENTREGADOR') {
      return {
        canViewDeliveryDashboard: true,
        canManageDrivers: false,
        canAssignDeliveries: false,
        canOpenDailyShift: false,
        canCloseDailyShift: false,
        canViewShiftHistory: false,
        canReopenDailyShift: false,
        ...(user.deliveryPermissions || {}),
      };
    }
    return {
      canViewDeliveryDashboard: false,
      canManageDrivers: false,
      canAssignDeliveries: false,
      canOpenDailyShift: false,
      canCloseDailyShift: false,
      canViewShiftHistory: false,
      canReopenDailyShift: false,
      ...(user.deliveryPermissions || {}),
    };
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
      localStorage.removeItem('gf_delivery_user');
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

    if (users.some((u) => (u.username || '').toLowerCase() === cleanUsername)) {
      return { success: false, message: 'Nome de usuário já cadastrado. Escolha outro nome de login.' };
    }

    // Resolve or generate synthetic email if user did not provide an email
    const cleanEmail = userData.email && userData.email.includes('@')
      ? userData.email.trim().toLowerCase()
      : `${cleanUsername}@staff.amanditasabores.com.br`;

    if (userData.email && userData.email.trim().length > 0 && users.some((u) => (u.email || '').toLowerCase() === cleanEmail)) {
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

  // ---- Cancel Order with Audit-Compliant Financial Refund Flow ----
  public cancelOrder(
    orderId: string,
    reason: string,
    cancelledBy: string,
    refundPaymentMethodOverride?: PaymentMethod
  ): { success: boolean; message: string; order?: Order; refundInfo?: OrderRefundInfo } {
    if (this.shouldUseServerAtomicPayment()) {
      console.warn('[Security Guard] Em modo nuvem/atômico, use exclusivamente cancelOrderAsync().');
      return {
        success: false,
        message: 'Operação bloqueada: utilize cancelOrderAsync() para cancelamento atômico no servidor.',
      };
    }

    const orders = this.getOrders();
    const order = orders.find((o) => o.id === orderId);
    if (!order) {
      return { success: false, message: 'Pedido não encontrado no sistema.' };
    }

    if (order.status === 'CANCELADO') {
      return { success: false, message: 'Este pedido já se encontra cancelado.' };
    }

    if (order.refundInfo) {
      return { success: false, message: 'Este pedido já possui uma devolução/estorno registrada anteriormente.' };
    }

    const cleanReason = reason.trim();
    if (!cleanReason || cleanReason.length < 3) {
      return { success: false, message: 'O motivo do cancelamento é obrigatório e deve ter pelo menos 3 caracteres.' };
    }

    const previousStatus = order.status;
    const now = new Date().toISOString();
    const cleanAuthor = cancelledBy.trim() || 'Operador';

    // -------------------------------------------------------------
    // CENÁRIO 1: PEDIDO NÃO PAGO (PENDENTE)
    // Não gera recebimento, não gera estorno e não movimenta caixa.
    // -------------------------------------------------------------
    if (order.paymentStatus !== 'PAGO') {
      order.status = 'CANCELADO';
      order.cancellationReason = cleanReason;
      order.cancelledBy = cleanAuthor;
      order.cancelledAt = now;
      order.updatedAt = now;
      order._cloudSyncStatus = 'PENDING';

      order.movements.push({
        id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: now,
        fromStatus: previousStatus,
        toStatus: 'CANCELADO',
        author: cleanAuthor,
        notes: `Pedido Cancelado sem Pagamento. Motivo: ${cleanReason}`,
      });

      localStorage.setItem('gf_orders', JSON.stringify(orders));
      soundService.playSuccessTone();
      this.notify('ORDER_UPDATED', order);

      return {
        success: true,
        message: `Pedido ${order.orderNumber} cancelado com sucesso. Como não havia pagamento registrado, nenhuma movimentação financeira foi gerada.`,
        order,
      };
    }

    // -------------------------------------------------------------
    // CENÁRIO 2: PEDIDO JÁ PAGO (PAGO) -> DEVOLUÇÃO INTEGRAL OBRIGATÓRIA
    // -------------------------------------------------------------
    const refundPaymentMethod = refundPaymentMethodOverride || order.paymentMethod;
    const refundAmount = order.totalAmount;
    const refundId = `ref-${order.id}-${Date.now()}`;
    const movementId = `cash-estorno-${order.id}`;

    let cashMovementId: string | undefined = undefined;
    let targetShiftId: string | undefined = undefined;
    let isPendingCashRecord = false;

    const currentShift = this.getCurrentCashShift();
    if (currentShift && currentShift.status === 'ABERTO') {
      targetShiftId = currentShift.id;
      const alreadyRefunded = currentShift.movements.some(
        (m) => m.type === 'ESTORNO' && (m.orderId === order.id || m.id === movementId)
      );

      if (!alreadyRefunded) {
        const refundMovement: CashMovement = {
          id: movementId,
          timestamp: now,
          type: 'ESTORNO',
          amount: refundAmount,
          paymentMethod: refundPaymentMethod,
          description: `Estorno/Devolução Pedido ${order.orderNumber} (${refundPaymentMethod}) - ${order.customer.name}`,
          author: cleanAuthor,
          orderId: order.id,
          orderNumber: order.orderNumber,
          refundReason: cleanReason,
          originalShiftId: currentShift.id,
        };

        currentShift.movements.push(refundMovement);
        this.saveCurrentCashShift(currentShift);
        cashMovementId = movementId;
      } else {
        cashMovementId = movementId;
      }
    } else {
      isPendingCashRecord = true;
    }

    const refundInfo: OrderRefundInfo = {
      id: refundId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      originalAmount: order.totalAmount,
      refundAmount,
      originalPaymentMethod: order.paymentMethod,
      refundPaymentMethod,
      timestamp: now,
      reason: cleanReason,
      author: cleanAuthor,
      cashMovementId,
      targetShiftId,
      status: isPendingCashRecord ? 'PENDENTE_CAIXA' : 'CONCLUIDO',
    };

    order.status = 'CANCELADO';
    order.cancellationReason = cleanReason;
    order.cancelledBy = cleanAuthor;
    order.cancelledAt = now;
    order.updatedAt = now;
    order.refundInfo = refundInfo;
    order._cloudSyncStatus = 'PENDING';

    order.movements.push({
      id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: now,
      fromStatus: previousStatus,
      toStatus: 'CANCELADO',
      author: cleanAuthor,
      notes: `Venda Cancelada com Devolução Integral (${refundPaymentMethod}: ${formatCurrency(refundAmount)}). Motivo: ${cleanReason}`,
    });

    localStorage.setItem('gf_orders', JSON.stringify(orders));
    soundService.playSuccessTone();
    this.notify('ORDER_UPDATED', order);

    const warningMsg = isPendingCashRecord
      ? ' ATENÇÃO: Nenhum turno de caixa aberto no momento. O estorno foi registrado no pedido e aguarda conferência de caixa.'
      : refundPaymentMethod === 'DINHEIRO'
      ? ` O valor de ${formatCurrency(refundAmount)} foi debitado da gaveta física do caixa aberto atual.`
      : ` O estorno PIX de ${formatCurrency(refundAmount)} foi registrado. O dinheiro físico da gaveta não foi alterado.`;

    return {
      success: true,
      message: `Pedido ${order.orderNumber} cancelado e estorno integral de ${formatCurrency(refundAmount)} registrado com sucesso.${warningMsg}`,
      order,
      refundInfo,
    };
  }

  public async cancelOrderAsync(
    orderId: string,
    reason: string,
    cancelledBy: string,
    refundPaymentMethodOverride?: PaymentMethod,
    options?: { shiftId?: string; timeoutMs?: number }
  ): Promise<{
    success: boolean;
    synced: boolean;
    rejected?: boolean;
    uncertain?: boolean;
    recoveredFromTimeout?: boolean;
    message: string;
    order?: Order;
    refundInfo?: OrderRefundInfo;
  }> {
    const currentUser = this.getCurrentUser();
    if (currentUser && !this.canUserDeleteOrder(currentUser)) {
      return {
        success: false,
        synced: false,
        rejected: true,
        message: 'Permissão insuficiente: apenas Administrador ou Gerente podem cancelar pedidos e autorizar estornos.',
      };
    }

    const cleanReason = reason.trim();
    if (!cleanReason || cleanReason.length < 3) {
      return {
        success: false,
        synced: false,
        rejected: true,
        message: 'O motivo do cancelamento é obrigatório e deve ter pelo menos 3 caracteres.',
      };
    }

    if (!this.shouldUseServerAtomicPayment()) {
      const localRes = this.cancelOrder(orderId, cleanReason, cancelledBy, refundPaymentMethodOverride);
      return { ...localRes, synced: false };
    }

    // Cloud / Server Atomic Mode: NEVER mutate local gf_orders or gf_current_cash_shift before server commit!
    await this.waitForFirebaseAuthReady();
    if (isFirebaseReady() && !auth?.currentUser) {
      return {
        success: false,
        synced: false,
        rejected: true,
        message: 'Sessão Firebase não autenticada. Faça login novamente antes de cancelar pedidos.',
      };
    }

    const localOrder = this.getOrderById(orderId);
    if (localOrder && localOrder.status === 'CANCELADO') {
      return {
        success: false,
        synced: false,
        rejected: true,
        order: localOrder,
        message: 'Este pedido já se encontra cancelado.',
      };
    }

    if (localOrder && localOrder.refundInfo) {
      return {
        success: false,
        synced: false,
        rejected: true,
        order: localOrder,
        message: 'Este pedido já possui uma devolução/estorno registrada anteriormente.',
      };
    }

    if (typeof fetch !== 'function') {
      return {
        success: false,
        synced: false,
        rejected: true,
        message: 'Cliente HTTP indisponível para cancelamento atômico no servidor.',
      };
    }

    const authHeaders = await this.getFirebaseAuthHeaders();
    const opKey = `cancel:${orderId}`;

    if (this.uncertainServerOps.has(opKey)) {
      const preState = await this.consultOrderCancelState(orderId, authHeaders);
      const stateData = preState.data;
      if (
        preState.verified &&
        stateData?.exists &&
        stateData?.cancelled &&
        stateData?.order &&
        (stateData?.paymentStatus !== 'PAGO' || stateData?.refundRecorded)
      ) {
        this.uncertainServerOps.delete(opKey);
        const recovered = this.commitConfirmedServerOrderAndShift(
          stateData.order as Order,
          (stateData.shift as CashRegisterShift) || null
        );
        soundService.playSuccessTone();
        this.notify('ORDER_UPDATED', recovered);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_UPDATED', payload: recovered } }));
        }
        return {
          success: true,
          synced: true,
          recoveredFromTimeout: true,
          message: `Cancelamento do pedido ${recovered.orderNumber} confirmado após reconciliação com o servidor.`,
          order: recovered,
          refundInfo: (stateData.refundInfo as OrderRefundInfo) || recovered.refundInfo,
        };
      }
      if (preState.verified && (!stateData?.exists || !stateData?.cancelled)) {
        this.uncertainServerOps.delete(opKey);
      } else {
        const health = await this.checkServerAdminSdkHealth();
        if (health.reachable && health.hasAdminSdk === false) {
          this.uncertainServerOps.delete(opKey);
          return {
            success: false,
            synced: false,
            rejected: true,
            message:
              'Não foi possível cancelar o pedido: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
          };
        }
        return {
          success: false,
          synced: false,
          uncertain: true,
          message:
            'Não foi possível verificar o estado anterior do cancelamento no servidor. A requisição não foi repetida para evitar estorno duplicado.',
        };
      }
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const currentShift = this.getCurrentCashShift();
    const shiftIdToSend = options?.shiftId || (currentShift?.status === 'ABERTO' ? currentShift.id : undefined);

    const recoverCancelState = async () => {
      const state = await this.consultOrderCancelState(orderId, authHeaders);
      const stateData = state.data;
      if (
        state.verified &&
        stateData?.exists &&
        stateData?.cancelled &&
        stateData?.order &&
        (stateData?.paymentStatus !== 'PAGO' || stateData?.refundRecorded)
      ) {
        this.uncertainServerOps.delete(opKey);
        const recovered = this.commitConfirmedServerOrderAndShift(
          stateData.order as Order,
          (stateData.shift as CashRegisterShift) || null
        );
        soundService.playSuccessTone();
        this.notify('ORDER_UPDATED', recovered);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_UPDATED', payload: recovered } }));
        }
        return {
          status: 'recovered' as const,
          result: {
            success: true,
            synced: true,
            recoveredFromTimeout: true,
            message: `Cancelamento do pedido ${recovered.orderNumber} confirmado após reconciliação com o servidor.`,
            order: recovered,
            refundInfo: (stateData.refundInfo as OrderRefundInfo) || recovered.refundInfo,
          },
        };
      }
      if (state.verified && (!stateData?.exists || !stateData?.cancelled)) {
        this.uncertainServerOps.delete(opKey);
        return { status: 'not_committed' as const };
      }
      return { status: 'unknown' as const };
    };

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          reason: cleanReason,
          cancelledBy: cancelledBy.trim() || 'Operador',
          ...(refundPaymentMethodOverride ? { refundPaymentMethodOverride } : {}),
          ...(shiftIdToSend ? { shiftId: shiftIdToSend } : {}),
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const parsed = await this.readServerJsonResponse(res);
      const data = parsed.data;

      if (
        parsed.ok &&
        !parsed.isHtml &&
        parsed.isValidJson &&
        data?.success === true &&
        data?.order &&
        data.order.id &&
        data.order.status === 'CANCELADO'
      ) {
        this.uncertainServerOps.delete(opKey);
        const committed = this.commitConfirmedServerOrderAndShift(
          data.order as Order,
          (data.shift as CashRegisterShift) || null
        );
        soundService.playSuccessTone();
        this.notify('ORDER_UPDATED', committed);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('gestaofood_state_changed', { detail: { type: 'ORDER_UPDATED', payload: committed } }));
        }
        return {
          success: true,
          synced: true,
          message: data.message || `Pedido ${committed.orderNumber} cancelado atomicamente.`,
          order: committed,
          refundInfo: (data.refundInfo as OrderRefundInfo) || committed.refundInfo,
        };
      }

      const resolution = await this.resolveFinancialHttpFailure(parsed, 'o cancelamento do pedido');
      if (resolution.kind === 'rejected') {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          message: resolution.error,
        };
      }

      const rec = await recoverCancelState();
      if (rec.status === 'recovered') return rec.result;
      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          message: resolution.nonCommittedError,
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        message: resolution.uncertainError,
      };
    } catch (fetchErr: unknown) {
      const rec = await recoverCancelState();
      if (rec.status === 'recovered') return rec.result;
      const isTimeout = this.isTimeoutFetchError(fetchErr);

      if (rec.status === 'not_committed') {
        return {
          success: false,
          synced: false,
          rejected: false,
          uncertain: false,
          message: isTimeout
            ? 'Tempo esgotado ao cancelar o pedido; consulta ao servidor confirmou que o pedido não foi cancelado.'
            : 'Falha de conexão ao cancelar o pedido; consulta ao servidor confirmou que o pedido não foi cancelado.',
        };
      }

      const health = await this.checkServerAdminSdkHealth();
      if (health.reachable && health.hasAdminSdk === false) {
        this.uncertainServerOps.delete(opKey);
        return {
          success: false,
          synced: false,
          rejected: true,
          message:
            'Não foi possível cancelar o pedido: Firebase Admin SDK indisponível no servidor (hasAdminSdk: false). Nenhuma alteração foi gravada.',
        };
      }

      this.uncertainServerOps.set(opKey, Date.now());
      return {
        success: false,
        synced: false,
        uncertain: true,
        message: isTimeout
          ? 'Tempo esgotado ao cancelar o pedido no servidor e o resultado permanece desconhecido. Nenhum dado local foi alterado.'
          : 'Falha de comunicação com o servidor ao cancelar o pedido. Nenhum dado local foi alterado.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---- Login & Authentication ----
  private upsertLocalUserCleanly(profile: User, legacyId?: string): void {
    const users = this.getUsers();
    const cleanEmail = (profile.email || '').trim().toLowerCase();
    const cleanUsername = (profile.username || '').trim().toLowerCase();
    const filtered = users.filter((u) => {
      if (u.id === profile.id) return false;
      if (legacyId && u.id === legacyId) return false;
      const uEmail = (u.email || '').trim().toLowerCase();
      if (cleanEmail && uEmail && uEmail === cleanEmail) return false;
      const uUsername = (u.username || '').trim().toLowerCase();
      if (cleanUsername && uUsername && uUsername === cleanUsername) return false;
      return true;
    });
    filtered.push(profile);
    localStorage.setItem('gf_users', JSON.stringify(filtered));
  }

  public async loginWithGoogle(): Promise<{ success: boolean; message: string; user?: User; isCloudAuth?: boolean }> {
    if (!isFirebaseReady() || !auth) {
      return {
        success: false,
        isCloudAuth: false,
        message: 'Firebase Authentication não está configurado neste dispositivo.',
      };
    }

    try {
      const fbUser = await signInWithGoogle();
      if (!fbUser) {
        return { success: false, isCloudAuth: false, message: 'Operação de login com Google cancelada.' };
      }

      const fbEmail = (fbUser.email || '').trim().toLowerCase();
      const isBootstrapAdmin = this.isBootstrappedAdminEmail(fbEmail);
      const users = this.getUsers();
      const localMatch = users.find((u) => u.id === fbUser.uid || (fbEmail && (u.email || '').trim().toLowerCase() === fbEmail));
      const legacyId = localMatch && localMatch.id !== fbUser.uid ? localMatch.id : undefined;

      let remoteProfile: User | null = null;
      if (db) {
        try {
          const snap = await getDoc(doc(db, 'users', fbUser.uid));
          if (snap.exists()) {
            remoteProfile = snap.data() as User;
          }
        } catch (readErr) {
          console.warn('[Auth Google] Falha ao ler /users/{uid}:', readErr);
        }
      }

      const now = new Date().toISOString();
      let resolvedProfile: User | null = null;

      if (remoteProfile) {
        if (remoteProfile.status === 'BLOQUEADO') {
          await signOutFirebase().catch(() => {});
          return { success: false, isCloudAuth: false, message: 'Esta conta está bloqueada pelo administrador.' };
        }
        if (remoteProfile.status === 'DESATIVADO') {
          await signOutFirebase().catch(() => {});
          return { success: false, isCloudAuth: false, message: 'Esta conta foi desativada.' };
        }
        resolvedProfile = {
          ...remoteProfile,
          id: fbUser.uid,
          email: fbUser.email || remoteProfile.email,
          isEmailVerified: fbUser.emailVerified,
          authProvider: 'firebase_google',
          firebaseUid: fbUser.uid,
          lastLoginAt: now,
        };
      } else if (localMatch) {
        if (localMatch.status === 'BLOQUEADO' || localMatch.status === 'DESATIVADO') {
          await signOutFirebase().catch(() => {});
          return { success: false, isCloudAuth: false, message: 'Esta conta de colaborador está bloqueada ou desativada.' };
        }
        resolvedProfile = {
          ...localMatch,
          id: fbUser.uid,
          email: fbUser.email || localMatch.email,
          isEmailVerified: fbUser.emailVerified,
          authProvider: 'firebase_google',
          firebaseUid: fbUser.uid,
          lastLoginAt: now,
          ...(isBootstrapAdmin ? { role: 'ADMINISTRADOR' as UserRole } : {}),
        };
      } else if (isBootstrapAdmin) {
        resolvedProfile = {
          id: fbUser.uid,
          name: fbUser.displayName || 'Amanda Silveira (Admin)',
          username: fbEmail.split('@')[0] || 'admin',
          email: fbUser.email || fbEmail,
          isEmailVerified: fbUser.emailVerified,
          role: 'ADMINISTRADOR',
          status: 'ATIVO',
          allowedModules: ['pdv', 'kanban', 'kds', 'caixa', 'entregas', 'relatorios', 'menu', 'usuarios', 'configuracoes', 'qrcodes', 'auditoria'],
          authProvider: 'firebase_google',
          firebaseUid: fbUser.uid,
          createdAt: now,
          lastLoginAt: now,
        };
      } else {
        await signOutFirebase().catch(() => {});
        return {
          success: false,
          isCloudAuth: false,
          message: 'Esta conta Google não está vinculada a nenhum colaborador ativo em /users/{uid}. Solicite seu cadastro ao administrador.',
        };
      }

      let finalProfile: User = resolvedProfile;

      // Confirm /users/{uid} existence/sync in Firestore before declaring cloud login successful
      if (db) {
        try {
          if (remoteProfile) {
            await updateDoc(doc(db, 'users', fbUser.uid), { lastLoginAt: now });
          } else {
            await setDoc(doc(db, 'users', fbUser.uid), this.cleanForFirestore(finalProfile));
          }
        } catch (fsErr: any) {
          // Try backend /api/auth/sync-profile if client self-create was blocked (e.g. non-bootstrap email linking)
          let syncedViaBackend = false;
          if (typeof window !== 'undefined') {
            try {
              const idToken = await fbUser.getIdToken();
              const syncRes = await fetch('/api/auth/sync-profile', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({
                  name: finalProfile.name,
                  username: finalProfile.username,
                  allowedModules: finalProfile.allowedModules,
                }),
              });
              const syncData = await syncRes.json().catch(() => ({}));
              if (syncRes.ok && syncData.success && syncData.profile) {
                finalProfile = { ...finalProfile, ...syncData.profile, id: fbUser.uid, firebaseUid: fbUser.uid, authProvider: 'firebase_google' };
                syncedViaBackend = true;
              }
            } catch {}
          }
          if (!syncedViaBackend) {
            await signOutFirebase().catch(() => {});
            return {
              success: false,
              isCloudAuth: false,
              message: `Conta Google autenticada, mas não foi possível confirmar seu perfil ativo no Firestore (/users/${fbUser.uid}): ${fsErr?.message || 'Erro de permissão'}`,
            };
          }
        }
      }

      this.upsertLocalUserCleanly(finalProfile, legacyId);
      this.setCurrentUser(finalProfile);
      await this.initStaffFirestoreSync(fbUser);

      this.logAccess({
        userId: finalProfile.id,
        username: finalProfile.username,
        role: finalProfile.role,
        action: 'LOGIN_SUCESSO',
        details: `Login via Firebase Google Auth (${finalProfile.email})`,
      });

      return {
        success: true,
        message: 'Autenticado com sucesso via Firebase Google Auth!',
        user: finalProfile,
        isCloudAuth: true,
      };
    } catch (err: unknown) {
      const msg = formatFirebaseAuthError(err);
      return { success: false, isCloudAuth: false, message: `Falha na autenticação Google: ${msg}` };
    }
  }

  public async login(
    loginOrEmail: string,
    password: string
  ): Promise<{ success: boolean; message: string; user?: User; isCloudAuth?: boolean; isLocalContingency?: boolean }> {
    const rawInput = loginOrEmail.trim();
    if (!rawInput || !password.trim()) {
      return { success: false, isCloudAuth: false, message: 'Por favor, informe seu nome de usuário e senha.' };
    }

    const users = this.getUsers();
    const term = rawInput.toLowerCase();

    // 1. Identify local employee candidate to resolve username -> email
    const localCandidate = users.find(
      (u) => (u.username || '').toLowerCase() === term || (u.email || '').toLowerCase() === term
    );

    // Resolve target email for Firebase Auth
    let targetEmail = term;
    if (!targetEmail.includes('@')) {
      if (localCandidate && localCandidate.email && localCandidate.email.includes('@')) {
        targetEmail = localCandidate.email.trim().toLowerCase();
      } else if (term === 'admin') {
        targetEmail = this.getInitialAdminEmail();
      } else {
        targetEmail = `${term}@staff.amanditasabores.com.br`;
      }
    }

    const isBootstrapAdmin = this.isBootstrappedAdminEmail(targetEmail);

    // 2. CLOUD AUTHENTICATION PATH (STRICT when Firebase is configured — NEVER silently falls back to local auth)
    if (isFirebaseReady() && auth) {
      const currentFbEmail = (auth.currentUser?.email || '').trim().toLowerCase();
      if (auth.currentUser && currentFbEmail && currentFbEmail !== targetEmail) {
        await signOutFirebase().catch(() => {});
      }

      let fbUser: any = null;
      let firebaseAuthErr: unknown = null;

      try {
        fbUser = await signInWithEmail(targetEmail, password);
      } catch (fbErr: unknown) {
        firebaseAuthErr = fbErr;
        // Only allow initial Firebase Auth user creation if a matching local staff account exists with the exact stored initial password
        const errCode = String((fbErr as any)?.code || '');
        if (errCode !== 'auth/wrong-password' && errCode !== 'auth/user-disabled' && errCode !== 'auth/too-many-requests') {
          const passwords = this.getUserPasswords();
          const storedPass = localCandidate ? (passwords[localCandidate.id] || '123456') : null;
          if (localCandidate && storedPass && password.trim() === storedPass.trim()) {
            try {
              fbUser = await createUserWithEmail(targetEmail, password);
              firebaseAuthErr = null;
            } catch (createErr: unknown) {
              // Keep original sign-in error if email is already registered (meaning wrong password)
              const createCode = String((createErr as any)?.code || '');
              if (createCode !== 'auth/email-already-in-use') {
                firebaseAuthErr = createErr;
              }
            }
          }
        }
      }

      if (!fbUser) {
        this.setCurrentUser(null);
        this.stopStaffFirestoreSync();
        const friendlyMsg = formatFirebaseAuthError(firebaseAuthErr);
        this.logAccess({
          username: rawInput,
          action: 'LOGIN_FALHA',
          details: `Falha no Firebase Auth para ${targetEmail}: ${friendlyMsg}`,
        });
        return {
          success: false,
          isCloudAuth: false,
          message: friendlyMsg,
        };
      }

      // Firebase Auth succeeded: now resolve and verify active profile in Firestore /users/{uid}
      const now = new Date().toISOString();
      let profile: User | null = null;
      let existsInFirestore = false;

      if (db) {
        try {
          const snap = await getDoc(doc(db, 'users', fbUser.uid));
          if (snap.exists()) {
            profile = snap.data() as User;
            existsInFirestore = true;
          }
        } catch (err) {
          console.warn('[Firestore User Fetch]:', err);
        }
      }

      if (!profile && typeof window !== 'undefined') {
        try {
          const idToken = await fbUser.getIdToken();
          if (idToken) {
            const syncRes = await fetch('/api/auth/sync-profile', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                name: localCandidate?.name,
                username: localCandidate?.username,
                allowedModules: localCandidate?.allowedModules,
              }),
            });
            const syncData = await syncRes.json().catch(() => ({}));
            if (syncRes.ok && syncData.success && syncData.profile) {
              profile = syncData.profile as User;
              existsInFirestore = true;
            }
          }
        } catch {
          // Non-fatal; proceed to self-create check below
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
            lastLoginAt: now,
            ...(isBootstrapAdmin ? { role: 'ADMINISTRADOR' as UserRole } : {}),
          };
        } else if (isBootstrapAdmin) {
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
            createdAt: now,
            lastLoginAt: now,
          };
        } else if (targetEmail === 'gerente@amanditasabores.com.br') {
          profile = {
            id: fbUser.uid,
            name: fbUser.displayName || 'Gerência Amandita',
            username: 'gerente',
            email: fbUser.email || targetEmail,
            isEmailVerified: fbUser.emailVerified ?? true,
            role: 'GERENTE',
            status: 'ATIVO',
            allowedModules: ['pdv', 'kanban', 'kds', 'caixa', 'entregas', 'relatorios', 'menu', 'configuracoes', 'qrcodes'],
            authProvider: 'firebase_email',
            firebaseUid: fbUser.uid,
            createdAt: now,
            lastLoginAt: now,
          };
        }
      }

      if (!profile) {
        await signOutFirebase().catch(() => {});
        this.setCurrentUser(null);
        return {
          success: false,
          isCloudAuth: false,
          message: 'Conta autenticada no Firebase, porém sem perfil de colaborador vinculado em /users/{uid}. Solicite cadastro ao administrador.',
        };
      }

      if (profile.status === 'BLOQUEADO') {
        await signOutFirebase().catch(() => {});
        this.setCurrentUser(null);
        return { success: false, isCloudAuth: false, message: 'Esta conta está bloqueada pelo administrador.' };
      }
      if (profile.status === 'DESATIVADO') {
        await signOutFirebase().catch(() => {});
        this.setCurrentUser(null);
        return { success: false, isCloudAuth: false, message: 'Esta conta foi desativada.' };
      }

      profile = {
        ...profile,
        id: fbUser.uid,
        firebaseUid: fbUser.uid,
        authProvider: 'firebase_email',
        lastLoginAt: now,
      };

      // Persist or update /users/{uid} in Firestore cleanly and fail if profile creation is rejected
      if (db) {
        try {
          if (existsInFirestore) {
            await updateDoc(doc(db, 'users', fbUser.uid), { lastLoginAt: now }).catch(() => {});
          } else {
            await setDoc(doc(db, 'users', fbUser.uid), this.cleanForFirestore(profile));
          }
        } catch (fsProfileErr: any) {
          await signOutFirebase().catch(() => {});
          this.setCurrentUser(null);
          return {
            success: false,
            isCloudAuth: false,
            message: `Sessão Firebase iniciada, mas o perfil /users/${fbUser.uid} não pôde ser confirmado no Firestore (${fsProfileErr?.code || fsProfileErr?.message || 'permission-denied'}). Solicite ao administrador para vincular seu usuário.`,
          };
        }
      }

      const legacyId = localCandidate && localCandidate.id !== fbUser.uid ? localCandidate.id : undefined;
      this.upsertLocalUserCleanly(profile, legacyId);
      this.setCurrentUser(profile);
      await this.initStaffFirestoreSync(fbUser);

      this.logAccess({
        userId: profile.id,
        username: profile.username,
        role: profile.role,
        action: 'LOGIN_SUCESSO',
        details: `Login efetuado com sucesso via Firebase Cloud para @${profile.username} (${profile.role})`,
      });

      return {
        success: true,
        message: 'Login realizado com sucesso e sincronizado com o Firebase!',
        user: profile,
        isCloudAuth: true,
      };
    }

    // 3. LOCAL CONTINGENCY MODE (ONLY executed when Firebase is NOT configured on this device)
    if (!localCandidate) {
      this.logAccess({
        username: rawInput,
        action: 'LOGIN_FALHA',
        details: 'Tentativa de login com usuário inexistente (modo contingência local)',
      });
      return { success: false, isCloudAuth: false, isLocalContingency: true, message: 'Usuário não encontrado.' };
    }

    if (localCandidate.status === 'BLOQUEADO') {
      this.logAccess({
        userId: localCandidate.id,
        username: localCandidate.username,
        role: localCandidate.role,
        action: 'CONTA_BLOQUEADA',
        details: 'Tentativa de acesso em conta bloqueada',
      });
      return { success: false, isCloudAuth: false, isLocalContingency: true, message: 'Esta conta está bloqueada pelo administrador. Contate a gerência.' };
    }

    if (localCandidate.status === 'DESATIVADO') {
      return { success: false, isCloudAuth: false, isLocalContingency: true, message: 'Esta conta foi desativada no sistema.' };
    }

    const passwords = this.getUserPasswords();
    const storedPass = passwords[localCandidate.id] || '123456';

    if (password.trim() !== storedPass.trim()) {
      this.logAccess({
        userId: localCandidate.id,
        username: localCandidate.username,
        role: localCandidate.role,
        action: 'LOGIN_FALHA',
        details: 'Senha incorreta digitada (modo contingência local)',
      });
      return { success: false, isCloudAuth: false, isLocalContingency: true, message: 'Senha incorreta.' };
    }

    const contingencyUser: User = {
      ...localCandidate,
      authProvider: 'local_contingency',
      lastLoginAt: new Date().toISOString(),
    };
    const updatedUsersList = users.map((u) =>
      u.id === contingencyUser.id ? contingencyUser : u
    );
    localStorage.setItem('gf_users', JSON.stringify(updatedUsersList));
    this.setCurrentUser(contingencyUser);

    this.logAccess({
      userId: contingencyUser.id,
      username: contingencyUser.username,
      role: contingencyUser.role,
      action: 'LOGIN_CONTINGENCIA_LOCAL',
      details: `Acesso em modo de contingência local (Firebase não configurado) para @${contingencyUser.username} (${contingencyUser.role})`,
    });

    return {
      success: true,
      message: 'Autenticado em modo de contingência local (sem sincronização com a nuvem).',
      user: contingencyUser,
      isCloudAuth: false,
      isLocalContingency: true,
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
    this.stopStaffFirestoreSync();
    if (this.isCloudCashConfirmationRequired()) {
      try {
        localStorage.removeItem('gf_current_cash_shift');
      } catch {}
    }
    signOutFirebase().catch(() => {});
    this.setCurrentUser(null);
  }

  public async verifyAdminPassword(password: string): Promise<{ success: boolean; message: string }> {
    const current = this.getCurrentUser();
    if (!current) {
      return { success: false, message: 'Nenhum usuário logado na sessão.' };
    }
    const role = (current.role || '').toUpperCase();
    if (role !== 'ADMINISTRADOR' && current.username !== 'admin') {
      return { success: false, message: 'Permissão insuficiente: somente Administradores podem executar esta ação.' };
    }
    const trimmedPw = password.trim();
    if (!trimmedPw) {
      return { success: false, message: 'A senha é obrigatória.' };
    }

    if (isFirebaseReady() && auth) {
      if (current.authProvider === 'firebase_google') {
        try {
          const pwMapRaw = localStorage.getItem('gf_user_passwords');
          if (pwMapRaw) {
            const pwMap = JSON.parse(pwMapRaw);
            if (pwMap[current.id] === trimmedPw || pwMap['user-admin'] === trimmedPw) {
              return { success: true, message: 'PIN/Senha administrativa confirmada.' };
            }
          }
        } catch {}
        return { success: false, message: 'Senha administrativa incorreta.' };
      }

      const targetEmail = (auth.currentUser?.email || current.email || '').trim().toLowerCase();
      if (!targetEmail) {
        return { success: false, message: 'E-mail administrativo não localizado para revalidação no Firebase.' };
      }
      try {
        await signInWithEmail(targetEmail, trimmedPw);
        return { success: true, message: 'Senha confirmada no Firebase Authentication.' };
      } catch (err) {
        return { success: false, message: formatFirebaseAuthError(err) };
      }
    }

    // Local contingency fallback ONLY when Firebase is not configured
    try {
      const pwMapRaw = localStorage.getItem('gf_user_passwords');
      if (pwMapRaw) {
        const pwMap = JSON.parse(pwMapRaw);
        if (pwMap[current.id] === trimmedPw || pwMap['user-admin'] === trimmedPw) {
          return { success: true, message: 'Senha confirmada em modo contingência local.' };
        }
      }
    } catch {
      // ignore
    }

    return { success: false, message: 'Senha incorreta. Acesso não autorizado.' };
  }

  public resetToSampleData(): void {
    localStorage.setItem('gf_menu_items', JSON.stringify(INITIAL_MENU));
    localStorage.setItem('gf_orders', JSON.stringify(INITIAL_ORDERS));
    localStorage.setItem('gf_restaurant_config', JSON.stringify(INITIAL_CONFIG));
    localStorage.setItem('gf_users', JSON.stringify(INITIAL_USERS));
    localStorage.setItem('gf_current_user', JSON.stringify(INITIAL_USERS[0]));
    this.hasReceivedFirestoreConfig = false;
    this.officialPixState = {
      status: isFirebaseReady() && db ? 'LOADING' : 'MISSING',
      source: 'none',
      hasValidPixKey: false,
      error: null,
      message: isFirebaseReady() && db
        ? 'Carregando configuração oficial do PIX do Firebase...'
        : 'Chave PIX oficial não configurada.',
      lastSyncedAt: null,
    };
    
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
