import React, { useState, useMemo } from 'react';
import { Order, MenuItem } from '../../types';
import { store } from '../../services/store';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { 
  DollarSign, 
  TrendingUp, 
  ShoppingBag, 
  PieChart, 
  Calendar, 
  Download, 
  Printer, 
  ArrowUpRight, 
  Bike,
  CreditCard,
  Trash2
} from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';

interface FinancialReportsProps {
  orders: Order[];
}

export const FinancialReports: React.FC<FinancialReportsProps> = ({ orders }) => {
  const [period, setPeriod] = useState<'today' | 'yesterday' | '7days' | '30days' | 'all'>('7days');
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const menuItems = store.getMenuItems();

  // Create menu map for cost calculation
  const menuMap = useMemo(() => {
    const map = new Map<string, MenuItem>();
    menuItems.forEach((i) => map.set(i.id, i));
    return map;
  }, [menuItems]);

  // Filter orders by period
  const filteredOrders = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    return orders.filter((order) => {
      // Don't count canceled orders in financial revenue
      if (order.status === 'CANCELADO') return false;

      const orderTime = new Date(order.createdAt).getTime();

      switch (period) {
        case 'today':
          return orderTime >= startOfToday;
        case 'yesterday': {
          const startOfYesterday = startOfToday - 86400000;
          return orderTime >= startOfYesterday && orderTime < startOfToday;
        }
        case '7days':
          return orderTime >= now.getTime() - 7 * 86400000;
        case '30days':
          return orderTime >= now.getTime() - 30 * 86400000;
        case 'all':
        default:
          return true;
      }
    });
  }, [orders, period]);

  // Financial aggregates
  const totalGrossRevenue = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  }, [filteredOrders]);

  const totalDeliveryFees = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + o.deliveryFee, 0);
  }, [filteredOrders]);

  const totalFoodRevenue = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + o.subtotal, 0);
  }, [filteredOrders]);

  const orderCount = filteredOrders.length;
  const avgTicket = orderCount > 0 ? totalGrossRevenue / orderCount : 0;

  // Breakdown by Category of Products Sold
  const categoryStats = useMemo(() => {
    const catMap: Record<string, { category: string; quantity: number; revenue: number; estimatedCost: number }> = {};

    filteredOrders.forEach((ord) => {
      ord.items.forEach((item) => {
        const menuItem = menuMap.get(item.menuItemId);
        const category = menuItem?.category || 'Outros / Especiais';
        const cost = (menuItem?.costPrice || item.unitPrice * 0.4) * item.quantity;

        if (!catMap[category]) {
          catMap[category] = { category, quantity: 0, revenue: 0, estimatedCost: 0 };
        }

        catMap[category].quantity += item.quantity;
        catMap[category].revenue += item.subtotal;
        catMap[category].estimatedCost += cost;
      });
    });

    const list = Object.values(catMap);
    list.sort((a, b) => b.revenue - a.revenue);
    return list;
  }, [filteredOrders, menuMap]);

  // Breakdown by Payment Method
  const paymentStats = useMemo(() => {
    const pMap: Record<string, { label: string; count: number; total: number }> = {
      PIX: { label: 'PIX Instantâneo', count: 0, total: 0 },
      CARTAO_CREDITO: { label: 'Cartão de Crédito', count: 0, total: 0 },
      CARTAO_DEBITO: { label: 'Cartão de Débito', count: 0, total: 0 },
      DINHEIRO: { label: 'Dinheiro', count: 0, total: 0 },
    };

    filteredOrders.forEach((ord) => {
      if (pMap[ord.paymentMethod]) {
        pMap[ord.paymentMethod].count += 1;
        pMap[ord.paymentMethod].total += ord.totalAmount;
      }
    });

    return Object.values(pMap);
  }, [filteredOrders]);

  // Export to CSV
  const exportToCSV = () => {
    const headers = ['Numero_Pedido', 'Data_Hora', 'Cliente', 'Telefone', 'Subtotal', 'Taxa_Entrega', 'Total', 'Forma_Pagamento', 'Status'];
    const rows = filteredOrders.map((o) => [
      o.orderNumber,
      formatDateTime(o.createdAt),
      `"${o.customer.name.replace(/"/g, '""')}"`,
      o.customer.phone,
      o.subtotal.toFixed(2),
      o.deliveryFee.toFixed(2),
      o.totalAmount.toFixed(2),
      o.paymentMethod,
      o.status
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `relatorio_financeiro_${period}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span className="text-xs font-bold text-slate-700">Período de Análise:</span>
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {[
              { id: 'today', label: 'Hoje' },
              { id: 'yesterday', label: 'Ontem' },
              { id: '7days', label: 'Últimos 7 dias' },
              { id: '30days', label: 'Últimos 30 dias' },
              { id: 'all', label: 'Todo o Período' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id as typeof period)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  period === p.id
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportToCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir</span>
          </button>
        </div>
      </div>

      {/* Main KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Faturamento Bruto</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{formatCurrency(totalGrossRevenue)}</p>
          <div className="flex items-center gap-1 text-[11px] text-emerald-700 font-semibold mt-1">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Produtos: {formatCurrency(totalFoodRevenue)}</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total de Pedidos</span>
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{orderCount}</p>
          <p className="text-[11px] text-slate-500 mt-1">Pedidos válidos no período</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Ticket Médio</span>
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{formatCurrency(avgTicket)}</p>
          <p className="text-[11px] text-slate-500 mt-1">Média por pedido fechado</p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Taxas de Entrega</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
              <Bike className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">{formatCurrency(totalDeliveryFees)}</p>
          <p className="text-[11px] text-slate-500 mt-1">Coletado para logística / motoboys</p>
        </div>
      </div>

      {/* Relatórios Detalhados por Categoria de Produtos Vendidos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Vendas por Categoria de Produtos</h3>
              <p className="text-xs text-slate-500">
                Faturamento e volume de pratos distribuídos por categoria no cardápio
              </p>
            </div>
            <PieChart className="w-5 h-5 text-amber-500" />
          </div>

          {categoryStats.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-8 text-center">Nenhuma venda registrada no período selecionado.</p>
          ) : (
            <div className="space-y-4 pt-2">
              {categoryStats.map((cat) => {
                const percent = totalFoodRevenue > 0 ? (cat.revenue / totalFoodRevenue) * 100 : 0;

                return (
                  <div key={cat.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{cat.category}</span>
                        <span className="text-slate-400">({cat.quantity} un vendidas)</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-slate-900">{formatCurrency(cat.revenue)}</span>
                        <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                          {percent.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Visual Progress Bar */}
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(3, percent))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Forma de Pagamento */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Formas de Pagamento</h3>
              <p className="text-xs text-slate-500">Distribuição financeira por canal</p>
            </div>
            <CreditCard className="w-5 h-5 text-slate-400" />
          </div>

          <div className="space-y-3 pt-2">
            {paymentStats.map((pay) => {
              const percent = totalGrossRevenue > 0 ? (pay.total / totalGrossRevenue) * 100 : 0;

              return (
                <div key={pay.label} className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-800">{pay.label}</span>
                    <span className="font-mono font-bold text-slate-900">{formatCurrency(pay.total)}</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] text-slate-400">
                    <span>{pay.count} transações</span>
                    <span>{percent.toFixed(1)}% do total</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* LANÇAMENTOS DO PERÍODO COM OPÇÃO DE EXCLUIR */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">Lançamentos de Vendas do Período ({filteredOrders.length})</h3>
            <p className="text-xs text-slate-500">
              Gerencie cada venda individual e exclua lançamentos de teste ou cancelados
            </p>
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs italic">
            Nenhum lançamento no período selecionado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="py-3 px-2">Pedido</th>
                  <th className="py-3 px-2">Data e Hora</th>
                  <th className="py-3 px-2">Cliente</th>
                  <th className="py-3 px-2">Forma Pgto</th>
                  <th className="py-3 px-2 text-right">Subtotal</th>
                  <th className="py-3 px-2 text-right">Taxa Entrega</th>
                  <th className="py-3 px-2 text-right">Total</th>
                  <th className="py-3 px-2 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {ord.orderNumber}
                    </td>
                    <td className="py-3 px-2 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                      {formatDateTime(ord.createdAt)}
                    </td>
                    <td className="py-3 px-2 whitespace-nowrap">
                      <span className="font-semibold text-slate-800 block">{ord.customer.name}</span>
                      <span className="text-[11px] text-slate-400">{ord.items.length} item(ns)</span>
                    </td>
                    <td className="py-3 px-2 text-slate-600 whitespace-nowrap font-medium">
                      {ord.paymentMethod}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-slate-600 whitespace-nowrap">
                      {formatCurrency(ord.subtotal)}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-slate-600 whitespace-nowrap">
                      {formatCurrency(ord.deliveryFee)}
                    </td>
                    <td className="py-3 px-2 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                      {formatCurrency(ord.totalAmount)}
                    </td>
                    <td className="py-3 px-2 text-center whitespace-nowrap">
                      <button
                        onClick={() => setOrderToDelete(ord)}
                        className="px-2.5 py-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg text-xs font-semibold transition inline-flex items-center gap-1 cursor-pointer"
                        title="Excluir este lançamento de venda"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Excluir</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CONFIRM MODAL FOR DELETE ORDER IN FINANCIAL REPORTS */}
      {orderToDelete && (
        <ConfirmModal
          isOpen={true}
          title="Excluir Lançamento de Venda"
          message={`Deseja realmente EXCLUIR o lançamento da venda ${orderToDelete.orderNumber} (${orderToDelete.customer.name}) no valor de ${formatCurrency(orderToDelete.totalAmount)}? O lançamento será removido dos relatórios financeiros e do caixa.`}
          confirmLabel="Excluir Lançamento"
          cancelLabel="Cancelar"
          isDanger={true}
          onConfirm={() => {
            store.deleteOrder(orderToDelete.id);
            setOrderToDelete(null);
          }}
          onCancel={() => setOrderToDelete(null)}
        />
      )}
    </div>
  );
};
