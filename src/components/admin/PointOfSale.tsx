import React, { useState, useEffect, useMemo, useRef } from 'react';
import { store } from '../../services/store';
import { isFirebaseReady } from '../../services/firebase';
import { thermalPrinterService, ThermalPrinterStatus } from '../../services/thermalPrinter';
import { MenuItem, Order, OrderItem, PaymentMethod, User, MenuItemAddon } from '../../types';
import { formatCurrency, formatDateTime, formatTime, getPaymentMethodLabel, formatAddressDetails } from '../../utils/formatters';
import { generateQRCodeDataUrl } from '../../utils/qrcode';
import { generatePurchasePixPayload, generateOrderPixTxId, inferPixKeyType } from '../../utils/pix';
import { 
  ShoppingBag, 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  Printer, 
  Bluetooth,
  RefreshCw,
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
  Home,
  Copy,
  Check
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
  const [cashSyncState, setCashSyncState] = useState(() => store.getCashShiftSyncState());
  const [config, setConfig] = useState(() => store.getRestaurantConfig());
  const [pixConfigState, setPixConfigState] = useState(() => store.getOfficialPixConfigState());
  const [printerStatus, setPrinterStatus] = useState<ThermalPrinterStatus>(() => thermalPrinterService.getStatus());
  const [isPrinterQuickBusy, setIsPrinterQuickBusy] = useState(false);
  const [printerQuickNotice, setPrinterQuickNotice] = useState<{
    type: 'success' | 'info' | 'error';
    message: string;
    offerRepair?: boolean;
  } | null>(null);
  const printerNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleUpdate = () => {
      setMenuItems(store.getMenuItems());
      setOrders(store.getOrders());
      setCurrentShift(store.getCurrentCashShift());
      setCashSyncState(store.getCashShiftSyncState());
      setConfig(store.getRestaurantConfig());
      setPixConfigState(store.getOfficialPixConfigState());
    };
    window.addEventListener('gestaofood_state_changed', handleUpdate);
    return () => window.removeEventListener('gestaofood_state_changed', handleUpdate);
  }, []);

  useEffect(() => {
    const unsubscribe = thermalPrinterService.subscribe((status) => {
      setPrinterStatus(status);
    });
    return () => {
      unsubscribe();
      if (printerNoticeTimerRef.current) {
        clearTimeout(printerNoticeTimerRef.current);
      }
    };
  }, []);

  const showPrinterQuickFeedback = (
    notice: { type: 'success' | 'info' | 'error'; message: string; offerRepair?: boolean },
    durationMs = 5000
  ) => {
    if (printerNoticeTimerRef.current) {
      clearTimeout(printerNoticeTimerRef.current);
    }
    setPrinterQuickNotice(notice);
    printerNoticeTimerRef.current = setTimeout(() => {
      setPrinterQuickNotice(null);
    }, durationMs);
  };

  const handleExplicitBlePair = async () => {
    if (
      printerStatus.reconnecting ||
      printerStatus.isPrinting ||
      isPrinterQuickBusy
    ) {
      return;
    }

    setIsPrinterQuickBusy(true);
    try {
      const res = await thermalPrinterService.connectBluetoothBLE();
      showPrinterQuickFeedback(
        {
          type: res.success ? 'success' : 'error',
          message: res.message,
        },
        res.success ? 4500 : 7500
      );
    } finally {
      setIsPrinterQuickBusy(false);
    }
  };

  const handleQuickPrinterClick = async () => {
    // Não interferir em reconexão ou impressão em andamento
    if (printerStatus.reconnecting || printerStatus.isPrinting || isPrinterQuickBusy) {
      return;
    }

    // RawBT ou Spooler do Sistema: clicar no acesso rápido permite parear diretamente via Bluetooth BLE
    if (printerStatus.mode !== 'bluetooth_ble') {
      await handleExplicitBlePair();
      return;
    }

    // A. Bluetooth conectado: nunca desconectar, reconectar ou perturbar a conexão saudável
    if (printerStatus.connected) {
      showPrinterQuickFeedback(
        {
          type: 'info',
          message: `Impressora "${printerStatus.deviceName || 'Térmica 58mm'}" conectada e pronta para uso.`,
        },
        3500
      );
      return;
    }

    // C. Bluetooth desconectado com dispositivo salvo: tenta reconexão direta e oferece pareamento imediato em qualquer falha
    if (printerStatus.hasSavedDevice) {
      setIsPrinterQuickBusy(true);
      try {
        const res = await thermalPrinterService.reconnectSavedBLE();
        showPrinterQuickFeedback(
          {
            type: res.success ? 'success' : 'error',
            message: res.message,
            offerRepair: !res.success,
          },
          res.success ? 4500 : 10000
        );
      } finally {
        setIsPrinterQuickBusy(false);
      }
      return;
    }

    // D. Bluetooth sem dispositivo salvo: parear mediante clique explícito
    await handleExplicitBlePair();
  };

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

  // Sale finalized modal & feedback state
  const submittingRef = useRef(false);
  const draftOrderIdRef = useRef<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [saleSuccessBanner, setSaleSuccessBanner] = useState<{ orderNumber: string; total: number; order: Order; printed?: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [printableOrder, setPrintableOrder] = useState<Order | null>(null);

  // Cancellation modal state
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);

  // History filters
  const [historyPeriod, setHistoryPeriod] = useState<'HOJE' | 'ONTEM' | '7DIAS' | 'TODOS'>('HOJE');
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState<string>('TODOS');
  const [historySearch, setHistorySearch] = useState('');

  // Live PIX QR Code preview for PDV
  const [posPixQrDataUrl, setPosPixQrDataUrl] = useState('');
  const [posPixQrError, setPosPixQrError] = useState<string | null>(null);
  const [copiedPosPix, setCopiedPosPix] = useState(false);
  const [posPixConfirmed, setPosPixConfirmed] = useState(false);
  const [pdvPixTxId, setPdvPixTxId] = useState<string>(() =>
    generateOrderPixTxId('PDV', `${Date.now()}${Math.floor(Math.random() * 1000)}`)
  );

  const operatorName = currentUser?.name || currentUser?.username || 'Caixa Balcão';

  const reloadData = () => {
    setMenuItems(store.getMenuItems());
    setOrders(store.getOrders());
    setCurrentShift(store.getCurrentCashShift());
    setCashSyncState(store.getCashShiftSyncState());
    setConfig(store.getRestaurantConfig());
    setPixConfigState(store.getOfficialPixConfigState());
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
      return matchesSearch && matchesCategory && item.available !== false;
    });
  }, [menuItems, searchQuery, selectedCategory]);

  // Calculations (rounded cleanly to 2 decimal places)
  const roundCurrency = (value: number) => Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;

  const subtotal = useMemo(() => {
    return roundCurrency(cart.reduce((acc, item) => acc + item.subtotal, 0));
  }, [cart]);

  const totalCartCount = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.quantity, 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    const rawVal = parseFloat(discountValue) || 0;
    if (rawVal <= 0) return 0;
    if (discountType === 'PERCENT') {
      return roundCurrency((subtotal * Math.min(rawVal, 100)) / 100);
    }
    return roundCurrency(Math.min(rawVal, subtotal));
  }, [discountValue, discountType, subtotal]);

  const deliveryFee = fulfillmentType === 'DELIVERY' ? roundCurrency(config.deliveryFeeBase || 0) : 0;
  const totalAmount = Math.max(0, roundCurrency(subtotal - discountAmount + deliveryFee));

  const changeDue = useMemo(() => {
    if (paymentMethod !== 'DINHEIRO') return 0;
    const tendered = parseFloat(cashTendered) || 0;
    return Math.max(0, roundCurrency(tendered - totalAmount));
  }, [cashTendered, totalAmount, paymentMethod]);

  const posPixPreview = useMemo(() => {
    if (paymentMethod !== 'PIX' || totalAmount <= 0) return null;
    if (!pixConfigState.hasValidPixKey) {
      return {
        success: false as const,
        error:
          pixConfigState.message ||
          'Configuração oficial do PIX não disponível. Selecione outra forma de pagamento ou tente recarregar.',
      };
    }
    return generatePurchasePixPayload({
      pixKey: config.pixKey,
      keyType: config.pixKeyType || inferPixKeyType(config.pixKey || ''),
      receiverName: config.pixReceiverName,
      receiverCity: config.pixReceiverCity,
      storeName: config.name,
      amount: totalAmount,
      txId: pdvPixTxId,
      description: 'Venda PDV Amandita',
    });
  }, [
    paymentMethod,
    totalAmount,
    pdvPixTxId,
    pixConfigState.status,
    pixConfigState.hasValidPixKey,
    pixConfigState.message,
    config.pixKey,
    config.pixKeyType,
    config.pixReceiverName,
    config.pixReceiverCity,
    config.name,
  ]);

  const posPixCode = posPixPreview?.success ? posPixPreview.payload : '';
  const posPixError = posPixPreview && !posPixPreview.success ? posPixPreview.error : posPixQrError;

  useEffect(() => {
    let cancelled = false;
    const buildPosQr = async () => {
      if (!posPixCode) {
        if (!cancelled) {
          setPosPixQrDataUrl('');
          setPosPixQrError(null);
        }
        return;
      }

      try {
        const qr = await generateQRCodeDataUrl(posPixCode, { width: 300, margin: 4 });
        if (!cancelled) {
          setPosPixQrDataUrl(qr);
          setPosPixQrError(null);
        }
      } catch {
        if (!cancelled) {
          setPosPixQrDataUrl('');
          setPosPixQrError('Não foi possível gerar o QR Code PIX.');
        }
      }
    };
    buildPosQr();
    return () => {
      cancelled = true;
    };
  }, [posPixCode]);

  useEffect(() => {
    setPosPixConfirmed(false);
  }, [paymentMethod, totalAmount]);

  // Reset idempotent draft order ID whenever the operator edits cart items or payment parameters
  useEffect(() => {
    draftOrderIdRef.current = null;
  }, [cart, discountValue, discountType, fulfillmentType, paymentMethod]);

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
    const addonsTotal = roundCurrency(addons.reduce((sum, a) => sum + a.price, 0));
    const unitPrice = roundCurrency(item.price + addonsTotal);
    const key = `${item.id}-${addons.map((a) => a.id).sort().join(',')}-${notes}`;

    setCart((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        const nextQty = existing.quantity + quantity;
        return prev.map((i) =>
          i.key === key
            ? { ...i, quantity: nextQty, subtotal: roundCurrency(nextQty * unitPrice) }
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
          subtotal: roundCurrency(unitPrice * quantity),
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
            return newQty > 0 ? { ...item, quantity: newQty, subtotal: roundCurrency(newQty * item.unitPrice) } : null;
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
    draftOrderIdRef.current = null;
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
    setPosPixConfirmed(false);
    setPdvPixTxId(generateOrderPixTxId('PDV', `${Date.now()}${Math.floor(Math.random() * 1000)}`));
  };

  // Submit sale with strict idempotency lock and atomic financial confirmation
  const handleFinalizeSale = async () => {
    if (cart.length === 0 || isSubmitting || submittingRef.current) return;

    if (paymentMethod === 'PIX') {
      const livePixState = store.getOfficialPixConfigState();
      if (!livePixState.hasValidPixKey || Boolean(posPixError) || !posPixCode) {
        setSaleError(
          livePixState.message ||
            posPixError ||
            'Configuração oficial do PIX não carregada ou inválida. Escolha Dinheiro ou Cartão para concluir a venda.'
        );
        return;
      }
    }

    if (paymentMethod === 'DINHEIRO') {
      const tendered = parseFloat(cashTendered) || 0;
      if (tendered < totalAmount && cashTendered.trim() !== '') {
        alert(`Valor em dinheiro informado (R$ ${tendered.toFixed(2)}) é menor que o total (R$ ${totalAmount.toFixed(2)}).`);
        return;
      }
    }

    submittingRef.current = true;
    setSaleError(null);
    setIsSubmitting(true);

    try {
      // Build formatted address for delivery if applicable
      let formattedAddress = undefined;
      if (fulfillmentType === 'DELIVERY') {
        const hasPresetCondo = deliveryCondo === 'Eco Way' || deliveryCondo === 'Eco Fit';
        const resolvedCondo = hasPresetCondo
          ? `Condomínio ${deliveryCondo}`
          : (deliveryCondoCustom.trim() || undefined);

        formattedAddress = {
          condominium: resolvedCondo,
          street: resolvedCondo || 'Endereço de Entrega',
          number: (deliveryAp.trim() || deliveryBloco.trim()) ? undefined : 'S/N',
          block: deliveryBloco.trim() || undefined,
          apartment: deliveryAp.trim() || undefined,
          neighborhood: hasPresetCondo ? `Condomínio ${deliveryCondo}` : (deliveryCondoCustom.trim() || undefined),
          complement: undefined,
          city: config.city || 'Campina Grande',
          reference: deliveryReference.trim() || undefined,
        };
      }

      const resolvedPaymentStatus: 'PAGO' | 'PENDENTE' =
        paymentMethod === 'PIX' ? (posPixConfirmed ? 'PAGO' : 'PENDENTE') : 'PAGO';

      if (!draftOrderIdRef.current) {
        draftOrderIdRef.current = `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      }

      const orderPayload = {
        id: draftOrderIdRef.current,
        fulfillmentType,
        customer: {
          name: customerName.trim() || (fulfillmentType === 'RETIRADA' ? 'Cliente Balcão' : 'Cliente Entrega'),
          phone: customerPhone.trim() || config.phone,
          address: formattedAddress,
          notes: orderNotes.trim() || undefined,
        },
        items: cart.map(({ key, ...item }) => ({
          ...item,
          unitPrice: roundCurrency(item.unitPrice),
          subtotal: roundCurrency(item.subtotal),
        })),
        subtotal,
        deliveryFee,
        discount: discountAmount,
        totalAmount,
        paymentMethod,
        pixCode: paymentMethod === 'PIX' && posPixCode ? posPixCode : undefined,
        pixTxId: paymentMethod === 'PIX' ? pdvPixTxId : undefined,
        pixDescription: paymentMethod === 'PIX' ? 'Venda PDV Amandita' : undefined,
        paymentChangeFor: paymentMethod === 'DINHEIRO' ? (parseFloat(cashTendered) || totalAmount) : undefined,
        cashReceived: paymentMethod === 'DINHEIRO' ? (parseFloat(cashTendered) || totalAmount) : undefined,
        changeAmount: paymentMethod === 'DINHEIRO' ? Math.max(0, roundCurrency((parseFloat(cashTendered) || totalAmount) - totalAmount)) : undefined,
        createdBy: operatorName || 'Operador PDV',
        processedBy: operatorName || 'Operador PDV',
        paymentStatus: resolvedPaymentStatus,
        status: 'EM_PREPARO' as const,
        estimatedDeliveryMinutes: fulfillmentType === 'RETIRADA' ? 15 : config.avgDeliveryTimeMinutes,
      };

      let committedOrder: Order | null = null;

      if (resolvedPaymentStatus === 'PAGO') {
        const atomicRes = await store.createAndConfirmPaidOrderAsync(orderPayload, operatorName);
        if (!atomicRes.order || atomicRes.rejected || atomicRes.uncertain) {
          setSaleError(
            atomicRes.error ||
              'Não foi possível concluir a venda paga e registrar no caixa. Os itens foram preservados para nova tentativa.'
          );
          return;
        }
        committedOrder = atomicRes.order;
      } else {
        const requireCloudConfirm = isFirebaseReady();
        const pendingRes = await store.createOrderAsync(orderPayload, {
          requireServerConfirmation: requireCloudConfirm,
        });
        if (requireCloudConfirm && !pendingRes.synced) {
          setSaleError(
            pendingRes.error ||
              'Não foi possível registrar o pedido PIX pendente no servidor. Os itens foram preservados.'
          );
          return;
        }
        committedOrder = pendingRes.order;
      }

      // Only clear cart, reset draft ID, close drawer, and show success AFTER confirmed persistence
      draftOrderIdRef.current = null;
      handleClearCart();
      setIsCartDrawerOpen(false);
      reloadData();
      if (onOrderCreated) onOrderCreated();
      setCompletedOrder(null);

      // Auto-print thermal receipt AFTER sale and cash shift are confirmed
      let printSuccess = false;
      try {
        const printerCfg = thermalPrinterService.getConfig();
        if (printerCfg.enabled && printerCfg.autoPrintPickup && committedOrder.fulfillmentType === 'RETIRADA') {
          await thermalPrinterService.printOrder(committedOrder);
          printSuccess = true;
        }
      } catch (printErr) {
        console.warn('Falha na impressão do cupom térmico (a venda permanece registrada com sucesso):', printErr);
        printSuccess = false;
      }

      setSaleSuccessBanner({
        orderNumber: committedOrder.orderNumber,
        total: committedOrder.totalAmount,
        order: committedOrder,
        printed: printSuccess,
      });
      setTimeout(() => setSaleSuccessBanner(null), 8000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaleError(`Falha ao registrar venda: ${msg}. Os produtos e dados preenchidos foram preservados.`);
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
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

  const handleExecuteCancelSale = async () => {
    if (!orderToCancel || isCancellingOrder) return;
    if (!cancelReason.trim()) {
      setCancelError('Por favor informe o motivo obrigatório do cancelamento.');
      return;
    }

    setIsCancellingOrder(true);
    setCancelError(null);
    const targetId = orderToCancel.id;
    try {
      const res = await store.cancelOrderAsync(targetId, cancelReason.trim(), operatorName);
      if (!res.success) {
        setCancelError(res.message);
        return;
      }

      const cancelledOrder = store.getOrderById(targetId);
      setOrderToCancel(null);
      reloadData();

      if (cancelledOrder?.refundInfo) {
        thermalPrinterService.printRefundReceipt(cancelledOrder);
      }
    } finally {
      setIsCancellingOrder(false);
    }
  };

  // Reusable Cart Section rendered both in desktop sidebar and slide-over cart drawer
  const renderCartSection = (isDrawer: boolean) => (
    <div className="space-y-4">
      {/* Customer & Fulfillment Info */}
      <div className="space-y-3 bg-[#F8FAFC] p-3 sm:p-3.5 rounded-xl border border-[#E2E8F0] text-xs">
        {/* Modalidade Toggle (Retirada vs Entrega) */}
        <div>
          <label className="block text-[11px] font-semibold text-[#475569] mb-1.5">
            Modalidade da venda
          </label>
          <div className="grid grid-cols-2 gap-1 p-1 bg-white border border-[#E2E8F0] rounded-xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setFulfillmentType('RETIRADA')}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-center transition flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                fulfillmentType === 'RETIRADA'
                  ? 'bg-[#0F2342] text-white shadow-2xs'
                  : 'text-[#475569] hover:text-[#0F2342] hover:bg-[#F8FAFC]'
              }`}
            >
              <Store className="w-3.5 h-3.5 shrink-0" />
              <span>Retirada</span>
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentType('DELIVERY')}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-center transition flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                fulfillmentType === 'DELIVERY'
                  ? 'bg-[#0F2342] text-white shadow-2xs'
                  : 'text-[#475569] hover:text-[#0F2342] hover:bg-[#F8FAFC]'
              }`}
            >
              <Bike className="w-3.5 h-3.5 shrink-0" />
              <span>Entrega</span>
            </button>
          </div>
        </div>

        {/* OPÇÃO RETIRADA: Apenas Nome e Telefone (Tudo Opcional) */}
        {fulfillmentType === 'RETIRADA' && (
          <div className="space-y-2 pt-2 border-t border-[#E2E8F0] animate-in fade-in">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Nome (opcional)
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs font-medium text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(83) 9...."
                  className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs font-medium text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
                />
              </div>
            </div>
            <p className="text-[11px] text-emerald-700 flex items-center gap-1.5 font-medium">
              <Store className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Retirada no balcão · informe nome e telefone se desejar.</span>
            </p>
          </div>
        )}

        {/* OPÇÃO ENTREGA: Nome, Telefone, Condomínio (Eco Way, Eco Fit, Outros), Bloco e Ap */}
        {fulfillmentType === 'DELIVERY' && (
          <div className="space-y-2.5 pt-2 border-t border-[#E2E8F0] animate-in fade-in">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-[#EA580C] flex items-center gap-1.5">
                <Bike className="w-3.5 h-3.5" />
                <span>Dados de entrega</span>
              </span>
            </div>

            {/* Nome e Telefone */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs font-medium text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="(83) 9...."
                  className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs font-medium text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
                />
              </div>
            </div>

            {/* Condomínio: Eco Way, Eco Fit, Outros */}
            <div>
              <label className="block text-[11px] font-semibold text-[#475569] mb-1 flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-[#EA580C]" />
                <span>Condomínio</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setDeliveryCondo(deliveryCondo === 'Eco Way' ? '' : 'Eco Way')}
                  className={`min-h-[36px] py-1.5 px-2 rounded-xl text-xs font-semibold transition text-center whitespace-nowrap cursor-pointer border ${
                    deliveryCondo === 'Eco Way'
                      ? 'bg-[#EA580C] text-white border-[#EA580C] shadow-xs'
                      : 'bg-white text-[#0F2342] border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                  }`}
                >
                  Eco Way
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryCondo(deliveryCondo === 'Eco Fit' ? '' : 'Eco Fit')}
                  className={`min-h-[36px] py-1.5 px-2 rounded-xl text-xs font-semibold transition text-center whitespace-nowrap cursor-pointer border ${
                    deliveryCondo === 'Eco Fit'
                      ? 'bg-[#EA580C] text-white border-[#EA580C] shadow-xs'
                      : 'bg-white text-[#0F2342] border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                  }`}
                >
                  Eco Fit
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryCondo(deliveryCondo === 'Outros' ? '' : 'Outros')}
                  className={`min-h-[36px] py-1.5 px-2 rounded-xl text-xs font-semibold transition text-center whitespace-nowrap cursor-pointer border ${
                    deliveryCondo === 'Outros'
                      ? 'bg-[#EA580C] text-white border-[#EA580C] shadow-xs'
                      : 'bg-white text-[#0F2342] border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                  }`}
                >
                  Outros
                </button>
              </div>

              {/* Se clicou em Outros ou quer especificar */}
              {deliveryCondo === 'Outros' && (
                <div className="mt-2 animate-in fade-in">
                  <input
                    type="text"
                    value={deliveryCondoCustom}
                    onChange={(e) => setDeliveryCondoCustom(e.target.value)}
                    placeholder="Nome do condomínio ou endereço"
                    className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs font-medium text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
                  />
                </div>
              )}
            </div>

            {/* Bloco e Ap */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Bloco
                </label>
                <input
                  type="text"
                  value={deliveryBloco}
                  onChange={(e) => setDeliveryBloco(e.target.value)}
                  placeholder="Ex: Bloco A, 02"
                  className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs font-medium text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#475569] mb-1">
                  Apartamento / Ap
                </label>
                <input
                  type="text"
                  value={deliveryAp}
                  onChange={(e) => setDeliveryAp(e.target.value)}
                  placeholder="Ex: Ap 104, 302"
                  className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs font-medium text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
                />
              </div>
            </div>

            {/* Ponto de Referência */}
            <div>
              <input
                type="text"
                placeholder="Ponto de referência ou obs. da entrega"
                value={deliveryReference}
                onChange={(e) => setDeliveryReference(e.target.value)}
                className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs font-medium text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
              />
            </div>
          </div>
        )}
      </div>

      {/* Cart Items List */}
      <div className={`divide-y divide-[#E2E8F0] ${isDrawer ? 'max-h-[42vh]' : 'max-h-64'} overflow-y-auto pr-1`}>
        {cart.length === 0 ? (
          <div className="py-8 text-center text-[#64748B] space-y-2">
            <div className="w-11 h-11 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center mx-auto">
              <ShoppingBag className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-xs font-semibold text-[#0F2342]">Nenhum item na comanda</p>
            <p className="text-[11px] text-[#64748B]">Toque nos produtos para adicionar à venda.</p>
          </div>
        ) : (
          cart.map((item) => (
            <div key={item.key} className="py-2.5 flex items-start justify-between gap-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[#0F2342] leading-snug">{item.name}</p>
                {item.addons && item.addons.length > 0 && (
                  <p className="text-[11px] text-[#EA580C] font-medium mt-0.5 leading-snug">
                    + {item.addons.map((a) => a.name).join(', ')}
                  </p>
                )}
                {item.notes && (
                  <p className="text-[11px] text-[#64748B] italic mt-0.5 leading-snug">Obs: {item.notes}</p>
                )}
                <p className="text-[11px] text-[#64748B] font-mono tabular-nums mt-0.5">
                  {formatCurrency(item.unitPrice)} un.
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <div className="inline-flex items-center border border-[#E2E8F0] rounded-xl bg-[#F8FAFC] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => updateItemQty(item.key, -1)}
                    className="w-8 h-8 flex items-center justify-center hover:bg-white text-[#0F2342] transition cursor-pointer"
                    aria-label={`Diminuir quantidade de ${item.name}`}
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-7 text-center text-xs font-extrabold font-mono tabular-nums text-[#0F2342]">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateItemQty(item.key, 1)}
                    className="w-8 h-8 flex items-center justify-center hover:bg-white text-[#0F2342] transition cursor-pointer"
                    aria-label={`Aumentar quantidade de ${item.name}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <span className="font-extrabold text-xs text-[#0F2342] w-16 text-right font-mono tabular-nums">
                  {formatCurrency(item.subtotal)}
                </span>

                <button
                  type="button"
                  onClick={() => removeItem(item.key)}
                  className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
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
        <div className="space-y-3.5 pt-3 border-t border-[#E2E8F0]">
          {/* Discount */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#475569] flex items-center gap-1.5">
              <Percent className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>Desconto</span>
            </span>
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-[11px] font-bold bg-[#F8FAFC]">
                <button
                  type="button"
                  onClick={() => setDiscountType('FIXED')}
                  className={`px-2.5 py-1 transition cursor-pointer ${
                    discountType === 'FIXED' ? 'bg-[#0F2342] text-white' : 'text-[#475569] hover:text-[#0F2342]'
                  }`}
                >
                  R$
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('PERCENT')}
                  className={`px-2.5 py-1 transition cursor-pointer ${
                    discountType === 'PERCENT' ? 'bg-[#0F2342] text-white' : 'text-[#475569] hover:text-[#0F2342]'
                  }`}
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
                className="w-20 min-h-[34px] px-2.5 py-1 bg-white border border-[#CBD5E1] rounded-lg text-xs font-bold font-mono tabular-nums text-right text-[#0F2342] focus:outline-none focus:border-[#EA580C]"
              />
            </div>
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="block text-[11px] font-semibold text-[#475569] mb-1.5">
              Forma de pagamento
            </label>
            <div className="grid grid-cols-2 gap-1.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setPaymentMethod('DINHEIRO')}
                className={`min-h-[40px] px-2.5 py-2 rounded-xl border flex items-center justify-center gap-1.5 whitespace-nowrap transition cursor-pointer ${
                  paymentMethod === 'DINHEIRO'
                    ? 'bg-[#0F2342] text-white border-[#0F2342] shadow-xs'
                    : 'bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                }`}
              >
                <Banknote className={`w-3.5 h-3.5 shrink-0 ${paymentMethod === 'DINHEIRO' ? 'text-emerald-400' : 'text-emerald-600'}`} />
                <span>Dinheiro</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('PIX')}
                className={`min-h-[40px] px-2.5 py-2 rounded-xl border flex items-center justify-center gap-1.5 whitespace-nowrap transition cursor-pointer ${
                  paymentMethod === 'PIX'
                    ? 'bg-[#0F2342] text-white border-[#0F2342] shadow-xs'
                    : 'bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                }`}
              >
                <QrCode className={`w-3.5 h-3.5 shrink-0 ${paymentMethod === 'PIX' ? 'text-cyan-400' : 'text-cyan-600'}`} />
                <span>PIX</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CARTAO_DEBITO')}
                className={`min-h-[40px] px-2.5 py-2 rounded-xl border flex items-center justify-center gap-1.5 whitespace-nowrap transition cursor-pointer ${
                  paymentMethod === 'CARTAO_DEBITO'
                    ? 'bg-[#0F2342] text-white border-[#0F2342] shadow-xs'
                    : 'bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                }`}
              >
                <CreditCard className={`w-3.5 h-3.5 shrink-0 ${paymentMethod === 'CARTAO_DEBITO' ? 'text-[#FB923C]' : 'text-[#EA580C]'}`} />
                <span>C. Débito</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('CARTAO_CREDITO')}
                className={`min-h-[40px] px-2.5 py-2 rounded-xl border flex items-center justify-center gap-1.5 whitespace-nowrap transition cursor-pointer ${
                  paymentMethod === 'CARTAO_CREDITO'
                    ? 'bg-[#0F2342] text-white border-[#0F2342] shadow-xs'
                    : 'bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                }`}
              >
                <CreditCard className={`w-3.5 h-3.5 shrink-0 ${paymentMethod === 'CARTAO_CREDITO' ? 'text-indigo-300' : 'text-indigo-600'}`} />
                <span>C. Crédito</span>
              </button>
            </div>
          </div>

          {/* If Dinheiro: Change calculation */}
          {paymentMethod === 'DINHEIRO' && (
            <div className="p-3 bg-emerald-50/80 rounded-xl border border-emerald-200 text-xs space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-emerald-950">Valor recebido (R$)</span>
                <input
                  type="number"
                  step="any"
                  placeholder="Ex: 50.00"
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  className="w-28 min-h-[36px] px-2.5 py-1 bg-white border border-emerald-300 rounded-lg text-xs font-bold font-mono tabular-nums text-right text-emerald-950 focus:outline-none focus:border-emerald-600"
                />
              </div>
              {parseFloat(cashTendered) > totalAmount && (
                <div className="flex items-center justify-between pt-2 border-t border-emerald-200 font-extrabold text-emerald-800">
                  <span>Troco a devolver</span>
                  <span className="text-sm font-mono tabular-nums">{formatCurrency(changeDue)}</span>
                </div>
              )}
            </div>
          )}

          {/* If PIX: Live QR Code & Copia e Cola with exact order amount */}
          {paymentMethod === 'PIX' && totalAmount > 0 && (
            <div className="p-3 bg-sky-50/70 rounded-xl border border-sky-200 text-xs space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-[#0F2342] flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5 text-sky-700" />
                  <span className="tabular-nums">PIX exato ({formatCurrency(totalAmount)})</span>
                </span>
                <span className="text-[11px] font-medium text-[#475569] truncate">
                  {config.pixReceiverName || config.name}
                </span>
              </div>

              {posPixError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-[11px] font-medium space-y-2">
                  <p>{posPixError}</p>
                  {pixConfigState.status === 'UNAVAILABLE' && (
                    <button
                      type="button"
                      onClick={() => store.refreshPublicConfigFromServer()}
                      className="px-2.5 py-1.5 bg-white hover:bg-rose-100 text-rose-900 border border-rose-300 rounded-lg text-[11px] font-bold transition cursor-pointer"
                    >
                      Tentar recarregar PIX oficial
                    </button>
                  )}
                </div>
              )}

              {posPixCode && (
                <>
                  {posPixQrDataUrl && !posPixQrError && (
                    <div className="flex justify-center bg-white p-2.5 rounded-xl border border-sky-200/70">
                      <img src={posPixQrDataUrl} alt="QR Code PIX PDV" className="w-44 h-44 max-w-full object-contain" />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-[#1B365D] font-mono tabular-nums">
                      <span>TXID: <strong>{pdvPixTxId}</strong></span>
                      <span>Valor exato</span>
                    </div>
                    <div className="p-2 bg-white border border-sky-200 rounded-lg font-mono text-[10px] text-slate-700 break-all max-h-16 overflow-y-auto select-all">
                      {posPixCode}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(posPixCode);
                        setCopiedPosPix(true);
                        setTimeout(() => setCopiedPosPix(false), 2000);
                      }}
                      className="w-full min-h-[36px] py-1.5 px-2.5 bg-white hover:bg-sky-50 text-[#0F2342] border border-sky-300 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                    >
                      {copiedPosPix ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedPosPix ? 'Código PIX Copiado!' : 'Copiar PIX Copia e Cola'}</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-[#0F2342] leading-snug bg-white/80 p-2 rounded-lg border border-sky-200">
                    <strong>Conferência manual:</strong> gerar o QR Code não confirma o recebimento automaticamente. Verifique no app do banco antes de marcar como pago.
                  </p>
                  <label className="flex items-start gap-2.5 p-2.5 bg-white border border-sky-200 rounded-xl cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={posPixConfirmed}
                      onChange={(e) => setPosPixConfirmed(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded accent-[#EA580C]"
                    />
                    <span className="text-[11px] font-semibold text-[#0F2342] leading-snug">
                      Recebimento PIX já conferido no banco (marcar pedido como PAGO)
                      {!posPixConfirmed && (
                        <span className="block text-[10px] font-normal text-amber-800 mt-0.5">
                          Desmarcado: o pedido será registrado com pagamento PENDENTE até conferência manual.
                        </span>
                      )}
                    </span>
                  </label>
                </>
              )}
            </div>
          )}

          {/* Order Notes */}
          <div>
            <label className="block text-[11px] font-semibold text-[#475569] mb-1">
              Observações gerais do pedido
            </label>
            <input
              type="text"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="Ex: Embalagem para viagem, cliente aguarda no salão"
              className="w-full min-h-[38px] px-2.5 py-1.5 bg-white border border-[#CBD5E1] rounded-xl text-xs text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/15 transition"
            />
          </div>

          {/* Financial Summary */}
          <div className="p-3.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] space-y-1.5 text-xs">
            <div className="flex justify-between text-[#475569]">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700 font-semibold">
                <span>Desconto aplicado</span>
                <span className="font-mono tabular-nums">- {formatCurrency(discountAmount)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex justify-between text-[#475569]">
                <span>Taxa de entrega</span>
                <span className="font-mono tabular-nums">+ {formatCurrency(deliveryFee)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-[#E2E8F0] flex justify-between items-center text-sm font-extrabold text-[#0F2342]">
              <span>Total a pagar</span>
              <span className="text-xl text-[#0F2342] font-black font-mono tabular-nums">
                {formatCurrency(totalAmount)}
              </span>
            </div>
          </div>

          {/* Error notice if submission failed (preserves all data) */}
          {saleError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{saleError}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="space-y-2">
            <button
              onClick={handleFinalizeSale}
              disabled={isSubmitting || cart.length === 0 || (paymentMethod === 'PIX' && (Boolean(posPixError) || !posPixCode))}
              className="w-full min-h-[48px] py-3 px-4 bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.99] disabled:opacity-50"
            >
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span className="tabular-nums">
                {isSubmitting ? 'Registrando venda...' : `Confirmar Venda (${formatCurrency(totalAmount)})`}
              </span>
            </button>

            <button
              type="button"
              onClick={handleClearCart}
              className="w-full py-2 bg-transparent hover:bg-rose-50 text-rose-600 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Esvaziar carrinho</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Toast Banner for Confirmed Sale */}
      {saleSuccessBanner && (
        <div className="fixed top-20 inset-x-0 z-50 max-w-lg mx-auto px-3 sm:px-4 pointer-events-none animate-in slide-in-from-top-4 duration-200">
          <div className="bg-[#0F2342] text-white p-3.5 sm:p-4 rounded-2xl shadow-2xl border border-emerald-400/40 flex items-center justify-between gap-3 pointer-events-auto">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-sm text-white truncate">
                  Venda {saleSuccessBanner.orderNumber} registrada
                </h4>
                <p className="text-[11px] text-slate-300 font-mono tabular-nums truncate">
                  {formatCurrency(saleSuccessBanner.total)} · {saleSuccessBanner.order.paymentStatus === 'PENDENTE' ? 'PIX pendente' : 'Enviado à cozinha'}
                  {saleSuccessBanner.printed ? ' · Impresso' : ' · Não impresso'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {saleSuccessBanner.order.paymentMethod === 'PIX' && saleSuccessBanner.order.pixCode && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(saleSuccessBanner.order.pixCode!);
                    setCopiedPosPix(true);
                    setTimeout(() => setCopiedPosPix(false), 2000);
                  }}
                  className="px-2.5 py-1.5 bg-[#1B365D] hover:bg-[#25477A] text-white rounded-xl text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
                  title="Copiar PIX Copia e Cola do Pedido"
                >
                  {copiedPosPix ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{copiedPosPix ? 'Copiado' : 'PIX'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => thermalPrinterService.printOrder(saleSuccessBanner.order, { forceReprint: true })}
                className="px-2.5 sm:px-3 py-1.5 bg-[#EA580C] hover:bg-[#C2410C] text-white rounded-xl text-xs font-bold transition flex items-center gap-1 whitespace-nowrap cursor-pointer"
                title="Imprimir Cupom Térmico 58mm"
              >
                <Printer className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">
                  {saleSuccessBanner.printed ? 'Reimprimir Cupom' : 'Imprimir Cupom'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSaleSuccessBanner(null)}
                className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Operational Sub-Header & Tabs */}
      <div className="bg-white rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 border border-[#E2E8F0] shadow-xs flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-lg font-extrabold text-[#0F2342] tracking-tight">
              PDV Balcão
            </h2>
            <span className="text-slate-300 hidden sm:inline" aria-hidden="true">·</span>
            <span className="text-xs text-[#475569] truncate">
              Operador: <strong className="text-[#0F2342] font-semibold">{operatorName}</strong>
            </span>
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
            {cashSyncState.status === 'SYNCING' || cashSyncState.status === 'IDLE' ? (
              <span className="inline-flex items-center gap-1 font-medium text-[#64748B]">
                <Clock className="w-3.5 h-3.5 text-[#EA580C] animate-pulse shrink-0" />
                Sincronizando caixa...
              </span>
            ) : cashSyncState.status === 'ERROR' ? (
              <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Falha ao sincronizar caixa
              </span>
            ) : currentShift && currentShift.status === 'ABERTO' ? (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Caixa aberto
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Caixa fechado
              </span>
            )}
          </div>
        </div>

        {/* View mode toggle & quick actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Discreet Thermal Printer Quick Access */}
          {printerStatus.reconnecting || isPrinterQuickBusy ? (
            <button
              type="button"
              disabled
              className="px-2.5 sm:px-3 py-1.5 bg-amber-50 text-amber-800 text-xs font-semibold rounded-xl border border-amber-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-wait"
              title="Conectando impressora Bluetooth..."
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-600 animate-spin shrink-0" />
              <span>Conectando...</span>
            </button>
          ) : printerStatus.mode !== 'bluetooth_ble' ? (
            <button
              type="button"
              onClick={handleExplicitBlePair}
              disabled={printerStatus.isPrinting}
              className="px-2.5 sm:px-3 py-1.5 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] text-xs font-semibold rounded-xl border border-[#E2E8F0] transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
              title={
                printerStatus.mode === 'android_rawbt'
                  ? 'Modo atual: Android RawBT · Clique para parear impressora via Bluetooth (BLE)'
                  : 'Modo atual: Spooler do Sistema · Clique para parear impressora via Bluetooth (BLE)'
              }
            >
              <Bluetooth className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
              <span>{printerStatus.mode === 'android_rawbt' ? 'RawBT · Parear' : 'Parear Bluetooth'}</span>
            </button>
          ) : printerStatus.connected ? (
            <button
              type="button"
              onClick={handleQuickPrinterClick}
              disabled={printerStatus.isPrinting}
              className="px-2.5 sm:px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-800 text-xs font-semibold rounded-xl border border-emerald-200 transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-70"
              title={`Impressora conectada: ${printerStatus.deviceName || 'Térmica 58mm'}`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
              <Printer className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>Impressora</span>
            </button>
          ) : printerStatus.hasSavedDevice ? (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={handleQuickPrinterClick}
                disabled={printerStatus.isPrinting}
                className="px-2.5 sm:px-3 py-1.5 bg-[#FFF7ED] hover:bg-[#FFEDD5] text-[#C2410C] text-xs font-semibold rounded-xl border border-[#FED7AA] transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
                title={`Reconectar impressora salva (${printerStatus.deviceName || 'Térmica 58mm'})`}
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                <span>Reconectar</span>
              </button>
              <button
                type="button"
                onClick={handleExplicitBlePair}
                disabled={printerStatus.isPrinting}
                className="px-2.5 py-1.5 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] text-xs font-semibold rounded-xl border border-[#E2E8F0] transition inline-flex items-center gap-1 whitespace-nowrap cursor-pointer disabled:opacity-60"
                title="Abrir seletor Bluetooth para parear impressora"
              >
                <Bluetooth className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                <span>Parear</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleExplicitBlePair}
              disabled={printerStatus.isPrinting}
              className="px-2.5 sm:px-3 py-1.5 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] text-xs font-semibold rounded-xl border border-[#E2E8F0] transition inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-60"
              title="Parear impressora térmica Bluetooth"
            >
              <Bluetooth className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
              <span>Parear impressora</span>
            </button>
          )}

          {onNavigateToCaixa && (
            <button
              type="button"
              onClick={onNavigateToCaixa}
              className="px-3 py-1.5 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] text-xs font-semibold rounded-xl border border-[#E2E8F0] transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Banknote className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
              <span>Fluxo do Caixa</span>
            </button>
          )}

          {activeTab === 'vendas' && (
            <button
              type="button"
              onClick={() => setIsCartDrawerOpen(true)}
              className="lg:hidden px-3 py-1.5 bg-[#FFF7ED] hover:bg-[#FFEDD5] text-[#EA580C] text-xs font-bold rounded-xl border border-[#FED7AA] transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              title="Abrir comanda da venda"
            >
              <Receipt className="w-3.5 h-3.5 shrink-0" />
              <span className="tabular-nums">Comanda ({totalCartCount})</span>
            </button>
          )}

          <div className="flex p-1 bg-[#F1F5F9] rounded-xl border border-[#E2E8F0] text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('vendas')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'vendas'
                  ? 'bg-[#0F2342] text-white shadow-2xs'
                  : 'text-[#475569] hover:text-[#0F2342]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 shrink-0" />
              <span>Nova Venda</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('historico')}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeTab === 'historico'
                  ? 'bg-[#0F2342] text-white shadow-2xs'
                  : 'text-[#475569] hover:text-[#0F2342]'
              }`}
            >
              <History className="w-3.5 h-3.5 shrink-0" />
              <span className="tabular-nums">Histórico ({orders.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Discreet Printer Quick-Action Feedback */}
      {printerQuickNotice && (
        <div
          className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-2.5 flex-wrap ${
            printerQuickNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : printerQuickNotice.type === 'info'
              ? 'bg-[#F8FAFC] border-[#E2E8F0] text-[#0F2342]'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {printerQuickNotice.type === 'success' || printerQuickNotice.type === 'info' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium leading-snug">{printerQuickNotice.message}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {printerQuickNotice.offerRepair && !printerStatus.connected && (
              <button
                type="button"
                onClick={handleExplicitBlePair}
                disabled={printerStatus.reconnecting || isPrinterQuickBusy || printerStatus.isPrinting}
                className="px-2.5 py-1 bg-[#EA580C] hover:bg-[#C2410C] text-white rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                Parear novamente
              </button>
            )}
            <button
              type="button"
              onClick={() => setPrinterQuickNotice(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-[#0F2342] transition cursor-pointer"
              aria-label="Fechar aviso da impressora"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {activeTab === 'vendas' ? (
        /* MAIN PDV INTERFACE: PRODUCTS + SALE CART */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: PRODUCT SEARCH & CATALOG (7 COLS ON DESKTOP, FULL WIDTH ON MOBILE/TABLET) */}
          <div className="lg:col-span-7 space-y-3.5">
            {/* Search Bar, Selection Mode & Category Filter */}
            <div className="bg-white rounded-2xl p-3 sm:p-3.5 border border-[#E2E8F0] shadow-xs space-y-2.5">
              {/* Row 1: Compact Search + Clear Mode Toggle */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar produto por nome ou descrição..."
                    className="w-full min-h-[40px] pl-9 pr-8 py-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-[#0F2342] rounded-lg cursor-pointer"
                      aria-label="Limpar busca"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Selection Mode Selector: Cardápio vs 1-Clique */}
                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                  <span className="text-[11px] font-semibold text-[#64748B] flex items-center gap-1 sm:hidden">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-[#EA580C]" />
                    Modo de toque:
                  </span>
                  <div
                    className="inline-flex p-0.5 bg-[#F1F5F9] rounded-xl border border-[#E2E8F0] text-xs font-semibold shrink-0"
                    role="group"
                    aria-label="Modo de inclusão de produtos"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectionMode('cardapio')}
                      title="Abre opções de adicionais, quantidade e observações ao clicar"
                      className={`min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                        selectionMode === 'cardapio'
                          ? 'bg-[#0F2342] text-white shadow-2xs'
                          : 'text-[#475569] hover:text-[#0F2342]'
                      }`}
                    >
                      <SlidersHorizontal className={`w-3.5 h-3.5 shrink-0 ${selectionMode === 'cardapio' ? 'text-[#FB923C]' : ''}`} />
                      <span>Cardápio</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectionMode('rapido')}
                      title="Adiciona 1 unidade direto na comanda com um clique"
                      className={`min-h-[34px] px-2.5 sm:px-3 py-1 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                        selectionMode === 'rapido'
                          ? 'bg-[#EA580C] text-white shadow-2xs'
                          : 'text-[#475569] hover:text-[#0F2342]'
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      <span>1-Clique</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Toast feedback when items are added to cart */}
              {cartToastMessage && (
                <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between gap-2 animate-in fade-in">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="truncate">{cartToastMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCartDrawerOpen(true)}
                    className="text-[11px] text-emerald-900 hover:underline font-bold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Ver comanda ({totalCartCount}) →
                  </button>
                </div>
              )}

              {/* Horizontal Category Navigation */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-[#0F2342] text-white shadow-2xs'
                        : 'bg-[#F8FAFC] text-[#475569] hover:text-[#0F2342] hover:bg-[#F1F5F9] border border-[#E2E8F0]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Products Grid */}
            {filteredItems.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center space-y-2">
                <Search className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="text-sm font-bold text-[#0F2342]">Nenhum produto encontrado</p>
                <p className="text-xs text-[#64748B]">Tente outro termo ou selecione outra categoria.</p>
                {(searchQuery || selectedCategory !== 'TODOS') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('TODOS');
                    }}
                    className="mt-2 px-3.5 py-2 bg-[#0F2342] text-white text-xs font-semibold rounded-xl hover:bg-[#1B365D] transition cursor-pointer"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className="bg-white rounded-2xl border border-[#E2E8F0] hover:border-[#EA580C]/70 overflow-hidden flex flex-col justify-between transition cursor-pointer shadow-2xs hover:shadow-sm group active:scale-[0.98]"
                  >
                    <div>
                      <div className="relative w-full aspect-[16/10] bg-[#F1F5F9] overflow-hidden">
                        <img
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          loading="lazy"
                        />
                        {item.featured && (
                          <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#EA580C] text-white shadow-xs">
                            Destaque
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 sm:p-3 pb-1.5">
                        <h4 className="font-bold text-xs sm:text-[13px] text-[#0F2342] leading-snug line-clamp-2 group-hover:text-[#EA580C] transition">
                          {item.name}
                        </h4>
                        {item.description && (
                          <p className="text-[11px] text-[#64748B] line-clamp-1 sm:line-clamp-2 mt-0.5 leading-relaxed">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="px-2.5 sm:px-3 pb-2.5 sm:pb-3 pt-2 flex items-center justify-between gap-2">
                      <span className="font-extrabold text-sm sm:text-[15px] text-[#0F2342] font-mono tabular-nums">
                        {formatCurrency(item.price)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Adicionar ${item.name}`}
                        className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA] group-hover:bg-[#EA580C] group-hover:text-white group-hover:border-[#EA580C] flex items-center justify-center transition shrink-0 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: DESKTOP SIDE-BY-SIDE SALE / CART / CHECKOUT (HIDDEN ON MOBILE & TABLET TO ELIMINATE DUPLICATION) */}
          <div className="hidden lg:block lg:col-span-5 bg-white rounded-2xl border border-[#E2E8F0] shadow-xs p-4 sm:p-5 space-y-4 sticky top-24">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Receipt className="w-4 h-4 text-[#EA580C] shrink-0" />
                <h3 className="font-bold text-sm text-[#0F2342] truncate">Comanda de Venda</h3>
                <span className="text-xs text-[#64748B] tabular-nums shrink-0">({totalCartCount})</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsCartDrawerOpen(true)}
                  className="px-2.5 py-1 rounded-lg bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] border border-[#E2E8F0] transition flex items-center gap-1 text-[11px] font-semibold cursor-pointer"
                  title="Expandir comanda em gaveta lateral"
                >
                  <Maximize2 className="w-3.5 h-3.5 text-[#EA580C]" />
                  <span>Expandir</span>
                </button>
                {cart.length > 0 && (
                  <button
                    type="button"
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
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs p-4 sm:p-5 space-y-5">
          {/* Metrics summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
              <p className="text-xs text-[#64748B] font-medium">Vendas concluídas</p>
              <p className="text-2xl font-extrabold text-[#0F2342] font-mono tabular-nums mt-1">{historyMetrics.count}</p>
            </div>
            <div className="p-3.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
              <p className="text-xs text-[#64748B] font-medium">Faturamento do período</p>
              <p className="text-2xl font-extrabold text-[#0F2342] font-mono tabular-nums mt-1">{formatCurrency(historyMetrics.totalRev)}</p>
            </div>
            <div className="p-3.5 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
              <p className="text-xs text-[#64748B] font-medium">Ticket médio</p>
              <p className="text-2xl font-extrabold text-[#EA580C] font-mono tabular-nums mt-1">{formatCurrency(historyMetrics.avgTicket)}</p>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-xs font-semibold text-[#475569] shrink-0">Período:</span>
              <div className="inline-flex p-0.5 bg-[#F1F5F9] border border-[#E2E8F0] rounded-xl text-xs font-semibold shrink-0">
                {(['HOJE', 'ONTEM', '7DIAS', 'TODOS'] as const).map((period) => (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setHistoryPeriod(period)}
                    className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition cursor-pointer ${
                      historyPeriod === period
                        ? 'bg-[#0F2342] text-white shadow-2xs'
                        : 'text-[#475569] hover:text-[#0F2342]'
                    }`}
                  >
                    {period === 'HOJE' ? 'Hoje' : period === 'ONTEM' ? 'Ontem' : period === '7DIAS' ? '7 Dias' : 'Todos'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <select
                value={historyPaymentFilter}
                onChange={(e) => setHistoryPaymentFilter(e.target.value)}
                className="min-h-[38px] px-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs font-semibold text-[#0F2342] focus:outline-none focus:border-[#EA580C]"
              >
                <option value="TODOS">Todas as formas</option>
                <option value="DINHEIRO">Dinheiro</option>
                <option value="PIX">PIX</option>
                <option value="CARTAO_DEBITO">Cartão de Débito</option>
                <option value="CARTAO_CREDITO">Cartão de Crédito</option>
              </select>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Buscar pedido ou cliente..."
                  className="w-full sm:w-56 min-h-[38px] pl-8 pr-3 py-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-xs text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#EA580C]"
                />
              </div>
            </div>
          </div>

          {/* MOBILE HISTORY CARDS (NO HORIZONTAL SCROLL) */}
          <div className="md:hidden space-y-2.5">
            {filteredHistoryOrders.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#64748B] bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
                Nenhuma venda encontrada para os filtros selecionados.
              </div>
            ) : (
              filteredHistoryOrders.map((order) => {
                const isCancelled = order.status === 'CANCELADO';
                return (
                  <div
                    key={order.id}
                    className={`p-3.5 rounded-xl border space-y-2.5 transition ${
                      isCancelled
                        ? 'bg-rose-50/40 border-rose-200/80 opacity-80'
                        : 'bg-[#F8FAFC] border-[#E2E8F0]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono tabular-nums font-extrabold text-sm text-[#0F2342]">
                            {order.orderNumber}
                          </span>
                          <span className="text-[11px] text-[#64748B] font-mono tabular-nums">
                            {formatTime(order.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-[#0F2342] truncate mt-0.5">
                          {order.customer.name}
                          <span className="font-normal text-[#64748B]">
                            {' '}· {order.fulfillmentType === 'RETIRADA' ? 'Retirada' : 'Delivery'}
                          </span>
                        </p>
                      </div>
                      <span
                        className={`text-[11px] font-bold shrink-0 ${
                          isCancelled ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {isCancelled ? 'Cancelado' : order.status}
                      </span>
                    </div>

                    <p className="text-xs text-[#475569] leading-relaxed">
                      {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                    </p>

                    <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-[11px] text-[#475569] font-medium">
                          {getPaymentMethodLabel(order.paymentMethod)} ·{' '}
                          <span className={order.paymentStatus === 'PAGO' ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                            {order.paymentStatus === 'PAGO' ? 'Pago' : 'Pendente'}
                          </span>
                        </p>
                        <p className="text-base font-extrabold font-mono tabular-nums text-[#0F2342]">
                          {formatCurrency(order.totalAmount)}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePrintReceipt(order)}
                          title="Reimprimir Comprovante Térmico do Pedido"
                          className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-white hover:bg-[#F1F5F9] text-[#0F2342] border border-[#E2E8F0] text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Imprimir</span>
                        </button>
                        {order.refundInfo && (
                          <button
                            type="button"
                            onClick={() => thermalPrinterService.printRefundReceipt(order)}
                            title="Reimprimir Comprovante de Estorno (58mm)"
                            className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Estorno</span>
                          </button>
                        )}
                        {!isCancelled && (
                          <button
                            type="button"
                            onClick={() => handleOpenCancelModal(order)}
                            title="Cancelar Venda (Permissão & Motivo)"
                            className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancelar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* DESKTOP / TABLET FULL ORDERS TABLE */}
          <div className="hidden md:block border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#475569] font-bold text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Pedido / Hora</th>
                    <th className="py-3 px-4">Cliente / Tipo</th>
                    <th className="py-3 px-4">Itens</th>
                    <th className="py-3 px-4">Pagamento</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filteredHistoryOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[#64748B]">
                        Nenhuma venda encontrada para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredHistoryOrders.map((order) => {
                      const isCancelled = order.status === 'CANCELADO';
                      return (
                        <tr
                          key={order.id}
                          className={`hover:bg-[#F8FAFC] transition ${isCancelled ? 'bg-rose-50/40 opacity-75' : ''}`}
                        >
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="font-mono tabular-nums font-bold text-[#0F2342] block">{order.orderNumber}</span>
                            <span className="text-[11px] font-mono tabular-nums text-[#64748B]">{formatTime(order.createdAt)}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-[#0F2342] block">{order.customer.name}</span>
                            <span className="text-[11px] text-[#64748B]">
                              {order.fulfillmentType === 'RETIRADA' ? 'Balcão / Retirada' : 'Delivery'}
                            </span>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <p className="truncate text-[#334155]">
                              {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                            </p>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="font-semibold text-[#0F2342] block">
                              {getPaymentMethodLabel(order.paymentMethod)}
                            </span>
                            <span className={`text-[11px] font-bold ${
                              order.paymentStatus === 'PAGO'
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                            }`}>
                              {order.paymentStatus === 'PAGO' ? 'Pago' : 'Pendente'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-extrabold text-[#0F2342] whitespace-nowrap">
                            {formatCurrency(order.totalAmount)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`text-xs font-bold ${
                                isCancelled
                                  ? 'text-rose-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {isCancelled ? 'Cancelado' : order.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap space-x-1">
                            <button
                              type="button"
                              onClick={() => handlePrintReceipt(order)}
                              title="Reimprimir Comprovante Térmico do Pedido"
                              className="p-2 rounded-lg bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#0F2342] border border-[#E2E8F0] transition cursor-pointer"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            {order.refundInfo && (
                              <button
                                type="button"
                                onClick={() => thermalPrinterService.printRefundReceipt(order)}
                                title="Reimprimir Comprovante de Estorno (58mm)"
                                className="p-2 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 transition cursor-pointer"
                              >
                                <AlertCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!isCancelled && (
                              <button
                                type="button"
                                onClick={() => handleOpenCancelModal(order)}
                                title="Cancelar Venda (Permissão & Motivo)"
                                className="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/70 transition cursor-pointer"
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

      {/* MOBILE / TABLET FIXED BOTTOM CART BAR (PRIMARY ACCESS TO DRAWER WITHOUT DUPLICATING CART BELOW PRODUCTS) */}
      {activeTab === 'vendas' && cart.length > 0 && (
        <aside aria-label="Acesso Rápido à Comanda" className="lg:hidden fixed bottom-3 left-3 right-3 sm:left-5 sm:right-5 z-40 animate-in slide-in-from-bottom-3">
          <button
            type="button"
            onClick={() => setIsCartDrawerOpen(true)}
            className="w-full min-h-[54px] bg-[#0F2342] hover:bg-[#1B365D] text-white px-3.5 py-2.5 rounded-2xl shadow-xl flex items-center justify-between gap-3 border border-white/15 active:scale-[0.98] transition cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#EA580C] text-white flex items-center justify-center shrink-0 font-mono tabular-nums font-extrabold text-sm">
                {totalCartCount}
              </div>
              <div className="text-left min-w-0">
                <span className="block text-[11px] text-slate-300 leading-tight">Comanda da venda</span>
                <span className="font-bold text-sm text-white block truncate">Ver e finalizar</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 bg-[#EA580C] px-3 py-1.5 rounded-xl shrink-0">
              <span className="text-sm font-extrabold text-white font-mono tabular-nums">{formatCurrency(totalAmount)}</span>
              <ChevronRight className="w-4 h-4 text-white shrink-0" />
            </div>
          </button>
        </aside>
      )}

      {/* SLIDE-OVER CART DRAWER */}
      {isCartDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#0F2342]/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md sm:max-w-lg bg-white h-full shadow-2xl flex flex-col border-l border-[#E2E8F0] animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="bg-[#0F2342] text-white px-4 py-3.5 flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-2.5 min-w-0">
                <Receipt className="w-5 h-5 text-[#FB923C] shrink-0" />
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-white truncate">Comanda de Venda</h3>
                  <p className="text-[11px] text-slate-300 tabular-nums">{totalCartCount} item(s) selecionado(s)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCartDrawerOpen(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition cursor-pointer"
                title="Fechar comanda"
                aria-label="Fechar comanda"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cart Body */}
            <div className="flex-1 overflow-y-auto p-4 pb-8 space-y-4">
              {renderCartSection(true)}
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMIZE ADDONS, QUANTITY & NOTES MODAL */}
      {selectedItemForAddons && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-[#0F2342]/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-[#E2E8F0] shadow-2xl overflow-hidden">
            <div className="bg-[#0F2342] text-white px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[11px] font-semibold text-[#FB923C] block truncate">
                  {selectedItemForAddons.category}
                </span>
                <h3 className="font-bold text-base sm:text-lg text-white leading-snug truncate">
                  {selectedItemForAddons.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItemForAddons(null)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition shrink-0 cursor-pointer"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 max-h-[78vh] overflow-y-auto">
              {/* Product preview banner */}
              <div className="flex items-center gap-3.5 p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
                <img
                  src={selectedItemForAddons.imageUrl}
                  alt={selectedItemForAddons.name}
                  className="w-18 h-18 sm:w-20 sm:h-20 rounded-xl object-cover border border-[#E2E8F0] shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[#475569] line-clamp-2 leading-relaxed">
                    {selectedItemForAddons.description}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs">
                    <span className="font-extrabold text-[#0F2342] text-base font-mono tabular-nums">
                      {formatCurrency(selectedItemForAddons.price)}
                    </span>
                    <span className="text-[11px] text-[#64748B] flex items-center gap-1 font-medium">
                      <Clock className="w-3.5 h-3.5 text-[#EA580C]" />
                      <span className="tabular-nums">~{selectedItemForAddons.prepTimeMinutes} min</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Quantity selector */}
              <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-[#E2E8F0]">
                <div>
                  <span className="text-xs font-bold text-[#0F2342] block">Quantidade</span>
                  <span className="text-[11px] text-[#64748B]">Ajuste para este lançamento</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setModalQuantity(Math.max(1, modalQuantity - 1))}
                    className="w-10 h-10 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-[#F1F5F9] flex items-center justify-center text-[#0F2342] transition cursor-pointer"
                    aria-label="Diminuir quantidade"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="font-extrabold text-lg text-[#0F2342] w-8 text-center font-mono tabular-nums">
                    {modalQuantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalQuantity(modalQuantity + 1)}
                    className="w-10 h-10 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] hover:bg-[#F1F5F9] flex items-center justify-center text-[#0F2342] transition cursor-pointer"
                    aria-label="Aumentar quantidade"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Addons List */}
              {selectedItemForAddons.addons && selectedItemForAddons.addons.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-[#0F2342]">
                    Adicionais opcionais
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedItemForAddons.addons.map((addon) => {
                      const isSelected = tempAddons.some((a) => a.id === addon.id);
                      return (
                        <label
                          key={addon.id}
                          className={`min-h-[42px] flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                            isSelected
                              ? 'bg-[#FFF7ED] border-[#EA580C] text-[#0F2342] font-bold'
                              : 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
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
                              className="w-4 h-4 rounded accent-[#EA580C] shrink-0"
                            />
                            <span className="truncate">{addon.name}</span>
                          </div>
                          <span className="font-bold text-[#0F2342] font-mono tabular-nums shrink-0">
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
                <label className="block text-xs font-bold text-[#0F2342] mb-1.5">
                  Observações para a cozinha
                </label>
                <input
                  type="text"
                  value={tempNotes}
                  onChange={(e) => setTempNotes(e.target.value)}
                  placeholder="Ex: sem cebola, ovo bem passado, manteiga à parte"
                  className="w-full min-h-[42px] px-3 py-2 bg-white border border-[#CBD5E1] rounded-xl text-xs text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C] focus:ring-2 focus:ring-[#EA580C]/20 transition"
                />
              </div>

              {/* Total calculation & Add to cart button */}
              <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between gap-3">
                <div>
                  <span className="text-[11px] text-[#64748B] block">Total do item ({modalQuantity}x)</span>
                  <span className="text-xl font-black text-[#0F2342] font-mono tabular-nums">
                    {formatCurrency(
                      (selectedItemForAddons.price + tempAddons.reduce((s, a) => s + a.price, 0)) * modalQuantity
                    )}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={confirmCustomItemAdd}
                  className="min-h-[44px] px-5 py-2.5 bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-xs sm:text-sm shadow-sm transition cursor-pointer active:scale-95 flex items-center gap-2 whitespace-nowrap"
                >
                  <ShoppingBag className="w-4 h-4 shrink-0" />
                  <span>Adicionar à comanda</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SALE COMPLETED SUCCESS MODAL */}
      {completedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2342]/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div>
              <p className="text-xs font-bold text-emerald-700">Venda registrada com sucesso</p>
              <h3 className="text-2xl font-black text-[#0F2342] mt-1 font-mono tabular-nums">
                Pedido {completedOrder.orderNumber}
              </h3>
              <p className="text-xs text-[#475569] mt-1">
                Valor: <strong className="text-[#0F2342] font-mono tabular-nums">{formatCurrency(completedOrder.totalAmount)}</strong> · {getPaymentMethodLabel(completedOrder.paymentMethod)}
              </p>

              <div className="mt-2.5 flex items-center justify-center">
                {completedOrder._cloudSyncStatus === 'SYNCED' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Sincronizado no Cloud Firestore</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                    <Clock className="w-3.5 h-3.5 animate-pulse" />
                    <span>Salvo no caixa · Fila de sincronização ativa</span>
                  </span>
                )}
              </div>
            </div>

            <p className="text-xs text-[#475569] bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
              O pedido foi enviado para a <strong>Cozinha / KDS</strong> e computado no saldo do caixa.
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => thermalPrinterService.printOrder(completedOrder, { forceReprint: true })}
                className="flex-1 min-h-[42px] py-2.5 px-3 bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-xs whitespace-nowrap cursor-pointer"
                title="Imprimir comprovante formatado para impressora térmica de 58 mm via Bluetooth"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span>Térmica 58mm</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintReceipt(completedOrder)}
                className="min-h-[42px] py-2.5 px-3 bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#E2E8F0] text-[#0F2342] font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition whitespace-nowrap cursor-pointer"
                title="Imprimir Comanda Completa no Spooler / A4"
              >
                <FileText className="w-4 h-4 text-[#64748B] shrink-0" />
                <span>Spooler A4</span>
              </button>

              <button
                type="button"
                onClick={() => setCompletedOrder(null)}
                className="flex-1 min-h-[42px] py-2.5 px-3 bg-[#0F2342] hover:bg-[#1B365D] text-white font-bold rounded-xl text-xs transition whitespace-nowrap cursor-pointer"
              >
                Nova Venda
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANCELLATION MODAL (WITH MANDATORY REASON) */}
      {orderToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0F2342]/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-[#0F2342]">Cancelar Venda</h3>
                <p className="text-xs text-[#64748B] font-mono tabular-nums truncate">
                  Pedido {orderToCancel.orderNumber} · {formatCurrency(orderToCancel.totalAmount)}
                </p>
              </div>
            </div>

            {/* Financial Details Preview */}
            <div className={`p-3.5 rounded-xl text-xs space-y-1.5 border ${
              orderToCancel.paymentStatus === 'PAGO'
                ? 'bg-amber-50/70 border-amber-200 text-[#0F2342]'
                : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#334155]'
            }`}>
              <div className="flex justify-between items-center font-bold">
                <span>Valor do pedido</span>
                <span className="text-sm font-mono tabular-nums text-rose-700">{formatCurrency(orderToCancel.totalAmount)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#475569]">Status de pagamento</span>
                <span className={`font-bold text-xs ${
                  orderToCancel.paymentStatus === 'PAGO' ? 'text-emerald-700' : 'text-amber-800'
                }`}>
                  {orderToCancel.paymentStatus === 'PAGO' ? 'Pago' : 'Não pago (pendente)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#475569]">Forma</span>
                <span className="font-semibold text-[#0F2342]">{getPaymentMethodLabel(orderToCancel.paymentMethod)}</span>
              </div>

              {orderToCancel.paymentStatus === 'PAGO' ? (
                <div className="pt-2 border-t border-amber-200/80 text-[11px] leading-relaxed">
                  {orderToCancel.paymentMethod === 'DINHEIRO' ? (
                    <p className="text-rose-900 font-medium">
                      <strong>Gaveta de dinheiro:</strong> o cancelamento registrará devolução de {formatCurrency(orderToCancel.totalAmount)} e <strong>subtrairá o valor físico da gaveta</strong> do caixa aberto.
                    </p>
                  ) : orderToCancel.paymentMethod === 'PIX' ? (
                    <p className="text-[#0F2342] font-medium">
                      <strong>Devolução PIX:</strong> o cancelamento registrará a devolução bancária PIX e <strong>não alterará o saldo da gaveta física</strong>.
                    </p>
                  ) : (
                    <p className="text-[#0F2342] font-medium">
                      <strong>Estorno cartão:</strong> o estorno será registrado para conciliação das vendas via maquininha.
                    </p>
                  )}
                </div>
              ) : (
                <p className="pt-2 border-t border-[#E2E8F0] text-[11px] text-[#64748B]">
                  Pedido sem recebimento prévio. Não haverá estorno financeiro no caixa.
                </p>
              )}
            </div>

            {cancelError && (
              <p className="text-xs text-rose-700 font-semibold bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                {cancelError}
              </p>
            )}

            <div>
              <label className="block text-xs font-bold text-[#0F2342] mb-1.5">
                Motivo do cancelamento <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ex: Erro ao digitar valor, desistência do cliente, troca de forma de pagamento..."
                rows={3}
                className="w-full p-2.5 bg-white border border-[#CBD5E1] rounded-xl text-xs text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15"
                autoFocus
              />
            </div>

            <p className="text-[11px] text-[#64748B] bg-[#F8FAFC] p-2.5 rounded-xl border border-[#E2E8F0]">
              Operador responsável: <strong className="text-[#0F2342]">{operatorName}</strong>. Um comprovante de estorno para auditoria será gerado automaticamente.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={isCancellingOrder}
                onClick={() => setOrderToCancel(null)}
                className="flex-1 min-h-[42px] py-2.5 bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F2342] font-semibold rounded-xl text-xs border border-[#E2E8F0] disabled:opacity-50 transition cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={isCancellingOrder}
                onClick={handleExecuteCancelSale}
                className="flex-1 min-h-[42px] py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs"
              >
                {isCancellingOrder ? 'Cancelando...' : 'Confirmar Cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRINTABLE RECEIPT TEMPLATE (80mm) */}
      {printableOrder && (
        <div id="printable-receipt" className="hidden font-mono text-[11px] leading-[1.12] text-black">
          <div className="text-center pb-1 border-b border-dashed border-black">
            <h2 className="font-extrabold text-[13px]">{config.name} - Tradição & Afeto Artesanal</h2>
            <p className="text-[10px]">{config.address} | TEL: {config.phone}</p>
          </div>

          <div className="py-1 border-b border-dashed border-black">
            <p className="font-bold text-[12px]">CUPOM NÃO FISCAL - PEDIDO {printableOrder.orderNumber}</p>
            <p>DATA: {formatDateTime(printableOrder.createdAt)} | OP: {operatorName}</p>
            <p>CLIENTE: {printableOrder.customer.name}{printableOrder.customer.phone ? ` | TEL: ${printableOrder.customer.phone}` : ''}</p>
            <p>TIPO: {printableOrder.fulfillmentType === 'RETIRADA' ? 'BALCÃO / RETIRADA' : 'DELIVERY'}</p>
            {printableOrder.fulfillmentType === 'DELIVERY' && printableOrder.customer.address && (() => {
              const addr = formatAddressDetails(printableOrder.customer.address);
              return (
                <div>
                  <p className="font-bold">ENTREGA: {addr.primaryLine}</p>
                  {addr.secondaryLine && <p>{addr.secondaryLine}</p>}
                  {addr.referenceLine && (
                    <p className="text-[10px] italic">REF: {addr.referenceLine}</p>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="py-1 border-b border-dashed border-black space-y-0.5">
            <div className="flex justify-between font-bold border-b border-dotted border-black pb-0.5">
              <span>QTD ITEM</span>
              <span>TOTAL</span>
            </div>
            {printableOrder.items.map((i) => (
              <div key={i.id} className="text-[11px]">
                <div className="flex justify-between font-semibold">
                  <span>{i.quantity}x {i.name}</span>
                  <span>{formatCurrency(i.subtotal)}</span>
                </div>
                {i.addons && i.addons.length > 0 && (
                  <p className="text-[10px] pl-1.5">+ {i.addons.map((a) => a.name).join(', ')}</p>
                )}
                {i.notes && <p className="text-[10px] pl-1.5 italic">Obs: {i.notes}</p>}
              </div>
            ))}
          </div>

          <div className="py-1 border-b border-dashed border-black">
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
            <div className="flex justify-between font-extrabold text-[13px] pt-0.5 mt-0.5 border-t border-black">
              <span>TOTAL:</span>
              <span>{formatCurrency(printableOrder.totalAmount)}</span>
            </div>
            <div className="flex justify-between pt-0.5">
              <span>PAGAMENTO:</span>
              <span>{getPaymentMethodLabel(printableOrder.paymentMethod)}</span>
            </div>
            {printableOrder.paymentChangeFor && printableOrder.paymentChangeFor > printableOrder.totalAmount && (
              <div className="flex justify-between font-bold text-[11px]">
                <span>PAGO EM DINHEIRO: {formatCurrency(printableOrder.paymentChangeFor)}</span>
                <span>TROCO: {formatCurrency(printableOrder.paymentChangeFor - printableOrder.totalAmount)}</span>
              </div>
            )}
          </div>

          <div className="text-center pt-1 text-[10.5px]">
            <p>Agradecemos a preferência! <span className="font-bold">Amandita Sabores</span></p>
          </div>
        </div>
      )}
    </div>
  );
};
