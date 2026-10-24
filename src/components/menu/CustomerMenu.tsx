import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../../services/store';
import { MenuItem, MenuItemAddon, OrderItem, PaymentMethod, FulfillmentType, Order } from '../../types';
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
  UploadCloud,
  Wifi
} from 'lucide-react';
import { AmanditaLogo } from '../common/AmanditaLogo';

interface CustomerMenuProps {
  onNavigateToTracking?: (orderId: string, trackingCode?: string) => void;
  onNavigateToAdmin?: () => void;
  onOpenStaffLogin?: () => void;
}

export const CustomerMenu: React.FC<CustomerMenuProps> = ({ 
  onNavigateToTracking, 
  onNavigateToAdmin,
  onOpenStaffLogin 
}) => {
  const [config, setConfig] = useState(() => store.getRestaurantConfig());
  const [menuItems, setMenuItems] = useState<MenuItem[]>(() => store.getMenuItems());

  // Placed order success state
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [createdOrderNumber, setCreatedOrderNumber] = useState<string>('');
  const [whatsappShareUrl, setWhatsappShareUrl] = useState<string>('');
  const [pixQrDataUrl, setPixQrDataUrl] = useState<string>('');
  const [copiedPixCode, setCopiedPixCode] = useState(false);

  useEffect(() => {
    const handleUpdate = () => {
      setMenuItems(store.getMenuItems());
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

  // Cart state
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Customization Modal
  const [selectedItemForModal, setSelectedItemForModal] = useState<MenuItem | null>(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [modalSelectedAddons, setModalSelectedAddons] = useState<MenuItemAddon[]>([]);
  const [modalNotes, setModalNotes] = useState('');

  // Fulfillment Type: Entrega vs Retirada no Balcão
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('DELIVERY');
  const [formError, setFormError] = useState<string | null>(null);

  // Checkout Form State (Tudo Opcional)
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

  // Categories list
  const categories = useMemo(() => {
    const set = new Set(menuItems.map((item) => item.category));
    return ['TODAS', ...Array.from(set)];
  }, [menuItems]);

  // Tags list
  const allTags = useMemo(() => {
    const set = new Set<string>();
    menuItems.forEach((i) => i.tags?.forEach((t) => set.add(t)));
    return ['TODOS', ...Array.from(set)];
  }, [menuItems]);

  // Filtered Items (Advanced Search)
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      // Only available items
      if (!item.available) return false;

      // Category filter
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
    }).sort((a, b) => {
      if (sortBy === 'price_asc') return a.price - b.price;
      if (sortBy === 'price_desc') return b.price - a.price;
      // Default: featured first
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return 0;
    });
  }, [menuItems, selectedCategory, selectedTag, searchQuery, sortBy]);

  // Open item modal for customization
  const handleOpenItemModal = (item: MenuItem) => {
    setSelectedItemForModal(item);
    setModalQuantity(1);
    setModalSelectedAddons([]);
    setModalNotes('');
  };

  const handleToggleAddon = (addon: MenuItemAddon) => {
    if (modalSelectedAddons.some((a) => a.id === addon.id)) {
      setModalSelectedAddons(modalSelectedAddons.filter((a) => a.id !== addon.id));
    } else {
      setModalSelectedAddons([...modalSelectedAddons, addon]);
    }
  };

  const handleAddToCart = () => {
    if (!selectedItemForModal) return;

    const addonsCost = modalSelectedAddons.reduce((sum, a) => sum + a.price, 0);
    const unitPrice = selectedItemForModal.price;
    const subtotal = (unitPrice + addonsCost) * modalQuantity;

    const newOrderItem: OrderItem = {
      id: `cart-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      menuItemId: selectedItemForModal.id,
      name: selectedItemForModal.name,
      quantity: modalQuantity,
      unitPrice,
      addons: modalSelectedAddons,
      notes: modalNotes.trim() || undefined,
      subtotal,
    };

    setCart([...cart, newOrderItem]);
    setSelectedItemForModal(null);
  };

  const handleRemoveFromCart = (cartItemId: string) => {
    setCart(cart.filter((item) => item.id !== cartItemId));
  };

  const cartSubtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const isRetirada = fulfillmentType === 'RETIRADA';
  const deliveryFee = isRetirada ? 0 : config.deliveryFeeBase;
  const cartTotal = cartSubtotal + deliveryFee;

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (cart.length === 0) return;

    // Delivery address formatted from Condomínio, Bloco, Ap, etc. (Tudo opcional)
    let formattedAddress = undefined;
    if (!isRetirada) {
      const condoTitle = condoType === 'Outros'
        ? (condoCustom.trim() || street.trim() || 'Outro Condomínio / Endereço')
        : (condoType ? `Condomínio ${condoType}` : (condoCustom.trim() || street.trim() || 'Entrega'));

      const numStr = apto.trim()
        ? `Ap ${apto.trim()}`
        : (bloco.trim() ? `Bloco ${bloco.trim()}` : (number.trim() || 'S/N'));

      const complementParts: string[] = [];
      if (bloco.trim()) complementParts.push(`Bloco: ${bloco.trim()}`);
      if (apto.trim()) complementParts.push(`Ap: ${apto.trim()}`);
      if (complement.trim()) complementParts.push(complement.trim());

      formattedAddress = {
        street: condoTitle,
        number: numStr,
        neighborhood: condoType ? `Condomínio ${condoType}` : (neighborhood.trim() || 'Bairro'),
        complement: complementParts.join(' - ') || undefined,
        city: config.city || 'João Pessoa',
        reference: reference.trim() || undefined,
      };
    }

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
      } catch {
        // fallback
      }
    }

    const trackingUrl = getPublicAppUrl('rastreio', order.id, order.trackingCode);

    // Generate WhatsApp text
    const itemsList = order.items
      .map((i) => `• ${i.quantity}x ${i.name} - ${formatCurrency(i.subtotal)}${i.notes ? ` (Obs: ${i.notes})` : ''}`)
      .join('\n');

    const addressText = isRetirada 
      ? `Retirada no Balcão (${config.address})`
      : `${order.customer.address?.street}, ${order.customer.address?.number} - ${order.customer.address?.neighborhood}${order.customer.address?.complement ? ` (${order.customer.address?.complement})` : ''}`;

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
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#2C1810] pb-28">
      {/* Restaurant Header Banner */}
      <header className="bg-gradient-to-r from-[#2C1810] via-[#3D2314] to-[#2C1810] text-white shadow-lg sticky top-0 z-30 border-b border-[#C86D3B]/20">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AmanditaLogo variant="icon" size="md" theme="dark" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-black text-base tracking-tight text-white">{config.name}</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  ABERTO
                </span>
              </div>
              <p className="text-xs text-[#D9C7B8] flex items-center gap-2">
                <span>{config.address}</span>
                <span>·</span>
                <span className="text-amber-300">Preparo ~{config.avgPrepTimeMinutes} min</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onNavigateToAdmin && (store.getCurrentUser()?.role === 'ADMINISTRADOR' || store.getCurrentUser()?.role === 'GERENTE') && (
              <button
                onClick={onNavigateToAdmin}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-[#D9C7B8] hover:text-white rounded-xl transition text-xs font-semibold flex items-center gap-1.5 border border-white/10 cursor-pointer"
                title="Voltar ao Painel Administrativo"
              >
                <span>Painel ADM</span>
              </button>
            )}

            <button
              onClick={() => setIsCartOpen(true)}
              className="relative p-2.5 bg-gradient-to-r from-[#C86D3B] to-[#721C24] hover:opacity-95 text-white rounded-xl transition font-bold text-xs flex items-center gap-2 shadow-sm cursor-pointer"
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

        {/* Search bar inside header */}
        <div className="max-w-4xl mx-auto px-4 pb-3">
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#8C5E47] absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Busque por cuscuz, tapioca, café, pão, bolo..."
                className="w-full pl-9 pr-8 py-2 bg-[#1F100B] border border-[#4A2E1F] rounded-xl text-xs text-white placeholder:text-[#A89085] focus:outline-none focus:ring-2 focus:ring-[#C86D3B]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`p-2 rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer ${
                showAdvancedFilters || selectedTag !== 'TODOS' || sortBy !== 'relevance'
                  ? 'bg-gradient-to-r from-[#C86D3B] to-[#721C24] text-white font-bold'
                  : 'bg-[#1F100B] text-[#D9C7B8] border border-[#4A2E1F]'
              }`}
              title="Filtros avançados"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">Filtros</span>
            </button>
          </div>

          {/* Advanced Filter Drawer */}
          {showAdvancedFilters && (
            <div className="mt-3 p-3 bg-slate-900/95 border border-slate-800 rounded-xl text-xs space-y-2.5 animate-in slide-in-from-top-2">
              <div>
                <span className="text-[11px] font-semibold text-slate-400 block mb-1">Tags & Preferências:</span>
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setSelectedTag(tag)}
                      className={`px-2.5 py-1 rounded-lg text-xs transition ${
                        selectedTag === tag
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                <span className="text-[11px] font-semibold text-slate-400">Ordenar por:</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setSortBy('relevance')}
                    className={`px-2 py-0.5 rounded text-[11px] ${
                      sortBy === 'relevance' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400'
                    }`}
                  >
                    Mais Pedidos
                  </button>
                  <button
                    onClick={() => setSortBy('price_asc')}
                    className={`px-2 py-0.5 rounded text-[11px] ${
                      sortBy === 'price_asc' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400'
                    }`}
                  >
                    Menor Preço
                  </button>
                  <button
                    onClick={() => setSortBy('price_desc')}
                    className={`px-2 py-0.5 rounded text-[11px] ${
                      sortBy === 'price_desc' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400'
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
        <div className="bg-slate-900 border-t border-slate-800/80">
          <div className="max-w-4xl mx-auto px-4 py-2 overflow-x-auto flex items-center gap-2 scrollbar-none">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  selectedCategory === cat
                    ? 'bg-white text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Menu Grid */}
      <main className="max-w-4xl mx-auto px-4 pt-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-600 uppercase tracking-wider">
            {selectedCategory === 'TODAS' ? 'Cardápio Completo' : selectedCategory} ({filteredItems.length})
          </h2>
          {searchQuery && (
            <span className="text-xs text-slate-500">
              Resultados para: <strong className="text-slate-800">"{searchQuery}"</strong>
            </span>
          )}
        </div>

        {filteredItems.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
            <Search className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="font-bold text-slate-800 text-base">Nenhum item encontrado</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Tente buscar por outro termo ou limpe os filtros aplicados.
            </p>
            <button
              onClick={() => { setSearchQuery(''); setSelectedCategory('TODAS'); setSelectedTag('TODOS'); }}
              className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold"
            >
              Limpar Filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => handleOpenItemModal(item)}
                className="bg-white rounded-2xl border border-slate-200 hover:border-amber-400/80 shadow-xs hover:shadow-md transition-all p-4 flex flex-col justify-between cursor-pointer group"
              >
                <div className="flex gap-4">
                  <div className="flex-1">
                    {/* Tags */}
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-700 font-semibold mb-1">
                        {item.featured && <Sparkles className="w-3 h-3 text-amber-500" />}
                        <span>{item.tags.join(' · ')}</span>
                      </div>
                    )}

                    <h3 className="text-base font-bold text-slate-900 group-hover:text-amber-800 transition-colors">
                      {item.name}
                    </h3>
                    <p className="text-xs text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  {item.imageUrl && (
                    <div className="w-24 h-24 rounded-xl overflow-hidden shrink-0 bg-slate-100 relative">
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-extrabold text-slate-900">
                      {formatCurrency(item.price)}
                    </span>
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      ~{item.prepTimeMinutes}m
                    </span>
                  </div>

                  <button
                    type="button"
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1 shadow-xs transition"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[3]" />
                    <span>Adicionar</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Customer Footer with Subtle Staff Access */}
      <footer className="mt-16 py-8 border-t border-[#E8DFD5] text-center text-xs text-[#8C5E47] space-y-2">
        <p className="font-bold text-[#2C1810]">Amandita Sabores — Cuscuz Gourmet, Tapiocas & Café Especial</p>
        <p>{config.address} · {config.phone}</p>
        <div className="pt-2">
          {onOpenStaffLogin && (
            <button
              onClick={onOpenStaffLogin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-[#8C5E47] hover:text-[#C86D3B] hover:bg-[#F2EAE0] transition cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Acesso de Colaboradores</span>
            </button>
          )}
        </div>
      </footer>

      {/* Floating Bottom Cart Bar */}
      {cart.length > 0 && !isCartOpen && (
        <div className="fixed bottom-4 inset-x-0 z-40 max-w-lg mx-auto px-4">
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full py-3.5 px-5 bg-slate-950 hover:bg-slate-900 text-white rounded-2xl shadow-xl flex items-center justify-between border border-slate-800 cursor-pointer transition hover:scale-[1.01]"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold text-sm">
                {cart.length}
              </div>
              <div className="text-left">
                <span className="text-xs text-slate-400 block">Ver Meu Pedido</span>
                <span className="font-extrabold text-sm text-white">{formatCurrency(cartTotal)}</span>
              </div>
            </div>
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
              Finalizar Pedido →
            </span>
          </button>
        </div>
      )}

      {/* ITEM CUSTOMIZATION MODAL */}
      {selectedItemForModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{selectedItemForModal.name}</h3>
                <p className="text-sm font-bold text-amber-700">{formatCurrency(selectedItemForModal.price)}</p>
              </div>
              <button
                onClick={() => setSelectedItemForModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">{selectedItemForModal.description}</p>

            {/* Addons Selection */}
            {selectedItemForModal.addons && selectedItemForModal.addons.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-800 block">
                  Turbine seu prato (Opcional):
                </span>
                <div className="space-y-1.5">
                  {selectedItemForModal.addons.map((addon) => {
                    const isSelected = modalSelectedAddons.some((a) => a.id === addon.id);
                    return (
                      <div
                        key={addon.id}
                        onClick={() => handleToggleAddon(addon)}
                        className={`p-3 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition ${
                          isSelected ? 'bg-amber-50 border-amber-300 text-slate-900 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-4 h-4 rounded flex items-center justify-center ${isSelected ? 'bg-amber-500 text-slate-950' : 'border border-slate-300'}`}>
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <span>{addon.name}</span>
                        </div>
                        <span className="font-bold text-amber-800">+{formatCurrency(addon.price)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-800 block mb-1">
                Observações para a Cozinha:
              </label>
              <textarea
                rows={2}
                value={modalNotes}
                onChange={(e) => setModalNotes(e.target.value)}
                placeholder="Ex: Sem cebola, carne ao ponto, maionese à parte..."
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Quantity and Add Button */}
            <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1">
                <button
                  type="button"
                  onClick={() => setModalQuantity(Math.max(1, modalQuantity - 1))}
                  className="w-8 h-8 rounded-lg bg-white text-slate-700 flex items-center justify-center font-bold shadow-xs hover:bg-slate-200"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-6 text-center text-sm font-bold">{modalQuantity}</span>
                <button
                  type="button"
                  onClick={() => setModalQuantity(modalQuantity + 1)}
                  className="w-8 h-8 rounded-lg bg-white text-slate-700 flex items-center justify-center font-bold shadow-xs hover:bg-slate-200"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleAddToCart}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-sm transition shadow-sm"
              >
                Adicionar ao Carrinho · {formatCurrency(
                  (selectedItemForModal.price + modalSelectedAddons.reduce((s, a) => s + a.price, 0)) * modalQuantity
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CART & CHECKOUT DRAWER */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-bold text-slate-900">Seu Carrinho & Entrega</h3>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cart.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <ShoppingBag className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-semibold">Seu carrinho está vazio</p>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="mt-4 px-4 py-2 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold"
                >
                  Escolher Pratos
                </button>
              </div>
            ) : (
              <form onSubmit={handleCheckoutSubmit} className="space-y-4">
                {/* Cart items list */}
                <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto pr-1">
                  {cart.map((item) => (
                    <div key={item.id} className="py-2.5 flex items-start justify-between">
                      <div className="flex-1 pr-2">
                        <p className="text-xs font-bold text-slate-800">
                          {item.quantity}x {item.name}
                        </p>
                        {item.addons && item.addons.length > 0 && (
                          <p className="text-[11px] text-slate-500">
                            + {item.addons.map((a) => a.name).join(', ')}
                          </p>
                        )}
                        {item.notes && (
                          <p className="text-[11px] text-amber-700 italic">Obs: {item.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">
                          {formatCurrency(item.subtotal)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFromCart(item.id)}
                          className="text-slate-400 hover:text-rose-500 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Fulfillment Type Toggle (Entrega vs Retirada) */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-bold text-slate-700 block">Como deseja receber seu pedido?</label>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
                    <button
                      type="button"
                      onClick={() => { setFulfillmentType('DELIVERY'); setFormError(null); }}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                        fulfillmentType === 'DELIVERY'
                          ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Bike className="w-4 h-4 text-amber-600" />
                      <span>Entrega (Delivery)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setFulfillmentType('RETIRADA'); setFormError(null); }}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                        fulfillmentType === 'RETIRADA'
                          ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <StoreIcon className="w-4 h-4 text-emerald-600" />
                      <span>Retirar no Balcão</span>
                    </button>
                  </div>
                </div>

                {/* Subtotal & Delivery Summary */}
                <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1.5 text-slate-600 border border-slate-200">
                  <div className="flex justify-between">
                    <span>Subtotal dos itens</span>
                    <span>{formatCurrency(cartSubtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Taxa de entrega</span>
                    <span className={isRetirada ? 'text-emerald-700 font-bold' : ''}>
                      {isRetirada ? 'Grátis (Retirada)' : formatCurrency(deliveryFee)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-1.5 border-t border-slate-200">
                    <span>Total a Pagar</span>
                    <span className="text-amber-800">{formatCurrency(cartTotal)}</span>
                  </div>
                </div>

                {/* Customer Information (Tudo Opcional) */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    Seus Dados de Contato (Opcional)
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">Seu Nome (Opcional)</label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Ex: Maria Santos"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">WhatsApp / Telefone (Opcional)</label>
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="(83) 98765-4321"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Address Section: Somente se for Entrega (Delivery) */}
                {!isRetirada ? (
                  <div className="space-y-3 pt-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <Bike className="w-3.5 h-3.5 text-amber-600" />
                      Local de Entrega (Tudo Opcional)
                    </h4>

                    {/* Condomínio Buttons */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-700 block mb-1.5 flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5 text-amber-600" />
                        <span>Selecione seu Condomínio (Opcional):</span>
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setCondoType(condoType === 'Eco Way' ? '' : 'Eco Way')}
                          className={`py-2 px-3 rounded-xl text-xs font-bold transition text-center cursor-pointer border ${
                            condoType === 'Eco Way'
                              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          🏢 Eco Way
                        </button>
                        <button
                          type="button"
                          onClick={() => setCondoType(condoType === 'Eco Fit' ? '' : 'Eco Fit')}
                          className={`py-2 px-3 rounded-xl text-xs font-bold transition text-center cursor-pointer border ${
                            condoType === 'Eco Fit'
                              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          🏢 Eco Fit
                        </button>
                        <button
                          type="button"
                          onClick={() => setCondoType(condoType === 'Outros' ? '' : 'Outros')}
                          className={`py-2 px-3 rounded-xl text-xs font-bold transition text-center cursor-pointer border ${
                            condoType === 'Outros'
                              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          Outros...
                        </button>
                      </div>

                      {condoType === 'Outros' && (
                        <div className="mt-2 animate-in fade-in">
                          <input
                            type="text"
                            value={condoCustom}
                            onChange={(e) => setCondoCustom(e.target.value)}
                            placeholder="Nome do seu condomínio ou endereço"
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
                          />
                        </div>
                      )}
                    </div>

                    {/* Bloco e Apartamento */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">Bloco (Opcional)</label>
                        <input
                          type="text"
                          value={bloco}
                          onChange={(e) => setBloco(e.target.value)}
                          placeholder="Ex: Bloco A, Bloco 02"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">Apartamento / Ap (Opcional)</label>
                        <input
                          type="text"
                          value={apto}
                          onChange={(e) => setApto(e.target.value)}
                          placeholder="Ex: Ap 204, 101"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">Ponto de Referência / Complemento (Opcional)</label>
                      <input
                        type="text"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder="Ex: Próximo à portaria, deixar na recepção..."
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                ) : (
                  /* Banner Informativo de Retirada */
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-1.5">
                    <div className="flex items-center gap-2 font-bold text-emerald-950">
                      <StoreIcon className="w-4 h-4 text-emerald-700" />
                      <span>Retirada no Balcão</span>
                    </div>
                    <p className="text-[11px] text-emerald-800">
                      Local de retirada: <strong>{config.address} - {config.city}</strong>
                    </p>
                    <p className="text-[11px] text-emerald-700 font-semibold">
                      ✓ Apenas seu nome e WhatsApp (opcionais). Nenhum endereço necessário!
                    </p>
                  </div>
                )}

                {/* Observações do Pedido */}
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Observações do Pedido (opcional)</label>
                  <input
                    type="text"
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Ex: Sem cebola, molho à parte, guardanapos extras..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Forma de Pagamento para Ambos */}
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" />
                    Forma de Pagamento
                  </h4>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'PIX', label: 'PIX Instantâneo' },
                      { id: 'CARTAO_CREDITO', label: 'Cartão de Crédito' },
                      { id: 'CARTAO_DEBITO', label: 'Cartão de Débito' },
                      { id: 'DINHEIRO', label: 'Dinheiro' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMethod(m.id as PaymentMethod)}
                        className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition cursor-pointer ${
                          paymentMethod === m.id
                            ? 'bg-amber-50 border-amber-400 text-amber-950 font-bold'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {paymentMethod === 'DINHEIRO' && (
                    <div className="mt-2">
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        Precisa de troco? Digite o valor para o troco:
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={paymentChangeFor}
                        onChange={(e) => setPaymentChangeFor(e.target.value)}
                        placeholder="Ex: 50.00 ou 100.00"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  )}

                  {paymentMethod === 'PIX' && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                      <QrCode className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>
                        O <strong>QR Code oficial</strong> e a chave <strong>Copia e Cola</strong> no valor exato de <strong>{formatCurrency(cartTotal)}</strong> serão gerados ao confirmar!
                      </span>
                    </div>
                  )}
                </div>

                {/* Form Error Display */}
                {formError && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-2xl text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer mt-4"
                >
                  <Send className="w-4 h-4" />
                  <span>Confirmar Pedido · {formatCurrency(cartTotal)}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ORDER CONFIRMATION / PIX QR CODE & WHATSAPP SHARE MODAL */}
      {createdOrderId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl border border-slate-100 my-8 animate-in zoom-in-95">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-2xl font-bold">
              ✓
            </div>

            <div>
              <span className="text-xs font-mono text-emerald-700 font-bold uppercase tracking-wider">
                PEDIDO RECEBIDO COM SUCESSO!
              </span>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{createdOrderNumber}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {createdOrder?.fulfillmentType === 'RETIRADA' 
                  ? 'Pedido registrado para retirada no balcão do restaurante.'
                  : 'Pedido registrado e enviado para a nossa cozinha!'}
              </p>

              {/* Status da transmissão para a nuvem em tempo real */}
              <div className="mt-2.5 flex items-center justify-center">
                {createdOrder?._cloudSyncStatus === 'SYNCED' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Confirmado e Sincronizado na Nuvem</span>
                  </span>
                ) : createdOrder?._cloudSyncStatus === 'PENDING' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    <UploadCloud className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                    <span>Gravado no Aparelho · Transmitindo à Cozinha...</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                    <Wifi className="w-3.5 h-3.5 text-slate-500" />
                    <span>Salvo em Cache Seguro (Offline)</span>
                  </span>
                )}
              </div>
            </div>

            {/* SE O PAGAMENTO FOR PIX: EXIBE QR CODE COM VALOR EXATO */}
            {createdOrder?.paymentMethod === 'PIX' && (
              <div className="p-4 bg-emerald-50/90 border border-emerald-200 rounded-2xl space-y-3 text-left">
                <div className="flex items-center justify-between pb-2 border-b border-emerald-200/70">
                  <div className="flex items-center gap-2">
                    <QrCode className="w-4 h-4 text-emerald-700" />
                    <span className="text-xs font-bold text-emerald-950">Pagamento Instantâneo via PIX</span>
                  </div>
                  <span className="text-sm font-mono font-black text-emerald-800">
                    {formatCurrency(createdOrder.totalAmount)}
                  </span>
                </div>

                {/* QR Code Image */}
                {pixQrDataUrl && (
                  <div className="flex flex-col items-center justify-center py-2">
                    <img
                      src={pixQrDataUrl}
                      alt="QR Code PIX do Pedido"
                      className="w-44 h-44 rounded-xl shadow-xs border border-white"
                    />
                    <span className="text-[10px] text-emerald-700 mt-1 font-semibold">
                      Abra o app do seu banco e aponte a câmera
                    </span>
                  </div>
                )}

                {/* PIX Copia e Cola */}
                {createdOrder.pixCode && (
                  <div className="space-y-1.5 pt-1 border-t border-emerald-200/70">
                    <div className="flex items-center justify-between text-[11px] text-emerald-900">
                      <span className="font-semibold">Código PIX Copia e Cola:</span>
                      <span className="text-[10px] text-emerald-700">Valor Exato</span>
                    </div>
                    <div className="p-2 bg-white rounded-xl border border-emerald-200 font-mono text-[10px] text-slate-800 break-all max-h-16 overflow-y-auto">
                      {createdOrder.pixCode}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (createdOrder.pixCode) {
                          navigator.clipboard.writeText(createdOrder.pixCode);
                          setCopiedPixCode(true);
                          setTimeout(() => setCopiedPixCode(false), 2000);
                        }
                      }}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs"
                    >
                      {copiedPixCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedPixCode ? 'Código PIX Copiado!' : 'Copiar Código PIX (Copia e Cola)'}</span>
                    </button>
                  </div>
                )}

                <div className="text-[10px] text-emerald-800 pt-1">
                  Chave: <strong>{config.pixKey}</strong> · Titular: <strong>{config.pixReceiverName || config.name}</strong>
                </div>
              </div>
            )}

            {/* Prazo e Informações */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 text-left space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-slate-900">
                <Clock className="w-4 h-4 text-amber-600" />
                {createdOrder?.fulfillmentType === 'RETIRADA'
                  ? `Preparo estimado: ~${config.avgPrepTimeMinutes} minutos para retirar`
                  : `Tempo estimado de entrega: ~${config.avgPrepTimeMinutes + config.avgDeliveryTimeMinutes} minutos`}
              </p>
              {createdOrder?.fulfillmentType === 'RETIRADA' && (
                <p className="text-[11px] text-slate-600">
                  Endereço para retirada: <strong>{config.address} - {config.city}</strong>
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2">
              <a
                href={whatsappShareUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition"
              >
                <Send className="w-4 h-4" />
                <span>Enviar Pedido no WhatsApp da Loja</span>
              </a>

              <button
                onClick={() => {
                  if (onNavigateToTracking) {
                    onNavigateToTracking(createdOrderId, createdOrder?.trackingCode);
                  } else {
                    const tkParam = createdOrder?.trackingCode ? `&tk=${encodeURIComponent(createdOrder.trackingCode)}` : '';
                    window.location.search = `?view=rastreio&pedido=${createdOrderId}${tkParam}`;
                  }
                }}
                className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
              >
                <ExternalLink className="w-4 h-4 text-amber-400" />
                <span>Acompanhar Status em Tempo Real Agora</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
