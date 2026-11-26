export type OrderStatus = 
  | 'NOVO' 
  | 'EM_PREPARO' 
  | 'PRONTO' 
  | 'EM_ROTA' 
  | 'ENTREGUE' 
  | 'CANCELADO';

export type PaymentMethod = 
  | 'PIX' 
  | 'CARTAO_CREDITO' 
  | 'CARTAO_DEBITO' 
  | 'DINHEIRO'
  | 'MISTO';

export type UserRole = 
  | 'ADMINISTRADOR' 
  | 'GERENTE' 
  | 'CAIXA' 
  | 'COZINHA' 
  | 'ENTREGADOR'
  | 'ATENDENTE'
  | 'admin'
  | 'gerente'
  | 'atendente';

export type UserStatus = 'ATIVO' | 'BLOQUEADO' | 'DESATIVADO';

export type AppModule = 
  | 'pdv'           // Ponto de Venda / Balcão
  | 'kanban'        // Gestão de Pedidos
  | 'kds'           // Produção / Cozinha
  | 'caixa'         // Fechamento e Fluxo de Caixa
  | 'entregas'      // Área do Entregador
  | 'relatorios'    // Relatórios Financeiros e DRE
  | 'menu'          // Gestão do Cardápio
  | 'usuarios'      // Gestão de Funcionários e Permissões
  | 'configuracoes' // Configurações da Loja & PIX
  | 'qrcodes'       // QR Codes & Links
  | 'auditoria';    // Logs de Auditoria

export interface DeliveryPermissions {
  canViewDeliveryDashboard: boolean;
  canManageDrivers: boolean;
  canAssignDeliveries: boolean;
  canOpenDailyShift: boolean;
  canCloseDailyShift: boolean;
  canViewShiftHistory: boolean;
  canReopenDailyShift: boolean;
}

export interface User {
  id: string;
  name?: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
  role: UserRole;
  status?: UserStatus;
  allowedModules?: AppModule[];
  deliveryPermissions?: DeliveryPermissions;
  phone?: string;
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string;
  authProvider?: 'firebase_custom_token' | 'firebase_email' | 'firebase_google' | 'local_contingency';
  provisioningState?: 'PENDING' | 'FINALIZING' | 'ACTIVE';
  firebaseUid?: string;
}

export interface AuthBootstrapStatus {
  initialized: boolean;
  mode: 'setup_required' | 'login' | 'unavailable';
  message?: string;
  checkedAt?: string;
}

export interface BootstrapAdminPayload {
  name: string;
  username: string;
  phone: string;
  password: string;
  idempotencyKey?: string;
}

export interface CreateStaffPayload {
  name: string;
  username: string;
  phone: string;
  password: string;
  role: UserRole;
  allowedModules: AppModule[];
  deliveryPermissions?: Partial<DeliveryPermissions>;
  idempotencyKey?: string;
}

export interface UpdateStaffPayload {
  name?: string;
  username?: string;
  phone?: string;
  role?: UserRole;
  status?: UserStatus;
  allowedModules?: AppModule[];
  deliveryPermissions?: Partial<DeliveryPermissions>;
}

export interface UpdateOwnCredentialsPayload {
  currentPassword: string;
  newUsername?: string;
  newPassword?: string;
  name?: string;
  phone?: string;
}

export interface AuthActionResult<T = User> {
  success: boolean;
  message: string;
  code?: string;
  user?: T;
  users?: User[];
  retryAfterSeconds?: number;
  idempotentReplay?: boolean;
  isCloudAuth?: boolean;
  isLocalContingency?: boolean;
}

export interface UserAccessLog {
  id: string;
  userId?: string;
  username: string;
  timestamp: string;
  action:
    | 'LOGIN_SUCESSO'
    | 'LOGIN_FALHA'
    | 'LOGOUT'
    | 'SENHA_ALTERADA'
    | 'CONTA_BLOQUEADA'
    | 'CONTA_ATIVADA'
    | 'LOGIN_CONTINGENCIA_LOCAL'
    | 'VINCULO_FIREBASE'
    | 'RESTAURACAO_DADOS'
    | 'PRIMEIRO_ACESSO_ADMIN'
    | 'FUNCIONARIO_CADASTRADO'
    | 'FUNCIONARIO_ATUALIZADO'
    | 'FUNCIONARIO_REMOVIDO'
    | 'CREDENCIAIS_ALTERADAS'
    | 'RECUPERACAO_ADMIN'
    | 'RECUPERACAO_ADMIN_FALHA';
  details?: string;
  role?: string;
}

export interface MenuItemAddon {
  id: string;
  name: string;
  price: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  costPrice?: number;
  prepTimeMinutes: number;
  imageUrl: string;
  available: boolean;
  featured?: boolean;
  tags?: string[];
  addons?: MenuItemAddon[];
  // Metadados opcionais quando o documento em menu_items representa um Combo oficial
  isCombo?: boolean;
  comboActive?: boolean;
  comboItems?: ComboComponent[];
  originalPrice?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ComboComponent {
  menuItemId: string;
  name: string;
  quantity: number;
  originalPrice: number;
}

export type ComboAvailabilityStatus =
  | 'AVAILABLE'
  | 'INACTIVE'
  | 'COMPONENT_PAUSED'
  | 'COMPONENT_MISSING'
  | 'EMPTY_COMPOSITION';

export interface ComboComponentStatus extends ComboComponent {
  status: 'AVAILABLE' | 'PAUSED' | 'MISSING';
}

export interface Combo {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  category: string; // e.g. 'Combos'
  items: ComboComponent[];
  originalPrice: number; // Sum of component individual prices
  comboPrice: number; // Special promotional price
  active: boolean; // Active / Inactive
  available: boolean; // Active and all component products exist and are available
  availabilityStatus?: ComboAvailabilityStatus;
  missingComponents?: ComboComponent[];
  pausedComponents?: ComboComponent[];
  componentStatuses?: ComboComponentStatus[];
  syncSource?: 'firestore' | 'local_legacy' | 'initial_fallback';
  featured?: boolean;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LegacyComboSyncCandidate {
  combo: Combo;
  reason: 'NOT_IN_FIRESTORE' | 'MISSING_COMPOSITION_IN_FIRESTORE' | 'LOCAL_NEWER';
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
}

export interface DailyMenuConfig {
  enabled: boolean;
  publishedAt?: string;
  referenceDate?: string;
  selectedItemIds: string[];
  selectedComboIds: string[];
  draftItemIds?: string[];
  draftComboIds?: string[];
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  addons?: MenuItemAddon[];
  notes?: string;
  subtotal: number;
  isCombo?: boolean;
  comboId?: string;
  comboComponents?: ComboComponent[];
}

export interface CustomerAddress {
  condominium?: string; // 'Eco Way' | 'Eco Fit' | string
  block?: string; // Bloco
  apartment?: string; // Ap / Apartamento
  street?: string;
  number?: string;
  neighborhood?: string;
  complement?: string;
  city?: string;
  reference?: string;
}

export interface CustomerInfo {
  name: string;
  phone?: string; // WhatsApp
  address?: CustomerAddress;
  notes?: string;
}

export interface OrderMovementLog {
  id: string;
  timestamp: string;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
  author: string;
  notes?: string;
}

export type FulfillmentType = 'DELIVERY' | 'RETIRADA';

export interface Order {
  id: string;
  orderNumber: string; // e.g. "#1024"
  createdAt: string;
  updatedAt: string;
  estimatedDeliveryMinutes: number;
  fulfillmentType: FulfillmentType; // 'DELIVERY' ou 'RETIRADA'
  customer: CustomerInfo;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentChangeFor?: number; // Para quanto é o troco (valor entregue pelo cliente)
  cashReceived?: number; // Valor em dinheiro recebido efetivamente
  changeAmount?: number; // Troco devolvido ao cliente
  paymentSplits?: OrderPaymentSplit[]; // Detalhamento quando houver pagamento misto
  paymentStatus: 'PENDENTE' | 'PAGO';
  pixCode?: string; // Código PIX Copia e Cola gerado
  pixTxId?: string; // Identificador TXID único da transação PIX
  pixQrCodeUrl?: string; // Imagem do QR Code PIX
  status: OrderStatus;
  createdBy?: string; // Identificador/nome do usuário que criou o pedido
  processedBy?: string; // Usuário que processou a venda no PDV/caixa
  deliveryPersonId?: string; // Identificador do entregador responsável
  deliveryPersonName?: string; // Nome do entregador responsável
  deliveryPerson?: {
    id: string;
    name: string;
    phone: string;
    assignedAt?: string;
    deliveredAt?: string;
  };
  deliveryAssignmentHistory?: DeliveryAssignmentRecord[]; // Histórico completo de atribuições e trocas
  operatorName?: string;
  cancellationReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  refundInfo?: OrderRefundInfo;
  movements: OrderMovementLog[];
  trackingCode?: string; // Código de alta entropia para rastreamento seguro público
  _cloudSyncStatus?: 'SYNCED' | 'PENDING' | 'ERROR';
}

export interface OrderRefundInfo {
  id: string; // ex: 'ref-1731400000-xyz'
  orderId: string;
  orderNumber: string;
  originalAmount: number;
  refundAmount: number;
  originalPaymentMethod: PaymentMethod;
  refundPaymentMethod: PaymentMethod;
  timestamp: string;
  reason: string;
  author: string;
  cashMovementId?: string;
  targetShiftId?: string;
  originalShiftId?: string;
  status: 'CONCLUIDO' | 'PENDENTE_CAIXA';
}

export interface OrderPaymentSplit {
  method: PaymentMethod;
  amount: number;
  cashReceived?: number;
  change?: number;
}

export interface DeliveryAssignmentRecord {
  assignedAt: string;
  previousDriverId?: string;
  previousDriverName?: string;
  newDriverId?: string;
  newDriverName?: string;
  assignedBy: string; // Usuário administrativo responsável pela alteração
  reason?: string; // Motivo da atribuição ou reatribuição
}

export interface DeliveryShiftSummary {
  totalDeliveries: number;
  completedDeliveries: number;
  inTransitDeliveries: number;
  pendingDeliveries: number;
  unassignedDeliveries: number;
  totalAmount: number;
  activeDriversCount: number;
}

export interface DeliveryShift {
  id: string; // ex: 'del-shift-2026-11-07'
  date: string; // 'YYYY-MM-DD'
  status: 'ABERTO' | 'FECHADO';
  openedAt: string;
  openedBy: {
    userId: string;
    userName: string;
    userRole: string;
  };
  closedAt?: string;
  closedBy?: {
    userId: string;
    userName: string;
    userRole: string;
  };
  summary?: DeliveryShiftSummary;
  notes?: string;
}

export interface PublicOrderTracking {
  id: string;
  orderNumber: string;
  createdAt: string;
  estimatedDeliveryMinutes: number;
  fulfillmentType: FulfillmentType;
  status: OrderStatus;
  items: {
    id: string;
    name: string;
    quantity: number;
    subtotal: number;
    addons?: MenuItemAddon[];
    notes?: string;
  }[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: 'PENDENTE' | 'PAGO';
  deliveryPerson?: {
    name: string;
  };
  trackingCode: string;
  // Note: PII sanitization: Customer phone, full address CPF and notes are stripped from public view
  destinationSummary?: string; // e.g. "Bela Vista, Campina Grande" (bairro/cidade apenas)
}

export type DayOfWeekKey = 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab' | 'dom';

export interface DayOperatingHours {
  dayKey: DayOfWeekKey;
  label: string;
  isOpen: boolean;
  openTime: string; // 'HH:mm' (1º turno)
  closeTime: string; // 'HH:mm' (1º turno)
  hasSecondShift?: boolean; // Opcional: habilita 2º turno no mesmo dia
  secondOpenTime?: string; // 'HH:mm' (2º turno)
  secondCloseTime?: string; // 'HH:mm' (2º turno)
}

export interface StoreClosedSettings {
  operatingHours: DayOperatingHours[];
  closedPrimaryMessage: string;
  closedSecondaryMessage: string;
}

export interface PublicStoreAvailability {
  verified: boolean;
  isOpen: boolean;
  reason: 'CASH_OPEN' | 'CASH_CLOSED' | 'MULTIPLE_OPEN_SHIFTS' | 'UNABLE_TO_VERIFY_CASH';
  message?: string;
  activeShiftId?: string | null;
  closedSettings: StoreClosedSettings;
  restaurantPublicInfo: {
    name: string;
    whatsapp: string;
    phone: string;
    address: string;
    city: string;
  };
  hasServerRestaurantInfo?: boolean;
  checkedAt: string;
}

export interface RestaurantConfig {
  name: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  pixKey: string;
  pixKeyType?: 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'ALEATORIA';
  pixReceiverName?: string;
  pixReceiverCity?: string;
  deliveryFeeBase: number;
  avgPrepTimeMinutes: number;
  avgDeliveryTimeMinutes: number;
  isOpen: boolean;
  customPublicUrl?: string; // Optional override for shared URL
  receiptFooterText?: string; // Texto configurável do rodapé do cupom térmico (ex: @nomedoperfil)
  dailyMenu?: DailyMenuConfig; // Configuração do cardápio do dia publicado
  operatingHours?: DayOperatingHours[]; // Horários semanais informativos exibidos quando o estabelecimento estiver fechado
  closedPrimaryMessage?: string; // Mensagem principal da página de estabelecimento fechado
  closedSecondaryMessage?: string; // Mensagem complementar opcional da página de estabelecimento fechado
  // Configurações independentes de Notificações Push
  notifyNewOrders?: boolean; // [ ] Notificar chegada de novos pedidos (padrão true)
  notifyDeliveryConfirmed?: boolean; // [ ] Notificar confirmação de entrega (padrão true)
  notifyReadyForDelivery?: boolean; // [ ] Notificar pedido pronto para entrega aos entregadores (padrão true)
  // Entregador fixo responsável pelas novas entregas (sem rodízio)
  defaultDeliveryPersonId?: string; // ID do entregador ativo selecionado pela administração
}

export type CashMovementType = 'SANGRIA' | 'VALE' | 'SUPRIMENTO' | 'VENDA' | 'AJUSTE' | 'ESTORNO';

export interface CashMovement {
  id: string;
  timestamp: string;
  type: CashMovementType;
  amount: number;
  paymentMethod?: PaymentMethod;
  description: string;
  employeeName?: string; // Para vales de funcionários
  orderId?: string;
  orderNumber?: string;
  author: string;
  refundReason?: string;
  originalShiftId?: string;
  originalMovementId?: string;
}

export type ExceptionalClosingReasonCode =
  | 'CLIENTE_NAO_PAGOU'
  | 'PIX_AGUARDANDO_EXTRATO'
  | 'ENTREGADOR_SEM_PRESTACAO_CONTAS'
  | 'PAGO_SEM_COMPROVANTE'
  | 'OUTRA_SITUACAO';

export interface ExceptionalClosingJustificationInput {
  orderId: string;
  reasonCode: ExceptionalClosingReasonCode;
  reasonDetail?: string;
}

export interface ExceptionalClosingPendingRecord {
  orderId: string;
  orderNumber: string;
  amount: number;
  paymentMethod: PaymentMethod | string;
  orderCreatedAt: string;
  customerName?: string;
  reasonCode: ExceptionalClosingReasonCode;
  reasonLabel: string;
  reasonDetail?: string;
  responsibleUid: string;
  responsibleName: string;
  responsibleRole?: string;
  recordedAt: string;
  shiftId: string;
}

export interface CashPendingDeliveredOrder {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  deliveredAt?: string;
  totalAmount: number;
  paymentMethod: PaymentMethod | string;
  customerName: string;
  origin?: string;
  originLabel: string;
  deliveryPersonId?: string;
  deliveryPersonName?: string;
  fulfillmentType?: FulfillmentType | string;
  settlementStatus?: string;
  settlementId?: string;
}

export interface CashShiftPendingSummary {
  shiftId: string;
  shiftStatus: 'ABERTO' | 'FECHADO';
  shiftOpenedAt: string;
  shiftClosedAt?: string;
  checkedAt: string;
  currentShiftPending: CashPendingDeliveredOrder[];
  currentShiftPendingCount: number;
  currentShiftPendingTotal: number;
  previousShiftsPending: CashPendingDeliveredOrder[];
  previousShiftsPendingCount: number;
  previousShiftsPendingTotal: number;
}

export interface CashRegisterShift {
  id: string;
  openedAt: string;
  closedAt?: string;
  status: 'ABERTO' | 'FECHADO';
  openedBy: string;
  closedBy?: string;
  closedByUid?: string;
  initialBalance: number; // Fundo de troco inicial
  movements: CashMovement[];
  finalCalculatedBalance?: number;
  finalCountedCash?: number;
  difference?: number;
  notes?: string;
  closedWithPendingOrders?: boolean;
  pendingDeliveredAtCloseCount?: number;
  pendingDeliveredAtCloseTotal?: number;
  exceptionalPendingJustifications?: ExceptionalClosingPendingRecord[];
}


