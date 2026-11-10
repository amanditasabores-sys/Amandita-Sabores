import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { soundService } from '../../services/audio';
import { Order, User } from '../../types';
import { formatTime } from '../../utils/formatters';
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
  const addressText = address
    ? `${address.street || ''}, ${address.number || 'S/N'}${address.complement ? ` (${address.complement})` : ''} - ${address.neighborhood || ''}${address.city ? ` · ${address.city}` : ''}`
    : null;

  return (
    <aside
      aria-label="Notificação de Pedido Pronto para Entrega"
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 max-w-sm sm:max-w-md w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-5 duration-300 pointer-events-auto"
    >
      <div className="bg-slate-900 border-2 border-amber-500/80 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden backdrop-blur-xl ring-1 ring-amber-500/30">
        {/* Pulsing Alarm Header Bar */}
        <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-amber-900 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-90"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-200"></span>
            </span>
            <div className="flex items-center gap-1.5 font-black text-xs tracking-wide uppercase text-white">
              <Bike className="w-4 h-4 text-amber-200 animate-bounce" />
              <span>Pedido pronto para entrega!</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {isPlayingAudio && !isSoundMutedManually && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-200 bg-black/30 px-2 py-0.5 rounded-full">
                <Volume2 className="w-3 h-3 animate-pulse text-amber-300" />
                <span className="hidden sm:inline">Tocando</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => handleAcknowledge(current.id)}
              className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
              title="Dispensar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-3 bg-slate-900/95 text-slate-100">
          {/* Order Header & Time */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-amber-400 font-mono tracking-tight">
                  {current.orderNumber}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <PackageCheck className="w-3 h-3" />
                  Pronto para Retirada
                </span>
              </div>
              <p className="text-sm font-bold text-white mt-0.5">
                {current.customer.name}
              </p>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Pronto às</span>
              <span className="text-xs font-bold text-slate-200 font-mono flex items-center justify-end gap-1">
                <Clock className="w-3 h-3 text-amber-400" />
                {readyTimeStr}
              </span>
            </div>
          </div>

          {/* Delivery Address Details */}
          {addressText ? (
            <div className="text-xs text-slate-200 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2">
              <MapPin className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-100 leading-snug">
                  {addressText}
                </p>
                {address?.reference && (
                  <p className="text-[11px] text-slate-400 mt-0.5 italic">
                    Ref: {address.reference}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-300 bg-slate-950/80 p-2 rounded-xl border border-slate-800 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Endereço de entrega informado no cadastro do pedido.</span>
            </div>
          )}

          {/* Clear message */}
          <p className="text-xs font-medium text-amber-200/90 bg-amber-950/40 border border-amber-900/50 p-2 rounded-xl">
            📦 <strong>Mensagem:</strong> O pedido está pronto para ser retirado e entregue.
          </p>

          {additionalCount > 0 && (
            <p className="text-[11px] font-bold text-amber-400 text-center bg-amber-500/10 py-1 rounded-lg border border-amber-500/20">
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
              className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95 ${
                isPlayingAudio && !isSoundMutedManually
                  ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md ring-2 ring-amber-400/50'
                  : 'bg-slate-800/80 text-slate-400 border border-slate-700/50 cursor-default opacity-70'
              }`}
              title="Interrompe o alarme sonoro imediatamente"
            >
              {isPlayingAudio && !isSoundMutedManually ? (
                <>
                  <VolumeX className="w-4 h-4 text-slate-950" />
                  <span>Parar som</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-4 h-4" />
                  <span>Som parado</span>
                </>
              )}
            </button>

            {/* 2. ENTENDIDO BUTTON (Confirms awareness & closes alert; preserves order status) */}
            <button
              type="button"
              onClick={() => handleAcknowledge(current.id)}
              className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 ring-1 ring-emerald-400/30"
              title="Confirma recebimento do aviso sem alterar o status do pedido"
            >
              <Check className="w-4 h-4 text-emerald-200" />
              <span>Entendido</span>
            </button>
          </div>

          {/* Open Order Detail in Portal */}
          {onSelectOrder && (
            <button
              type="button"
              onClick={() => handleViewOrder(current)}
              className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-amber-400" />
              <span>Ver Detalhes do Pedido no Portal</span>
            </button>
          )}

          {additionalCount > 0 && (
            <button
              type="button"
              onClick={handleAcknowledgeAll}
              className="w-full text-center text-[11px] text-slate-400 hover:text-slate-200 underline pt-1 cursor-pointer transition-colors"
            >
              Confirmar e dispensar todos os {readyAlerts.length} avisos
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
