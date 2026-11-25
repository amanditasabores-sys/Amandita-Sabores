import React, { useState, useEffect, useRef } from 'react';
import { store } from '../../services/store';
import { Order } from '../../types';
import { formatCurrency, formatTime, getPaymentMethodLabel, formatAddressDetails, getFortalezaDateKey } from '../../utils/formatters';
import { 
  Bike, 
  QrCode, 
  Camera, 
  MapPin, 
  Phone, 
  MessageSquare, 
  Navigation, 
  CheckCircle, 
  ExternalLink, 
  Search, 
  X,
  UserCheck,
  RotateCcw,
  LogOut,
  ArrowLeft,
  Shield,
  ShieldCheck,
  AlertCircle,
  AlertTriangle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { User } from '../../types';
import { AmanditaLogo } from '../common/AmanditaLogo';
import { DeliverySupervisorDashboard } from './DeliverySupervisorDashboard';
import { DriverReadyOrderAlert } from './DriverReadyOrderAlert';

interface DeliveryPortalProps {
  initialOrderId?: string;
  currentUser?: User | null;
  adminUser?: User | null;
  onLogout?: () => void;
  onBackToAdmin?: () => void;
}

export const DeliveryPortal: React.FC<DeliveryPortalProps> = ({ 
  initialOrderId, 
  currentUser,
  adminUser,
  onLogout,
  onBackToAdmin
}) => {
  const permissions = store.getDeliveryPermissions(currentUser);
  const isSupervisor = Boolean(
    adminUser || 
    currentUser?.role === 'ADMINISTRADOR' || 
    currentUser?.role === 'GERENTE' || 
    currentUser?.username === 'admin' ||
    permissions.canViewDeliveryDashboard
  );
  const isDriverRole = currentUser?.role === 'ENTREGADOR';

  // 1. COMPORTAMENTO DO ADMINISTRADOR / SUPERVISOR:
  // Se for Administrador, Gerente ou usuário autorizado na supervisão (e não um entregador individual),
  // entra AUTOMATICAMENTE no Painel de Supervisão Geral, e NUNCA no painel individual de motorista!
  if (isSupervisor && !isDriverRole) {
    return (
      <DeliverySupervisorDashboard
        currentUser={currentUser}
        adminUser={adminUser}
        onBackToAdmin={onBackToAdmin}
        onLogout={onLogout}
        initialOrderId={initialOrderId}
      />
    );
  }

  const [driverName, setDriverName] = useState(() => {
    return currentUser?.name || currentUser?.username || 'Entregador Autorizado';
  });

  const [driverPhone, setDriverPhone] = useState(() => {
    return currentUser?.phone || '';
  });

  // Keep state strictly in sync with authenticated user
  useEffect(() => {
    if (currentUser) {
      setDriverName(currentUser.name || currentUser.username);
      setDriverPhone(currentUser.phone || '');
    }
  }, [currentUser]);

  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [readyOrders, setReadyOrders] = useState<Order[]>([]);
  const [deliveredOrders, setDeliveredOrders] = useState<Order[]>([]);
  const [deliveredCount, setDeliveredCount] = useState(0);
  const [deliveryTab, setDeliveryTab] = useState<'pendentes' | 'concluidas'>('pendentes');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ type: 'error' | 'warning'; message: string } | null>(null);

  // Scanner state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scannerStatus, setScannerStatus] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadData = () => {
    const orders = store.getOrders();
    const currentDriverId = currentUser?.id;
    const cleanCurrentDriver = (driverName || '').toLowerCase().replace(/entregador\s*/g, '').trim();

    // Orders ready or in transit (pending delivery completion) - STRICTLY DELIVERY ONLY
    const ready = orders.filter((o) => {
      if (o.status !== 'PRONTO' && o.status !== 'EM_ROTA') return false;
      if (o.fulfillmentType !== 'DELIVERY') return false; // Never show Retirada no Balcão

      // When logged in as delivery driver, show only own assigned deliveries or unassigned ready deliveries
      if (isDriverRole) {
        if (o.deliveryPerson) {
          const isSameId = currentDriverId && (o.deliveryPerson.id === currentDriverId || o.deliveryPerson.id === `driver-${currentDriverId}`);
          const cleanOrderDriver = (o.deliveryPerson.name || '').toLowerCase().replace(/entregador\s*/g, '').trim();
          const isSameName = cleanOrderDriver && (
            cleanOrderDriver === cleanCurrentDriver ||
            cleanOrderDriver.includes(cleanCurrentDriver) ||
            cleanCurrentDriver.includes(cleanOrderDriver)
          );
          return Boolean(isSameId || isSameName);
        }
        // Unassigned PRONTO deliveries can be accepted by driver
        return o.status === 'PRONTO';
      }

      return true;
    });
    setReadyOrders(ready);

    // Delivered deliveries (completed by this driver) - STRICTLY DELIVERY ONLY
    const done = orders.filter((o) => {
      if (o.status !== 'ENTREGUE') return false;
      if (o.fulfillmentType !== 'DELIVERY') return false;
      if (isDriverRole) {
        if (!o.deliveryPerson) return false;
        const isSameId = currentDriverId && (o.deliveryPerson.id === currentDriverId || o.deliveryPerson.id === `driver-${currentDriverId}`);
        const cleanOrderDriver = (o.deliveryPerson.name || '').toLowerCase().replace(/entregador\s*/g, '').trim();
        const isSameName = cleanOrderDriver && (
          cleanOrderDriver === cleanCurrentDriver ||
          cleanOrderDriver.includes(cleanCurrentDriver) ||
          cleanCurrentDriver.includes(cleanOrderDriver)
        );
        return Boolean(isSameId || isSameName);
      }
      return true;
    });

    const todayKey = getFortalezaDateKey();
    const doneToday = done.filter((o) => {
      const refDate = o.deliveryPerson?.deliveredAt || o.updatedAt || o.createdAt;
      return getFortalezaDateKey(refDate) === todayKey;
    });

    setDeliveredOrders(done);
    setDeliveredCount(doneToday.length);

    if (activeOrder) {
      const refreshed = store.getOrderById(activeOrder.id);
      if (refreshed && refreshed.fulfillmentType === 'DELIVERY') {
        setActiveOrder(refreshed);
      } else {
        setActiveOrder(null);
      }
    }
  };

  useEffect(() => {
    if (initialOrderId) {
      const ord = store.getOrderById(initialOrderId);
      if (ord && ord.fulfillmentType === 'DELIVERY') {
        setActiveOrder(ord);
      }
    }
    loadData();

    const handleUpdate = () => {
      loadData();
    };

    window.addEventListener('gestaofood_state_changed', handleUpdate);
    return () => {
      window.removeEventListener('gestaofood_state_changed', handleUpdate);
      stopCamera();
    };
  }, [initialOrderId]);

  const handleSelectOrder = (order: Order) => {
    if (order.fulfillmentType !== 'DELIVERY') return;
    setStatusFeedback(null);
    setActiveOrder(order);
    setIsScannerOpen(false);
    stopCamera();
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    const clean = manualCode.trim();
    const found = store.getOrderById(clean);
    if (found && found.fulfillmentType === 'DELIVERY') {
      setActiveOrder(found);
      setManualCode('');
      setIsScannerOpen(false);
      stopCamera();
    } else if (found) {
      setScannerStatus(`O pedido ${found.orderNumber} é para Retirada no Balcão e não requer entrega.`);
    } else {
      setScannerStatus(`Pedido "${clean}" não encontrado. Verifique o número.`);
    }
  };

  // Camera QR scanner simulation / native camera
  const startCamera = async () => {
    setIsScannerOpen(true);
    setScannerStatus('Aponte a câmera para o QR Code impresso no cupom do pedido...');
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }
    } catch {
      setScannerStatus('Câmera não disponível no momento. Digite o código do pedido abaixo ou escolha um da lista.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const handleScanSample = (orderToPick: Order) => {
    setActiveOrder(orderToPick);
    setIsScannerOpen(false);
    stopCamera();
    confetti({ particleCount: 30, spread: 50 });
  };

  // Status transitions
  const handleStartDelivery = async () => {
    if (!activeOrder || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    setStatusFeedback(null);
    try {
      const authorStr = `Entregador ${driverName}`;
      const notesStr = `Entregador ${driverName} retirou o pedido e iniciou o trajeto de entrega.`;
      const res = await store.updateOrderStatusAsync(
        activeOrder.id,
        'EM_ROTA',
        authorStr,
        notesStr
      );
      if (!res.synced) {
        setStatusFeedback({
          type: res.rejected ? 'error' : 'warning',
          message: res.rejected
            ? `Não foi possível iniciar a rota: ${res.error || 'Alteração recusada pelo servidor.'}`
            : `Sem conexão no momento: saída para entrega salva localmente e aguardando sincronização (${res.error || 'Offline'}).`,
        });
      }
      const refreshed = store.getOrderById(activeOrder.id) || res.order;
      if (refreshed) {
        setActiveOrder(refreshed);
        loadData();
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleCompleteDelivery = async () => {
    if (!activeOrder || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    setStatusFeedback(null);
    try {
      const authorStr = `Entregador ${driverName}`;
      const notesStr = `Entrega confirmada pelo entregador ${driverName} no endereço do cliente.`;
      const res = await store.updateOrderStatusAsync(
        activeOrder.id,
        'ENTREGUE',
        authorStr,
        notesStr
      );
      if (!res.synced) {
        setStatusFeedback({
          type: res.rejected ? 'error' : 'warning',
          message: res.rejected
            ? `Não foi possível concluir a entrega: ${res.error || 'Alteração recusada pelo servidor.'}`
            : `Sem conexão no momento: conclusão salva localmente e aguardando envio ao servidor (${res.error || 'Offline'}).`,
        });
      }
      const refreshed = store.getOrderById(activeOrder.id) || res.order;
      if (refreshed) {
        setActiveOrder(refreshed);
        loadData();
        if (res.synced) {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 }
          });
        }
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const formatMapsUrl = (order: Order) => {
    if (!order.customer.address) return '#';
    const details = formatAddressDetails(order.customer.address);
    const query = details.navigationQuery || details.fullSingleLine;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  };

  const formatWazeUrl = (order: Order) => {
    if (!order.customer.address) return '#';
    const details = formatAddressDetails(order.customer.address);
    const query = details.navigationQuery || details.fullSingleLine;
    return `https://waze.com/ul?q=${encodeURIComponent(query)}`;
  };

  const formatWhatsAppUrl = (order: Order) => {
    if (!order.customer.phone) return '#';
    const cleanPhone = order.customer.phone.replace(/\D/g, '');
    const phoneWithCountry = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
    const text = encodeURIComponent(`Olá ${order.customer.name}! Sou ${driverName}, entregador do seu pedido ${order.orderNumber}. Estou com seu pedido e a caminho do seu endereço!`);
    return `https://wa.me/${phoneWithCountry}?text=${text}`;
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F2342] pb-16 font-sans">
      {/* Top Compact Header */}
      <header className="bg-[#0F2342] text-white border-b border-[#1B365D] sticky top-0 z-30 shadow-xs">
        <div className="max-w-2xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <AmanditaLogo variant="icon" size="sm" theme="dark" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h1 className="text-sm font-extrabold tracking-tight text-white truncate">
                  Portal do Entregador
                </h1>
                {isSupervisor && !isDriverRole ? (
                  <span className="text-[10px] font-mono font-bold text-[#93C5FD] shrink-0">· Supervisão</span>
                ) : store.getAuthSessionMode() === 'local_contingency' ? (
                  <span className="text-[10px] font-mono font-bold text-amber-300 shrink-0">· Local</span>
                ) : (
                  <span className="text-[10px] font-mono font-bold text-emerald-300 shrink-0">· Online</span>
                )}
              </div>
              <p className="text-xs text-slate-300 truncate">
                {isSupervisor && !isDriverRole ? (
                  <span className="font-medium text-slate-200">
                    Supervisão: {adminUser?.name || currentUser?.name || 'Administrador'}
                  </span>
                ) : (
                  <span className="font-medium text-slate-200">
                    {driverName}
                    {currentUser?.role ? ` · ${currentUser.role}` : ''}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Exclusive Administrator Return Button */}
            {onBackToAdmin && (
              <button
                type="button"
                onClick={onBackToAdmin}
                className="min-h-[40px] flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-[#1B365D] hover:bg-[#24467A] text-white rounded-xl text-xs font-semibold transition border border-white/15 whitespace-nowrap cursor-pointer"
                title="Retornar à Administração sem deslogar"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Administração</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (isScannerOpen) {
                  setIsScannerOpen(false);
                  stopCamera();
                } else {
                  startCamera();
                }
              }}
              className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 bg-[#EA580C] hover:bg-[#C2410C] text-white rounded-xl text-xs font-bold transition shadow-xs whitespace-nowrap cursor-pointer"
            >
              <QrCode className="w-4 h-4 shrink-0" />
              <span>{isScannerOpen ? 'Fechar' : 'QR Code'}</span>
            </button>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-white/10 hover:bg-rose-600 text-slate-200 hover:text-white rounded-xl text-xs font-semibold transition whitespace-nowrap cursor-pointer"
                title="Sair do Portal do Entregador"
                aria-label="Sair do Portal do Entregador"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Sair</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Supervisor Mode Banner */}
      {isSupervisor && !isDriverRole && (
        <div className="max-w-2xl mx-auto px-3 sm:px-4 pt-3">
          <div className="p-3 bg-white border border-[#E2E8F0] rounded-2xl flex items-center justify-between gap-3 text-xs shadow-2xs">
            <div className="flex items-start gap-2.5 text-[#0F2342]">
              <Shield className="w-4 h-4 text-[#1B365D] shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-[#0F2342]">Modo Supervisão Administrativa:</span>
                <span className="text-slate-600 block text-xs mt-0.5">
                  Você está consultando o fluxo de entregas em tempo real sem ser vinculado como entregador.
                </span>
              </div>
            </div>
            {onBackToAdmin && (
              <button
                type="button"
                onClick={onBackToAdmin}
                className="shrink-0 px-3 py-1.5 bg-[#0F2342] hover:bg-[#1B365D] text-white font-semibold rounded-xl text-xs transition cursor-pointer"
              >
                Voltar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Driver Shift Summary stats */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3.5 shadow-2xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/80 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-xs text-slate-500 font-medium block truncate">Entregas Feitas Hoje</span>
              <p className="text-lg font-extrabold text-[#0F2342] font-mono tabular-nums leading-tight mt-0.5">
                {deliveredCount} <span className="text-xs font-sans font-medium text-slate-500">pedidos</span>
              </p>
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3.5 shadow-2xs flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA] flex items-center justify-center shrink-0">
              <Bike className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-xs text-slate-500 font-medium block truncate">Aguardando Entrega</span>
              <p className="text-lg font-extrabold text-[#EA580C] font-mono tabular-nums leading-tight mt-0.5">
                {readyOrders.length} <span className="text-xs font-sans font-medium text-slate-500">aguardando</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* QR SCANNER VIEWPORT */}
      {isScannerOpen && (
        <div className="max-w-2xl mx-auto px-3 sm:px-4 pt-4">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-[#EA580C]" />
                <h3 className="text-sm font-bold text-[#0F2342]">Scanner de QR Code do Pedido</h3>
              </div>
              <button
                type="button"
                onClick={() => { setIsScannerOpen(false); stopCamera(); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#0F2342] hover:bg-[#F1F5F9] transition cursor-pointer"
                aria-label="Fechar scanner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video preview / target viewfinder */}
            <div className="relative bg-[#0F2342] rounded-xl h-56 flex items-center justify-center overflow-hidden border border-[#E2E8F0]">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-44 h-44 border-2 border-dashed border-[#FB923C] rounded-xl" />
              </div>
              <div className="absolute bottom-2.5 text-center text-xs bg-[#0F2342]/85 px-3 py-1 rounded-lg text-white">
                Aponte para o QR Code da comanda
              </div>
            </div>

            {scannerStatus && (
              <p className="text-xs text-[#9A3412] bg-[#FFF7ED] border border-[#FED7AA] rounded-xl px-3 py-2 mt-3 text-center font-medium">
                {scannerStatus}
              </p>
            )}

            {/* Quick Simulation Buttons for fast testing */}
            <div className="mt-3 pt-3 border-t border-[#E2E8F0]">
              <span className="text-xs text-slate-600 block mb-2 font-semibold">
                Ou selecione rapidamente um pedido pronto:
              </span>
              <div className="flex flex-wrap gap-2">
                {readyOrders.length > 0 ? (
                  readyOrders.map((ord) => (
                    <button
                      type="button"
                      key={ord.id}
                      onClick={() => handleScanSample(ord)}
                      className="min-h-[38px] px-3 py-1.5 bg-[#F8FAFC] hover:bg-[#FFF7ED] rounded-xl text-xs font-mono font-bold text-[#0F2342] hover:text-[#EA580C] border border-[#E2E8F0] hover:border-[#FED7AA] transition cursor-pointer"
                    >
                      Ler {ord.orderNumber} ({ord.customer.name.split(' ')[0]})
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">Nenhum pedido aguardando no momento</span>
                )}
              </div>
            </div>

            {/* Manual Code Input */}
            <form onSubmit={handleManualSearch} className="mt-3 flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Digite o código (ex: #1002 ou 1002)"
                  className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#EA580C]/20 focus:border-[#EA580C] transition"
                />
              </div>
              <button
                type="submit"
                className="min-h-[44px] px-4 py-2 bg-[#0F2342] hover:bg-[#1B365D] text-white rounded-xl text-xs font-bold transition cursor-pointer shrink-0"
              >
                Buscar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ACTIVE ORDER CARD (Loaded by QR code or selection) */}
      <main className="max-w-2xl mx-auto px-3 sm:px-4 pt-4 space-y-4">
        {activeOrder ? (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-xs overflow-hidden">
            {/* Order Header */}
            <div className="p-4 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-xs font-medium text-slate-500 block">Detalhes do pedido</span>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                  <h2 className="text-xl font-extrabold text-[#0F2342] font-mono tabular-nums">
                    {activeOrder.orderNumber}
                  </h2>
                  <span className={`text-xs font-bold ${
                    activeOrder.status === 'ENTREGUE'
                      ? 'text-emerald-700'
                      : activeOrder.status === 'EM_ROTA'
                      ? 'text-[#1B365D]'
                      : 'text-[#EA580C]'
                  }`}>
                    · {activeOrder.status === 'EM_ROTA' ? 'Em Rota com Você' : activeOrder.status === 'ENTREGUE' ? 'Entregue' : 'Pronto para Retirar'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveOrder(null)}
                className="min-h-[40px] px-3 py-1.5 bg-white hover:bg-[#F1F5F9] text-[#0F2342] border border-[#E2E8F0] rounded-xl text-xs font-semibold transition whitespace-nowrap shrink-0 cursor-pointer"
              >
                Trocar Pedido
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {/* Customer & Contacts */}
              <div className="flex items-center justify-between gap-3 bg-[#F8FAFC] p-3.5 rounded-xl border border-[#E2E8F0]">
                <div className="min-w-0">
                  <span className="text-xs text-slate-500 font-medium block">Cliente</span>
                  <p className="text-base font-bold text-[#0F2342] truncate">{activeOrder.customer.name}</p>
                  {activeOrder.customer.phone && (
                    <p className="text-xs text-slate-600 font-mono tabular-nums mt-0.5">{activeOrder.customer.phone}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {activeOrder.customer.phone && (
                    <a
                      href={`tel:${activeOrder.customer.phone.replace(/\D/g, '')}`}
                      className="min-h-[44px] min-w-[44px] px-3 bg-white hover:bg-[#F1F5F9] text-[#0F2342] rounded-xl transition border border-[#E2E8F0] flex items-center justify-center gap-1.5 text-xs font-semibold"
                      title="Ligar para o cliente"
                    >
                      <Phone className="w-4 h-4 text-[#1B365D]" />
                      <span className="hidden sm:inline">Ligar</span>
                    </a>
                  )}
                  <a
                    href={formatWhatsAppUrl(activeOrder)}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-[44px] min-w-[44px] px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition shadow-2xs flex items-center justify-center gap-1.5 text-xs font-bold"
                    title="Mandar WhatsApp"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span className="hidden sm:inline">WhatsApp</span>
                  </a>
                </div>
              </div>

              {/* Delivery Address & GPS Route */}
              <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA] flex items-center justify-center shrink-0 mt-0.5">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-slate-500 font-semibold block">
                      {activeOrder.fulfillmentType === 'RETIRADA' ? 'Modalidade do Pedido' : 'Endereço de Entrega'}
                    </span>
                    {activeOrder.fulfillmentType === 'RETIRADA' || !activeOrder.customer.address ? (
                      <p className="text-sm font-bold text-[#0F2342] mt-0.5">
                        Retirada no Balcão do Restaurante
                      </p>
                    ) : (() => {
                      const addrDetails = formatAddressDetails(activeOrder.customer.address);
                      return (
                        <>
                          <p className="text-sm sm:text-base font-bold text-[#0F2342] leading-snug mt-0.5">
                            {addrDetails.primaryLine}
                          </p>
                          {addrDetails.secondaryLine && (
                            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                              {addrDetails.secondaryLine}
                            </p>
                          )}
                          {addrDetails.referenceLine && (
                            <p className="text-xs font-semibold text-[#9A3412] bg-[#FFF7ED] border border-[#FED7AA] px-2.5 py-1.5 rounded-lg mt-2">
                              Ponto de Ref: {addrDetails.referenceLine}
                            </p>
                          )}
                        </>
                      );
                    })()}
                    {activeOrder.customer.notes && (
                      <p className="text-xs text-[#0F2342] bg-white p-2.5 rounded-lg mt-2 border border-[#E2E8F0]">
                        <strong>Instruções do Cliente:</strong> {activeOrder.customer.notes}
                      </p>
                    )}
                  </div>
                </div>

                {/* Route Buttons */}
                <div className="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-[#E2E8F0]">
                  <a
                    href={formatMapsUrl(activeOrder)}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-3 bg-[#0F2342] hover:bg-[#1B365D] text-white rounded-xl text-xs font-bold transition shadow-2xs"
                  >
                    <Navigation className="w-4 h-4 shrink-0" />
                    <span>Google Maps</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-75 shrink-0" />
                  </a>
                  <a
                    href={formatWazeUrl(activeOrder)}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-3 bg-white hover:bg-[#F1F5F9] text-[#0F2342] border border-[#E2E8F0] rounded-xl text-xs font-bold transition"
                  >
                    <Navigation className="w-4 h-4 text-[#1B365D] shrink-0" />
                    <span>Waze</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  </a>
                </div>
              </div>

              {/* Payment Instructions (Crucial for Delivery Driver) */}
              <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] space-y-3">
                <span className="text-xs text-slate-500 font-semibold block">
                  Pagamento e Cobrança na Entrega
                </span>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-slate-500">Total do Pedido</span>
                    <p className="text-xl font-extrabold text-[#EA580C] font-mono tabular-nums">
                      {formatCurrency(activeOrder.totalAmount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500">Forma de Pagamento</span>
                    <p className="text-sm font-bold text-[#0F2342]">
                      {getPaymentMethodLabel(activeOrder.paymentMethod)}
                    </p>
                  </div>
                </div>

                {activeOrder.paymentMethod === 'DINHEIRO' ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1 text-amber-950">
                    <p className="font-bold text-amber-900">COBRAR EM DINHEIRO NA ENTREGA</p>
                    {activeOrder.paymentChangeFor ? (
                      <p className="text-amber-900 leading-relaxed">
                        Cliente solicitou troco para <strong className="font-mono">{formatCurrency(activeOrder.paymentChangeFor)}</strong>.
                        <br />
                        Valor a devolver: <strong className="font-mono text-[#EA580C]">{formatCurrency(activeOrder.paymentChangeFor - activeOrder.totalAmount)}</strong>
                      </p>
                    ) : (
                      <p className="text-amber-900">Não foi solicitado troco (cobrar valor exato).</p>
                    )}
                  </div>
                ) : activeOrder.paymentStatus === 'PAGO' ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>PAGO ONLINE (PIX) — Apenas entregar o pedido ao cliente.</span>
                  </div>
                ) : (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-[#1B365D] font-semibold">
                    Levar maquininha de cartão ({getPaymentMethodLabel(activeOrder.paymentMethod)})
                  </div>
                )}
              </div>

              {/* Items overview */}
              <div className="space-y-1.5 text-xs text-slate-700 border-t border-[#E2E8F0] pt-3.5">
                <span className="text-xs text-slate-500 font-semibold block mb-1.5">
                  Volumes / Itens ({activeOrder.items.length})
                </span>
                {activeOrder.items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-2 py-1.5 border-b border-[#F1F5F9] last:border-b-0">
                    <span className="text-[#0F2342]">
                      <strong className="text-[#EA580C] font-mono mr-1.5">{item.quantity}x</strong>
                      {item.name}
                      {item.notes && <span className="text-slate-500 italic block ml-5 mt-0.5">Obs: {item.notes}</span>}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 shrink-0">{formatCurrency(item.subtotal)}</span>
                  </div>
                ))}
              </div>

              {/* Main Driver Status Action Buttons */}
              <div className="space-y-2.5 pt-1">
                {statusFeedback && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                      statusFeedback.type === 'error'
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    {statusFeedback.type === 'error' ? (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <span className="font-semibold flex-1">{statusFeedback.message}</span>
                    <button
                      type="button"
                      onClick={() => setStatusFeedback(null)}
                      className="text-slate-500 hover:text-[#0F2342] font-bold px-1 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {isSupervisor && !isDriverRole ? (
                  <div className="p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl space-y-1.5">
                    <div className="flex items-center gap-2 text-[#0F2342] text-xs font-bold">
                      <ShieldCheck className="w-4 h-4 text-[#1B365D]" />
                      <span>Modo Visualização Administrativa</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      Entregador vinculado ao pedido: <strong className="text-[#0F2342]">{activeOrder.deliveryPersonName || activeOrder.deliveryPerson?.name || 'Aguardando Atribuição'}</strong>.
                    </p>
                    <p className="text-[11px] text-slate-500">
                      A transição operacional de rota e encerramento de entrega pertence ao entregador em campo ou à gestão de pedidos na administração.
                    </p>
                  </div>
                ) : (
                  <>
                    {activeOrder.status !== 'EM_ROTA' && activeOrder.status !== 'ENTREGUE' && (
                      <button
                        type="button"
                        disabled={isUpdatingStatus}
                        onClick={handleStartDelivery}
                        className="w-full min-h-[52px] py-3.5 px-4 bg-[#EA580C] hover:bg-[#C2410C] active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait text-white rounded-xl font-bold text-sm shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Bike className="w-5 h-5 shrink-0" />
                        <span>{isUpdatingStatus ? 'Atualizando Rota...' : 'Retirar Pedido e Iniciar Rota'}</span>
                      </button>
                    )}

                    {activeOrder.status === 'EM_ROTA' && (
                      <button
                        type="button"
                        disabled={isUpdatingStatus}
                        onClick={handleCompleteDelivery}
                        className="w-full min-h-[52px] py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait text-white rounded-xl font-bold text-sm shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <CheckCircle className="w-5 h-5 shrink-0" />
                        <span>{isUpdatingStatus ? 'Confirmando Entrega...' : 'Confirmar Entrega Concluída'}</span>
                      </button>
                    )}
                  </>
                )}
              </div>

              {activeOrder.status === 'ENTREGUE' && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center space-y-2.5">
                  <CheckCircle className="w-9 h-9 text-emerald-600 mx-auto" />
                  <p className="font-bold text-emerald-900 text-sm">Entrega Concluída e Registrada com Sucesso!</p>
                  <p className="text-xs text-emerald-800">
                    Pedido <strong className="font-mono">{activeOrder.orderNumber}</strong> entregue por <strong>{driverName}</strong>.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { setActiveOrder(null); setDeliveryTab('pendentes'); }}
                      className="flex-1 min-h-[44px] py-2.5 px-3 bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold text-xs rounded-xl transition cursor-pointer"
                    >
                      Próximo Pedido Pendente
                    </button>
                    <button
                      type="button"
                      onClick={() => { setActiveOrder(null); setDeliveryTab('concluidas'); }}
                      className="flex-1 min-h-[44px] py-2.5 px-3 bg-white hover:bg-[#F8FAFC] text-[#0F2342] font-semibold text-xs rounded-xl transition cursor-pointer border border-[#E2E8F0]"
                    >
                      Ver Entregas Concluídas ({deliveredCount})
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* NO ORDER SELECTED: SHOW TABBED LIST (PENDING OR COMPLETED) */
          <div className="space-y-4">
            {/* Delivery Navigation Tabs */}
            <div className="flex p-1 bg-[#E2E8F0]/70 rounded-xl border border-[#E2E8F0]">
              <button
                type="button"
                onClick={() => setDeliveryTab('pendentes')}
                className={`flex-1 min-h-[42px] py-2 px-3 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  deliveryTab === 'pendentes'
                    ? 'bg-[#0F2342] text-white shadow-2xs'
                    : 'text-[#475569] hover:text-[#0F2342]'
                }`}
              >
                <Bike className="w-4 h-4 shrink-0" />
                <span className="tabular-nums">Pendentes ({readyOrders.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setDeliveryTab('concluidas')}
                className={`flex-1 min-h-[42px] py-2 px-3 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  deliveryTab === 'concluidas'
                    ? 'bg-[#0F2342] text-white shadow-2xs'
                    : 'text-[#475569] hover:text-[#0F2342]'
                }`}
              >
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span className="tabular-nums">Concluídas ({deliveredCount})</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-[#0F2342]">
                {deliveryTab === 'pendentes'
                  ? `Pedidos Aguardando Entrega (${readyOrders.length})`
                  : `Entregas Concluídas por ${driverName} (${deliveredCount})`}
              </h2>
              <button
                type="button"
                onClick={loadData}
                className="text-xs font-semibold text-[#1B365D] hover:text-[#EA580C] flex items-center gap-1.5 py-1 px-2 rounded-lg hover:bg-white transition cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Atualizar</span>
              </button>
            </div>

            {deliveryTab === 'pendentes' ? (
              readyOrders.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 border border-[#E2E8F0] text-center shadow-2xs">
                  <div className="w-12 h-12 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <Bike className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-[#0F2342]">Nenhum Pedido Aguardando</h3>
                  <p className="text-xs text-slate-500 mt-1 mb-5 max-w-sm mx-auto leading-relaxed">
                    Assim que a cozinha concluir o preparo ou você ler um QR Code, o pedido aparecerá aqui.
                  </p>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="min-h-[44px] px-5 py-2.5 bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-2xs"
                  >
                    Abrir Leitor de QR Code
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {readyOrders.map((ord) => (
                    <div
                      key={ord.id}
                      onClick={() => handleSelectOrder(ord)}
                      className="bg-white hover:border-[#EA580C]/60 border border-[#E2E8F0] rounded-2xl p-4 transition cursor-pointer shadow-2xs group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-extrabold text-[#0F2342] font-mono tabular-nums">
                              {ord.orderNumber}
                            </span>
                            <span className={`text-xs font-bold ${
                              ord.status === 'EM_ROTA' ? 'text-[#1B365D]' : 'text-[#EA580C]'
                            }`}>
                              · {ord.status === 'EM_ROTA' ? 'Em Rota com Você' : 'Pronto p/ Entrega'}
                            </span>
                          </div>
                          <p className="text-sm font-bold text-[#0F2342] mt-1 truncate">{ord.customer.name}</p>
                          <p className="text-xs text-slate-600 flex items-start gap-1.5 mt-1 leading-snug">
                            <MapPin className="w-3.5 h-3.5 text-[#EA580C] shrink-0 mt-0.5" />
                            <span className="line-clamp-2">
                              {ord.customer.address
                                ? formatAddressDetails(ord.customer.address).fullSingleLine
                                : 'Retirada no Balcão'}
                            </span>
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-base font-extrabold text-[#EA580C] font-mono tabular-nums">
                            {formatCurrency(ord.totalAmount)}
                          </span>
                          <p className="text-xs text-slate-500 mt-0.5">{getPaymentMethodLabel(ord.paymentMethod)}</p>
                          <span className="inline-block mt-2.5 text-xs font-bold text-[#1B365D] group-hover:text-[#EA580C] group-hover:translate-x-0.5 transition">
                            {ord.status === 'EM_ROTA' ? 'Concluir →' : 'Iniciar →'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              /* COMPLETED DELIVERIES LIST */
              deliveredOrders.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 border border-[#E2E8F0] text-center shadow-2xs">
                  <div className="w-12 h-12 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <CheckCircle className="w-6 h-6" />
                  </div>
                  <h3 className="text-base font-bold text-[#0F2342]">Nenhuma Entrega Concluída Hoje</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                    Os pedidos que você entregar aparecerão listados aqui com comprovação de horário e pagamento.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {deliveredOrders.map((ord) => (
                    <div
                      key={ord.id}
                      onClick={() => handleSelectOrder(ord)}
                      className="bg-white hover:border-emerald-400 border border-[#E2E8F0] rounded-2xl p-4 transition cursor-pointer shadow-2xs group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-extrabold text-[#0F2342] font-mono tabular-nums">
                              {ord.orderNumber}
                            </span>
                            <span className="text-xs font-bold text-emerald-700 flex items-center gap-1 shrink-0">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Entregue com Sucesso</span>
                            </span>
                          </div>
                          <p className="text-sm font-bold text-[#0F2342] mt-1 truncate">{ord.customer.name}</p>
                          <p className="text-xs text-slate-600 flex items-start gap-1.5 mt-1 leading-snug">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                            <span className="line-clamp-2">
                              {ord.customer.address
                                ? formatAddressDetails(ord.customer.address).fullSingleLine
                                : 'Retirada no Balcão'}
                            </span>
                          </p>
                          {ord.deliveryPerson?.deliveredAt && (
                            <p className="text-xs text-emerald-700 mt-1.5 font-mono tabular-nums">
                              Horário de entrega: {formatTime(ord.deliveryPerson.deliveredAt)}
                            </p>
                          )}
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-base font-extrabold text-emerald-700 font-mono tabular-nums">
                            {formatCurrency(ord.totalAmount)}
                          </span>
                          <p className="text-xs text-slate-500 mt-0.5">{getPaymentMethodLabel(ord.paymentMethod)}</p>
                          <span className="inline-block mt-2.5 text-xs font-semibold text-slate-500 group-hover:text-emerald-700 transition-colors">
                            Ver Recibo →
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </main>

      {/* NOTIFICAÇÃO DE PEDIDO PRONTO PARA ENTREGA COM CONTROLE DE SOM E CIÊNCIA */}
      <DriverReadyOrderAlert
        currentUser={currentUser}
        onSelectOrder={(order) => {
          setActiveOrder(order);
          setDeliveryTab('pendentes');
        }}
      />
    </div>
  );
};
