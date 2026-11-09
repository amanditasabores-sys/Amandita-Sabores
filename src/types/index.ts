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
  authProvider?: 'firebase_email' | 'firebase_google' | 'local_contingency';
  firebaseUid?: string;
}

export interface UserAccessLog {
  id: string;
  userId?: string;
  username: string;
  timestamp: string;
  action: 'LOGIN_SUCESSO' | 'LOGIN_FALHA' | 'LOGOUT' | 'SENHA_ALTERADA' | 'CONTA_BLOQUEADA' | 'LOGIN_CONTINGENCIA_LOCAL' | 'VINCULO_FIREBASE' | 'RESTAURACAO_DADOS';
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
}

export interface ComboComponent {
  menuItemId: string;
  name: string;
  quantity: number;
  originalPrice: number;
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
  available: boolean; // Components available in stock
  featured?: boolean;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
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
  movements: OrderMovementLog[];
  trackingCode?: string; // Código de alta entropia para rastreamento seguro público
  _cloudSyncStatus?: 'SYNCED' | 'PENDING' | 'ERROR';
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
  // Configurações independentes de Notificações Push (restritas exclusivamente a 2 eventos)
  notifyNewOrders?: boolean; // [ ] Notificar chegada de novos pedidos (padrão true)
  notifyDeliveryConfirmed?: boolean; // [ ] Notificar confirmação de entrega (padrão true)
  // Entregador fixo responsável pelas novas entregas (sem rodízio)
  defaultDeliveryPersonId?: string; // ID do entregador ativo selecionado pela administração
}

export type CashMovementType = 'SANGRIA' | 'VALE' | 'SUPRIMENTO' | 'VENDA' | 'AJUSTE';

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
}

export interface CashRegisterShift {
  id: string;
  openedAt: string;
  closedAt?: string;
  status: 'ABERTO' | 'FECHADO';
  openedBy: string;
  closedBy?: string;
  initialBalance: number; // Fundo de troco inicial
  movements: CashMovement[];
  finalCalculatedBalance?: number;
  finalCountedCash?: number;
  difference?: number;
  notes?: string;
}

