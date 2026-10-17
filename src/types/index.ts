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
  | 'DINHEIRO';

export type UserRole = 
  | 'ADMINISTRADOR' 
  | 'GERENTE' 
  | 'CAIXA' 
  | 'COZINHA' 
  | 'ENTREGADOR'
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

export interface User {
  id: string;
  name?: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
  role: UserRole;
  status?: UserStatus;
  allowedModules?: AppModule[];
  phone?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export interface UserAccessLog {
  id: string;
  userId?: string;
  username: string;
  timestamp: string;
  action: 'LOGIN_SUCESSO' | 'LOGIN_FALHA' | 'LOGOUT' | 'SENHA_ALTERADA' | 'CONTA_BLOQUEADA';
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

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  addons?: MenuItemAddon[];
  notes?: string;
  subtotal: number;
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
  paymentChangeFor?: number; // Para quanto é o troco
  paymentStatus: 'PENDENTE' | 'PAGO';
  pixCode?: string; // Código PIX Copia e Cola gerado
  pixQrCodeUrl?: string; // Imagem do QR Code PIX
  status: OrderStatus;
  deliveryPerson?: {
    id: string;
    name: string;
    phone: string;
    assignedAt?: string;
    deliveredAt?: string;
  };
  operatorName?: string;
  cancellationReason?: string;
  cancelledBy?: string;
  movements: OrderMovementLog[];
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

