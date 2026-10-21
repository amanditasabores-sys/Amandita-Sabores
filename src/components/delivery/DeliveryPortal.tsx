import React, { useState, useEffect, useRef } from 'react';
import { store } from '../../services/store';
import { Order } from '../../types';
import { formatCurrency, formatTime, getPaymentMethodLabel } from '../../utils/formatters';
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
  LogOut
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { User } from '../../types';

interface DeliveryPortalProps {
  initialOrderId?: string;
  onNavigateToAdmin?: () => void;
  currentUser?: User | null;
  onLogout?: () => void;
}

export const DeliveryPortal: React.FC<DeliveryPortalProps> = ({ 
  initialOrderId, 
  onNavigateToAdmin,
  currentUser,
  onLogout
}) => {
  const [driverName, setDriverName] = useState(() => {
    return currentUser?.name || currentUser?.username || localStorage.getItem('gf_driver_name') || 'Rodrigo Motoboy';
  });
  const [driverPhone, setDriverPhone] = useState(() => {
    return currentUser?.phone || localStorage.getItem('gf_driver_phone') || '(11) 97771-2233';
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [readyOrders, setReadyOrders] = useState<Order[]>([]);
  const [deliveredCount, setDeliveredCount] = useState(0);

  // Scanner state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scannerStatus, setScannerStatus] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loadData = () => {
    const orders = store.getOrders();
    // Orders ready or in prep
    const ready = orders.filter((o) => o.status === 'PRONTO' || o.status === 'EM_ROTA');
    setReadyOrders(ready);

    // Delivered by this driver today
    const done = orders.filter(
      (o) => o.status === 'ENTREGUE' && o.deliveryPerson?.name === driverName
    );
    setDeliveredCount(done.length);

    if (activeOrder) {
      const refreshed = store.getOrderById(activeOrder.id);
      if (refreshed) setActiveOrder(refreshed);
    }
  };

  useEffect(() => {
    if (initialOrderId) {
      const ord = store.getOrderById(initialOrderId);
      if (ord) setActiveOrder(ord);
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

  const saveDriverProfile = () => {
    localStorage.setItem('gf_driver_name', driverName);
    localStorage.setItem('gf_driver_phone', driverPhone);
    setIsEditingProfile(false);
  };

  const handleSelectOrder = (order: Order) => {
    setActiveOrder(order);
    setIsScannerOpen(false);
    stopCamera();
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    const clean = manualCode.trim();
    const found = store.getOrderById(clean);
    if (found) {
      setActiveOrder(found);
      setManualCode('');
      setIsScannerOpen(false);
      stopCamera();
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
  const handleStartDelivery = () => {
    if (!activeOrder) return;
    const updated = store.updateOrderStatus(
      activeOrder.id,
      'EM_ROTA',
      `Entregador ${driverName}`,
      `Entregador ${driverName} retirou o pedido e iniciou o trajeto de entrega.`
    );
    if (updated) {
      store.assignDeliveryPerson(activeOrder.id, {
        id: `driver-${driverName}`,
        name: driverName,
        phone: driverPhone,
      });
      setActiveOrder(store.getOrderById(activeOrder.id) || null);
      loadData();
    }
  };

  const handleCompleteDelivery = () => {
    if (!activeOrder) return;
    const updated = store.updateOrderStatus(
      activeOrder.id,
      'ENTREGUE',
      `Entregador ${driverName}`,
      `Entrega confirmada pelo entregador ${driverName} no endereço do cliente.`
    );
    if (updated) {
      setActiveOrder(store.getOrderById(activeOrder.id) || null);
      loadData();
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  };

  const formatMapsUrl = (order: Order) => {
    if (!order.customer.address) return '#';
    const addr = `${order.customer.address.street}, ${order.customer.address.number}, ${order.customer.address.neighborhood}, ${order.customer.address.city}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  };

  const formatWazeUrl = (order: Order) => {
    if (!order.customer.address) return '#';
    const addr = `${order.customer.address.street}, ${order.customer.address.number}, ${order.customer.address.city}`;
    return `https://waze.com/ul?q=${encodeURIComponent(addr)}`;
  };

  const formatWhatsAppUrl = (order: Order) => {
    if (!order.customer.phone) return '#';
    const cleanPhone = order.customer.phone.replace(/\D/g, '');
    const phoneWithCountry = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
    const text = encodeURIComponent(`Olá ${order.customer.name}! Sou ${driverName}, entregador do seu pedido ${order.orderNumber}. Estou com seu pedido e a caminho do seu endereço!`);
    return `https://wa.me/${phoneWithCountry}?text=${text}`;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pb-16">
      {/* Top Header */}
      <header className="bg-slate-950/80 backdrop-blur border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
              <Bike className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                Portal do Entregador
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-mono">ONLINE</span>
              </h1>
              <p className="text-xs text-slate-400 flex items-center gap-1">
                <span>{driverName}</span>
                <button
                  onClick={() => setIsEditingProfile(true)}
                  className="text-amber-400 hover:underline text-[11px] ml-1"
                >
                  (Alterar)
                </button>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onNavigateToAdmin && (currentUser?.role === 'ADMINISTRADOR' || currentUser?.role === 'GERENTE' || !currentUser) && (
              <button
                onClick={onNavigateToAdmin}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-xl text-xs font-semibold transition border border-slate-700 cursor-pointer"
                title="Voltar ao Painel Administrativo"
              >
                <span>Painel ADM</span>
              </button>
            )}

            <button
              onClick={() => {
                if (isScannerOpen) {
                  setIsScannerOpen(false);
                  stopCamera();
                } else {
                  startCamera();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition shadow-md shadow-amber-500/10 cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
              <span>{isScannerOpen ? 'Fechar Scanner' : 'Ler QR Code'}</span>
            </button>

            {onLogout && (
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-white rounded-xl text-xs font-bold transition border border-rose-500/30 cursor-pointer"
                title="Sair do Portal do Entregador"
              >
                <LogOut className="w-4 h-4" />
                <span>Sair</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Driver Profile Edit Modal */}
      {isEditingProfile && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4">
            <h3 className="font-bold text-white text-base">Identificação do Entregador</h3>
            <div>
              <label className="text-xs text-slate-300 block mb-1">Seu Nome / Apelido</label>
              <input
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-300 block mb-1">Seu Telefone / WhatsApp</label>
              <input
                type="text"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setIsEditingProfile(false)}
                className="flex-1 py-2 bg-slate-700 rounded-xl text-xs font-semibold text-slate-300"
              >
                Cancelar
              </button>
              <button
                onClick={saveDriverProfile}
                className="flex-1 py-2 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Driver Shift Summary stats */}
      <div className="max-w-xl mx-auto px-4 pt-4">
        <div className="grid grid-cols-2 gap-2 p-3 bg-slate-800/60 border border-slate-800 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400">Entregas Feitas Hoje</span>
              <p className="text-lg font-bold text-white">{deliveredCount} pedidos</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
              <Bike className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] text-slate-400">Prontos no Balcão</span>
              <p className="text-lg font-bold text-amber-400">{readyOrders.length} aguardando</p>
            </div>
          </div>
        </div>
      </div>

      {/* QR SCANNER VIEWPORT */}
      {isScannerOpen && (
        <div className="max-w-xl mx-auto px-4 pt-4">
          <div className="bg-slate-800 border-2 border-amber-500/50 rounded-2xl p-4 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-amber-400 animate-pulse" />
                <h3 className="text-sm font-bold text-white">Scanner de QR Code do Pedido</h3>
              </div>
              <button
                onClick={() => { setIsScannerOpen(false); stopCamera(); }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video preview / target viewfinder */}
            <div className="relative bg-black rounded-xl h-56 flex items-center justify-center overflow-hidden border border-slate-700">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-44 h-44 border-2 border-dashed border-amber-400 rounded-xl shadow-[0_0_20px_rgba(245,158,11,0.3)] animate-pulse" />
              </div>
              <div className="absolute bottom-2 text-center text-[11px] bg-black/70 px-3 py-1 rounded-full text-slate-300">
                Aponte para o QR Code da comanda
              </div>
            </div>

            {scannerStatus && (
              <p className="text-xs text-amber-300 mt-2 text-center font-medium">
                {scannerStatus}
              </p>
            )}

            {/* Quick Simulation Buttons for fast testing */}
            <div className="mt-3 pt-3 border-t border-slate-700/70">
              <span className="text-[11px] text-slate-400 block mb-1.5 font-semibold">
                Ou teste com um clique simulando leitura de pedido real:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {readyOrders.length > 0 ? (
                  readyOrders.map((ord) => (
                    <button
                      key={ord.id}
                      onClick={() => handleScanSample(ord)}
                      className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-mono text-amber-400 border border-slate-600 transition"
                    >
                      Ler {ord.orderNumber} ({ord.customer.name.split(' ')[0]})
                    </button>
                  ))
                ) : (
                  <span className="text-xs text-slate-400 italic">Nenhum pedido aguardando no momento</span>
                )}
              </div>
            </div>

            {/* Manual Code Input */}
            <form onSubmit={handleManualSearch} className="mt-3 flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Ex: #1002 ou 1002"
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold hover:bg-amber-400 transition"
              >
                Buscar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ACTIVE ORDER CARD (Loaded by QR code or selection) */}
      <main className="max-w-xl mx-auto px-4 pt-4 space-y-4">
        {activeOrder ? (
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl overflow-hidden">
            {/* Order Header */}
            <div className="p-4 bg-slate-850 border-b border-slate-700 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-mono text-amber-400 font-bold">DETALHES DO PEDIDO</span>
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                  <span>{activeOrder.orderNumber}</span>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                    activeOrder.status === 'ENTREGUE'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : activeOrder.status === 'EM_ROTA'
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}>
                    {activeOrder.status === 'EM_ROTA' ? 'Em Rota com Você' : activeOrder.status === 'ENTREGUE' ? 'Entregue' : 'Pronto para Retirar'}
                  </span>
                </h2>
              </div>
              <button
                onClick={() => setActiveOrder(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-700 rounded-lg"
              >
                Trocar Pedido
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Customer & Contacts */}
              <div className="flex items-start justify-between bg-slate-900/80 p-3.5 rounded-xl border border-slate-700/60">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Cliente</span>
                  <p className="text-base font-bold text-white">{activeOrder.customer.name}</p>
                  <p className="text-xs text-slate-400 font-mono">{activeOrder.customer.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  {activeOrder.customer.phone && (
                    <a
                      href={`tel:${activeOrder.customer.phone.replace(/\D/g, '')}`}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition border border-slate-700"
                      title="Ligar para o cliente"
                    >
                      <Phone className="w-4 h-4 text-emerald-400" />
                    </a>
                  )}
                  <a
                    href={formatWhatsAppUrl(activeOrder)}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl transition shadow"
                    title="Mandar WhatsApp"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {/* Delivery Address & GPS Route */}
              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/60 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <span className="text-[10px] text-amber-400 uppercase tracking-wider font-bold">
                      {activeOrder.fulfillmentType === 'RETIRADA' ? 'Modalidade do Pedido' : 'Local da Entrega'}
                    </span>
                    {activeOrder.fulfillmentType === 'RETIRADA' || !activeOrder.customer.address ? (
                      <p className="text-sm font-bold text-white">
                        Retirada no Balcão do Restaurante
                      </p>
                    ) : (
                      <>
                        <p className="text-sm font-bold text-white">
                          {activeOrder.customer.address.street}, {activeOrder.customer.address.number}
                        </p>
                        <p className="text-xs text-slate-400">
                          {activeOrder.customer.address.neighborhood}
                          {activeOrder.customer.address.complement && ` · ${activeOrder.customer.address.complement}`}
                          {` · ${activeOrder.customer.address.city}`}
                        </p>
                        {activeOrder.customer.address.reference && (
                          <p className="text-xs text-amber-300 mt-1">
                            Ponto de Ref: {activeOrder.customer.address.reference}
                          </p>
                        )}
                      </>
                    )}
                    {activeOrder.customer.notes && (
                      <p className="text-xs text-slate-300 bg-slate-800/80 p-2 rounded-lg mt-2 border border-slate-700">
                        Instruções do Cliente: {activeOrder.customer.notes}
                      </p>
                    )}
                  </div>
                </div>

                {/* Route Buttons */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                  <a
                    href={formatMapsUrl(activeOrder)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow"
                  >
                    <Navigation className="w-4 h-4" />
                    <span>Google Maps</span>
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                  <a
                    href={formatWazeUrl(activeOrder)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition shadow"
                  >
                    <Navigation className="w-4 h-4" />
                    <span>Waze</span>
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </a>
                </div>
              </div>

              {/* Payment Instructions (Crucial for Delivery Driver) */}
              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold block mb-1">
                  Instruções Financeiras & Cobrança
                </span>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-xs text-slate-400">Total do Pedido:</span>
                    <p className="text-lg font-extrabold text-amber-400">{formatCurrency(activeOrder.totalAmount)}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400">Forma de Pagamento:</span>
                    <p className="text-sm font-bold text-white">{getPaymentMethodLabel(activeOrder.paymentMethod)}</p>
                  </div>
                </div>

                {activeOrder.paymentMethod === 'DINHEIRO' ? (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs space-y-1">
                    <p className="font-bold text-amber-400">⚠️ COBRAR EM DINHEIRO NA ENTREGA</p>
                    {activeOrder.paymentChangeFor ? (
                      <p className="text-slate-200">
                        Cliente solicitou troco para <strong className="text-white">{formatCurrency(activeOrder.paymentChangeFor)}</strong>.
                        <br />
                        Valor a devolver: <strong className="text-amber-300">{formatCurrency(activeOrder.paymentChangeFor - activeOrder.totalAmount)}</strong>
                      </p>
                    ) : (
                      <p className="text-slate-200">Não foi solicitado troco (cobrar valor exato).</p>
                    )}
                  </div>
                ) : activeOrder.paymentStatus === 'PAGO' ? (
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-400 font-semibold flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <span>PAGO ONLINE (PIX) - Apenas entregar a encomenda!</span>
                  </div>
                ) : (
                  <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-xl text-xs text-blue-300 font-semibold">
                    💳 Levar maquininha de cartão ({getPaymentMethodLabel(activeOrder.paymentMethod)})
                  </div>
                )}
              </div>

              {/* Items overview */}
              <div className="space-y-1.5 text-xs text-slate-300 border-t border-slate-700/60 pt-3">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
                  Volumes / Itens ({activeOrder.items.length})
                </span>
                {activeOrder.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-1 border-b border-slate-800">
                    <span>
                      <strong className="text-amber-400 mr-1.5">{item.quantity}x</strong>
                      {item.name}
                      {item.notes && <span className="text-slate-400 italic block ml-4">Obs: {item.notes}</span>}
                    </span>
                    <span className="font-mono text-slate-400">{formatCurrency(item.subtotal)}</span>
                  </div>
                ))}
              </div>

              {/* Main Driver Status Action Buttons */}
              <div className="space-y-2 pt-2">
                {activeOrder.status !== 'EM_ROTA' && activeOrder.status !== 'ENTREGUE' && (
                  <button
                    onClick={handleStartDelivery}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Bike className="w-5 h-5" />
                    <span>Retirar Pedido e Iniciar Rota</span>
                  </button>
                )}

                {activeOrder.status === 'EM_ROTA' && (
                  <button
                    onClick={handleCompleteDelivery}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle className="w-5 h-5" />
                    <span>Confirmar Entrega Concluída</span>
                  </button>
                )}

                {activeOrder.status === 'ENTREGUE' && (
                  <div className="p-4 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-center">
                    <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-1" />
                    <p className="font-bold text-emerald-300 text-sm">Pedido Concluído com Sucesso!</p>
                    <p className="text-xs text-slate-400 mt-1">Obrigado pela entrega, {driverName}.</p>
                    <button
                      onClick={() => setActiveOrder(null)}
                      className="mt-3 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-xs font-semibold rounded-lg text-white"
                    >
                      Voltar e pegar próximo pedido
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* NO ORDER SELECTED: SHOW PENDING LIST */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                Pedidos Aguardando Entrega ({readyOrders.length})
              </h2>
              <button
                onClick={loadData}
                className="text-xs text-amber-400 hover:underline flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Atualizar
              </button>
            </div>

            {readyOrders.length === 0 ? (
              <div className="bg-slate-800/80 rounded-2xl p-8 border border-slate-700 text-center">
                <Bike className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-bold text-white">Nenhum Pedido Aguardando</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4">
                  Assim que a cozinha concluir o preparo ou você ler um QR Code, o pedido aparecerá aqui.
                </p>
                <button
                  onClick={startCamera}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition"
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
                    className="bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-amber-500/50 rounded-2xl p-4 transition cursor-pointer shadow-sm group"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-extrabold text-white">{ord.orderNumber}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            ord.status === 'EM_ROTA' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {ord.status === 'EM_ROTA' ? 'Em Rota' : 'Pronto p/ Entrega'}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-200 mt-1">{ord.customer.name}</p>
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-amber-400" />
                          <span>
                            {ord.customer.address 
                              ? `${ord.customer.address.street}, ${ord.customer.address.number} · ${ord.customer.address.neighborhood}`
                              : 'Retirada no Balcão'}
                          </span>
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-bold text-amber-400">{formatCurrency(ord.totalAmount)}</span>
                        <p className="text-[11px] text-slate-400">{getPaymentMethodLabel(ord.paymentMethod)}</p>
                        <span className="inline-block mt-2 text-xs font-semibold text-amber-400 group-hover:translate-x-0.5 transition-transform">
                          Ver Detalhes →
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
