import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../../services/store';
import { MenuItem, Order, OrderItem, PaymentMethod, User, MenuItemAddon } from '../../types';
import { formatCurrency, formatDateTime, formatTime, getPaymentMethodLabel } from '../../utils/formatters';
import { generateQRCodeDataUrl } from '../../utils/qrcode';
import { 
  ShoppingBag, 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  Printer, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  DollarSign, 
  CreditCard, 
  QrCode, 
  Banknote, 
  Percent, 
  UserCheck, 
  History, 
  Store, 
  Receipt, 
  ChevronRight,
  ArrowRight,
  X,
  XCircle,
  FileText,
  SlidersHorizontal,
  Maximize2,
  Sparkles,
  MapPin,
  Bike,
  Building2,
  Home
} from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';

interface PointOfSaleProps {
  currentUser: User | null;
  onOrderCreated?: () => void;
  onNavigateToCaixa?: () => void;
}

interface CartItem extends OrderItem {
  key: string;
}

export const PointOfSale: React.FC<PointOfSaleProps> = ({ currentUser, onOrderCreated, onNavigateToCaixa }) => {
  const [activeTab, setActiveTab] = useState<'vendas' | 'historico'>('vendas');
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => store.getMenuItems());
  const [orders, setOrders] = useState<Order[]>(() => store.getOrders());
  const [currentShift, setCurrentShift] = useState(() => store.getCurrentCashShift());

  useEffect(() => {
    const handleUpdate = () => {
      setMenuItems(store.getMenuItems());
      setOrders(store.getOrders());
      setCurrentShift(store.getCurrentCashShift());
    };
    window.addEventListener('gestaofood_state_changed', handleUpdate);
    return () => window.removeEventListener('gestaofood_state_changed', handleUpdate);
  }, []);

  // Search & Categories
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('TODOS');

  // Selection Mode: 'cardapio' (opens customization modal with addons, qty, notes) vs 'rapido' (1-click direct add)
  const [selectionMode, setSelectionMode] = useState<'cardapio' | 'rapido'>('cardapio');
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [cartToastMessage, setCartToastMessage] = useState<string | null>(null);

  // Current Sale Cart State (Tudo Opcional)
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'RETIRADA' | 'DELIVERY'>('RETIRADA');
  
  // Condomínio Delivery details: Eco Way, Eco Fit, Outros. Bloco e Ap. (Tudo opcional)
  const [deliveryCondo, setDeliveryCondo] = useState<'Eco Way' | 'Eco Fit' | 'Outros' | ''>('');
  const [deliveryCondoCustom, setDeliveryCondoCustom] = useState('');
  const [deliveryBloco, setDeliveryBloco] = useState('');
  const [deliveryAp, setDeliveryAp] = useState('');
  const [deliveryReference, setDeliveryReference] = useState('');

  const [orderNotes, setOrderNotes] = useState('');
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [discountValue, setDiscountValue] = useState<string>('0');
  const [discountAuthorizedBy, setDiscountAuthorizedBy] = useState<string>('');
  
  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('DINHEIRO');
  const [cashTendered, setCashTendered] = useState<string>('');

  // Item customization modal (addons, quantity & notes like cardápio)
  const [selectedItemForAddons, setSelectedItemForAddons] = useState<MenuItem | null>(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [tempAddons, setTempAddons] = useState<MenuItemAddon[]>([]);
  const [tempNotes, setTempNotes] = useState('');

  // Sale finalized modal
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [printableOrder, setPrintableOrder] = useState<Order | null>(null);

  // Cancellation modal state
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  // History filters
  const [historyPeriod, setHistoryPeriod] = useState<'HOJE' | 'ONTEM' | '7DIAS' | 'TODOS'>('HOJE');
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState<string>('TODOS');
  const [historySearch, setHistorySearch] = useState('');

  const config = store.getRestaurantConfig();
  const operatorName = currentUser?.name || currentUser?.username || 'Caixa Balcão';

  const reloadData = () => {
    setMenuItems(store.getMenuItems());
    setOrders(store.getOrders());
    setCurrentShift(store.getCurrentCashShift());
  };

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    menuItems.forEach((item) => {
      if (item.category) set.add(item.category);
    });
    return ['TODOS', ...Array.from(set)];
  }, [menuItems]);

  // Filtered menu items
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'TODOS' || item.category === selectedCategory;
      return matchesSearch && matchesCategory && item.available;
    });
  }, [menuItems, searchQuery, selectedCategory]);

  // Calculations
  const subtotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.subtotal, 0);
  }, [cart]);

  const totalCartCount = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.quantity, 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    const rawVal = parseFloat(discountValue) || 0;
    if (rawVal <= 0) return 0;
    if (discountType === 'PERCENT') {
      return (subtotal * Math.min(rawVal, 100)) / 100;
    }
    return Math.min(rawVal, subtotal);
  }, [discountValue, discountType, subtotal]);

  const deliveryFee = fulfillmentType === 'DELIVERY' ? config.deliveryFeeBase : 0;
  const totalAmount = Math.max(0, subtotal - discountAmount + deliveryFee);

  const changeDue = useMemo(() => {
    if (paymentMethod !== 'DINHEIRO') return 0;
    const tendered = parseFloat(cashTendered) || 0;
    return Math.max(0, tendered - totalAmount);
  }, [cashTendered, totalAmount, paymentMethod]);

  // Add item with cardápio mode / addons check
  const handleItemClick = (item: MenuItem) => {
    if (selectionMode === 'cardapio' || (item.addons && item.addons.length > 0)) {
      setSelectedItemForAddons(item);
      setModalQuantity(1);
      setTempAddons([]);
      setTempNotes('');
    } else {
      quickAddToCart(item, 1, [], '');
    }
  };

  const quickAddToCart = (item: MenuItem, quantity: number, addons: MenuItemAddon[], notes: string) => {
    const addonsTotal = addons.reduce((sum, a) => sum + a.price, 0);
    const unitPrice = item.price + addonsTotal;
    const key = `${item.id}-${addons.map((a) => a.id).sort().join(',')}-${notes}`;

    setCart((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) =>
          i.key === key
            ? { ...i, quantity: i.quantity + quantity, subtotal: (i.quantity + quantity) * unitPrice }
            : i
        );
      }
      return [
        ...prev,
        {
          key,
          id: `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          menuItemId: item.id,
          name: item.name,
          quantity,
          unitPrice,
          addons: addons.length > 0 ? addons : undefined,
          notes: notes.trim() || undefined,
          subtotal: unitPrice * quantity,
        },
      ];
    });

    setCartToastMessage(`✓ ${quantity}x ${item.name} adicionado ao carrinho!`);
    setTimeout(() => setCartToastMessage(null), 2500);
  };

  const confirmCustomItemAdd = () => {
    if (!selectedItemForAddons) return;
    quickAddToCart(selectedItemForAddons, modalQuantity, tempAddons, tempNotes);
    setSelectedItemForAddons(null);
  };

  const updateItemQty = (key: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((item) => {
          if (item.key === key) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty, subtotal: newQty * item.unitPrice } : null;
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null);
    });
  };

  const removeItem = (key: string) => {
    setCart((prev) => prev.filter((i) => i.key !== key));
  };

  const handleClearCart = () => {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setFulfillmentType('RETIRADA');
    setDeliveryCondo('');
    setDeliveryCondoCustom('');
    setDeliveryBloco('');
    setDeliveryAp('');
    setDeliveryReference('');
    setOrderNotes('');
    setDiscountValue('0');
    setCashTendered('');
  };

  // Submit sale with idempotency lock
  const handleFinalizeSale = async () => {
    if (cart.length === 0 || isSubmitting) return;

    if (paymentMethod === 'DINHEIRO') {
      const tendered = parseFloat(cashTendered) || 0;
      if (tendered < totalAmount && cashTendered.trim() !== '') {
        alert(`Valor em dinheiro informado (R$ ${tendered.toFixed(2)}) é menor que o total (R$ ${totalAmount.toFixed(2)}).`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // Build formatted address for delivery
      let formattedAddress = undefined;
      if (fulfillmentType === 'DELIVERY') {
        const condoTitle = deliveryCondo === 'Outros'
          ? (deliveryCondoCustom.trim() || 'Outro Condomínio / Endereço')
          : (deliveryCondo ? `Condomínio ${deliveryCondo}` : (deliveryCondoCustom.trim() || 'Entrega'));

        const numStr = deliveryAp.trim()
          ? `Ap ${deliveryAp.trim()}`
          : (deliveryBloco.trim() ? `Bloco ${deliveryBloco.trim()}` : 'S/N');

        const complementParts: string[] = [];
        if (deliveryBloco.trim()) complementParts.push(`Bloco: ${deliveryBloco.trim()}`);
        if (deliveryAp.trim()) complementParts.push(`Ap: ${deliveryAp.trim()}`);

        formattedAddress = {
          street: condoTitle,
          number: numStr,
          neighborhood: deliveryCondo ? `Condomínio ${deliveryCondo}` : (deliveryCondoCustom.trim() || 'Bairro'),
          complement: complementParts.join(' - ') || undefined,
          city: config.city || 'João Pessoa',
          reference: deliveryReference.trim() || undefined,
        };
      }

      const syncResult = await store.createOrderAsync({
        fulfillmentType,
        customer: {
          name: customerName.trim() || (fulfillmentType === 'RETIRADA' ? 'Cliente Balcão' : 'Cliente Entrega'),
          phone: customerPhone.trim() || config.phone,
          address: formattedAddress,
          notes: orderNotes.trim() || undefined,
        },
        items: cart.map(({ key, ...item }) => item),
        subtotal,
        deliveryFee,
        discount: discountAmount,
        totalAmount,
        paymentMethod,
        paymentChangeFor: paymentMethod === 'DINHEIRO' && cashTendered ? parseFloat(cashTendered) : undefined,
        paymentStatus: 'PAGO',
        status: 'EM_PREPARO', // Direct to kitchen
        estimatedDeliveryMinutes: fulfillmentType === 'RETIRADA' ? 15 : config.avgDeliveryTimeMinutes,
      });
      const newOrder = syncResult.order;

      // Record automatically into active cash register shift if open
      const shift = store.getCurrentCashShift();
      if (shift && shift.status === 'ABERTO') {
        store.addCashMovement(
          'VENDA',
          totalAmount,
          `Venda PDV Balcão ${newOrder.orderNumber} - ${customerName}`,
          operatorName,
          paymentMethod
        );
      }

      setCompletedOrder(newOrder);
      handleClearCart();
      setIsCartDrawerOpen(false);
      reloadData();
      if (onOrderCreated) onOrderCreated();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintReceipt = (order: Order) => {
    setPrintableOrder(order);
    setTimeout(() => {
      window.print();
    }, 250);
  };

  // History filtering
  const filteredHistoryOrders = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOf7Days = startOfToday - 7 * 86400000;

    return orders.filter((o) => {
      const orderTime = new Date(o.createdAt).getTime();

      // Period filter
      if (historyPeriod === 'HOJE' && orderTime < startOfToday) return false;
      if (historyPeriod === 'ONTEM' && (orderTime < startOfYesterday || orderTime >= startOfToday)) return false;
      if (historyPeriod === '7DIAS' && orderTime < startOf7Days) return false;

      // Payment filter
      if (historyPaymentFilter !== 'TODOS' && o.paymentMethod !== historyPaymentFilter) return false;

      // Search filter
      if (historySearch) {
        const query = historySearch.toLowerCase();
        const matchesNum = o.orderNumber.toLowerCase().includes(query);
        const matchesCust = o.customer.name.toLowerCase().includes(query);
        const matchesOp = (o.operatorName || '').toLowerCase().includes(query);
        if (!matchesNum && !matchesCust && !matchesOp) return false;
      }

      return true;
    });
  }, [orders, historyPeriod, historyPaymentFilter, historySearch]);

  const historyMetrics = useMemo(() => {
    const validOrders = filteredHistoryOrders.filter((o) => o.status !== 'CANCELADO');
    const totalRev = validOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const count = validOrders.length;
    const avgTicket = count > 0 ? totalRev / count : 0;
    return { count, totalRev, avgTicket };
  }, [filteredHistoryOrders]);

  const handleOpenCancelModal = (order: Order) => {
    setOrderToCancel(order);
    setCancelReason('');
    setCancelError(null);
  };

  const handleExecuteCancelSale = () => {
    if (!orderToCancel) return;
    if (!cancelReason.trim()) {
      setCancelError('Por favor informe o motivo obrigatório do cancelamento.');
      return;
    }

    store.cancelOrder(orderToCancel.id, cancelReason, operatorName);
    setOrderToCancel(null);
    reloadData();
  };

  // Reusable Cart Section rendered both in desktop sidebar and slide-over cart drawer
  const renderCartSection = (isDrawer: boolean) => (
    <div className="space-y-4">
      {/* Customer & Fulfillment Info */}
      <div className="space-y-2.5 bg-[#FAF7F2] p-3 rounded-2xl border border-[#E8DFD5] text-xs">
        {/* Modalidade Toggle (Retirada vs Entrega) */}
        <div>
          <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1">
            Modalidade da Venda
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-white border border-[#E8DFD5] rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setFulfillmentType('RETIRADA')}
              className={`py-1.5 rounded-lg text-center transition flex items-center justify-center gap-1.5 cursor-pointer ${
                fulfillmentType === 'RETIRADA'
                  ? 'bg-[#3D2314] text-white shadow-2xs'
                  : 'text-[#6B4B3E] hover:text-[#2C1810]'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>Retirada no Balcão</span>
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentType('DELIVERY')}
              className={`py-1.5 rounded-lg text-center transition flex items-center justify-center gap-1.5 cursor-pointer ${
                fulfillmentType === 'DELIVERY'
                  ? 'bg-[#3D2314] text-white shadow-2xs'
                  : 'text-[#6B4B3E] hover:text-[#2C1810]'
              }`}
            >
              <Bike className="w-3.5 h-3.5" />
              <span>Entrega / Delivery</span>
            </button>
          </div>
        </div>

        {/* OPÇÃO RETIRADA: Apenas Nome e Telefone (Tudo Opcional) */}
        {fulfillmentType === 'RETIRADA' && (
          <div className="space-y-2 pt-1 border-t border-[#E8DFD5] animate-in fade-in">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs font-semibold text-[#2C1810] focus:ring-1 focus:ring-[#C86D3B]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(83) 9...."
                  className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs font-semibold text-[#2C1810] focus:ring-1 focus:ring-[#C86D3B]"
                />
              </div>
            </div>
            <div className="text-[11px] text-emerald-800 bg-emerald-50/80 border border-emerald-200/60 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Retirada: Apenas nome e telefone.</span>
            </div>
          </div>
        )}

        {/* OPÇÃO ENTREGA: Nome, Telefone, Condomínio (Eco Way, Eco Fit, Outros), Bloco e Ap */}
        {fulfillmentType === 'DELIVERY' && (
          <div className="space-y-2.5 pt-1 border-t border-[#E8DFD5] animate-in fade-in">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-[#C86D3B] flex items-center gap-1">
                <Bike className="w-3.5 h-3.5" />
                <span>Dados de Entrega</span>
              </span>
            </div>

            {/* Nome e Telefone */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs font-semibold text-[#2C1810] focus:ring-1 focus:ring-[#C86D3B]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(83) 9...."
                  className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs font-semibold text-[#2C1810] focus:ring-1 focus:ring-[#C86D3B]"
                />
              </div>
            </div>

            {/* Condomínio: Eco Way, Eco Fit, Outros */}
            <div>
              <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1 flex items-center gap-1">
                <Building2 className="w-3 h-3 text-[#C86D3B]" />
                <span>Condomínio</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setDeliveryCondo(deliveryCondo === 'Eco Way' ? '' : 'Eco Way')}
                  className={`py-1.5 px-2 rounded-xl text-xs font-bold transition text-center cursor-pointer border ${
                    deliveryCondo === 'Eco Way'
                      ? 'bg-[#721C24] text-white border-[#721C24] shadow-xs'
                      : 'bg-white text-[#3D2314] border-[#E8DFD5] hover:bg-amber-50/50'
                  }`}
                >
                  🏢 Eco Way
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryCondo(deliveryCondo === 'Eco Fit' ? '' : 'Eco Fit')}
                  className={`py-1.5 px-2 rounded-xl text-xs font-bold transition text-center cursor-pointer border ${
                    deliveryCondo === 'Eco Fit'
                      ? 'bg-[#721C24] text-white border-[#721C24] shadow-xs'
                      : 'bg-white text-[#3D2314] border-[#E8DFD5] hover:bg-amber-50/50'
                  }`}
                >
                  🏢 Eco Fit
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryCondo(deliveryCondo === 'Outros' ? '' : 'Outros')}
                  className={`py-1.5 px-2 rounded-xl text-xs font-bold transition text-center cursor-pointer border ${
                    deliveryCondo === 'Outros'
                      ? 'bg-[#721C24] text-white border-[#721C24] shadow-xs'
                      : 'bg-white text-[#3D2314] border-[#E8DFD5] hover:bg-amber-50/50'
                  }`}
                >
                  Outros...
                </button>
              </div>

              {/* Se clicou em Outros ou quer especificar */}
              {deliveryCondo === 'Outros' && (
                <div className="mt-2 animate-in fade-in">
                  <input
                    type="text"
                    value={deliveryCondoCustom}
                    onChange={(e) => setDeliveryCondoCustom(e.target.value)}
                    placeholder="Nome do condomínio / Endereço"
                    className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs font-medium text-[#2C1810]"
                  />
                </div>
              )}
            </div>

            {/* Bloco e Ap */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1">
                  Bloco
                </label>
                <input
                  type="text"
                  value={deliveryBloco}
                  onChange={(e) => setDeliveryBloco(e.target.value)}
                  placeholder="Ex: Bloco A, 02"
                  className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs font-medium text-[#2C1810]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1">
                  Apartamento / Ap
                </label>
                <input
                  type="text"
                  value={deliveryAp}
                  onChange={(e) => setDeliveryAp(e.target.value)}
                  placeholder="Ex: Ap 104, 302"
                  className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs font-medium text-[#2C1810]"
                />
              </div>
            </div>

            {/* Ponto de Referência */}
            <div>
              <input
                type="text"
                placeholder="Ponto de referência / Obs da entrega"
                value={deliveryReference}
                onChange={(e) => setDeliveryReference(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs font-medium text-[#2C1810]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Cart Items List */}
      <div className={`divide-y divide-[#E8DFD5]/70 ${isDrawer ? 'max-h-[38vh]' : 'max-h-60'} overflow-y-auto pr-1 scrollbar-thin`}>
        {cart.length === 0 ? (
          <div className="py-8 text-center text-[#8C5E47] space-y-2">
            <ShoppingBag className="w-8 h-8 mx-auto opacity-30 text-[#C86D3B]" />
            <p className="text-xs font-semibold">Nenhum item na comanda</p>
            <p className="text-[11px] text-slate-400">Clique nos produtos para adicionar ao carrinho da venda.</p>
          </div>
        ) : (
          cart.map((item) => (
            <div key={item.key} className="py-2.5 flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[#2C1810] leading-tight truncate">{item.name}</p>
                {item.addons && item.addons.length > 0 && (
                  <p className="text-[10px] text-[#C86D3B] font-medium mt-0.5">
                    + {item.addons.map((a) => a.name).join(', ')}
                  </p>
                )}
                {item.notes && (
                  <p className="text-[10px] text-slate-500 italic mt-0.5 truncate">Obs: {item.notes}</p>
                )}
                <p className="text-[11px] text-[#8C5E47] font-semibold mt-0.5">
                  {formatCurrency(item.unitPrice)} cada
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <div className="flex items-center border border-[#E8DFD5] rounded-lg bg-white overflow-hidden shadow-2xs">
                  <button
                    onClick={() => updateItemQty(item.key, -1)}
                    className="p-1 hover:bg-[#FAF7F2] text-[#3D2314] transition cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-7 text-center text-xs font-black text-[#2C1810]">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateItemQty(item.key, 1)}
                    className="p-1 hover:bg-[#FAF7F2] text-[#3D2314] transition cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                <span className="font-extrabold text-xs text-[#721C24] w-16 text-right font-mono">
                  {formatCurrency(item.subtotal)}
                </span>

                <button
                  onClick={() => removeItem(item.key)}
                  className="text-slate-400 hover:text-rose-600 p-1 transition cursor-pointer"
                  title="Remover item"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Discount & Payment & Notes */}
      {cart.length > 0 && (
        <div className="space-y-3 pt-3 border-t border-[#E8DFD5]">
          {/* Discount */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-[#6B4B3E] flex items-center gap-1">
              <Percent className="w-3.5 h-3.5 text-[#C86D3B]" />
              <span>Desconto Autorizado:</span>
            </span>
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-lg border border-[#E8DFD5] overflow-hidden text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setDiscountType('FIXED')}
                  className={`px-2 py-0.5 cursor-pointer ${discountType === 'FIXED' ? 'bg-[#3D2314] text-white' : 'bg-white text-slate-600'}`}
                >
                  R$
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('PERCENT')}
                  className={`px-2 py-0.5 cursor-pointer ${discountType === 'PERCENT' ? 'bg-[#3D2314] text-white' : 'bg-white text-slate-600'}`}
                >
                  %
                </button>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="w-16 px-2 py-1 bg-white border border-[#E8DFD5] rounded-lg text-xs font-bold text-right text-[#2C1810]"
              />
            </div>
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1.5">
              Forma de Pagamento
            </label>
            <div className="grid grid-cols-2 gap-1.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setPaymentMethod('DINHEIRO')}
                className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  paymentMethod === 'DINHEIRO'
                    ? 'bg-[#3D2314] text-white border-[#3D2314] shadow-xs'
                    : 'bg-[#FAF7F2] text-[#6B4B3E] border-[#E8DFD5] hover:bg-[#F2EAE0]'
                }`}
              >
                <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                <span>Dinheiro</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('PIX')}
                className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  paymentMethod === 'PIX'
                    ? 'bg-[#3D2314] text-white border-[#3D2314] shadow-xs'
                    : 'bg-[#FAF7F2] text-[#6B4B3E] border-[#E8DFD5] hover:bg-[#F2EAE0]'
                }`}
              >
                <QrCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>PIX</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CARTAO_DEBITO')}
                className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  paymentMethod === 'CARTAO_DEBITO'
                    ? 'bg-[#3D2314] text-white border-[#3D2314] shadow-xs'
                    : 'bg-[#FAF7F2] text-[#6B4B3E] border-[#E8DFD5] hover:bg-[#F2EAE0]'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5 text-amber-400" />
                <span>C. Débito</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CARTAO_CREDITO')}
                className={`p-2 rounded-xl border flex items-center justify-center gap-1.5 transition cursor-pointer ${
                  paymentMethod === 'CARTAO_CREDITO'
                    ? 'bg-[#3D2314] text-white border-[#3D2314] shadow-xs'
                    : 'bg-[#FAF7F2] text-[#6B4B3E] border-[#E8DFD5] hover:bg-[#F2EAE0]'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5 text-purple-400" />
                <span>C. Crédito</span>
              </button>
            </div>
          </div>

          {/* If Dinheiro: Change calculation */}
          {paymentMethod === 'DINHEIRO' && (
            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs space-y-1.5 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-950">Valor Recebido (R$):</span>
                <input
                  type="number"
                  step="any"
                  placeholder="Ex: 50.00"
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  className="w-24 px-2 py-1 bg-white border border-emerald-300 rounded-lg text-xs font-bold text-right text-emerald-950"
                />
              </div>
              {parseFloat(cashTendered) > totalAmount && (
                <div className="flex items-center justify-between pt-1 border-t border-emerald-200 font-extrabold text-emerald-800">
                  <span>Troco a Devolver:</span>
                  <span className="text-sm font-mono">{formatCurrency(changeDue)}</span>
                </div>
              )}
            </div>
          )}

          {/* Order Notes */}
          <div>
            <label className="block text-[10px] font-bold text-[#6B4B3E] uppercase mb-1">
              Observações Gerais do Pedido
            </label>
            <input
              type="text"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="Ex: Embalagem para viagem, cliente aguarda no salão"
              className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810]"
            />
          </div>

          {/* Financial Summary */}
          <div className="p-3 bg-[#FAF7F2] rounded-xl border border-[#E8DFD5] space-y-1.5 text-xs">
            <div className="flex justify-between text-[#8C5E47]">
              <span>Subtotal:</span>
              <span className="font-mono">{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Desconto Aplicado:</span>
                <span className="font-mono">- {formatCurrency(discountAmount)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-[#8C5E47]">
                <span>Taxa de Entrega:</span>
                <span className="font-mono">+ {formatCurrency(deliveryFee)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-[#E8DFD5] flex justify-between items-center text-sm font-black text-[#2C1810]">
              <span>TOTAL A PAGAR:</span>
              <span className="text-xl text-[#721C24] font-black font-mono">
                {formatCurrency(totalAmount)}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            <button
              onClick={handleFinalizeSale}
              disabled={isSubmitting || cart.length === 0}
              className="w-full py-3.5 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] hover:opacity-95 text-white font-extrabold rounded-xl text-sm shadow-md flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99] disabled:opacity-50"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>{isSubmitting ? 'Registrando Venda...' : `Confirmar Venda (${formatCurrency(totalAmount)})`}</span>
            </button>

            <button
              type="button"
              onClick={handleClearCart}
              className="w-full py-2 bg-transparent hover:bg-rose-50 text-rose-600 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Esvaziar Carrinho</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner & Tabs */}
      <div className="bg-[#FFFDF9] rounded-2xl p-4 sm:p-5 border border-[#E8DFD5] shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-[#C86D3B]/10 text-[#C86D3B] flex items-center justify-center font-bold text-xl border border-[#C86D3B]/20 shrink-0">
            <Store className="w-5 h-5 sm:w-6 sm:h-6 text-[#C86D3B]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-black text-[#2C1810] break-words">PDV — Ponto de Venda & Balcão</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#C86D3B]/15 text-[#C86D3B] border border-[#C86D3B]/25 shrink-0">
                AMANDITA SABORES
              </span>
            </div>
            <p className="text-xs text-[#8C5E47] mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="truncate">Operador: <strong className="text-[#2C1810]">{operatorName}</strong></span>
              <span>·</span>
              <span className={`flex items-center gap-1 font-semibold shrink-0 ${
                currentShift && currentShift.status === 'ABERTO' ? 'text-emerald-700' : 'text-amber-700'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  currentShift && currentShift.status === 'ABERTO' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`} />
                Caixa {currentShift && currentShift.status === 'ABERTO' ? 'Aberto' : 'Fechado'}
              </span>
            </p>
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {onNavigateToCaixa && (
            <button
              onClick={onNavigateToCaixa}
              className="px-3 py-2 bg-[#F7F2EA] hover:bg-[#EFE6DC] text-[#3D2314] text-xs font-bold rounded-xl border border-[#E8DFD5] transition flex items-center gap-1.5"
            >
              <Banknote className="w-3.5 h-3.5 text-[#C86D3B]" />
              <span>Fluxo do Caixa</span>
            </button>
          )}

          <div className="flex p-1 bg-[#F5EFEB] rounded-xl border border-[#E8DFD5] text-xs font-bold">
            <button
              onClick={() => setActiveTab('vendas')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                activeTab === 'vendas'
                  ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                  : 'text-[#6B4B3E] hover:text-[#2C1810]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Nova Venda</span>
            </button>
            <button
              onClick={() => setActiveTab('historico')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                activeTab === 'historico'
                  ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                  : 'text-[#6B4B3E] hover:text-[#2C1810]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Histórico ({orders.length})</span>
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'vendas' ? (
        /* MAIN PDV INTERFACE: PRODUCTS + SALE CART */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: PRODUCT SEARCH & CATALOG (7 COLS) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Search Bar & Category filter */}
            <div className="bg-[#FFFDF9] rounded-2xl p-4 border border-[#E8DFD5] shadow-xs space-y-3">
              {/* Option: Selection Mode Toggle (Cardápio with Addons/Qty vs 1-Click Fast) */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E8DFD5]">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#3D2314]">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#C86D3B]" />
                  <span>Ao Clicar no Produto:</span>
                </div>
                <div className="flex p-0.5 bg-[#FAF7F2] rounded-xl border border-[#E8DFD5] text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setSelectionMode('cardapio')}
                    className={`px-2.5 sm:px-3 py-1 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                      selectionMode === 'cardapio'
                        ? 'bg-[#3D2314] text-white shadow-2xs'
                        : 'text-[#6B4B3E] hover:text-[#2C1810]'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 text-amber-300" />
                    <span className="hidden sm:inline">Estilo Cardápio (Adicionais & Qtd)</span>
                    <span className="sm:hidden">Cardápio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectionMode('rapido')}
                    className={`px-2.5 sm:px-3 py-1 rounded-lg transition flex items-center gap-1.5 cursor-pointer ${
                      selectionMode === 'rapido'
                        ? 'bg-[#3D2314] text-white shadow-2xs'
                        : 'text-[#6B4B3E] hover:text-[#2C1810]'
                    }`}
                  >
                    <span className="hidden sm:inline">⚡ 1-Clique Rápido</span>
                    <span className="sm:hidden">⚡ Rápido</span>
                  </button>
                </div>
              </div>

              {/* Toast feedback when items are added to cart */}
              {cartToastMessage && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{cartToastMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCartDrawerOpen(true)}
                    className="underline text-[11px] text-emerald-900 cursor-pointer font-black"
                  >
                    Abrir Carrinho ({totalCartCount}) →
                  </button>
                </div>
              )}

              <div className="relative">
                <Search className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Pesquisar por cuscuz, tapioca, café, bolo..."
                  className="w-full pl-10 pr-4 py-2.5 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-sm text-[#2C1810] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#C86D3B]/40 focus:border-[#C86D3B] transition"
                />
              </div>

              {/* Category Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-[#3D2314] text-white shadow-xs'
                        : 'bg-[#FAF7F2] text-[#6B4B3E] hover:bg-[#F2EAE0] border border-[#E8DFD5]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className="bg-[#FFFDF9] hover:bg-[#FAF6F0] rounded-2xl border border-[#E8DFD5] hover:border-[#C86D3B]/60 p-3 flex flex-col justify-between transition cursor-pointer shadow-2xs hover:shadow-md group active:scale-[0.98]"
                >
                  <div className="space-y-2">
                    <div className="relative w-full h-24 rounded-xl overflow-hidden bg-slate-100">
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        loading="lazy"
                      />
                      {item.featured && (
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-[#C86D3B] text-white shadow-xs">
                          Destaque
                        </span>
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-[#2C1810] line-clamp-1 group-hover:text-[#C86D3B] transition">
                        {item.name}
                      </h4>
                      <p className="text-[10px] text-[#8C5E47] line-clamp-2 mt-0.5 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-[#E8DFD5]/60 flex items-center justify-between">
                    <span className="font-extrabold text-sm text-[#721C24]">
                      {formatCurrency(item.price)}
                    </span>
                    <button
                      type="button"
                      className="p-1 rounded-lg bg-[#C86D3B]/10 text-[#C86D3B] group-hover:bg-[#C86D3B] group-hover:text-white transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT COLUMN: CURRENT SALE / CART / CHECKOUT (5 COLS) */}
          <div className="lg:col-span-5 bg-[#FFFDF9] rounded-3xl border border-[#E8DFD5] shadow-sm p-4 sm:p-5 space-y-4 sticky top-20">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#E8DFD5] pb-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-[#C86D3B]" />
                <h3 className="font-black text-sm text-[#2C1810]">Comanda de Venda</h3>
                <span className="text-xs text-[#8C5E47]">({totalCartCount} itens)</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCartDrawerOpen(true)}
                  className="px-2.5 py-1 rounded-lg bg-[#FAF7F2] hover:bg-[#EFE6DC] text-[#3D2314] border border-[#E8DFD5] transition flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                  title="Expandir carrinho em tela cheia / gaveta lateral"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-[#C86D3B]" />
                  <span className="hidden sm:inline">Gaveta</span>
                </button>
                {cart.length > 0 && (
                  <button
                    onClick={handleClearCart}
                    className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 transition cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Limpar</span>
                  </button>
                )}
              </div>
            </div>

            {/* Interactive Cart & Checkout Section */}
            {renderCartSection(false)}
          </div>
        </div>
      ) : (
        /* SALES HISTORY & AUDIT TAB */
        <div className="bg-[#FFFDF9] rounded-2xl border border-[#E8DFD5] shadow-xs p-6 space-y-6">
          {/* Metrics summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-[#FAF7F2] rounded-xl border border-[#E8DFD5]">
              <p className="text-xs text-[#8C5E47] font-semibold">Total de Vendas Concluídas</p>
              <p className="text-2xl font-black text-[#2C1810] mt-1">{historyMetrics.count}</p>
            </div>
            <div className="p-4 bg-[#FAF7F2] rounded-xl border border-[#E8DFD5]">
              <p className="text-xs text-[#8C5E47] font-semibold">Faturamento Total do Período</p>
              <p className="text-2xl font-black text-[#721C24] mt-1">{formatCurrency(historyMetrics.totalRev)}</p>
            </div>
            <div className="p-4 bg-[#FAF7F2] rounded-xl border border-[#E8DFD5]">
              <p className="text-xs text-[#8C5E47] font-semibold">Ticket Médio por Venda</p>
              <p className="text-2xl font-black text-[#C86D3B] mt-1">{formatCurrency(historyMetrics.avgTicket)}</p>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#6B4B3E]">Período:</span>
              <div className="flex p-0.5 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs font-semibold">
                {(['HOJE', 'ONTEM', '7DIAS', 'TODOS'] as const).map((period) => (
                  <button
                    key={period}
                    onClick={() => setHistoryPeriod(period)}
                    className={`px-3 py-1 rounded-lg transition ${
                      historyPeriod === period
                        ? 'bg-[#3D2314] text-white'
                        : 'text-[#6B4B3E] hover:text-[#2C1810]'
                    }`}
                  >
                    {period === 'HOJE' ? 'Hoje' : period === 'ONTEM' ? 'Ontem' : period === '7DIAS' ? '7 Dias' : 'Todos'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={historyPaymentFilter}
                onChange={(e) => setHistoryPaymentFilter(e.target.value)}
                className="px-3 py-1.5 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs font-semibold text-[#2C1810]"
              >
                <option value="TODOS">Todas as Formas de Pagamento</option>
                <option value="DINHEIRO">Dinheiro</option>
                <option value="PIX">PIX</option>
                <option value="CARTAO_DEBITO">Cartão de Débito</option>
                <option value="CARTAO_CREDITO">Cartão de Crédito</option>
              </select>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Buscar pedido ou cliente..."
                  className="pl-8 pr-3 py-1.5 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] placeholder:text-slate-400"
                />
              </div>
            </div>
          </div>

          {/* Orders Table */}
          <div className="border border-[#E8DFD5] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF7F2] border-b border-[#E8DFD5] text-[#6B4B3E] uppercase font-bold text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Pedido / Hora</th>
                    <th className="py-3 px-4">Cliente / Tipo</th>
                    <th className="py-3 px-4">Itens</th>
                    <th className="py-3 px-4">Pagamento</th>
                    <th className="py-3 px-4">Total</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8DFD5]">
                  {filteredHistoryOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[#8C5E47]">
                        Nenhuma venda encontrada para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredHistoryOrders.map((order) => {
                      const isCancelled = order.status === 'CANCELADO';
                      return (
                        <tr
                          key={order.id}
                          className={`hover:bg-[#FAF6F0] transition ${isCancelled ? 'bg-rose-50/50 opacity-70' : ''}`}
                        >
                          <td className="py-3 px-4">
                            <span className="font-extrabold text-[#2C1810] block">{order.orderNumber}</span>
                            <span className="text-[11px] text-[#8C5E47]">{formatTime(order.createdAt)}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-[#2C1810] block">{order.customer.name}</span>
                            <span className="text-[10px] text-[#8C5E47] font-medium">
                              {order.fulfillmentType === 'RETIRADA' ? 'Balcão / Retirada' : 'Delivery'}
                            </span>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <p className="truncate text-slate-700">
                              {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                            </p>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-[#3D2314]">
                              {getPaymentMethodLabel(order.paymentMethod)}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-black text-[#721C24]">
                            {formatCurrency(order.totalAmount)}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isCancelled
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {isCancelled ? 'Cancelado' : order.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right space-x-1">
                            <button
                              onClick={() => handlePrintReceipt(order)}
                              title="Reimprimir Comprovante Térmico"
                              className="p-1.5 rounded-lg bg-[#FAF7F2] hover:bg-[#EFE6DC] text-[#3D2314] transition"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            {!isCancelled && (
                              <button
                                onClick={() => handleOpenCancelModal(order)}
                                title="Cancelar Venda (Permissão & Motivo)"
                                className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 transition"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE STICKY FLOATING CART BUTTON (IDENTICAL TO CARDÁPIO) */}
      {cart.length > 0 && (
        <aside aria-label="Acesso Rápido ao Carrinho" className="lg:hidden fixed bottom-4 left-4 right-4 z-40 animate-in slide-in-from-bottom-3">
          <button
            onClick={() => setIsCartDrawerOpen(true)}
            className="w-full bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white p-3.5 rounded-2xl shadow-xl flex items-center justify-between font-black text-sm border border-white/20 active:scale-95 transition cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                <ShoppingBag className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <span className="block text-[10px] text-amber-200 uppercase font-mono tracking-wider">Carrinho da Venda</span>
                <span className="font-extrabold text-sm">{totalCartCount} item(s) • Ver e Finalizar</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-black text-amber-300 font-mono">{formatCurrency(totalAmount)}</span>
              <ChevronRight className="w-5 h-5 text-white" />
            </div>
          </button>
        </aside>
      )}

      {/* SLIDE-OVER CART DRAWER (FULL CARDÁPIO EXPERIENCE) */}
      {isCartDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#2C1810]/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg bg-[#FFFDF9] h-full shadow-2xl flex flex-col border-l border-[#E8DFD5] animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="bg-[#2C1810] text-white p-4 flex items-center justify-between border-b border-[#C86D3B]/30">
              <div className="flex items-center gap-2.5">
                <Receipt className="w-5 h-5 text-[#C86D3B]" />
                <div>
                  <h3 className="font-black text-sm text-white">Carrinho da Venda — PDV</h3>
                  <p className="text-[11px] text-[#D9C7B8]">{totalCartCount} item(s) selecionado(s)</p>
                </div>
              </div>
              <button
                onClick={() => setIsCartDrawerOpen(false)}
                className="p-1.5 text-[#D9C7B8] hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
                title="Fechar Gaveta"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cart Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {renderCartSection(true)}
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMIZE ADDONS, QUANTITY & NOTES MODAL (CARDÁPIO STYLE) */}
      {selectedItemForAddons && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2C1810]/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg bg-[#FFFDF9] rounded-3xl border border-[#E8DFD5] shadow-2xl overflow-hidden">
            <div className="bg-[#2C1810] text-white p-4 sm:p-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 block font-mono">
                  {selectedItemForAddons.category}
                </span>
                <h3 className="font-black text-base sm:text-lg text-white">{selectedItemForAddons.name}</h3>
              </div>
              <button
                onClick={() => setSelectedItemForAddons(null)}
                className="p-1 text-[#D9C7B8] hover:text-white rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Product preview banner */}
              <div className="flex items-center gap-4 p-3 bg-[#FAF7F2] rounded-2xl border border-[#E8DFD5]">
                <img
                  src={selectedItemForAddons.imageUrl}
                  alt={selectedItemForAddons.name}
                  className="w-20 h-20 rounded-xl object-cover border border-[#E8DFD5] shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#8C5E47] line-clamp-2 leading-relaxed">
                    {selectedItemForAddons.description}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs">
                    <span className="font-black text-[#721C24] text-base font-mono">
                      {formatCurrency(selectedItemForAddons.price)}
                    </span>
                    <span className="text-[11px] text-[#8C5E47] flex items-center gap-1 font-semibold">
                      <Clock className="w-3.5 h-3.5 text-[#C86D3B]" />
                      <span>~{selectedItemForAddons.prepTimeMinutes} min</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Quantity selector */}
              <div className="flex items-center justify-between p-3.5 bg-white rounded-2xl border border-[#E8DFD5]">
                <div>
                  <span className="text-xs font-black text-[#2C1810] block">Quantidade de Itens</span>
                  <span className="text-[10px] text-[#8C5E47]">Selecione a quantidade para o pedido</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setModalQuantity(Math.max(1, modalQuantity - 1))}
                    className="w-9 h-9 rounded-xl bg-[#FAF7F2] border border-[#E8DFD5] hover:bg-[#F2EAE0] flex items-center justify-center font-black text-sm text-[#2C1810] transition cursor-pointer"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="font-black text-lg text-[#2C1810] w-8 text-center font-mono">
                    {modalQuantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalQuantity(modalQuantity + 1)}
                    className="w-9 h-9 rounded-xl bg-[#FAF7F2] border border-[#E8DFD5] hover:bg-[#F2EAE0] flex items-center justify-center font-black text-sm text-[#2C1810] transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Addons List */}
              {selectedItemForAddons.addons && selectedItemForAddons.addons.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[#6B4B3E] uppercase">
                    Adicionais Opcionais
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedItemForAddons.addons.map((addon) => {
                      const isSelected = tempAddons.some((a) => a.id === addon.id);
                      return (
                        <label
                          key={addon.id}
                          className={`flex items-center justify-between p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                            isSelected
                              ? 'bg-[#C86D3B]/10 border-[#C86D3B] text-[#2C1810] font-bold'
                              : 'bg-white border-[#E8DFD5] text-slate-700 hover:bg-[#FAF7F2]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setTempAddons([...tempAddons, addon]);
                                } else {
                                  setTempAddons(tempAddons.filter((a) => a.id !== addon.id));
                                }
                              }}
                              className="w-4 h-4 rounded text-[#C86D3B] focus:ring-[#C86D3B]"
                            />
                            <span>{addon.name}</span>
                          </div>
                          <span className="font-extrabold text-[#721C24] font-mono">
                            {addon.price > 0 ? `+ ${formatCurrency(addon.price)}` : 'Incluso'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom notes */}
              <div>
                <label className="block text-xs font-bold text-[#6B4B3E] uppercase mb-1">
                  Observações para a Cozinha / Modificações
                </label>
                <input
                  type="text"
                  value={tempNotes}
                  onChange={(e) => setTempNotes(e.target.value)}
                  placeholder="Ex: sem cebola, ovo bem passado, manteiga à parte"
                  className="w-full px-3 py-2.5 bg-white border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:ring-2 focus:ring-[#C86D3B]/30"
                />
              </div>

              {/* Total calculation & Add to cart button */}
              <div className="pt-3 border-t border-[#E8DFD5] flex items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] text-[#8C5E47] block">Total deste Item ({modalQuantity}x):</span>
                  <span className="text-xl font-black text-[#721C24] font-mono">
                    {formatCurrency(
                      (selectedItemForAddons.price + tempAddons.reduce((s, a) => s + a.price, 0)) * modalQuantity
                    )}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={confirmCustomItemAdd}
                  className="px-6 py-3 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] hover:opacity-95 text-white font-extrabold rounded-xl text-xs shadow-md transition cursor-pointer active:scale-95 flex items-center gap-2"
                >
                  <ShoppingBag className="w-4 h-4 text-white" />
                  <span>Adicionar ao Carrinho</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SALE COMPLETED SUCCESS MODAL */}
      {completedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2C1810]/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-[#FFFDF9] rounded-3xl border border-[#E8DFD5] shadow-2xl p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                Venda Registrada com Sucesso!
              </span>
              <h3 className="text-2xl font-black text-[#2C1810] mt-2">
                Pedido {completedOrder.orderNumber}
              </h3>
              <p className="text-xs text-[#8C5E47]">
                Valor: <strong className="text-[#721C24]">{formatCurrency(completedOrder.totalAmount)}</strong> ({getPaymentMethodLabel(completedOrder.paymentMethod)})
              </p>

              <div className="mt-2.5 flex items-center justify-center">
                {completedOrder._cloudSyncStatus === 'SYNCED' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Sincronizado no Cloud Firestore</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                    <span>Salvo no Caixa · Fila de Sincronização Ativa</span>
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-600 bg-[#FAF7F2] p-3 rounded-xl border border-[#E8DFD5]">
              O pedido foi enviado diretamente para a <strong>Cozinha / KDS</strong> e computado no saldo do caixa.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handlePrintReceipt(completedOrder)}
                className="flex-1 py-3 bg-[#FAF7F2] hover:bg-[#EFE6DC] border border-[#E8DFD5] text-[#3D2314] font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
              >
                <Printer className="w-4 h-4 text-[#C86D3B]" />
                <span>Imprimir Comprovante</span>
              </button>

              <button
                type="button"
                onClick={() => setCompletedOrder(null)}
                className="flex-1 py-3 bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white font-bold rounded-xl text-xs transition"
              >
                Nova Venda
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCELLATION MODAL (WITH MANDATORY REASON) */}
      {orderToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2C1810]/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-[#FFFDF9] rounded-3xl border border-rose-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-base text-rose-950">Cancelar Venda</h3>
                <p className="text-xs text-rose-700">Pedido {orderToCancel.orderNumber} - {formatCurrency(orderToCancel.totalAmount)}</p>
              </div>
            </div>

            {cancelError && (
              <p className="text-xs text-rose-600 font-semibold bg-rose-50 p-2 rounded-lg border border-rose-200">
                {cancelError}
              </p>
            )}

            <div>
              <label className="block text-xs font-bold text-[#3D2314] mb-1">
                Motivo do Cancelamento <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ex: Erro ao digitar valor, desistência do cliente, troca de forma de pagamento..."
                rows={3}
                className="w-full p-2.5 bg-white border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:ring-2 focus:ring-rose-500/20"
                autoFocus
              />
            </div>

            <p className="text-[11px] text-[#8C5E47] bg-[#FAF7F2] p-2.5 rounded-xl border border-[#E8DFD5]">
              O cancelamento estornará a venda no fluxo do caixa atual e registrará o operador responsável (<strong>{operatorName}</strong>) nos relatórios de auditoria.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOrderToCancel(null)}
                className="flex-1 py-2.5 bg-[#FAF7F2] text-[#3D2314] font-bold rounded-xl text-xs border border-[#E8DFD5]"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleExecuteCancelSale}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition"
              >
                Confirmar Cancelamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRINTABLE RECEIPT TEMPLATE (80mm) */}
      {printableOrder && (
        <div id="printable-receipt" className="hidden font-mono text-[12px] leading-tight text-black">
          <div className="text-center pb-2 border-b border-dashed border-black">
            <h2 className="font-extrabold text-[15px]">{config.name}</h2>
            <p className="text-[11px]">Tradição & Afeto Artesanal</p>
            <p>{config.address}</p>
            <p>TEL: {config.phone}</p>
          </div>

          <div className="py-2 border-b border-dashed border-black">
            <p className="font-bold text-[14px]">CUPOM NÃO FISCAL - PEDIDO {printableOrder.orderNumber}</p>
            <p>DATA: {formatDateTime(printableOrder.createdAt)}</p>
            <p>OPERADOR: {operatorName}</p>
            <p>CLIENTE: {printableOrder.customer.name}</p>
            {printableOrder.customer.phone && <p>TEL: {printableOrder.customer.phone}</p>}
            <p>TIPO: {printableOrder.fulfillmentType === 'RETIRADA' ? 'BALCÃO / RETIRADA' : 'DELIVERY'}</p>
            {printableOrder.fulfillmentType === 'DELIVERY' && printableOrder.customer.address && (
              <p className="font-bold">ENTREGA: {printableOrder.customer.address.street}, {printableOrder.customer.address.number} {printableOrder.customer.address.complement ? `(${printableOrder.customer.address.complement})` : ''}</p>
            )}
            {printableOrder.customer.address?.reference && (
              <p className="text-[11px] italic">REF: {printableOrder.customer.address.reference}</p>
            )}
          </div>

          <div className="py-2 border-b border-dashed border-black space-y-1">
            <div className="flex justify-between font-bold border-b border-dotted border-black pb-1">
              <span>QTD ITEM</span>
              <span>TOTAL</span>
            </div>
            {printableOrder.items.map((i) => (
              <div key={i.id} className="text-[11px]">
                <div className="flex justify-between">
                  <span>{i.quantity}x {i.name}</span>
                  <span>{formatCurrency(i.subtotal)}</span>
                </div>
                {i.addons && i.addons.map((a) => (
                  <p key={a.id} className="text-[10px] pl-2">+ {a.name}</p>
                ))}
                {i.notes && <p className="text-[10px] pl-2 italic">Obs: {i.notes}</p>}
              </div>
            ))}
          </div>

          <div className="py-2 border-b border-dashed border-black space-y-0.5">
            <div className="flex justify-between">
              <span>SUBTOTAL:</span>
              <span>{formatCurrency(printableOrder.subtotal)}</span>
            </div>
            {printableOrder.discount > 0 && (
              <div className="flex justify-between">
                <span>DESCONTO:</span>
                <span>- {formatCurrency(printableOrder.discount)}</span>
              </div>
            )}
            {printableOrder.deliveryFee > 0 && (
              <div className="flex justify-between">
                <span>TAXA ENTREGA:</span>
                <span>+ {formatCurrency(printableOrder.deliveryFee)}</span>
              </div>
            )}
            <div className="flex justify-between font-extrabold text-[14px] pt-1 border-t border-black">
              <span>TOTAL:</span>
              <span>{formatCurrency(printableOrder.totalAmount)}</span>
            </div>
            <div className="flex justify-between pt-1">
              <span>PAGAMENTO:</span>
              <span>{getPaymentMethodLabel(printableOrder.paymentMethod)}</span>
            </div>
            {printableOrder.paymentChangeFor && printableOrder.paymentChangeFor > printableOrder.totalAmount && (
              <>
                <div className="flex justify-between text-[11px]">
                  <span>PAGO EM DINHEIRO:</span>
                  <span>{formatCurrency(printableOrder.paymentChangeFor)}</span>
                </div>
                <div className="flex justify-between font-bold text-[12px]">
                  <span>TROCO:</span>
                  <span>{formatCurrency(printableOrder.paymentChangeFor - printableOrder.totalAmount)}</span>
                </div>
              </>
            )}
          </div>

          <div className="text-center pt-3 text-[11px]">
            <p>Agradecemos a preferência!</p>
            <p className="font-bold">Amandita Sabores</p>
          </div>
        </div>
      )}
    </div>
  );
};
