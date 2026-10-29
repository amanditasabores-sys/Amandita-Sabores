import React, { useState, useEffect } from 'react';
import { store } from '../../services/store';
import { thermalPrinterService } from '../../services/thermalPrinter';
import { Order } from '../../types';
import { formatTime } from '../../utils/formatters';
import { ChefHat, Clock, Check, AlertTriangle, PackageCheck, Flame, Printer } from 'lucide-react';

interface KitchenDisplaySystemProps {
  orders: Order[];
  onOrderUpdated: () => void;
}

export const KitchenDisplaySystem: React.FC<KitchenDisplaySystemProps> = ({ orders, onOrderUpdated }) => {
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [, setTicker] = useState(0);

  // Update elapsed minutes every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setTicker((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  // Filter orders in production pipeline: NOVO and EM_PREPARO
  const kitchenOrders = orders
    .filter((o) => o.status === 'NOVO' || o.status === 'EM_PREPARO')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const toggleItemCheck = (orderId: string, itemId: string) => {
    const key = `${orderId}-${itemId}`;
    setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStartPrep = async (order: Order) => {
    await store.updateOrderStatusAsync(order.id, 'EM_PREPARO', 'Cozinha / KDS', 'Iniciado preparo na cozinha');
    onOrderUpdated();
  };

  const handleFinishPrep = async (order: Order) => {
    await store.updateOrderStatusAsync(order.id, 'PRONTO', 'Cozinha / KDS', 'Finalizado preparo dos pratos, pronto para embalar e entregar');
    onOrderUpdated();
  };

  return (
    <div className="space-y-4">
      {/* KDS Header summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 text-white p-3.5 sm:p-4 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold shrink-0">
            <ChefHat className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold tracking-tight truncate">KDS - Controle de Produção da Cozinha</h2>
            <p className="text-xs text-slate-400 truncate">
              {kitchenOrders.length} pedido(s) na fila de produção em tempo real
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs shrink-0">
          <div className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 bg-emerald-500/20 text-emerald-300 rounded-lg border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Normal (&lt;15m)</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 bg-amber-500/20 text-amber-300 rounded-lg border border-amber-500/30">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>Atenção (15-25m)</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 bg-rose-500/20 text-rose-300 rounded-lg border border-rose-500/30">
            <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
            <span>Atraso (&gt;25m)</span>
          </div>
        </div>
      </div>

      {kitchenOrders.length === 0 ? (
        <div className="bg-white rounded-2xl p-16 text-center border border-slate-200 shadow-sm">
          <Flame className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-800">Cozinha sem pedidos pendentes!</h3>
          <p className="text-xs text-slate-500 mt-1">
            Todos os pratos foram preparados ou despachados. Novos pedidos aparecerão aqui automaticamente com som de alerta.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kitchenOrders.map((order) => {
            const elapsed = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
            const isLate = elapsed > 25;
            const isWarning = elapsed >= 15 && elapsed <= 25;

            const cardHeaderClass = isLate
              ? 'bg-rose-600 text-white'
              : isWarning
              ? 'bg-amber-600 text-white'
              : order.status === 'EM_PREPARO'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-white';

            return (
              <div
                key={order.id}
                className="bg-white rounded-2xl border-2 border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between"
              >
                {/* Header with timer */}
                <div className={`p-3.5 flex items-center justify-between ${cardHeaderClass}`}>
                  <div>
                    <span className="text-[10px] uppercase font-mono tracking-wider opacity-80">
                      {order.status === 'NOVO' ? 'NOVO PEDIDO' : 'EM PRODUÇÃO'}
                    </span>
                    <h3 className="text-xl font-black">{order.orderNumber}</h3>
                  </div>

                  <div className="text-right flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); thermalPrinterService.printOrder(order, { forceReprint: true }); }}
                      className="p-1.5 bg-black/30 hover:bg-black/50 text-white rounded-lg transition"
                      title={
                        thermalPrinterService.hasOrderBeenPrinted(order.id)
                          ? "Reimprimir comprovante 58mm"
                          : "Imprimir comprovante térmico 58mm (Bluetooth)"
                      }
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                    <div>
                      <div className="flex items-center gap-1 font-mono font-bold text-sm bg-black/30 px-2 py-0.5 rounded-lg">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{elapsed} min</span>
                      </div>
                      <span className="text-[10px] opacity-80 block mt-0.5">Criado: {formatTime(order.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {/* Items to prepare */}
                <div className="p-4 flex-1 space-y-3">
                  <div className="flex justify-between items-center text-xs text-slate-500 pb-2 border-b border-slate-100">
                    <span className="font-bold text-slate-700">Cliente: {order.customer.name}</span>
                    <span>{order.items.length} itens</span>
                  </div>

                  <div className="space-y-2.5">
                    {order.items.map((item) => {
                      const isChecked = !!checkedItems[`${order.id}-${item.id}`];

                      return (
                        <div
                          key={item.id}
                          onClick={() => toggleItemCheck(order.id, item.id)}
                          className={`p-2.5 rounded-xl border transition cursor-pointer select-none ${
                            isChecked
                              ? 'bg-emerald-50 border-emerald-300 text-slate-400 line-through'
                              : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${isChecked ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white'}`}>
                              {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>

                            <div className="flex-1">
                              <p className={`text-sm font-black ${isChecked ? 'text-slate-400' : 'text-slate-900'}`}>
                                <span className="text-amber-800 font-extrabold mr-1.5">{item.quantity}x</span>
                                {item.name}
                              </p>

                              {item.addons && item.addons.length > 0 && (
                                <p className="text-xs text-slate-500 mt-0.5">
                                  + {item.addons.map((a) => a.name).join(', ')}
                                </p>
                              )}

                              {item.notes && (
                                <div className="mt-1 p-1.5 bg-amber-100/70 border border-amber-300 rounded text-xs font-bold text-amber-950 flex items-center gap-1">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                  <span>OBS: {item.notes}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {order.customer.notes && (
                    <div className="p-2 bg-slate-100 rounded-xl text-xs text-slate-700 border border-slate-200">
                      <strong>Obs do pedido:</strong> {order.customer.notes}
                    </div>
                  )}
                </div>

                {/* Footer Action */}
                <div className="p-3 bg-slate-50 border-t border-slate-100">
                  {order.status === 'NOVO' ? (
                    <button
                      onClick={() => handleStartPrep(order)}
                      className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <ChefHat className="w-4 h-4" />
                      <span>Iniciar Preparo na Cozinha</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleFinishPrep(order)}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>Concluir Prato / Pronto p/ Balcão</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
