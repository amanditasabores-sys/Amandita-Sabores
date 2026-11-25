import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { soundService } from '../../services/audio';
import { Order, User } from '../../types';
import { formatTime, formatAddressDetails } from '../../utils/formatters';
import { 
  Bike, 
  Volume2, 
  VolumeX, 
  Check, 
  MapPin, 
  Eye, 
  Clock, 
  X,
  PackageCheck
} from 'lucide-react';

interface DriverReadyOrderAlertProps {
  currentUser?: User | null;
  onSelectOrder?: (order: Order) => void;
}

export const DriverReadyOrderAlert: React.FC<DriverReadyOrderAlertProps> = ({ 
  currentUser, 
  onSelectOrder 
}) => {
  const [readyAlerts, setReadyAlerts] = useState<Order[]>([]);
  const [isSoundMutedManually, setIsSoundMutedManually] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const playedAudioOrdersRef = React.useRef<Set<string>>(new Set());

  const checkReadyOrders = () => {
    const unseenIds = store.getUnseenDriverReadyOrderIds(currentUser);
    if (unseenIds.length === 0) {
      setReadyAlerts([]);
      soundService.stopDriverReadyAlert();
      setIsPlayingAudio(false);
      return;
    }

    const allOrders = store.getOrders();
    const matching = unseenIds
      .map((id) => allOrders.find((o) => o.id === id))
      .filter((o): o is Order => {
        if (!o || o.status !== 'PRONTO' || o.fulfillmentType !== 'DELIVERY') return false;
        return store.isDriverAssignedToOrder(o, currentUser);
      });

    setReadyAlerts(matching);

    // If there are ready orders not yet acknowledged and sound was not manually silenced
    if (matching.length > 0) {
      const unplayedOrder = matching.find((o) => !playedAudioOrdersRef.current.has(o.id));
      if (unplayedOrder && !isSoundMutedManually) {
        playedAudioOrdersRef.current.add(unplayedOrder.id);
        soundService.startDriverReadyAlert(3500, 4, unplayedOrder.id);
        setIsPlayingAudio(true);
      } else {
        setIsPlayingAudio(soundService.isDriverReadyAlertActive());
      }
    } else {
      soundService.stopDriverReadyAlert();
      setIsPlayingAudio(false);
    }
  };

  useEffect(() => {
    checkReadyOrders();

    const handleUpdate = () => {
      checkReadyOrders();
    };

    const handleSeen = () => {
      checkReadyOrders();
    };

    const handleSilenced = () => {
      setIsSoundMutedManually(true);
      setIsPlayingAudio(false);
    };

    window.addEventListener('gestaofood_state_changed', handleUpdate);
    window.addEventListener('DRIVER_ORDER_READY', handleUpdate);
    window.addEventListener('DRIVER_READY_ORDER_SEEN', handleSeen);
    window.addEventListener('DRIVER_READY_ALERTS_SILENCED', handleSilenced);

    // Periodic safety check every 4 seconds
    const interval = window.setInterval(() => {
      checkReadyOrders();
      setIsPlayingAudio(soundService.isDriverReadyAlertActive());
    }, 4000);

    return () => {
      window.removeEventListener('gestaofood_state_changed', handleUpdate);
      window.removeEventListener('DRIVER_ORDER_READY', handleUpdate);
      window.removeEventListener('DRIVER_READY_ORDER_SEEN', handleSeen);
      window.removeEventListener('DRIVER_READY_ALERTS_SILENCED', handleSilenced);
      window.clearInterval(interval);
      soundService.stopDriverReadyAlert();
    };
  }, [currentUser, isSoundMutedManually]);

  // Stop sound immediately while keeping the visual alert card open
  const handleStopSound = () => {
    soundService.stopDriverReadyAlert();
    setIsSoundMutedManually(true);
    setIsPlayingAudio(false);
  };

  // Acknowledge receipt of the notification (removes alert card without changing order status)
  const handleAcknowledge = (orderId: string) => {
    soundService.stopDriverReadyAlert();
    setIsPlayingAudio(false);
    store.markDriverReadyOrderSeen(orderId);
    soundService.playSuccessTone();
    setReadyAlerts((prev) => prev.filter((o) => o.id !== orderId));
  };

  // Acknowledge all alerts
  const handleAcknowledgeAll = () => {
    store.acknowledgeAllDriverReadyOrders(currentUser);
    soundService.playSuccessTone();
    setReadyAlerts([]);
    setIsPlayingAudio(false);
  };

  // Open order in delivery portal
  const handleViewOrder = (order: Order) => {
    handleAcknowledge(order.id);
    if (onSelectOrder) {
      onSelectOrder(order);
    }
  };

  if (readyAlerts.length === 0) {
    return null;
  }

  // Highlight latest order prominently
  const current = readyAlerts[0];
  const additionalCount = readyAlerts.length - 1;

  // Extract ready moment from order movements
  const readyMovement = [...current.movements].reverse().find((m) => m.toStatus === 'PRONTO');
  const readyTimeStr = readyMovement?.timestamp 
    ? formatTime(readyMovement.timestamp) 
    : (current.updatedAt ? formatTime(current.updatedAt) : 'Agora');

  const address = current.customer.address;
  const addressDetails = address ? formatAddressDetails(address) : null;
  const addressText = addressDetails ? addressDetails.fullSingleLine : null;

  return (
    <aside
      aria-label="Notificação de Pedido Pronto para Entrega"
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 max-w-sm sm:max-w-md w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-5 duration-300 pointer-events-auto font-sans"
    >
      <div className="bg-white border-2 border-[#EA580C] rounded-2xl shadow-2xl overflow-hidden">
        {/* Alert Header Bar */}
        <div className="bg-[#0F2342] text-white px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#EA580C] text-white flex items-center justify-center shrink-0">
              <Bike className="w-4 h-4" />
            </div>
            <span className="font-bold text-xs sm:text-sm tracking-tight text-white truncate">
              Pedido pronto para entrega!
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isPlayingAudio && !isSoundMutedManually && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[#FED7AA] bg-white/10 px-2 py-0.5 rounded-lg">
                <Volume2 className="w-3.5 h-3.5 text-[#FB923C]" />
                <span className="hidden sm:inline">Tocando</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => handleAcknowledge(current.id)}
              className="text-slate-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
              title="Dispensar aviso"
              aria-label="Dispensar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-3 bg-white text-[#0F2342]">
          {/* Order Header & Time */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xl font-extrabold text-[#EA580C] font-mono tabular-nums tracking-tight">
                  {current.orderNumber}
                </span>
                <span className="text-xs font-semibold text-[#1B365D] flex items-center gap-1">
                  <PackageCheck className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                  <span>Pronto para retirada</span>
                </span>
              </div>
              <p className="text-sm font-bold text-[#0F2342] mt-0.5 truncate">
                {current.customer.name}
              </p>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[11px] text-slate-500 font-medium block">Pronto às</span>
              <span className="text-xs font-bold text-[#0F2342] font-mono tabular-nums flex items-center justify-end gap-1">
                <Clock className="w-3.5 h-3.5 text-[#EA580C]" />
                {readyTimeStr}
              </span>
            </div>
          </div>

          {/* Delivery Address Details */}
          {addressText ? (
            <div className="text-xs text-[#0F2342] bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0] flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-[#EA580C] shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[#0F2342] leading-snug">
                  {addressText}
                </p>
                {address?.reference && (
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Ref: {address.reference}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-600 bg-[#F8FAFC] p-2.5 rounded-xl border border-[#E2E8F0] flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#EA580C] shrink-0" />
              <span>Endereço de entrega informado no cadastro do pedido.</span>
            </div>
          )}

          {/* Clear message */}
          <p className="text-xs font-medium text-[#9A3412] bg-[#FFF7ED] border border-[#FED7AA] px-3 py-2 rounded-xl">
            O pedido está pronto no balcão para retirada e entrega.
          </p>

          {additionalCount > 0 && (
            <p className="text-xs font-semibold text-[#1B365D] text-center bg-[#F8FAFC] py-1.5 rounded-xl border border-[#E2E8F0]">
              + {additionalCount} outro(s) pedido(s) pronto(s) para entrega
            </p>
          )}

          {/* Dual Action Controls: Parar Som & Entendido */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {/* 1. PARAR SOM BUTTON (Stops audio immediately without closing card) */}
            <button
              type="button"
              onClick={handleStopSound}
              disabled={!isPlayingAudio || isSoundMutedManually}
              className={`min-h-[44px] py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-[0.98] ${
                isPlayingAudio && !isSoundMutedManually
                  ? 'bg-[#EA580C] hover:bg-[#C2410C] text-white shadow-xs'
                  : 'bg-[#F1F5F9] text-slate-400 border border-[#E2E8F0] cursor-default'
              }`}
              title="Interrompe o alarme sonoro imediatamente"
            >
              <VolumeX className="w-4 h-4 shrink-0" />
              <span>{isPlayingAudio && !isSoundMutedManually ? 'Parar som' : 'Som parado'}</span>
            </button>

            {/* 2. ENTENDIDO BUTTON (Confirms awareness & closes alert; preserves order status) */}
            <button
              type="button"
              onClick={() => handleAcknowledge(current.id)}
              className="min-h-[44px] py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98]"
              title="Confirma recebimento do aviso sem alterar o status do pedido"
            >
              <Check className="w-4 h-4 shrink-0" />
              <span>Entendido</span>
            </button>
          </div>

          {/* Open Order Detail in Portal */}
          {onSelectOrder && (
            <button
              type="button"
              onClick={() => handleViewOrder(current)}
              className="w-full min-h-[44px] py-2.5 px-3 bg-[#0F2342] hover:bg-[#1B365D] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Eye className="w-4 h-4 text-[#FB923C] shrink-0" />
              <span>Ver detalhes do pedido</span>
            </button>
          )}

          {additionalCount > 0 && (
            <button
              type="button"
              onClick={handleAcknowledgeAll}
              className="w-full text-center text-xs text-slate-500 hover:text-[#0F2342] underline pt-1 cursor-pointer transition-colors"
            >
              Confirmar e dispensar todos os {readyAlerts.length} avisos
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
