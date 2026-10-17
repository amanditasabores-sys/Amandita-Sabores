import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { Order, OrderStatus } from '../../types';
import { formatCurrency, formatTime, getStatusDetails, getPaymentMethodLabel } from '../../utils/formatters';
import { 
  CheckCircle, 
  Clock, 
  MapPin, 
  Phone, 
  ChefHat, 
  Bike, 
  PackageCheck, 
  MessageCircle, 
  Copy, 
  Check, 
  ArrowLeft,
  AlertTriangle
} from 'lucide-react';

interface OrderTrackingViewProps {
  orderId: string;
  onNavigateToMenu?: () => void;
}

export const OrderTrackingView: React.FC<OrderTrackingViewProps> = ({ orderId, onNavigateToMenu }) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const config = store.getRestaurantConfig();

  const loadOrder = () => {
    const found = store.getOrderById(orderId);
    if (found) {
      setOrder({ ...found });
    }
  };

  useEffect(() => {
    loadOrder();

    const handleUpdate = () => {
      loadOrder();
    };

    window.addEventListener('gestaofood_state_changed', handleUpdate);
    const interval = setInterval(loadOrder, 3000); // Polling backup

    return () => {
      window.removeEventListener('gestaofood_state_changed', handleUpdate);
      clearInterval(interval);
    };
  }, [orderId]);

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-800">Pedido Não Encontrado</h2>
          <p className="text-sm text-slate-500 mt-2 mb-6">
            Não localizamos o pedido com o identificador <span className="font-mono font-bold text-slate-700">{orderId}</span>.
          </p>
          {onNavigateToMenu && (
            <button
              onClick={onNavigateToMenu}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded-xl text-sm transition"
            >
              Ir para o Cardápio
            </button>
          )}
        </div>
      </div>
    );
  }

  const statusInfo = getStatusDetails(order.status);

  // Calculate remaining estimated minutes
  const createdDate = new Date(order.createdAt).getTime();
  const elapsedMinutes = Math.floor((Date.now() - createdDate) / 60000);
  const remainingMinutes = Math.max(0, order.estimatedDeliveryMinutes - elapsedMinutes);

  const steps: { key: OrderStatus; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      key: 'NOVO',
      label: 'Recebido',
      icon: <Clock className="w-4 h-4" />,
      desc: 'Pedido registrado e enviado para a cozinha',
    },
    {
      key: 'EM_PREPARO',
      label: 'Em Preparo',
      icon: <ChefHat className="w-4 h-4" />,
      desc: 'Pratos sendo preparados pelos nossos chefs',
    },
    {
      key: 'PRONTO',
      label: 'Pronto / Embalado',
      icon: <PackageCheck className="w-4 h-4" />,
      desc: 'Pedido pronto, aguardando saída do motoboy',
    },
    {
      key: 'EM_ROTA',
      label: 'Saiu para Entrega',
      icon: <Bike className="w-4 h-4" />,
      desc: order.deliveryPerson ? `Com ${order.deliveryPerson.name} a caminho do seu endereço` : 'A caminho do seu endereço',
    },
    {
      key: 'ENTREGUE',
      label: 'Entregue',
      icon: <CheckCircle className="w-4 h-4" />,
      desc: 'Entregue com sucesso! Bom apetite!',
    },
  ];

  const getStepStatus = (stepKey: OrderStatus) => {
    const orderStepWeight: Record<OrderStatus, number> = {
      'CANCELADO': -1,
      'NOVO': 1,
      'EM_PREPARO': 2,
      'PRONTO': 3,
      'EM_ROTA': 4,
      'ENTREGUE': 5,
    };
    const currentWeight = orderStepWeight[order.status] || 0;
    const targetWeight = orderStepWeight[stepKey] || 0;

    if (order.status === 'CANCELADO') return 'canceled';
    if (currentWeight > targetWeight) return 'completed';
    if (currentWeight === targetWeight) return 'active';
    return 'pending';
  };

  const copyTrackingLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const openWhatsAppHelp = () => {
    const text = encodeURIComponent(`Olá! Gostaria de informações sobre meu pedido ${order.orderNumber} em nome de ${order.customer.name}.`);
    window.open(`https://wa.me/${config.whatsapp}?text=${text}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-100/70 pb-16">
      {/* Top Bar */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onNavigateToMenu && (
              <button
                onClick={onNavigateToMenu}
                className="p-1.5 -ml-1 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition"
                title="Voltar ao Cardápio"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h1 className="font-bold text-sm tracking-tight">{config.name}</h1>
              <p className="text-[11px] text-amber-400 font-mono">Rastreamento de Pedido {order.orderNumber}</p>
            </div>
          </div>
          <button
            onClick={copyTrackingLink}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg transition"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Link Copiado!' : 'Copiar Link'}</span>
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 space-y-4">
        {/* Real-time Status Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 overflow-hidden relative">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Status em Tempo Real</span>
              <h2 className="text-2xl font-extrabold text-slate-900 mt-0.5">{statusInfo.label}</h2>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-semibold border flex items-center gap-2 ${statusInfo.bgLightClass} ${statusInfo.colorClass} ${statusInfo.borderClass}`}>
              <span className={`w-2 h-2 rounded-full ${statusInfo.dotColorClass}`} />
              <span>{order.status === 'ENTREGUE' ? 'Finalizado' : 'Em Andamento'}</span>
            </div>
          </div>

          {/* Delivery estimate indicator */}
          {order.status !== 'ENTREGUE' && order.status !== 'CANCELADO' && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-amber-900">Previsão Estimada de Entrega</p>
                  <p className="text-lg font-bold text-amber-950">
                    {remainingMinutes > 0 ? `Aproximadamente ${remainingMinutes} a ${remainingMinutes + 10} min` : 'Chegando a qualquer momento!'}
                  </p>
                </div>
              </div>
              <div className="text-right text-xs text-amber-800">
                <span>Criado às</span>
                <p className="font-semibold">{formatTime(order.createdAt)}</p>
              </div>
            </div>
          )}

          {/* Step Timeline */}
          <div className="space-y-4 mt-6">
            {steps.map((step, idx) => {
              const state = getStepStatus(step.key);
              const isLast = idx === steps.length - 1;

              return (
                <div key={step.key} className="flex items-start gap-3.5 relative">
                  {!isLast && (
                    <div 
                      className={`absolute left-4 top-8 bottom-0 w-0.5 -ml-[1px] ${
                        state === 'completed' ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}
                    />
                  )}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 transition-colors ${
                      state === 'completed'
                        ? 'bg-emerald-500 text-white shadow-sm'
                        : state === 'active'
                        ? 'bg-amber-500 text-slate-950 ring-4 ring-amber-100 font-bold'
                        : 'bg-slate-100 text-slate-400 border border-slate-200'
                    }`}
                  >
                    {state === 'completed' ? <Check className="w-4 h-4 stroke-[3]" /> : step.icon}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-bold ${state === 'active' ? 'text-amber-950' : state === 'completed' ? 'text-slate-800' : 'text-slate-400'}`}>
                        {step.label}
                      </p>
                      {state === 'active' && (
                        <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                          Etapa Atual
                        </span>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 ${state === 'active' ? 'text-slate-700' : 'text-slate-500'}`}>
                      {step.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Motoboy / Entregador Info if dispatched */}
        {order.deliveryPerson && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-indigo-100 bg-gradient-to-r from-indigo-50/40 to-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                  <Bike className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">Entregador Responsável</span>
                  <p className="text-base font-bold text-slate-900">{order.deliveryPerson.name}</p>
                  <p className="text-xs text-slate-500">{order.deliveryPerson.phone}</p>
                </div>
              </div>
              <a
                href={`tel:${order.deliveryPerson.phone.replace(/\D/g, '')}`}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Ligar</span>
              </a>
            </div>
          </div>
        )}

        {/* Order Items & Summary */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-bold text-slate-900 text-sm mb-3">Itens do Pedido ({order.items.length})</h3>
          <div className="divide-y divide-slate-100">
            {order.items.map((item) => (
              <div key={item.id} className="py-2.5 flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    <span className="text-amber-700 font-bold mr-1.5">{item.quantity}x</span>
                    {item.name}
                  </p>
                  {item.addons && item.addons.length > 0 && (
                    <p className="text-xs text-slate-500 ml-5">
                      + {item.addons.map((a) => a.name).join(', ')}
                    </p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-amber-700 italic ml-5 mt-0.5">
                      Obs: {item.notes}
                    </p>
                  )}
                </div>
                <span className="text-sm font-bold text-slate-700 ml-3">
                  {formatCurrency(item.subtotal)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-100 pt-3 mt-3 space-y-1.5 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Subtotal dos itens</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Taxa de entrega</span>
              <span>{formatCurrency(order.deliveryFee)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Desconto</span>
                <span>-{formatCurrency(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-2 border-t border-slate-200">
              <span>Total a pagar</span>
              <span className="text-amber-800 text-base">{formatCurrency(order.totalAmount)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500 pt-1">
              <span>Forma de Pagamento</span>
              <span className="font-semibold text-slate-700">{getPaymentMethodLabel(order.paymentMethod)} ({order.paymentStatus === 'PAGO' ? 'Pago' : 'Pagar na Entrega'})</span>
            </div>
          </div>
        </div>

        {/* Delivery Address Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-1">
                {order.fulfillmentType === 'RETIRADA' ? 'Local de Retirada' : 'Local da Entrega'}
              </h4>
              {order.fulfillmentType === 'RETIRADA' || !order.customer.address ? (
                <p className="text-sm font-semibold text-emerald-800">
                  Retirada no Balcão do Estabelecimento ({config.address} - {config.city})
                </p>
              ) : (
                <>
                  <p className="text-sm font-semibold text-slate-800">
                    {order.customer.address.street}, {order.customer.address.number}
                  </p>
                  <p className="text-xs text-slate-500">
                    {order.customer.address.neighborhood}
                    {order.customer.address.complement && ` · ${order.customer.address.complement}`}
                    {` · ${order.customer.address.city}`}
                  </p>
                  {order.customer.address.reference && (
                    <p className="text-xs text-amber-800 mt-1">
                      Ponto de Ref.: {order.customer.address.reference}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* WhatsApp Help CTA */}
        <button
          onClick={openWhatsAppHelp}
          className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
        >
          <MessageCircle className="w-5 h-5" />
          <span>Falar com o Restaurante via WhatsApp</span>
        </button>
      </main>
    </div>
  );
};
