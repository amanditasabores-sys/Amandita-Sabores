import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../../services/store';
import { MenuItem, MenuItemAddon, OrderItem, PaymentMethod, FulfillmentType, Order, Combo, DailyMenuConfig } from '../../types';
import { formatCurrency, generateWhatsAppOrderMessage } from '../../utils/formatters';
import { getPublicAppUrl } from '../../utils/url';
import { generateQRCodeDataUrl } from '../../utils/qrcode';
import { 
  Search, 
  ShoppingBag, 
  Clock, 
  Plus, 
  Minus, 
  Trash2, 
  X, 
  Check, 
  Sparkles, 
  SlidersHorizontal, 
  Send, 
  MapPin, 
  Phone, 
  User, 
  CreditCard, 
  QrCode, 
  ExternalLink,
  Copy,
  CheckCircle2,
  Bike,
  Store as StoreIcon,
  AlertCircle,
  Building2,
  Lock,
  Layers,
  Calendar,
  Tag,
  TrendingDown,
  Info,
  CheckSquare
} from 'lucide-react';
import { AmanditaLogo } from '../common/AmanditaLogo';

interface CustomerMenuProps {
  onNavigateToTracking?: (orderId: string, trackingCode?: string) => void;
}

export const CustomerMenu: React.FC<CustomerMenuProps> = ({ 
  onNavigateToTracking,
}) => {
  const [config, setConfig] = useState(() => store.getRestaurantConfig());
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => store.getMenuItems());
  const [combos, setCombos] = useState<Combo[]>(() => store.getCombos());
  const [dailyConfig, setDailyConfig] = useState<DailyMenuConfig>(() => store.getDailyMenuConfig());

  // Placed order success state
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [createdOrderNumber, setCreatedOrderNumber] = useState<string>('');
  const [whatsappShareUrl, setWhatsappShareUrl] = useState<string>('');
  const [pixQrDataUrl, setPixQrDataUrl] = useState<string>('');
  const [copiedPixCode, setCopiedPixCode] = useState(false);

  // Sync state
  useEffect(() => {
    const handleUpdate = () => {
      setMenuItems(store.getMenuItems());
      setCombos(store.getCombos());
      setDailyConfig(store.getDailyMenuConfig());
      setConfig(store.getRestaurantConfig());
      if (createdOrderId) {
        const fresh = store.getOrderById(createdOrderId);
        if (fresh) setCreatedOrder(fresh);
      }
    };
    window.addEventListener('gestaofood_state_changed', handleUpdate);
    return () => window.removeEventListener('gestaofood_state_changed', handleUpdate);
  }, [createdOrderId]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('TODAS');
  const [selectedTag, setSelectedTag] = useState<string>('TODOS');
  const [sortBy, setSortBy] = useState<'relevance' | 'price_asc' | 'price_desc'>('relevance');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Mode: Daily Menu vs Full Catalog (defaults to Daily Menu if active)
  const [viewScope, setViewScope] = useState<'daily' | 'full'>(() => {
    const dc = store.getDailyMenuConfig();
    return dc.enabled && (dc.selectedItemIds.length > 0 || dc.selectedComboIds.length > 0) ? 'daily' : 'full';
  });

  // Cart state
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Customization Modal for individual items
  const [selectedItemForModal, setSelectedItemForModal] = useState<MenuItem | null>(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [modalSelectedAddons, setModalSelectedAddons] = useState<MenuItemAddon[]>([]);
  const [modalNotes, setModalNotes] = useState('');

  // Fulfillment Type: Entrega vs Retirada no Balcão
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('DELIVERY');
  const [formError, setFormError] = useState<string | null>(null);

  // Checkout Form State
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [condoType, setCondoType] = useState<'Eco Way' | 'Eco Fit' | 'Outros' | ''>('');
  const [condoCustom, setCondoCustom] = useState('');
  const [bloco, setBloco] = useState('');
  const [apto, setApto] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [complement, setComplement] = useState('');
  const [reference, setReference] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');
  const [paymentChangeFor, setPaymentChangeFor] = useState('');

  // Available categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    if (combos.some((c) => c.active !== false)) {
      set.add('Combos & Ofertas');
    }
    menuItems.forEach((item) => {
      if (item.category && item.category !== 'Combos') {
        set.add(item.category);
      }
    });
    return ['TODAS', ...Array.from(set)];
  }, [menuItems, combos]);

  // Tags list
  const allTags = useMemo(() => {
    const set = new Set<string>();
    menuItems.forEach((i) => i.tags?.forEach((t) => set.add(t)));
    combos.forEach((c) => c.tags?.forEach((t) => set.add(t)));
    return ['TODOS', ...Array.from(set)];
  }, [menuItems, combos]);

  // Filtered Combos
  const filteredCombos = useMemo(() => {
    // Only active combos
    let list = combos.filter((c) => c.active !== false);

    // If Daily Menu filter is enabled and scope is 'daily', restrict to published combos
    if (dailyConfig.enabled && viewScope === 'daily') {
      const allowedSet = new Set(dailyConfig.selectedComboIds);
      list = list.filter((c) => allowedSet.has(c.id));
    }

    // Category filter
    if (selectedCategory !== 'TODAS' && selectedCategory !== 'Combos & Ofertas') {
      return [];
    }

    // Tag filter
    if (selectedTag !== 'TODOS') {
      list = list.filter((c) => c.tags?.includes(selectedTag));
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((c) => 
        c.name.toLowerCase().includes(q) || 
        c.description.toLowerCase().includes(q) ||
        c.items.some((comp) => comp.name.toLowerCase().includes(q))
      );
    }

    return list;
  }, [combos, dailyConfig, viewScope, selectedCategory, selectedTag, searchQuery]);

  // Filtered Items (Excluding combos category, which are handled in filteredCombos)
  const filteredItems = useMemo(() => {
    let list = menuItems.filter((item) => {
      // Exclude items already categorized as combos
      if (item.category === 'Combos') return false;

      // Only available items (default to true if available property is not explicitly false)
      if (item.available === false) return false;

      // Daily menu filter
      if (dailyConfig.enabled && viewScope === 'daily') {
        const allowedSet = new Set(dailyConfig.selectedItemIds);
        if (!allowedSet.has(item.id)) return false;
      }

      // Category filter
      if (selectedCategory === 'Combos & Ofertas') return false;
      if (selectedCategory !== 'TODAS' && item.category !== selectedCategory) {
        return false;
      }

      // Tag filter
      if (selectedTag !== 'TODOS' && (!item.tags || !item.tags.includes(selectedTag))) {
        return false;
      }

      // Advanced text search: name, description, category, tags
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesDesc = item.description.toLowerCase().includes(query);
        const matchesCat = item.category.toLowerCase().includes(query);
        const matchesTag = item.tags?.some((t) => t.toLowerCase().includes(query));
        if (!matchesName && !matchesDesc && !matchesCat && !matchesTag) {
          return false;
        }
      }

      return true;
    });

    return list.sort((a, b) => {
      if (sortBy === 'price_asc') return a.price - b.price;
      if (sortBy === 'price_desc') return b.price - a.price;
      // Default: featured first
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return 0;
    });
  }, [menuItems, dailyConfig, viewScope, selectedCategory, selectedTag, searchQuery, sortBy]);

  // Cart operations
  const handleAddToCart = (item: MenuItem) => {
    // Check if item has addons or options, or if user clicked to customize
    handleOpenItemModal(item);
  };

  const handleAddComboToCart = (combo: Combo) => {
    if (!combo.available) {
      alert('Este combo possui componentes temporariamente indisponíveis no estoque.');
      return;
    }

    const cartItem: OrderItem = {
      id: `cart-combo-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      menuItemId: combo.id,
      name: combo.name,
      quantity: 1,
      unitPrice: combo.comboPrice,
      subtotal: combo.comboPrice,
      isCombo: true,
      comboId: combo.id,
      comboComponents: combo.items,
    };

    setCart((prev) => {
      const existing = prev.find((i) => i.isCombo && i.comboId === combo.id);
      if (existing) {
        return prev.map((i) => 
          i.id === existing.id 
            ? { ...i, quantity: i.quantity + 1, subtotal: (i.quantity + 1) * i.unitPrice }
            : i
        );
      }
      return [...prev, cartItem];
    });

    setIsCartOpen(true);
  };

  const handleOpenItemModal = (item: MenuItem) => {
    setSelectedItemForModal(item);
    setModalQuantity(1);
    setModalSelectedAddons([]);
    setModalNotes('');
  };

  const handleConfirmModalAdd = () => {
    if (!selectedItemForModal) return;

    const addonsTotal = modalSelectedAddons.reduce((sum, a) => sum + a.price, 0);
    const unitPrice = selectedItemForModal.price + addonsTotal;
    const subtotal = unitPrice * modalQuantity;

    const orderItem: OrderItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      menuItemId: selectedItemForModal.id,
      name: selectedItemForModal.name,
      quantity: modalQuantity,
      unitPrice,
      addons: modalSelectedAddons.length > 0 ? modalSelectedAddons : undefined,
      notes: modalNotes.trim() ? modalNotes.trim() : undefined,
      subtotal,
    };

    setCart((prev) => [...prev, orderItem]);
    setSelectedItemForModal(null);
    setIsCartOpen(true);
  };

  const handleUpdateCartQuantity = (cartItemId: string, newQty: number) => {
    if (newQty <= 0) {
      setCart((prev) => prev.filter((i) => i.id !== cartItemId));
      return;
    }
    setCart((prev) =>
      prev.map((i) =>
        i.id === cartItemId
          ? { ...i, quantity: newQty, subtotal: i.unitPrice * newQty }
          : i
      )
    );
  };

  const handleRemoveFromCart = (cartItemId: string) => {
    setCart((prev) => prev.filter((i) => i.id !== cartItemId));
  };

  // Calculations
  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.subtotal, 0);
  }, [cart]);

  const deliveryFee = fulfillmentType === 'RETIRADA' ? 0 : config.deliveryFeeBase;
  const cartTotal = cartSubtotal + deliveryFee;

  // Handle Checkout / Create Order
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (cart.length === 0) {
      setFormError('Seu carrinho está vazio. Adicione pratos antes de finalizar.');
      return;
    }

    const isRetirada = fulfillmentType === 'RETIRADA';

    if (!isRetirada && !customerPhone.trim()) {
      setFormError('Por favor, informe seu WhatsApp para receber as atualizações do pedido.');
      return;
    }

    let formattedAddress = undefined;
    if (!isRetirada) {
      let condoTitle = condoType === 'Eco Way' ? 'Condomínio Eco Way' : condoType === 'Eco Fit' ? 'Condomínio Eco Fit' : (condoCustom.trim() || 'Residência');
      formattedAddress = {
        condominium: condoType && condoType !== 'Outros' ? `Condomínio ${condoType}` : (condoCustom.trim() || undefined),
        street: street.trim() || condoTitle,
        number: number.trim() || (apto.trim() || bloco.trim() ? undefined : 'S/N'),
        block: bloco.trim() || undefined,
        apartment: apto.trim() || undefined,
        neighborhood: condoType ? `Condomínio ${condoType}` : (neighborhood.trim() || 'Bairro'),
        complement: complement.trim() || undefined,
        city: config.city || 'Campina Grande',
        reference: reference.trim() || undefined,
      };
    }

    try {
      const syncRes = await store.createOrderAsync({
        estimatedDeliveryMinutes: isRetirada ? config.avgPrepTimeMinutes : config.avgPrepTimeMinutes + config.avgDeliveryTimeMinutes,
        fulfillmentType,
        customer: {
          name: customerName.trim() || (isRetirada ? 'Cliente Balcão' : 'Cliente Entrega'),
          phone: customerPhone.trim() || config.phone,
          address: formattedAddress,
          notes: orderNotes.trim() || undefined,
        },
        items: cart,
        subtotal: cartSubtotal,
        deliveryFee,
        discount: 0,
        totalAmount: cartTotal,
        paymentMethod,
        paymentChangeFor: paymentMethod === 'DINHEIRO' && paymentChangeFor ? parseFloat(paymentChangeFor) : undefined,
        paymentStatus: 'PENDENTE',
        status: 'NOVO',
      });
      const order = syncRes.order;

      // If order has PIX code, generate QR Code data URL
      if (order.paymentMethod === 'PIX' && order.pixCode) {
        try {
          const qrUrl = await generateQRCodeDataUrl(order.pixCode, { width: 360, margin: 1 });
          setPixQrDataUrl(qrUrl);
        } catch {}
      }

      const trackingUrl = getPublicAppUrl('rastreio', order.id, order.trackingCode);

      // Generate WhatsApp text
      const itemsList = order.items
        .map((i) => {
          let line = `• ${i.quantity}x ${i.name} - ${formatCurrency(i.subtotal)}`;
          if (i.isCombo && i.comboComponents) {
            line += '\n' + i.comboComponents.map((c) => `   ↳ ${c.quantity * i.quantity}x ${c.name}`).join('\n');
          }
          if (i.addons && i.addons.length > 0) {
            line += `\n   + Adicionais: ${i.addons.map((a) => a.name).join(', ')}`;
          }
          if (i.notes) {
            line += ` (Obs: ${i.notes})`;
          }
          return line;
        })
        .join('\n');

      const addressText = isRetirada 
        ? `Retirada no Balcão (${config.address})`
        : `${order.customer.address?.street}, ${order.customer.address?.number || 'S/N'}${order.customer.address?.block ? ` · Bloco ${order.customer.address.block}` : ''}${order.customer.address?.apartment ? ` · Ap ${order.customer.address.apartment}` : ''} - ${order.customer.address?.neighborhood || ''}`;

      const waText = generateWhatsAppOrderMessage({
        orderNumber: order.orderNumber,
        customerName: order.customer.name,
        itemsList,
        total: order.totalAmount,
        paymentMethod: paymentMethod === 'PIX' ? 'PIX' : paymentMethod === 'DINHEIRO' ? `Dinheiro (Troco para ${paymentChangeFor || 'Sem troco'})` : 'Cartão na Entrega / Balcão',
        address: addressText,
        trackingUrl,
      });

      const waUrl = `https://wa.me/${config.whatsapp}?text=${waText}`;

      setCreatedOrder(order);
      setCreatedOrderId(order.id);
      setCreatedOrderNumber(order.orderNumber);
      setWhatsappShareUrl(waUrl);
      setCart([]);
      setIsCartOpen(false);
    } catch (orderErr) {
      setFormError('Não foi possível registrar seu pedido. Por favor, tente novamente ou contate nosso WhatsApp.');
    }
  };

  const handleCopyPix = () => {
    if (!createdOrder?.pixCode) return;
    navigator.clipboard.writeText(createdOrder.pixCode);
    setCopiedPixCode(true);
    setTimeout(() => setCopiedPixCode(false), 3000);
  };

  return (
    <div className="min-h-screen w-full max-w-full bg-[#FAF7F2] text-[#2C1810] pb-28">
      {/* RESTAURANT TOP HEADER BANNER (ELEGANT WARM BISTRO IDENTITY) */}
      <header className="bg-gradient-to-r from-[#2C1810] via-[#3D2314] to-[#2C1810] text-white shadow-lg sticky top-0 z-30 border-b border-[#C86D3B]/30 w-full max-w-full">
        <div className="w-full max-w-4xl mx-auto px-3.5 sm:px-4 py-3 flex items-center justify-between gap-3 min-w-0">
          {/* Logo & Establishment Info */}
          <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
            <AmanditaLogo variant="icon" size="md" theme="dark" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-serif font-black text-sm sm:text-base tracking-tight text-[#FFFDF9] truncate">
                  {config.name || 'Amandita Sabores'}
                </h1>
                {config.isOpen ? (
                  <span className="px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                    ABERTO AGORA
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0">
                    FECHADO NO MOMENTO
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-[#D9C7B8] flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                <span className="truncate max-w-[170px] sm:max-w-none">{config.address}</span>
                <span className="hidden sm:inline">·</span>
                <span className="text-amber-300 shrink-0">Preparo ~{config.avgPrepTimeMinutes} min</span>
              </p>
            </div>
          </div>

          {/* Cart Floating / Action Button */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className="relative p-2 sm:px-3 sm:py-2 bg-gradient-to-r from-[#C86D3B] to-[#721C24] hover:opacity-95 text-white rounded-xl transition font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Abrir carrinho de compras"
            >
              <ShoppingBag className="w-4 h-4" />
              <span className="hidden sm:inline">Carrinho</span>
              {cart.length > 0 && (
                <span className="w-5 h-5 bg-[#FAF7F2] text-[#721C24] rounded-full text-[11px] font-black flex items-center justify-center shadow-xs">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="max-w-4xl mx-auto px-3.5 sm:px-4 pb-3">
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#8C5E47] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Busque por cuscuz, tapioca, café, combo, bolo..."
                className="w-full pl-10 pr-8 py-2 bg-[#1F100B] border border-[#4A2E1F] rounded-xl text-xs text-white placeholder:text-[#A89085] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`p-2 rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer ${
                showAdvancedFilters || selectedTag !== 'TODOS' || sortBy !== 'relevance'
                  ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white font-bold'
                  : 'bg-[#1F100B] text-[#D9C7B8] border border-[#4A2E1F]'
              }`}
              title="Filtros e ordenação"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">Filtros</span>
            </button>
          </div>

          {/* Advanced Filter Drawer */}
          {showAdvancedFilters && (
            <div className="mt-2.5 p-3 bg-[#1F100B] border border-[#4A2E1F] rounded-xl text-xs space-y-2 animate-in slide-in-from-top-2">
              <div>
                <span className="text-[11px] font-semibold text-[#D9C7B8] block mb-1">Tags & Destaques:</span>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setSelectedTag(tag)}
                      className={`px-2.5 py-1 rounded-lg text-xs transition cursor-pointer ${
                        selectedTag === tag
                          ? 'bg-[#C86D3B] text-white font-bold'
                          : 'bg-[#2C1810] text-[#D9C7B8] hover:text-white border border-[#4A2E1F]'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[#4A2E1F]">
                <span className="text-[11px] font-semibold text-[#D9C7B8]">Ordenar por:</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSortBy('relevance')}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                      sortBy === 'relevance' ? 'bg-[#C86D3B] text-white font-bold' : 'text-[#A89085]'
                    }`}
                  >
                    Destaques
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy('price_asc')}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                      sortBy === 'price_asc' ? 'bg-[#C86D3B] text-white font-bold' : 'text-[#A89085]'
                    }`}
                  >
                    Menor Preço
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortBy('price_desc')}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                      sortBy === 'price_desc' ? 'bg-[#C86D3B] text-white font-bold' : 'text-[#A89085]'
                    }`}
                  >
                    Maior Preço
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Category Filter Horizontal Slider */}
        <div className="bg-[#1A0E0A] border-t border-[#3D2314] w-full max-w-full overflow-hidden">
          <div className="w-full max-w-4xl mx-auto px-3.5 sm:px-4 py-2 overflow-x-auto flex items-center gap-1.5 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap px-3.5 py-1.5 rounded-xl text-xs font-bold shrink-0 transition cursor-pointer ${
                  selectedCategory === cat
                    ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                    : 'text-[#D9C7B8] hover:text-white hover:bg-white/10'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* DAILY MENU NOTICE / SCOPE SWITCHER (IF DAILY MENU IS ACTIVE) */}
      {dailyConfig.enabled && (
        <div className="w-full max-w-4xl mx-auto px-3.5 sm:px-4 pt-4">
          <div className="bg-gradient-to-r from-[#FFFDF9] to-[#FDF8F3] rounded-2xl p-3.5 sm:p-4 border border-[#E8DFD5] shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-[#721C24] text-white rounded-xl shadow-xs">
                <Sparkles className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-serif font-black text-xs sm:text-sm text-[#2C1810]">
                    Cardápio do Dia Selecionado
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    Especial de Hoje
                  </span>
                </div>
                <p className="text-[11px] text-[#8C5E47] mt-0.5">
                  Receitas frescas selecionadas com carinho pela chef para este dia.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 p-1 bg-white border border-[#E8DFD5] rounded-xl shrink-0 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setViewScope('daily')}
                className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                  viewScope === 'daily'
                    ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-2xs'
                    : 'text-[#8C5E47] hover:text-[#2C1810]'
                }`}
              >
                Cardápio do Dia
              </button>
              <button
                type="button"
                onClick={() => setViewScope('full')}
                className={`flex-1 sm:flex-none px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                  viewScope === 'full'
                    ? 'bg-[#2C1810] text-white shadow-2xs'
                    : 'text-[#8C5E47] hover:text-[#2C1810]'
                }`}
              >
                Ver Catálogo Completo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="w-full max-w-4xl mx-auto px-3.5 sm:px-4 pt-5 space-y-6">
        {/* SECTION 1: COMBOS & OFERTAS (FEATURED IF AVAILABLE) */}
        {filteredCombos.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#C86D3B]"></span>
                <h2 className="font-serif font-black text-sm sm:text-base text-[#2C1810] tracking-tight">
                  Combos & Ofertas Especiais
                </h2>
              </div>
              <span className="text-xs text-[#8C5E47] font-medium">
                {filteredCombos.length} {filteredCombos.length === 1 ? 'combo disponível' : 'combos disponíveis'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
              {filteredCombos.map((combo) => {
                const isOutOfStock = !combo.available;

                return (
                  <div
                    key={combo.id}
                    className={`bg-[#FFFDF9] rounded-3xl border transition-all p-3.5 sm:p-4 flex flex-col justify-between shadow-xs ${
                      isOutOfStock
                        ? 'border-slate-200 opacity-60'
                        : 'border-[#E8DFD5] hover:border-[#C86D3B]/50 hover:shadow-md'
                    }`}
                  >
                    <div>
                      {/* Combo Header: Image + Tag */}
                      <div className="relative h-44 rounded-2xl overflow-hidden bg-slate-100 mb-3">
                        {combo.imageUrl ? (
                          <img
                            src={combo.imageUrl}
                            alt={combo.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-[#FAF7F2] text-[#8C5E47]">
                            <Layers className="w-10 h-10 opacity-30" />
                          </div>
                        )}

                        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-[#2C1810]/95 text-white shadow-xs backdrop-blur-xs">
                            COMBO
                          </span>
                          {combo.originalPrice > combo.comboPrice && (
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-[#721C24] text-white shadow-xs flex items-center gap-1">
                              <TrendingDown className="w-3 h-3" />
                              <span>Economize {formatCurrency(combo.originalPrice - combo.comboPrice)}</span>
                            </span>
                          )}
                        </div>

                        {isOutOfStock && (
                          <div className="absolute inset-0 bg-black/40 backdrop-blur-2xs flex items-center justify-center">
                            <span className="px-3 py-1 bg-rose-600 text-white font-bold rounded-xl text-xs shadow-md">
                              Componente Esgotado
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Combo Title & Description */}
                      <h3 className="font-serif font-black text-base text-[#2C1810] leading-snug">
                        {combo.name}
                      </h3>
                      {combo.description && (
                        <p className="text-xs text-[#8C5E47] mt-1 line-clamp-2 leading-relaxed">
                          {combo.description}
                        </p>
                      )}

                      {/* Included Components Breakdown */}
                      <div className="mt-3 p-2.5 bg-[#FAF7F2] rounded-xl border border-[#E8DFD5] text-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#8C5E47] block mb-1">
                          Este combo inclui:
                        </span>
                        <div className="space-y-0.5">
                          {combo.items.map((comp, idx) => (
                            <div key={idx} className="flex items-center text-[#2C1810] text-[11px] sm:text-xs">
                              <span className="font-bold text-[#C86D3B] mr-1.5">{comp.quantity}x</span>
                              <span className="truncate">{comp.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Price & Add to Cart */}
                    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[#E8DFD5]">
                      <div>
                        {combo.originalPrice > combo.comboPrice && (
                          <span className="text-[11px] text-slate-400 line-through font-mono block">
                            De {formatCurrency(combo.originalPrice)}
                          </span>
                        )}
                        <span className="text-base sm:text-lg font-black text-[#721C24] font-mono">
                          {formatCurrency(combo.comboPrice)}
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={isOutOfStock}
                        onClick={() => handleAddComboToCart(combo)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer ${
                          isOutOfStock
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            : 'bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white hover:opacity-95'
                        }`}
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[3]" />
                        <span>Adicionar Combo</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION 2: REGULAR PRODUCTS */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#C86D3B]"></span>
              <h2 className="font-serif font-black text-sm sm:text-base text-[#2C1810] tracking-tight">
                {selectedCategory === 'TODAS'
                  ? viewScope === 'daily'
                    ? 'Pratos Selecionados para Hoje'
                    : 'Cardápio Completo'
                  : selectedCategory}
              </h2>
            </div>
            <span className="text-xs text-[#8C5E47] font-medium">
              {filteredItems.length} {filteredItems.length === 1 ? 'prato' : 'pratos'}
            </span>
          </div>

          {filteredItems.length === 0 && filteredCombos.length === 0 ? (
            <div className="bg-[#FFFDF9] rounded-3xl p-8 sm:p-12 text-center border border-dashed border-[#E8DFD5]">
              <Search className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h3 className="font-bold text-[#2C1810] text-base">Nenhum item encontrado</h3>
              <p className="text-xs text-[#8C5E47] mt-1 mb-4">
                {searchQuery
                  ? `Nenhum resultado para "${searchQuery}".`
                  : 'Tente alternar para o catálogo completo ou selecione outra categoria.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('TODAS');
                  setSelectedTag('TODOS');
                  setViewScope('full');
                }}
                className="px-4 py-2 bg-[#2C1810] text-white rounded-xl text-xs font-bold transition hover:bg-[#3D2314] cursor-pointer"
              >
                Limpar Filtros & Ver Todos
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleOpenItemModal(item)}
                  className="bg-[#FFFDF9] rounded-3xl border border-[#E8DFD5] hover:border-[#C86D3B]/60 shadow-xs hover:shadow-md transition-all p-3.5 sm:p-4 flex flex-col justify-between cursor-pointer group min-w-0"
                >
                  <div className="flex gap-3 sm:gap-4 min-w-0">
                    <div className="flex-1 min-w-0">
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[10px] text-[#C86D3B] font-bold mb-1 truncate">
                          {item.featured && <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />}
                          <span className="truncate">{item.tags.join(' · ')}</span>
                        </div>
                      )}

                      <h3 className="font-serif font-black text-sm sm:text-base text-[#2C1810] group-hover:text-[#721C24] transition-colors truncate">
                        {item.name}
                      </h3>
                      <p className="text-xs text-[#8C5E47] line-clamp-2 mt-1 leading-relaxed">
                        {item.description}
                      </p>
                    </div>

                    {item.imageUrl && (
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden shrink-0 bg-slate-100 relative shadow-2xs">
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-3.5 sm:mt-4 pt-2.5 sm:pt-3 border-t border-[#E8DFD5] min-w-0">
                    <div className="flex items-baseline gap-2 shrink-0">
                      <span className="text-base sm:text-lg font-black text-[#721C24] font-mono">
                        {formatCurrency(item.price)}
                      </span>
                      <span className="text-[10px] sm:text-[11px] text-[#8C5E47] flex items-center gap-1 font-medium">
                        <Clock className="w-3 h-3" />
                        ~{item.prepTimeMinutes}m
                      </span>
                    </div>

                    <button
                      type="button"
                      className="px-3.5 py-1.5 bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white font-bold rounded-xl text-xs flex items-center gap-1 shadow-xs hover:opacity-95 transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[3]" />
                      <span>Adicionar</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* FOOTER (CLEAN BRANDING EXCLUSIVELY FOR CUSTOMERS) */}
      <footer className="mt-16 py-8 border-t border-[#E8DFD5] text-center text-xs text-[#8C5E47] space-y-1.5 px-4">
        <p className="font-serif font-black text-sm text-[#2C1810]">Amandita Sabores</p>
        <p className="italic text-[11px]">Feito com amor, servido com sabor.</p>
        <p className="text-[11px] text-[#A6806C] pt-1">{config.address} · {config.phone}</p>
      </footer>

      {/* FLOATING BOTTOM CART BAR (IF ITEMS IN CART) */}
      {cart.length > 0 && !isCartOpen && (
        <div className="fixed bottom-4 inset-x-0 z-40 max-w-lg mx-auto px-4">
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="w-full py-3.5 px-5 bg-[#2C1810] hover:bg-[#3D2314] text-white rounded-2xl shadow-xl flex items-center justify-between border border-[#4A2E1F] cursor-pointer transition hover:scale-[1.01]"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#C86D3B] to-[#721C24] text-white flex items-center justify-center font-black text-xs shadow-xs">
                {cart.length}
              </div>
              <div className="text-left leading-tight">
                <span className="text-xs font-bold block text-white">Ver Meu Pedido</span>
                <span className="text-[11px] text-[#D9C7B8]">
                  {cart.length} {cart.length === 1 ? 'item selecionado' : 'itens selecionados'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-sm text-amber-300">
                {formatCurrency(cartTotal)}
              </span>
              <span className="text-xs font-bold bg-[#C86D3B] text-white px-2 py-1 rounded-lg">
                Finalizar →
              </span>
            </div>
          </button>
        </div>
      )}

      {/* MODAL: CUSTOMIZE INDIVIDUAL ITEM & ADDONS */}
      {selectedItemForModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-[#E8DFD5] overflow-hidden animate-in zoom-in-95">
            {/* Header Image */}
            <div className="relative h-44 bg-slate-100">
              <img
                src={selectedItemForModal.imageUrl}
                alt={selectedItemForModal.name}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => setSelectedItemForModal(null)}
                className="absolute top-3 right-3 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded-full transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <h3 className="font-serif font-black text-base sm:text-lg text-[#2C1810]">
                  {selectedItemForModal.name}
                </h3>
                <p className="text-xs text-[#8C5E47] mt-1 leading-relaxed">
                  {selectedItemForModal.description}
                </p>
                <div className="mt-2 text-base font-black text-[#721C24] font-mono">
                  {formatCurrency(selectedItemForModal.price)}
                </div>
              </div>

              {/* Addons List */}
              {selectedItemForModal.addons && selectedItemForModal.addons.length > 0 && (
                <div className="pt-3 border-t border-[#E8DFD5]">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#3D2314] block mb-2">
                    Adicionais Opcionais (+ R$ 3,00)
                  </label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedItemForModal.addons.map((ad) => {
                      const isSelected = modalSelectedAddons.some((a) => a.id === ad.id);
                      return (
                        <div
                          key={ad.id}
                          onClick={() => {
                            if (isSelected) {
                              setModalSelectedAddons(modalSelectedAddons.filter((a) => a.id !== ad.id));
                            } else {
                              setModalSelectedAddons([...modalSelectedAddons, ad]);
                            }
                          }}
                          className={`p-2 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition ${
                            isSelected
                              ? 'bg-[#FFF9F5] border-[#C86D3B] text-[#721C24] font-bold'
                              : 'bg-white border-[#E8DFD5] text-[#3D2314] hover:bg-slate-50'
                          }`}
                        >
                          <span>{ad.name}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-[#8C5E47]">+{formatCurrency(ad.price)}</span>
                            <div className={`w-4 h-4 rounded-md flex items-center justify-center ${isSelected ? 'bg-[#C86D3B] text-white' : 'border border-slate-300'}`}>
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-[#3D2314] block mb-1">
                  Observações para a Cozinha
                </label>
                <input
                  type="text"
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  placeholder="Ex: sem cebola, ovo bem passado, manteiga à parte..."
                  className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                />
              </div>

              {/* Quantity Stepper & Add Button */}
              <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#E8DFD5]">
                <div className="flex items-center border border-[#E8DFD5] rounded-xl bg-[#FAF7F2] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setModalQuantity(Math.max(1, modalQuantity - 1))}
                    className="px-3 py-2 text-xs font-bold text-[#8C5E47] hover:bg-slate-100 cursor-pointer"
                  >
                    -
                  </button>
                  <span className="px-3 text-xs font-black text-[#2C1810]">{modalQuantity}</span>
                  <button
                    type="button"
                    onClick={() => setModalQuantity(modalQuantity + 1)}
                    className="px-3 py-2 text-xs font-bold text-[#8C5E47] hover:bg-slate-100 cursor-pointer"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleConfirmModalAdd}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs hover:opacity-95 cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>
                    Adicionar ({formatCurrency((selectedItemForModal.price + modalSelectedAddons.reduce((s, a) => s + a.price, 0)) * modalQuantity)})
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CART & CHECKOUT SLIDE-OVER DRAWER */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
          <div className="bg-white w-full max-w-md h-full flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Cart Top Bar */}
            <div className="p-4 bg-[#2C1810] text-white flex items-center justify-between border-b border-[#4A2E1F]">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#C86D3B]" />
                <h3 className="font-serif font-black text-sm sm:text-base">Seu Pedido</h3>
                <span className="text-xs text-[#D9C7B8]">({cart.length} itens)</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCartOpen(false)}
                className="p-1.5 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cart Items List & Form */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {cart.length === 0 ? (
                <div className="text-center py-12 text-[#8C5E47]">
                  <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <p className="font-bold text-sm text-[#2C1810]">Seu carrinho está vazio</p>
                  <p className="text-xs mt-1">Selecione delícias do cardápio para começar.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {cart.map((cartItem) => (
                      <div
                        key={cartItem.id}
                        className="p-3 bg-[#FAF7F2] rounded-2xl border border-[#E8DFD5] space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {cartItem.isCombo && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-[#2C1810] text-white">
                                  COMBO
                                </span>
                              )}
                              <h4 className="font-bold text-xs sm:text-sm text-[#2C1810] truncate">
                                {cartItem.name}
                              </h4>
                            </div>

                            {/* Combo components list in cart */}
                            {cartItem.isCombo && cartItem.comboComponents && (
                              <div className="mt-1 pl-2 border-l-2 border-[#C86D3B] text-[11px] text-[#8C5E47] space-y-0.5">
                                {cartItem.comboComponents.map((comp, cIdx) => (
                                  <p key={cIdx}>
                                    ↳ {comp.quantity * cartItem.quantity}x {comp.name}
                                  </p>
                                ))}
                              </div>
                            )}

                            {/* Addons list */}
                            {cartItem.addons && cartItem.addons.length > 0 && (
                              <p className="text-[11px] text-[#8C5E47] mt-0.5">
                                + {cartItem.addons.map((a) => a.name).join(', ')}
                              </p>
                            )}

                            {cartItem.notes && (
                              <p className="text-[10px] text-amber-800 italic mt-0.5">
                                Obs: {cartItem.notes}
                              </p>
                            )}
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-mono font-black text-xs sm:text-sm text-[#721C24] block">
                              {formatCurrency(cartItem.subtotal)}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              ({formatCurrency(cartItem.unitPrice)} un.)
                            </span>
                          </div>
                        </div>

                        {/* Quantity Stepper & Remove */}
                        <div className="flex items-center justify-between pt-2 border-t border-[#E8DFD5]/70">
                          <div className="flex items-center border border-[#E8DFD5] rounded-lg bg-white overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQuantity(cartItem.id, cartItem.quantity - 1)}
                              className="px-2 py-0.5 text-xs text-[#8C5E47] hover:bg-slate-50 cursor-pointer"
                            >
                              -
                            </button>
                            <span className="px-2 text-xs font-bold text-[#2C1810]">{cartItem.quantity}</span>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartQuantity(cartItem.id, cartItem.quantity + 1)}
                              className="px-2 py-0.5 text-xs text-[#8C5E47] hover:bg-slate-50 cursor-pointer"
                            >
                              +
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(cartItem.id)}
                            className="text-xs text-rose-600 hover:text-rose-800 p-1 cursor-pointer flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remover</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* CHECKOUT FORM */}
                  <form onSubmit={handlePlaceOrder} className="pt-3 border-t border-[#E8DFD5] space-y-3.5">
                    {/* Modalidade: Entrega vs Retirada */}
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-[#3D2314] block mb-1.5">
                        Modalidade do Pedido
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFulfillmentType('DELIVERY')}
                          className={`p-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                            fulfillmentType === 'DELIVERY'
                              ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white shadow-xs'
                              : 'bg-[#FAF7F2] text-[#8C5E47] border border-[#E8DFD5]'
                          }`}
                        >
                          <Bike className="w-4 h-4" />
                          <span>Entrega ({formatCurrency(config.deliveryFeeBase)})</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setFulfillmentType('RETIRADA')}
                          className={`p-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                            fulfillmentType === 'RETIRADA'
                              ? 'bg-emerald-700 text-white shadow-xs'
                              : 'bg-[#FAF7F2] text-[#8C5E47] border border-[#E8DFD5]'
                          }`}
                        >
                          <StoreIcon className="w-4 h-4" />
                          <span>Retirada Balcão (Grátis)</span>
                        </button>
                      </div>
                    </div>

                    {/* Dados do Cliente */}
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-[#3D2314] block mb-1">
                        Seu Nome
                      </label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Ex: Maria Clara"
                        className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-[#3D2314] block mb-1">
                        Seu WhatsApp {fulfillmentType === 'DELIVERY' && '*'}
                      </label>
                      <input
                        type="tel"
                        required={fulfillmentType === 'DELIVERY'}
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="Ex: (83) 98888-7777"
                        className="w-full px-3 py-2 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs text-[#2C1810] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
                      />
                    </div>

                    {/* Endereço de Entrega */}
                    {fulfillmentType === 'DELIVERY' && (
                      <div className="p-3 bg-[#FAF7F2] rounded-2xl border border-[#E8DFD5] space-y-2.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-[#721C24] block">
                          Endereço para Entrega
                        </label>

                        {/* Atalhos para Condomínios Frequentes */}
                        <div>
                          <span className="text-[10px] text-[#8C5E47] block mb-1">Condomínio (Atalho Rápido):</span>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(['Eco Way', 'Eco Fit', 'Outros'] as const).map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setCondoType(c)}
                                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition cursor-pointer text-center ${
                                  condoType === c
                                    ? 'bg-[#2C1810] text-white shadow-2xs'
                                    : 'bg-white border border-[#E8DFD5] text-[#8C5E47]'
                                }`}
                              >
                                {c}
                              </button>
                            ))}
                          </div>
                        </div>

                        {condoType && condoType !== 'Outros' ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] font-bold text-[#8C5E47] block mb-0.5">Bloco</label>
                              <input
                                type="text"
                                value={bloco}
                                onChange={(e) => setBloco(e.target.value)}
                                placeholder="Ex: 03"
                                className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-lg text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-[#8C5E47] block mb-0.5">Apartamento</label>
                              <input
                                type="text"
                                value={apto}
                                onChange={(e) => setApto(e.target.value)}
                                placeholder="Ex: 204"
                                className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-lg text-xs"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={street}
                              onChange={(e) => setStreet(e.target.value)}
                              placeholder="Rua / Avenida"
                              className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-lg text-xs"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                value={number}
                                onChange={(e) => setNumber(e.target.value)}
                                placeholder="Número"
                                className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-lg text-xs"
                              />
                              <input
                                type="text"
                                value={neighborhood}
                                onChange={(e) => setNeighborhood(e.target.value)}
                                placeholder="Bairro"
                                className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-lg text-xs"
                              />
                            </div>
                          </div>
                        )}

                        <input
                          type="text"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="Ponto de referência (opcional)"
                          className="w-full px-2.5 py-1.5 bg-white border border-[#E8DFD5] rounded-lg text-xs"
                        />
                      </div>
                    )}

                    {/* Forma de Pagamento */}
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-[#3D2314] block mb-1.5">
                        Forma de Pagamento
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPaymentMethod('PIX')}
                          className={`p-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                            paymentMethod === 'PIX'
                              ? 'bg-[#2C1810] text-white shadow-2xs'
                              : 'bg-[#FAF7F2] text-[#8C5E47] border border-[#E8DFD5]'
                          }`}
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>PIX (Instantâneo)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPaymentMethod('CARTAO_CREDITO')}
                          className={`p-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                            paymentMethod === 'CARTAO_CREDITO' || paymentMethod === 'CARTAO_DEBITO'
                              ? 'bg-[#2C1810] text-white shadow-2xs'
                              : 'bg-[#FAF7F2] text-[#8C5E47] border border-[#E8DFD5]'
                          }`}
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>Cartão</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPaymentMethod('DINHEIRO')}
                          className={`p-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer col-span-2 ${
                            paymentMethod === 'DINHEIRO'
                              ? 'bg-[#2C1810] text-white shadow-2xs'
                              : 'bg-[#FAF7F2] text-[#8C5E47] border border-[#E8DFD5]'
                          }`}
                        >
                          <span>Dinheiro</span>
                        </button>
                      </div>

                      {paymentMethod === 'DINHEIRO' && (
                        <div className="mt-2">
                          <input
                            type="text"
                            value={paymentChangeFor}
                            onChange={(e) => setPaymentChangeFor(e.target.value)}
                            placeholder="Troco para quanto? (Ex: 50,00)"
                            className="w-full px-3 py-1.5 bg-[#FAF7F2] border border-[#E8DFD5] rounded-xl text-xs"
                          />
                        </div>
                      )}
                    </div>

                    {formError && (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{formError}</span>
                      </div>
                    )}

                    {/* Summary Totals */}
                    <div className="pt-3 border-t border-[#E8DFD5] space-y-1 text-xs">
                      <div className="flex justify-between text-[#8C5E47]">
                        <span>Subtotal</span>
                        <span className="font-mono">{formatCurrency(cartSubtotal)}</span>
                      </div>
                      <div className="flex justify-between text-[#8C5E47]">
                        <span>Taxa de Entrega</span>
                        <span className="font-mono">
                          {deliveryFee === 0 ? 'Grátis' : formatCurrency(deliveryFee)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm sm:text-base font-black text-[#721C24] pt-1 border-t border-[#E8DFD5]">
                        <span>Total</span>
                        <span className="font-mono">{formatCurrency(cartTotal)}</span>
                      </div>
                    </div>

                    {/* Submit Button */}
                    <button
                      type="submit"
                      className="w-full py-3.5 bg-gradient-to-r from-[#C86D3B] via-[#B85D2A] to-[#721C24] text-white font-bold rounded-2xl text-xs sm:text-sm hover:opacity-95 transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>Confirmar & Enviar Pedido ({formatCurrency(cartTotal)})</span>
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PLACED ORDER SUCCESS MODAL */}
      {createdOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl border border-[#E8DFD5] animate-in zoom-in-95">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div>
              <h3 className="font-serif font-black text-xl text-[#2C1810]">
                Pedido Recebido!
              </h3>
              <p className="font-mono font-bold text-sm text-[#721C24] mt-0.5">
                {createdOrder.orderNumber}
              </p>
              <p className="text-xs text-[#8C5E47] mt-1 leading-relaxed">
                Já estamos com seu pedido pronto para entrar em preparo na cozinha.
              </p>
            </div>

            {/* PIX QR CODE & CODE IF SELECTED */}
            {createdOrder.paymentMethod === 'PIX' && (
              <div className="p-4 bg-[#FAF7F2] rounded-2xl border border-[#E8DFD5] space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#721C24] block">
                  Pague com PIX para Agilizar:
                </span>

                {pixQrDataUrl && (
                  <div className="p-2 bg-white rounded-xl shadow-xs inline-block mx-auto border border-[#E8DFD5]">
                    <img
                      src={pixQrDataUrl}
                      alt="QR Code PIX"
                      className="w-44 h-44 object-contain mx-auto"
                    />
                  </div>
                )}

                {createdOrder.pixCode && (
                  <button
                    type="button"
                    onClick={handleCopyPix}
                    className="w-full py-2 bg-white border border-[#E8DFD5] text-[#2C1810] rounded-xl text-xs font-bold hover:bg-slate-50 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedPixCode ? 'Código PIX Copiado!' : 'Copiar Chave PIX Copia e Cola'}</span>
                  </button>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              {whatsappShareUrl && (
                <a
                  href={whatsappShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 bg-[#25D366] hover:bg-[#20BD5A] text-white font-bold rounded-xl text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-xs"
                >
                  <Send className="w-4 h-4" />
                  <span>Enviar Comprovante no WhatsApp</span>
                </a>
              )}

              {onNavigateToTracking && (
                <button
                  type="button"
                  onClick={() => {
                    const id = createdOrder.id;
                    const tk = createdOrder.trackingCode;
                    setCreatedOrder(null);
                    onNavigateToTracking(id, tk);
                  }}
                  className="w-full py-2.5 bg-[#2C1810] text-white font-bold rounded-xl text-xs transition hover:bg-[#3D2314] cursor-pointer"
                >
                  Acompanhar Status do Pedido em Tempo Real →
                </button>
              )}

              <button
                type="button"
                onClick={() => setCreatedOrder(null)}
                className="text-xs text-[#8C5E47] hover:text-[#2C1810] font-semibold pt-1 cursor-pointer"
              >
                Voltar ao Cardápio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
