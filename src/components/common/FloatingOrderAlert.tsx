import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { soundService } from '../../services/audio';
import { Order } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { Bell, Volume2, CheckCircle, Eye, X, Utensils, Bike, Store as StoreIcon } from 'lucide-react';

interface FloatingOrderAlertProps {
  onOpenOrder?: (order: Order) => void;
}

export const FloatingOrderAlert: React.FC<FloatingOrderAlertProps> = ({ onOpenOrder }) => {
  const [activeAlerts, setActiveAlerts] = useState<Order[]>([]);
  const [isMuted, setIsMuted] = useState(false);

  const checkUnseenOrders = () => {
    const unseenIds = store.getUnseenCustomerOrderIds();
    if (unseenIds.length === 0) {
      setActiveAlerts([]);
      soundService.stopPersistentOrderAlert();
      return;
    }

    const allOrders = store.getOrders();
    const matchingOrders = unseenIds
      .map((id) => allOrders.find((o) => o.id === id))
      .filter((o): o is Order => o !== undefined && o.status !== 'CANCELADO');

    setActiveAlerts(matchingOrders);

    // If there are unseen orders and sound is enabled, ensure persistent alert loop is ringing
    if (matchingOrders.length > 0 && soundService.isEnabled() && !isMuted) {
      if (!soundService.isPersistentAlertActive()) {
        soundService.startPersistentOrderAlert(3500);
      }
    } else if (matchingOrders.length === 0) {
      soundService.stopPersistentOrderAlert();
    }
  };

  useEffect(() => {
    checkUnseenOrders();

    const handleStateChanged = (event: Event) => {
      const custom = event as CustomEvent;
      if (custom.detail?.type === 'ORDER_CREATED') {
        const order = custom.detail.payload as Order;
        const isCustomerOrder = order.status === 'NOVO' || 
          order.movements?.[0]?.author?.includes('Cardápio Web');
        if (isCustomerOrder) {
          checkUnseenOrders();
        }
      } else if (custom.detail?.type === 'ORDER_SEEN' || custom.detail?.type === 'ALERTS_SILENCED' || custom.detail?.type === 'ORDER_UPDATED') {
        checkUnseenOrders();
      }
    };

    window.addEventListener('gestaofood_state_changed', handleStateChanged);

    // Periodic safety check every 5 seconds
    const interval = window.setInterval(checkUnseenOrders, 5000);

    return () => {
      window.removeEventListener('gestaofood_state_changed', handleStateChanged);
      window.clearInterval(interval);
    };
  }, [isMuted]);

  const handleAcknowledge = (orderId: string) => {
    store.markOrderSeen(orderId);
    soundService.playSuccessTone();
    setActiveAlerts((prev) => prev.filter((o) => o.id !== orderId));
  };

  const handleAcknowledgeAll = () => {
    store.silenceAllAlerts();
    soundService.playSuccessTone();
    setActiveAlerts([]);
  };

  const handleView = (order: Order) => {
    handleAcknowledge(order.id);
    if (onOpenOrder) {
      onOpenOrder(order);
    }
  };

  if (activeAlerts.length === 0) {
    return null;
  }

  // Display the latest order prominently with counter if multiple
  const current = activeAlerts[0];
  const additionalCount = activeAlerts.length - 1;

  return (
    <aside 
      aria-label="Avisos de Novos Pedidos"
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 max-w-sm sm:max-w-md w-[calc(100vw-2rem)] animate-in slide-in-from-bottom-5 duration-300 pointer-events-auto"
    >
      <div className="bg-[#FFFDF9] rounded-2xl sm:rounded-3xl border-2 border-[#C86D3B] shadow-2xl overflow-hidden backdrop-blur-md">
        {/* Pulsing Alarm Header Bar */}
        <div className="bg-gradient-to-r from-[#2C1810] via-[#5C2318] to-[#721C24] text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500"></span>
            </span>
            <span className="text-xs font-black tracking-wide uppercase text-amber-200 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-300 animate-bounce" />
              <span>Novo Pedido do Cardápio!</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-300/90 bg-white/10 px-2 py-0.5 rounded-full">
              <Volume2 className="w-3 h-3 animate-pulse" />
              <span>Alerta Ativo</span>
            </span>
            <button
              onClick={() => handleAcknowledge(current.id)}
              className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
              title="Fechar e silenciar este aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-black text-[#2C1810] font-mono">
                  {current.orderNumber}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#C86D3B]/15 text-[#C86D3B] border border-[#C86D3B]/25">
                  {current.fulfillmentType === 'DELIVERY' ? '🛵 Delivery' : '🛍️ Balcão'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                  {current.paymentMethod}
                </span>
              </div>
              <p className="text-sm font-bold text-[#3D2314] mt-0.5">
                {current.customer.name}
              </p>
              {current.customer.phone && (
                <p className="text-xs text-[#8C5E47] font-mono">
                  Tel: {current.customer.phone}
                </p>
              )}
            </div>

            <div className="text-right shrink-0">
              <span className="text-[11px] text-[#8C5E47] block font-medium">Total do Pedido</span>
              <span className="text-lg font-black text-[#721C24]">
                {formatCurrency(current.totalAmount)}
              </span>
            </div>
          </div>

          {/* Items snippet preview */}
          <div className="bg-[#FAF7F2] rounded-xl p-2.5 border border-[#E8DFD5] text-xs space-y-1 max-h-24 overflow-y-auto scrollbar-thin">
            {current.items.map((it, idx) => (
              <div key={idx} className="flex items-center justify-between text-[#3D2314]">
                <span className="font-semibold truncate pr-2">
                  <strong className="text-[#C86D3B]">{it.quantity}x</strong> {it.name}
                  {it.addons && it.addons.length > 0 && (
                    <span className="text-[10px] text-[#8C5E47] ml-1">
                      (+{it.addons.map((a) => a.name).join(', ')})
                    </span>
                  )}
                </span>
                <span className="font-bold text-[#721C24] shrink-0 font-mono">
                  {formatCurrency(it.subtotal)}
                </span>
              </div>
            ))}
          </div>

          {current.fulfillmentType === 'DELIVERY' && current.customer.address && (
            <div className="text-[11px] text-[#2C1810] bg-white p-2 rounded-lg border border-[#E8DFD5] flex items-center gap-1.5">
              <Bike className="w-3.5 h-3.5 text-[#C86D3B] shrink-0" />
              <span className="font-semibold truncate">
                {current.customer.address.street}, {current.customer.address.number} {current.customer.address.complement ? `(${current.customer.address.complement})` : ''}
              </span>
            </div>
          )}

          {current.customer.notes && (
            <p className="text-[11px] text-[#8C5E47] italic bg-amber-50/70 p-2 rounded-lg border border-amber-200/50">
              <strong>Obs:</strong> {current.customer.notes}
            </p>
          )}

          {additionalCount > 0 && (
            <p className="text-[11px] font-bold text-[#C86D3B] text-center">
              + {additionalCount} outro(s) pedido(s) pendente(s) de confirmação
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleAcknowledge(current.id)}
              className="flex-1 py-2.5 px-3 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-extrabold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
            >
              <CheckCircle className="w-4 h-4 text-emerald-200" />
              <span>Marcar como Visto (Silenciar)</span>
            </button>

            {onOpenOrder && (
              <button
                type="button"
                onClick={() => handleView(current)}
                className="py-2.5 px-3 bg-[#FAF7F2] hover:bg-[#F2EAE0] border border-[#E8DFD5] text-[#2C1810] font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                title="Abrir no painel"
              >
                <Eye className="w-3.5 h-3.5 text-[#C86D3B]" />
                <span className="hidden sm:inline">Ver Pedido</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
