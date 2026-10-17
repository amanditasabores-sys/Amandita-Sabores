import React, { useState, useMemo } from 'react';
import { Order, OrderMovementLog } from '../../types';
import { formatDateTime, getStatusDetails } from '../../utils/formatters';
import { History, Search, ArrowRight, UserCheck, ShieldCheck, Clock } from 'lucide-react';

interface MovementAuditLogProps {
  orders: Order[];
}

export const MovementAuditLog: React.FC<MovementAuditLogProps> = ({ orders }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [authorFilter, setAuthorFilter] = useState('TODOS');

  // Flatten all movements across orders with order context
  const allLogs = useMemo(() => {
    const list: (OrderMovementLog & { orderNumber: string; customerName: string; orderTotal: number })[] = [];

    orders.forEach((order) => {
      order.movements.forEach((mov) => {
        list.push({
          ...mov,
          orderNumber: order.orderNumber,
          customerName: order.customer.name,
          orderTotal: order.totalAmount,
        });
      });
    });

    // Sort by latest timestamp first
    list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return list;
  }, [orders]);

  // Authors filter
  const authors = useMemo(() => {
    const set = new Set(allLogs.map((l) => l.author));
    return ['TODOS', ...Array.from(set)];
  }, [allLogs]);

  const filteredLogs = useMemo(() => {
    return allLogs.filter((log) => {
      if (authorFilter !== 'TODOS' && log.author !== authorFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          log.orderNumber.toLowerCase().includes(q) ||
          log.customerName.toLowerCase().includes(q) ||
          (log.notes && log.notes.toLowerCase().includes(q)) ||
          log.author.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allLogs, authorFilter, searchTerm]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Histórico Completo de Movimentações</h3>
            <p className="text-xs text-slate-500">
              Trilha de auditoria em tempo real com timestamp e responsável por cada alteração
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por pedido ou cliente..."
              className="pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <select
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700"
          >
            {authors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {filteredLogs.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-xs italic">
          Nenhuma movimentação encontrada com os filtros informados.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                <th className="py-3 px-2">Data e Hora</th>
                <th className="py-3 px-2">Pedido / Cliente</th>
                <th className="py-3 px-2">Transição de Status</th>
                <th className="py-3 px-2">Responsável</th>
                <th className="py-3 px-2">Detalhes / Observações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.map((log) => {
                const toDetails = getStatusDetails(log.toStatus);
                const fromDetails = log.fromStatus ? getStatusDetails(log.fromStatus) : null;

                return (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-2 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                      {formatDateTime(log.timestamp)}
                    </td>
                    <td className="py-3 px-2 whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-900 block">{log.orderNumber}</span>
                      <span className="text-[11px] text-slate-500">{log.customerName}</span>
                    </td>
                    <td className="py-3 px-2 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-semibold">
                        {fromDetails ? (
                          <>
                            <span className={`px-2 py-0.5 rounded text-[10px] ${fromDetails.bgLightClass} ${fromDetails.colorClass}`}>
                              {fromDetails.label}
                            </span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                          </>
                        ) : null}
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${toDetails.bgLightClass} ${toDetails.colorClass}`}>
                          {toDetails.label}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 whitespace-nowrap font-medium text-slate-800">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded-lg text-slate-700">
                        <UserCheck className="w-3 h-3 text-slate-500" />
                        {log.author}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-slate-600 max-w-xs truncate">
                      {log.notes || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
