import React, { useState } from 'react';
import { store } from '../../services/store';
import { thermalPrinterService } from '../../services/thermalPrinter';
import { Order, OrderStatus } from '../../types';
import { formatCurrency, formatDateTime, formatTime, getPaymentMethodLabel, getStatusDetails } from '../../utils/formatters';
import { generateQRCodeDataUrl } from '../../utils/qrcode';
import { getPublicAppUrl } from '../../utils/url';
import { 
  Clock, 
  ChefHat, 
  PackageCheck, 
  Bike, 
  CheckCircle, 
  XCircle, 
  Printer, 
  MapPin, 
  Phone, 
  ExternalLink, 
  QrCode, 
  AlertCircle,
  Trash2,
  UploadCloud,
  FileText,
  X
} from 'lucide-react';
import { User } from '../../types';
import { ConfirmModal } from '../common/ConfirmModal';

interface LiveOrdersKanbanProps {
  orders: Order[];
  onOrderUpdated: () => void;
  currentUser?: User | null;
}

export const LiveOrdersKanban: React.FC<LiveOrdersKanbanProps> = ({ orders, onOrderUpdated, currentUser }) => {
  const [selectedOrderForModal, setSelectedOrderForModal] = useState<Order | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [printableOrder, setPrintableOrder] = useState<Order | null>(null);
  const [receiptQrCode, setReceiptQrCode] = useState<string>('');
  const [users, setUsers] = useState<User[]>(() => store.getUsers());
  const [isDeletingOrder, setIsDeletingOrder] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  // Cancellation & Refund Modal state
  const [orderToCancelModal, setOrderToCancelModal] = useState<Order | null>(null);
  const [cancelReasonInput, setCancelReasonInput] = useState('');
  const [cancelErrorMsg, setCancelErrorMsg] = useState<string | null>(null);
  const [cancelSuccessResult, setCancelSuccessResult] = useState<{ order: Order; message: string } | null>(null);

  const handleOpenCancelModal = (order: Order) => {
    setOrderToCancelModal(order);
    setCancelReasonInput('');
    setCancelErrorMsg(null);
  };

  const handleConfirmCancelOrder = () => {
    if (!orderToCancelModal) return;
    if (!cancelReasonInput.trim()) {
      setCancelErrorMsg('Por favor informe o motivo obrigatório do cancelamento.');
      return;
    }
    const operator = currentUser?.name || currentUser?.username || 'Administrador';
    const res = store.cancelOrder(orderToCancelModal.id, cancelReasonInput.trim(), operator);
    if (!res.success) {
      setCancelErrorMsg(res.message);
      return;
    }
    const updated = store.getOrderById(orderToCancelModal.id);
    setOrderToCancelModal(null);
    onOrderUpdated();
    if (selectedOrderForModal && selectedOrderForModal.id === orderToCancelModal.id && updated) {
      setSelectedOrderForModal(updated);
    }
    if (updated) {
      setCancelSuccessResult({
        order: updated,
        message: res.message,
      });
      setTimeout(() => setCancelSuccessResult(null), 10000);
    }
  };

  React.useEffect(() => {
    const handleState = () => setUsers(store.getUsers());
    window.addEventListener('gestaofood_state_changed', handleState);
    return () => window.removeEventListener('gestaofood_state_changed', handleState);
  }, []);

  const activeDrivers = users.filter((u) => u.role?.toUpperCase() === 'ENTREGADOR' && u.status === 'ATIVO');

  const handleReassignDriver = (orderId: string, driverId: string) => {
    const adminName = currentUser?.name || currentUser?.username || 'Administrador';
    if (!driverId) {
      store.assignDeliveryPerson(orderId, null, adminName);
    } else {
      const driver = activeDrivers.find((d) => d.id === driverId);
      if (driver) {
        store.assignDeliveryPerson(
          orderId,
          {
            id: driver.id,
            name: driver.name || driver.username,
            phone: driver.phone || '',
          },
          adminName
        );
      }
    }
    onOrderUpdated();
    if (selectedOrderForModal && selectedOrderForModal.id === orderId) {
      setSelectedOrderForModal(store.getOrderById(orderId) || null);
    }
  };

  const config = store.getRestaurantConfig();

  const handleDeleteOrder = (order: Order) => {
    setDeleteErrorMessage(null);
    setOrderToDelete(order);
  };

  const executeDeleteOrder = async () => {
    if (!orderToDelete || isDeletingOrder) return;
    setIsDeletingOrder(true);
    setDeleteErrorMessage(null);
    try {
      const res = await store.deleteOrderAsync(orderToDelete.id);
      if (res.success) {
        setSelectedOrderForModal(null);
        setOrderToDelete(null);
        onOrderUpdated();
      } else {
        setDeleteErrorMessage(res.error || 'Não foi possível excluir o pedido no servidor. Tente novamente.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDeleteErrorMessage(msg || 'Erro inesperado ao excluir o pedido.');
    } finally {
      setIsDeletingOrder(false);
    }
  };

  // Columns definition
  const columns: { status: OrderStatus; title: string; count: number; colorClass: string }[] = [
    {
      status: 'NOVO',
      title: 'Novos Pedidos',
      count: orders.filter((o) => o.status === 'NOVO').length,
      colorClass: 'border-amber-400 bg-amber-500/10 text-amber-800',
    },
    {
      status: 'EM_PREPARO',
      title: 'Em Preparo (Cozinha)',
      count: orders.filter((o) => o.status === 'EM_PREPARO').length,
      colorClass: 'border-blue-400 bg-blue-500/10 text-blue-800',
    },
    {
      status: 'PRONTO',
      title: 'Pronto (Aguardando Retirada)',
      count: orders.filter((o) => o.status === 'PRONTO').length,
      colorClass: 'border-purple-400 bg-purple-500/10 text-purple-800',
    },
    {
      status: 'EM_ROTA',
      title: 'Em Rota / Saiu para Entrega',
      count: orders.filter((o) => o.status === 'EM_ROTA').length,
      colorClass: 'border-indigo-400 bg-indigo-500/10 text-indigo-800',
    },
    {
      status: 'ENTREGUE',
      title: 'Entregue (Concluído)',
      count: orders.filter((o) => o.status === 'ENTREGUE').length,
      colorClass: 'border-emerald-400 bg-emerald-500/10 text-emerald-800',
    },
  ];

  const handleAdvanceStatus = async (order: Order, nextStatus: OrderStatus) => {
    await store.updateOrderStatusAsync(order.id, nextStatus, 'Painel Administrativo', `Avançado para ${nextStatus}`);
    onOrderUpdated();
    if (selectedOrderForModal && selectedOrderForModal.id === order.id) {
      setSelectedOrderForModal(store.getOrderById(order.id) || null);
    }
  };

  const [thermalPrintNotice, setThermalPrintNotice] = useState<{ message: string; success: boolean } | null>(null);

  const handlePrintReceipt = async (order: Order) => {
    setPrintableOrder(order);
    // Generate public QR code for delivery driver to scan without 403 error
    const deliveryUrl = getPublicAppUrl('entregador', order.id);
    const qrData = await generateQRCodeDataUrl(deliveryUrl, { width: 220, margin: 1 });
    setReceiptQrCode(qrData);

    setTimeout(() => {
      window.print();
    }, 300);
  };

  const handleThermalPrint = async (order: Order) => {
    const isReprint = thermalPrinterService.hasOrderBeenPrinted(order.id);
    const res = await thermalPrinterService.printOrder(order, { forceReprint: isReprint });
    setThermalPrintNotice({
      message: res.message,
      success: res.success,
    });
    setTimeout(() => setThermalPrintNotice(null), 4000);
  };

  return (
    <div className="space-y-4">
      {/* Toast Notice for Thermal Printer */}
      {thermalPrintNotice && (
        <div className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 shadow-sm ${
          thermalPrintNotice.success 
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
            : 'bg-amber-50 text-amber-800 border border-amber-200'
        }`}>
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{thermalPrintNotice.message}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setThermalPrintNotice(null)} 
            className="text-slate-400 hover:text-slate-600 text-xs px-1 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Kanban Board Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3.5 items-start">
        {columns.map((col) => {
          const columnOrders = orders.filter((o) => o.status === col.status);

          return (
            <div
              key={col.status}
              className="bg-slate-100/90 rounded-2xl p-3 border border-slate-200/80 min-h-[500px] flex flex-col"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.status === 'NOVO' ? 'bg-amber-500 animate-ping' : col.status === 'EM_PREPARO' ? 'bg-blue-500' : col.status === 'PRONTO' ? 'bg-purple-500' : col.status === 'EM_ROTA' ? 'bg-indigo-500' : 'bg-emerald-500'}`} />
                  <h3 className="font-bold text-xs text-slate-800">{col.title}</h3>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${col.colorClass}`}>
                  {col.count}
                </span>
              </div>

              {/* Cards List */}
              <div className="space-y-2.5 flex-1 overflow-y-auto">
                {columnOrders.length === 0 ? (
                  <div className="h-32 flex flex-col items-center justify-center text-slate-400 text-xs italic">
                    Nenhum pedido aqui
                  </div>
                ) : (
                  columnOrders.map((order) => {
                    const elapsedMin = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
                    return (
                      <div
                        key={order.id}
                        className="bg-white rounded-xl p-3 shadow-xs border border-slate-200 hover:border-slate-300 hover:shadow-sm transition cursor-pointer"
                        onClick={() => setSelectedOrderForModal(order)}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-sm text-slate-900 font-mono">
                              {order.orderNumber}
                            </span>
                            {order._cloudSyncStatus === 'PENDING' ? (
                              <span title="Salvo no dispositivo · Transmitindo para a Nuvem Firestore..." className="inline-flex text-amber-500">
                                <UploadCloud className="w-3.5 h-3.5 animate-pulse" />
                              </span>
                            ) : order._cloudSyncStatus === 'ERROR' ? (
                              <span title="Salvo em contingência local" className="inline-flex text-rose-500">
                                <AlertCircle className="w-3.5 h-3.5" />
                              </span>
                            ) : order._cloudSyncStatus === 'SYNCED' ? (
                              <span title="Sincronizado na Nuvem (Cloud Firestore)" className="inline-flex text-emerald-600">
                                <CheckCircle className="w-3 h-3 opacity-80" />
                              </span>
                            ) : (
                              <span title="Salvo em armazenamento local deste dispositivo" className="inline-flex text-slate-400">
                                <Clock className="w-3 h-3 opacity-50" />
                              </span>
                            )}
                            {thermalPrinterService.hasOrderBeenPrinted(order.id) && (
                              <span title="Comprovante de Balcão já impresso" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-[9px] font-bold border border-emerald-200">
                                <Printer className="w-2.5 h-2.5" />
                                <span>Impresso</span>
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {elapsedMin}m atrás
                          </span>
                        </div>

                        <p className="text-xs font-bold text-slate-800 truncate">
                          {order.customer.name}
                        </p>

                        <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>
                            {order.fulfillmentType === 'RETIRADA' 
                              ? 'Retirada no Balcão' 
                              : order.customer.address?.neighborhood || 'Entrega'}
                          </span>
                        </p>

                        {order.fulfillmentType === 'DELIVERY' && (
                          <div className="mt-1 flex items-center gap-1 text-[10px]">
                            <Bike className="w-3 h-3 text-indigo-600 shrink-0" />
                            {order.deliveryPersonName || order.deliveryPerson?.name ? (
                              <span className="font-semibold text-indigo-700 truncate">
                                {order.deliveryPersonName || order.deliveryPerson?.name}
                              </span>
                            ) : (
                              <span className="font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                Aguardando Atribuição
                              </span>
                            )}
                          </div>
                        )}

                        {/* Items preview */}
                        <div className="my-2 py-1.5 border-y border-slate-100 text-[11px] text-slate-600 space-y-0.5">
                          {order.items.slice(0, 2).map((it) => (
                            <p key={it.id} className="truncate">
                              <strong className="text-amber-700">{it.quantity}x</strong> {it.name}
                            </p>
                          ))}
                          {order.items.length > 2 && (
                            <p className="text-[10px] text-slate-400 italic">
                              + {order.items.length - 2} outro(s) item(ns)
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs pt-0.5">
                          <span className="font-bold text-slate-900">
                            {formatCurrency(order.totalAmount)}
                          </span>
                          <span className="text-[10px] text-slate-500 font-medium">
                            {getPaymentMethodLabel(order.paymentMethod).split(' ')[0]}
                          </span>
                        </div>

                        {/* Quick Action buttons */}
                        <div className="flex items-center gap-1 mt-2.5 pt-2 border-t border-slate-100">
                          {order.status === 'NOVO' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAdvanceStatus(order, 'EM_PREPARO'); }}
                              className="flex-1 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1"
                            >
                              <ChefHat className="w-3 h-3" />
                              <span>Enviar p/ Cozinha</span>
                            </button>
                          )}

                          {order.status === 'EM_PREPARO' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAdvanceStatus(order, 'PRONTO'); }}
                              className="flex-1 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1"
                            >
                              <PackageCheck className="w-3 h-3" />
                              <span>Pronto p/ Entrega</span>
                            </button>
                          )}

                          {order.status === 'PRONTO' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAdvanceStatus(order, 'EM_ROTA'); }}
                              className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1"
                            >
                              <Bike className="w-3 h-3" />
                              <span>Despachar Motoboy</span>
                            </button>
                          )}

                          {order.status === 'EM_ROTA' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAdvanceStatus(order, 'ENTREGUE'); }}
                              className="flex-1 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1"
                            >
                              <CheckCircle className="w-3 h-3" />
                              <span>Concluir Entrega</span>
                            </button>
                          )}

                          <button
                            onClick={(e) => { e.stopPropagation(); handleThermalPrint(order); }}
                            className={`p-1 rounded-lg transition ${
                              thermalPrinterService.hasOrderBeenPrinted(order.id)
                                ? 'text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50'
                                : 'text-[#C86D3B] hover:text-[#721C24] hover:bg-amber-50'
                            }`}
                            title={
                              thermalPrinterService.hasOrderBeenPrinted(order.id)
                                ? 'Reimprimir Cupom Térmico 58mm (Bluetooth)'
                                : 'Imprimir Cupom Térmico 58mm (Bluetooth)'
                            }
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={(e) => { e.stopPropagation(); handlePrintReceipt(order); }}
                            className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                            title="Imprimir Comanda Completa (Spooler / A4)"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteOrder(order); }}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Excluir lançamento deste pedido"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* DETAILED ORDER MODAL */}
      {selectedOrderForModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-mono text-slate-400">PEDIDO DETALHADO</span>
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <span>{selectedOrderForModal.orderNumber}</span>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${getStatusDetails(selectedOrderForModal.status).bgLightClass} ${getStatusDetails(selectedOrderForModal.status).colorClass} ${getStatusDetails(selectedOrderForModal.status).borderClass}`}>
                    {getStatusDetails(selectedOrderForModal.status).label}
                  </span>
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleThermalPrint(selectedOrderForModal)}
                  className="px-3 py-1.5 bg-[#C86D3B] hover:bg-[#721C24] text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                  title="Imprimir comprovante formatado para impressora térmica de 58 mm via Bluetooth"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>
                    {thermalPrinterService.hasOrderBeenPrinted(selectedOrderForModal.id)
                      ? 'Reimprimir Térmica 58mm'
                      : 'Imprimir Térmica 58mm'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintReceipt(selectedOrderForModal)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                  title="Imprimir Comanda Completa A4/Spooler com QR Code"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Comanda A4</span>
                </button>
                <button
                  onClick={() => setSelectedOrderForModal(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Customer & Address */}
            <div className="p-3.5 bg-slate-50 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <div>
                  <span className="text-slate-400 font-semibold block text-[10px] uppercase">Cliente</span>
                  <p className="font-bold text-slate-900 text-sm">{selectedOrderForModal.customer.name}</p>
                  <p className="text-slate-500">{selectedOrderForModal.customer.phone}</p>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 font-semibold block text-[10px] uppercase">Data / Horário</span>
                  <p className="font-medium text-slate-700">{formatDateTime(selectedOrderForModal.createdAt)}</p>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <span className="text-slate-400 font-semibold block text-[10px] uppercase">
                  {selectedOrderForModal.fulfillmentType === 'RETIRADA' ? 'Tipo de Recebimento' : 'Endereço de Entrega'}
                </span>
                {selectedOrderForModal.fulfillmentType === 'RETIRADA' || !selectedOrderForModal.customer.address ? (
                  <p className="font-semibold text-emerald-800">
                    Retirada no Balcão do Estabelecimento ({config.address})
                  </p>
                ) : (
                  <>
                    <p className="font-semibold text-slate-800">
                      {selectedOrderForModal.customer.address.street}, {selectedOrderForModal.customer.address.number}
                      {selectedOrderForModal.customer.address.complement && ` · ${selectedOrderForModal.customer.address.complement}`}
                    </p>
                    <p className="text-slate-500">
                      {selectedOrderForModal.customer.address.neighborhood} · {selectedOrderForModal.customer.address.city}
                    </p>
                    {selectedOrderForModal.customer.address.reference && (
                      <p className="text-amber-800 mt-0.5">Ref: {selectedOrderForModal.customer.address.reference}</p>
                    )}
                  </>
                )}
                {selectedOrderForModal.customer.notes && (
                  <p className="text-slate-700 bg-white p-2 rounded-lg mt-1 border border-slate-200">
                    Obs: {selectedOrderForModal.customer.notes}
                  </p>
                )}
              </div>
            </div>

            {/* Items */}
            <div>
              <h4 className="text-xs font-bold text-slate-800 mb-2">Itens Solicitados ({selectedOrderForModal.items.length})</h4>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {selectedOrderForModal.items.map((item) => (
                  <div key={item.id} className="p-3 flex justify-between items-start text-xs bg-white">
                    <div>
                      <p className="font-bold text-slate-900">
                        <span className="text-amber-700 mr-1.5">{item.quantity}x</span>
                        {item.name}
                      </p>
                      {item.addons && item.addons.length > 0 && (
                        <p className="text-slate-500 text-[11px] ml-4">
                          + {item.addons.map((a) => a.name).join(', ')}
                        </p>
                      )}
                      {item.notes && (
                        <p className="text-amber-700 italic text-[11px] ml-4">
                          Obs: {item.notes}
                        </p>
                      )}
                    </div>
                    <span className="font-bold text-slate-800 font-mono">{formatCurrency(item.subtotal)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Details */}
            <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1 text-slate-600">
              <div className="flex justify-between">
                <span>Subtotal dos Itens</span>
                <span>{formatCurrency(selectedOrderForModal.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Taxa de Entrega</span>
                <span>{formatCurrency(selectedOrderForModal.deliveryFee)}</span>
              </div>
              <div className="flex justify-between font-bold text-sm text-slate-900 pt-1.5 border-t border-slate-200">
                <span>Total Geral</span>
                <span className="text-amber-800">{formatCurrency(selectedOrderForModal.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500 pt-1">
                <span>Pagamento:</span>
                <span className="font-semibold text-slate-800">
                  {getPaymentMethodLabel(selectedOrderForModal.paymentMethod)} ({selectedOrderForModal.paymentStatus})
                  {selectedOrderForModal.paymentChangeFor ? ` · Troco p/ ${formatCurrency(selectedOrderForModal.paymentChangeFor)}` : ''}
                </span>
              </div>
            </div>

            {/* Refund & Cancellation Audit Card (se o pedido foi cancelado e estornado) */}
            {selectedOrderForModal.refundInfo && (
              <div className="p-3.5 bg-rose-50 rounded-xl border border-rose-200 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-rose-900 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    <span>Pedido Cancelado e Devolvido</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    selectedOrderForModal.refundInfo.status === 'CONCLUIDO'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}>
                    {selectedOrderForModal.refundInfo.status === 'CONCLUIDO' ? 'Estornado no Caixa' : 'Pendente de Compensação'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700">
                  <div>
                    <span className="text-slate-500 block">Valor Estornado:</span>
                    <strong className="text-rose-700 font-mono text-sm">{formatCurrency(selectedOrderForModal.refundInfo.refundAmount)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Forma de Estorno:</span>
                    <strong className="text-slate-800">{getPaymentMethodLabel(selectedOrderForModal.refundInfo.refundPaymentMethod)}</strong>
                  </div>
                </div>

                <div className="text-[11px] text-slate-700">
                  <span className="text-slate-500 block">Motivo:</span>
                  <p className="italic bg-white p-2 rounded-lg border border-rose-200 text-slate-800 mt-0.5">
                    {selectedOrderForModal.refundInfo.reason}
                  </p>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1 border-t border-rose-100">
                  <span>Autorizado por: <strong className="text-slate-700">{selectedOrderForModal.refundInfo.author}</strong></span>
                  <span>{formatDateTime(selectedOrderForModal.refundInfo.timestamp)}</span>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => thermalPrinterService.printRefundReceipt(selectedOrderForModal)}
                    className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Imprimir Comprovante de Estorno (58mm)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Delivery Assignment & Reassignment (Exclusively for Delivery fulfillment) */}
            {selectedOrderForModal.fulfillmentType === 'DELIVERY' && (
              <div className="p-3 bg-indigo-50/70 rounded-xl border border-indigo-100 text-xs space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-950 flex items-center gap-1.5">
                    <Bike className="w-4 h-4 text-indigo-600" />
                    <span>Entregador Responsável</span>
                  </span>
                  {selectedOrderForModal.deliveryPersonName || selectedOrderForModal.deliveryPerson?.name ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                      {selectedOrderForModal.deliveryPersonName || selectedOrderForModal.deliveryPerson?.name}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                      Aguardando Atribuição
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-700">
                    Reatribuir a outro entregador ativo:
                  </label>
                  <select
                    value={selectedOrderForModal.deliveryPersonId || selectedOrderForModal.deliveryPerson?.id || ''}
                    onChange={(e) => handleReassignDriver(selectedOrderForModal.id, e.target.value)}
                    className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Aguardando Atribuição (Nenhum entregador)</option>
                    {activeDrivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name || driver.username} {driver.phone ? `(${driver.phone})` : ''} — Ativo
                      </option>
                    ))}
                  </select>
                </div>

                {/* Assignment History Log */}
                {selectedOrderForModal.deliveryAssignmentHistory && selectedOrderForModal.deliveryAssignmentHistory.length > 0 && (
                  <div className="pt-2 border-t border-indigo-100 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-800 block">
                      Histórico de Atribuições:
                    </span>
                    <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                      {selectedOrderForModal.deliveryAssignmentHistory.map((rec, idx) => (
                        <div key={idx} className="text-[10px] text-slate-600 bg-white/80 p-1.5 rounded border border-indigo-100 flex items-start justify-between">
                          <div>
                            <span className="font-semibold text-slate-800">
                              {rec.newDriverName ? `Atribuído a: ${rec.newDriverName}` : 'Desatribuído'}
                            </span>
                            {rec.previousDriverName && (
                              <span className="text-slate-400 block text-[9px]">
                                Anterior: {rec.previousDriverName}
                              </span>
                            )}
                            <span className="text-[9px] text-slate-500 block">
                              Por: {rec.assignedBy}
                            </span>
                          </div>
                          <span className="text-[9px] text-slate-400 font-mono">
                            {formatDateTime(rec.assignedAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Audit & Responsibility: Separation of creator / attendant from driver */}
            <div className="px-3 py-2 bg-slate-50 rounded-xl text-[10px] text-slate-500 flex flex-wrap justify-between gap-2 border border-slate-200/60">
              <div>
                <span>Criado por: </span>
                <strong className="text-slate-700">{selectedOrderForModal.createdBy || 'Sistema (Cardápio Online)'}</strong>
              </div>
              {selectedOrderForModal.processedBy && (
                <div>
                  <span>Atendente/Caixa: </span>
                  <strong className="text-slate-700">{selectedOrderForModal.processedBy}</strong>
                </div>
              )}
            </div>

            {/* Advance Status Controls */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-bold text-slate-700 block">Alterar Status:</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleAdvanceStatus(selectedOrderForModal, 'EM_PREPARO')}
                  className="py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-xl text-xs font-bold transition"
                >
                  Em Produção
                </button>
                <button
                  onClick={() => handleAdvanceStatus(selectedOrderForModal, 'PRONTO')}
                  className="py-2 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-xl text-xs font-bold transition"
                >
                  Pronto
                </button>
                <button
                  onClick={() => handleAdvanceStatus(selectedOrderForModal, 'EM_ROTA')}
                  className="py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-xl text-xs font-bold transition"
                >
                  Em Rota (Motoboy)
                </button>
                <button
                  onClick={() => handleAdvanceStatus(selectedOrderForModal, 'ENTREGUE')}
                  className="py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition col-span-2"
                >
                  Finalizar (Entregue)
                </button>
                {selectedOrderForModal.status === 'CANCELADO' ? (
                  <button
                    disabled
                    className="py-2 bg-slate-100 text-slate-400 border border-slate-200 rounded-xl text-xs font-bold cursor-not-allowed"
                  >
                    Pedido Cancelado
                  </button>
                ) : (
                  <button
                    onClick={() => handleOpenCancelModal(selectedOrderForModal)}
                    className="py-2 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-xl text-xs font-bold transition cursor-pointer"
                  >
                    Cancelar / Devolver
                  </button>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => handleDeleteOrder(selectedOrderForModal)}
                  className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 font-semibold rounded-xl text-xs flex items-center gap-1.5 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir Lançamento deste Pedido</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRINTABLE THERMAL RECEIPT / COMANDA WITH QR CODE */}
      {printableOrder && (
        <div id="printable-receipt" className="hidden print:block text-black bg-white font-mono text-[12px] p-2 max-w-[80mm]">
          <div className="text-center pb-2 border-b border-black">
            <h2 className="font-bold text-base">{config.name}</h2>
            <p className="text-[10px]">{config.phone}</p>
            <p className="text-[10px]">{config.address}</p>
            <div className="my-2 py-1 border-y border-dashed border-black font-bold text-lg">
              {printableOrder.orderNumber}
            </div>
            <p className="text-[11px]">{formatDateTime(printableOrder.createdAt)}</p>
          </div>

          <div className="py-2 border-b border-dashed border-black text-left">
            <p className="font-bold text-[13px]">CLIENTE: {printableOrder.customer.name}</p>
            <p>TEL: {printableOrder.customer.phone}</p>
            {printableOrder.fulfillmentType === 'RETIRADA' || !printableOrder.customer.address ? (
              <p className="font-bold mt-1 text-[13px]">*** RETIRADA NO BALCÃO ***</p>
            ) : (
              <>
                <p className="font-bold mt-1">ENDEREÇO:</p>
                <p>{printableOrder.customer.address.street}, {printableOrder.customer.address.number}</p>
                <p>{printableOrder.customer.address.neighborhood} {printableOrder.customer.address.complement ? `- ${printableOrder.customer.address.complement}` : ''}</p>
                {printableOrder.customer.address.reference && (
                  <p>REF: {printableOrder.customer.address.reference}</p>
                )}
              </>
            )}
            {printableOrder.customer.notes && (
              <p className="mt-1 font-bold">OBS: {printableOrder.customer.notes}</p>
            )}
          </div>

          <div className="py-2 border-b border-dashed border-black">
            <p className="font-bold mb-1">ITENS DO PEDIDO:</p>
            {printableOrder.items.map((it) => (
              <div key={it.id} className="mb-1.5">
                <div className="flex justify-between font-bold">
                  <span>{it.quantity}x {it.name}</span>
                  <span>{formatCurrency(it.subtotal)}</span>
                </div>
                {it.addons && it.addons.length > 0 && (
                  <p className="text-[10px] ml-3">+ {it.addons.map((a) => a.name).join(', ')}</p>
                )}
                {it.notes && (
                  <p className="text-[10px] ml-3 italic">Obs: {it.notes}</p>
                )}
              </div>
            ))}
          </div>

          <div className="py-2 border-b border-black space-y-0.5">
            <div className="flex justify-between">
              <span>SUBTOTAL:</span>
              <span>{formatCurrency(printableOrder.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>TAXA ENTREGA:</span>
              <span>{formatCurrency(printableOrder.deliveryFee)}</span>
            </div>
            <div className="flex justify-between font-bold text-sm pt-1 border-t border-dashed border-black">
              <span>TOTAL:</span>
              <span>{formatCurrency(printableOrder.totalAmount)}</span>
            </div>
            <div className="mt-1 font-bold text-[11px]">
              PAGAMENTO: {getPaymentMethodLabel(printableOrder.paymentMethod)}
              {printableOrder.paymentChangeFor ? ` (Troco para ${formatCurrency(printableOrder.paymentChangeFor)})` : ''}
            </div>
          </div>

          {/* QR CODE FOR DELIVERY PERSON TO SCAN */}
          <div className="text-center pt-3">
            <p className="text-[10px] font-bold mb-1 uppercase tracking-wider">
              QR CODE PARA O ENTREGADOR ESCANEAR:
            </p>
            {receiptQrCode && (
              <img
                src={receiptQrCode}
                alt="QR Code Pedido"
                className="w-36 h-36 mx-auto border border-black p-1"
              />
            )}
            <p className="text-[9px] mt-1">O motoboy escaneia para ver endereço e confirmar entrega</p>
          </div>
        </div>
      )}

      {/* CONFIRM MODAL FOR DELETE ORDER (Eliminates window.confirm) */}
      {orderToDelete && (
        <ConfirmModal
          isOpen={true}
          title="Excluir Pedido"
          message={`Tem certeza que deseja excluir o pedido ${orderToDelete.orderNumber} (${orderToDelete.customer.name}) no valor de ${formatCurrency(orderToDelete.totalAmount)}? Esta ação remove o pedido do sistema e atualiza o caixa.`}
          confirmLabel="Excluir Pedido"
          cancelLabel="Cancelar"
          isDanger={true}
          isLoading={isDeletingOrder}
          errorMessage={deleteErrorMessage}
          onConfirm={executeDeleteOrder}
          onCancel={() => {
            if (!isDeletingOrder) {
              setOrderToDelete(null);
              setDeleteErrorMessage(null);
            }
          }}
        />
      )}

      {/* MODAL: CANCELAMENTO E ESTORNO FINANCEIRO */}
      {orderToCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-2xl border border-rose-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900">Cancelar Pedido</h3>
                  <p className="text-xs text-slate-500">
                    {orderToCancelModal.orderNumber} · {orderToCancelModal.customer.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderToCancelModal(null)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Financial Status Summary */}
            <div className={`p-3.5 rounded-xl text-xs space-y-2 border ${
              orderToCancelModal.paymentStatus === 'PAGO'
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <div className="flex justify-between items-center font-bold">
                <span>Valor Total:</span>
                <span className="text-sm font-mono text-rose-700">{formatCurrency(orderToCancelModal.totalAmount)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Status de Pagamento:</span>
                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                  orderToCancelModal.paymentStatus === 'PAGO'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-900'
                }`}>
                  {orderToCancelModal.paymentStatus === 'PAGO' ? 'PAGO' : 'NÃO PAGO (PENDENTE)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Forma Registrada:</span>
                <span className="font-semibold">{getPaymentMethodLabel(orderToCancelModal.paymentMethod)}</span>
              </div>

              {orderToCancelModal.paymentStatus === 'PAGO' ? (
                <div className="pt-2 border-t border-amber-200/80 text-[11px] leading-relaxed">
                  {orderToCancelModal.paymentMethod === 'DINHEIRO' ? (
                    <p className="text-rose-900 font-semibold">
                      💵 <strong>Impacto no Caixa:</strong> Este pedido foi pago em dinheiro. O cancelamento registrará um <strong>estorno de {formatCurrency(orderToCancelModal.totalAmount)}</strong> e deduzirá esse valor da <strong>gaveta física</strong> do caixa atual.
                    </p>
                  ) : orderToCancelModal.paymentMethod === 'PIX' ? (
                    <p className="text-blue-950 font-semibold">
                      📱 <strong>Impacto no Caixa:</strong> Este pedido foi pago via PIX. O estorno será registrado como devolução bancária PIX e <strong>NÃO alterará a gaveta física</strong> de dinheiro.
                    </p>
                  ) : (
                    <p className="text-indigo-950 font-semibold">
                      💳 <strong>Impacto no Caixa:</strong> O estorno será registrado para conciliação das vendas via cartão no fechamento do turno.
                    </p>
                  )}
                </div>
              ) : (
                <p className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
                  ℹ️ Este pedido ainda não teve pagamento recebido. Não haverá movimentação financeira ou devolução de valores no caixa.
                </p>
              )}
            </div>

            {cancelErrorMsg && (
              <div className="p-2.5 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-700 font-semibold">
                {cancelErrorMsg}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Motivo Obrigatório do Cancelamento <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={cancelReasonInput}
                onChange={(e) => setCancelReasonInput(e.target.value)}
                placeholder="Ex: Desistência do cliente, erro de lançamento, troca de itens..."
                rows={3}
                autoFocus
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOrderToCancelModal(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelOrder}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-xs"
              >
                Confirmar Cancelamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FEEDBACK TOAST / BANNER FOR CANCEL SUCCESS */}
      {cancelSuccessResult && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md bg-white border-2 border-rose-300 rounded-2xl p-4 shadow-xl space-y-2 animate-in slide-in-from-bottom-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600" />
              <strong className="text-xs text-slate-900">Cancelamento Concluído</strong>
            </div>
            <button
              onClick={() => setCancelSuccessResult(null)}
              className="text-slate-400 hover:text-slate-700 text-xs p-1"
            >
              ✕
            </button>
          </div>
          <p className="text-xs text-slate-600">{cancelSuccessResult.message}</p>
          {cancelSuccessResult.order.refundInfo && (
            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => thermalPrinterService.printRefundReceipt(cancelSuccessResult.order)}
                className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir Estorno (58mm)</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
