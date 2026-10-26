import React, { useState, useEffect, useMemo } from 'react';
import { store } from '../../services/store';
import { CashRegisterShift, CashMovement, PaymentMethod } from '../../types';
import { formatCurrency, formatDateTime, formatTime, getPaymentMethodLabel } from '../../utils/formatters';
import { 
  Vault, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  Lock, 
  Unlock, 
  DollarSign, 
  CreditCard, 
  Plus, 
  Minus, 
  Trash2, 
  Printer, 
  AlertCircle, 
  CheckCircle2, 
  History, 
  Clock, 
  X,
  FileText,
  UserCheck,
  Pencil
} from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';

interface CashRegisterManagerProps {
  onStateChanged: () => void;
}

export const CashRegisterManager: React.FC<CashRegisterManagerProps> = ({ onStateChanged }) => {
  const [currentShift, setCurrentShift] = useState<CashRegisterShift | null>(() => store.getCurrentCashShift());
  const [historyShifts, setHistoryShifts] = useState<CashRegisterShift[]>(() => store.getCashShiftHistory());
  const [selectedHistoryShift, setSelectedHistoryShift] = useState<CashRegisterShift | null>(null);

  // Modals
  const [isOpenModalActive, setIsOpenModalActive] = useState(false);
  const [isCloseModalActive, setIsCloseModalActive] = useState(false);
  const [isMovementModalActive, setIsMovementModalActive] = useState(false);
  const [movementType, setMovementType] = useState<'SANGRIA' | 'SUPRIMENTO' | 'VALE'>('SANGRIA');

  // Deletion modal state (replaces window.confirm)
  const [confirmDeleteMov, setConfirmDeleteMov] = useState<{ id: string; desc: string; amount: number } | null>(null);

  // Edit / Adjust Drawer Balance state
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [adjustDrawerNewValue, setAdjustDrawerNewValue] = useState('');
  const [adjustDrawerReason, setAdjustDrawerReason] = useState('');
  const [adjustToast, setAdjustToast] = useState<string | null>(null);

  // Open shift form
  const [initialBalanceInput, setInitialBalanceInput] = useState('150.00');
  const [openedByInput, setOpenedByInput] = useState('admin');

  // Close shift form
  const [countedCashInput, setCountedCashInput] = useState('');
  const [closingNotesInput, setClosingNotesInput] = useState('');

  // Movement form (Sangria / Suprimento / Vale)
  const [movAmountInput, setMovAmountInput] = useState('');
  const [movDescInput, setMovDescInput] = useState('');
  const [movEmployeeInput, setMovEmployeeInput] = useState('');
  const [movAuthorInput, setMovAuthorInput] = useState('admin');
  const [movPaymentMethod, setMovPaymentMethod] = useState<PaymentMethod>('DINHEIRO');

  const reloadData = () => {
    setCurrentShift(store.getCurrentCashShift());
    setHistoryShifts(store.getCashShiftHistory());
    onStateChanged();
  };

  useEffect(() => {
    const handleSync = () => reloadData();
    window.addEventListener('gestaofood_state_changed', handleSync);
    return () => window.removeEventListener('gestaofood_state_changed', handleSync);
  }, []);

  // Financial calculations for open shift
  const metrics = useMemo(() => {
    if (!currentShift) {
      return {
        initialBalance: 0,
        cashSales: 0,
        pixSales: 0,
        cardSales: 0,
        totalSangrias: 0,
        totalSuprimentos: 0,
        totalVales: 0,
        totalAjustes: 0,
        expectedCashInDrawer: 0,
        totalRevenue: 0,
      };
    }

    let cashSales = 0;
    let pixSales = 0;
    let cardSales = 0;
    let totalSangrias = 0;
    let totalSuprimentos = 0;
    let totalVales = 0;
    let totalAjustes = 0;

    currentShift.movements.forEach((m) => {
      if (m.type === 'VENDA') {
        if (m.paymentMethod === 'DINHEIRO') cashSales += m.amount;
        else if (m.paymentMethod === 'PIX') pixSales += m.amount;
        else cardSales += m.amount;
      } else if (m.type === 'SANGRIA') {
        totalSangrias += m.amount;
      } else if (m.type === 'SUPRIMENTO') {
        totalSuprimentos += m.amount;
      } else if (m.type === 'VALE') {
        totalVales += m.amount;
      } else if (m.type === 'AJUSTE') {
        totalAjustes += m.amount;
      }
    });

    const expectedCashInDrawer = currentShift.initialBalance + cashSales + totalSuprimentos - totalSangrias - totalVales + totalAjustes;
    const totalRevenue = cashSales + pixSales + cardSales;

    return {
      initialBalance: currentShift.initialBalance,
      cashSales,
      pixSales,
      cardSales,
      totalSangrias,
      totalSuprimentos,
      totalVales,
      totalAjustes,
      expectedCashInDrawer,
      totalRevenue,
    };
  }, [currentShift]);

  // Adjust Drawer Balance handler
  const handleSaveAdjustDrawer = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(adjustDrawerNewValue);
    if (isNaN(parsed) || parsed < 0) {
      alert('Por favor, informe um valor válido para o saldo da gaveta.');
      return;
    }

    const mov = store.adjustDrawerBalance(parsed, adjustDrawerReason, openedByInput || 'admin');
    if (mov) {
      setAdjustToast(`Saldo da gaveta atualizado com sucesso para ${formatCurrency(parsed)}!`);
      setTimeout(() => setAdjustToast(null), 3500);
      reloadData();
    }
    setIsAdjustModalOpen(false);
  };

  // Open Cash Register
  const handleOpenShift = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(initialBalanceInput) || 0;
    store.openCashRegister(val, openedByInput.trim() || 'admin');
    setIsOpenModalActive(false);
    reloadData();
  };

  // Close Cash Register
  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    const counted = parseFloat(countedCashInput) || 0;
    const closed = store.closeCashRegister(counted, 'admin', closingNotesInput.trim());
    setIsCloseModalActive(false);
    setCountedCashInput('');
    setClosingNotesInput('');
    reloadData();
    if (closed) {
      setSelectedHistoryShift(closed);
    }
  };

  // Add Movement (Sangria, Suprimento ou Vale)
  const handleAddMovement = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(movAmountInput);
    if (!amt || amt <= 0 || !movDescInput.trim()) return;

    store.addCashMovement(
      movementType, 
      amt, 
      movDescInput.trim(), 
      movAuthorInput.trim() || 'admin', 
      movPaymentMethod,
      movementType === 'VALE' ? movEmployeeInput.trim() : undefined
    );
    setIsMovementModalActive(false);
    setMovAmountInput('');
    setMovDescInput('');
    setMovEmployeeInput('');
    reloadData();
  };

  // Delete Cash Movement with Custom Modal (Replaces window.confirm)
  const executeDeleteMovement = (movementId: string) => {
    store.deleteCashMovement(movementId);
    setConfirmDeleteMov(null);
    reloadData();
  };

  const printCurrentShiftSummary = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Status of the register */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-xl shadow-xs ${
            currentShift?.status === 'ABERTO'
              ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-600 border border-rose-500/20'
          }`}>
            <Vault className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-slate-900">Controle de Frente de Caixa</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                currentShift?.status === 'ABERTO'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}>
                <span className={`w-2 h-2 rounded-full ${currentShift?.status === 'ABERTO' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                {currentShift?.status === 'ABERTO' ? 'CAIXA ABERTO' : 'CAIXA FECHADO'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {currentShift?.status === 'ABERTO' ? (
                <span>Aberto em <strong className="text-slate-700">{formatDateTime(currentShift.openedAt)}</strong> pelo operador <strong className="text-slate-700">{currentShift.openedBy}</strong></span>
              ) : (
                <span>Nenhum turno de caixa aberto no momento. Abra o caixa para registrar sangrias, suprimentos e conferência.</span>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {currentShift?.status === 'ABERTO' ? (
            <>
              <button
                onClick={() => { setMovementType('SANGRIA'); setIsMovementModalActive(true); }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition"
              >
                <ArrowDownCircle className="w-4 h-4" />
                <span>Nova Sangria</span>
              </button>

              <button
                onClick={() => { setMovementType('SUPRIMENTO'); setIsMovementModalActive(true); }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition"
              >
                <ArrowUpCircle className="w-4 h-4" />
                <span>Novo Suprimento</span>
              </button>

              <button
                onClick={() => { setMovementType('VALE'); setIsMovementModalActive(true); }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold transition"
              >
                <UserCheck className="w-4 h-4" />
                <span>Novo Vale / Adiantamento</span>
              </button>

              <button
                onClick={() => {
                  setCountedCashInput(metrics.expectedCashInDrawer.toFixed(2));
                  setIsCloseModalActive(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs"
              >
                <Lock className="w-4 h-4 text-amber-400" />
                <span>Fechar Caixa</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsOpenModalActive(true)}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>Abrir Novo Caixa</span>
            </button>
          )}

          <button
            onClick={printCurrentShiftSummary}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200"
            title="Imprimir relatório do caixa"
          >
            <Printer className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Toast Feedback for Drawer Adjustment */}
      {adjustToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-800 flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{adjustToast}</span>
          </div>
          <button onClick={() => setAdjustToast(null)} className="text-emerald-700 hover:text-emerald-950 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* When Shift is Open: Summary KPI Cards */}
      {currentShift?.status === 'ABERTO' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fundo Inicial</span>
            <p className="text-base font-black text-slate-800 mt-1">{formatCurrency(metrics.initialBalance)}</p>
            <span className="text-[10px] text-slate-400">Troco abertura</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vendas Dinheiro</span>
            <p className="text-base font-black text-emerald-700 mt-1">{formatCurrency(metrics.cashSales)}</p>
            <span className="text-[10px] text-emerald-600">+ na gaveta</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vendas PIX</span>
            <p className="text-base font-black text-blue-700 mt-1">{formatCurrency(metrics.pixSales)}</p>
            <span className="text-[10px] text-blue-600">Em conta</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vendas Cartão</span>
            <p className="text-base font-black text-indigo-700 mt-1">{formatCurrency(metrics.cardSales)}</p>
            <span className="text-[10px] text-indigo-600">POS / Máquina</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Sangrias</span>
            <p className="text-base font-black text-rose-700 mt-1">-{formatCurrency(metrics.totalSangrias)}</p>
            <span className="text-[10px] text-rose-600">Retiradas</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vales / Adiant.</span>
            <p className="text-base font-black text-purple-700 mt-1">-{formatCurrency(metrics.totalVales)}</p>
            <span className="text-[10px] text-purple-600">Funcionários</span>
          </div>

          <div className="bg-amber-50 p-3.5 rounded-2xl border-2 border-amber-300 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-amber-900 uppercase tracking-wider block">Gaveta</span>
                <button
                  type="button"
                  onClick={() => {
                    setAdjustDrawerNewValue(metrics.expectedCashInDrawer.toFixed(2));
                    setAdjustDrawerReason('');
                    setIsAdjustModalOpen(true);
                  }}
                  className="px-1.5 py-0.5 text-amber-900 hover:text-amber-950 bg-amber-200/50 hover:bg-amber-200 rounded-md transition flex items-center gap-1 text-[10px] font-bold cursor-pointer"
                  title="Editar saldo da gaveta"
                >
                  <Pencil className="w-2.5 h-2.5 text-amber-900" />
                  <span>Editar</span>
                </button>
              </div>
              <p className="text-lg font-black text-amber-950 mt-1">{formatCurrency(metrics.expectedCashInDrawer)}</p>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] font-bold text-amber-800">Saldo atual</span>
              <button
                type="button"
                onClick={() => {
                  setAdjustDrawerNewValue(metrics.expectedCashInDrawer.toFixed(2));
                  setAdjustDrawerReason('');
                  setIsAdjustModalOpen(true);
                }}
                className="text-[10px] font-semibold text-amber-800 hover:text-amber-950 hover:underline cursor-pointer"
              >
                Ajustar valor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOVEMENTS TABLE (Lançamentos do Caixa Atual) */}
      {currentShift?.status === 'ABERTO' ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">Lançamentos do Caixa Aberto ({currentShift.movements.length})</h3>
              <p className="text-xs text-slate-500">
                Lista de entradas, vendas, sangrias, vales e suprimentos. Exclua qualquer lançamento clicando na lixeira.
              </p>
            </div>
          </div>

          {currentShift.movements.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs italic">
              Nenhum lançamento registrado neste turno até o momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                    <th className="py-3 px-2">Horário</th>
                    <th className="py-3 px-2">Tipo de Lançamento</th>
                    <th className="py-3 px-2">Descrição / Motivo</th>
                    <th className="py-3 px-2">Forma Pgto</th>
                    <th className="py-3 px-2 text-right">Valor</th>
                    <th className="py-3 px-2">Operador</th>
                    <th className="py-3 px-2 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentShift.movements.slice().reverse().map((mov) => {
                    const isPositive = mov.type === 'VENDA' || mov.type === 'SUPRIMENTO' || (mov.type === 'AJUSTE' && mov.amount >= 0);
                    const isSangria = mov.type === 'SANGRIA';
                    const isVale = mov.type === 'VALE';
                    const isAjuste = mov.type === 'AJUSTE';

                    return (
                      <tr key={mov.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-2 text-slate-500 whitespace-nowrap font-mono">
                          {formatTime(mov.timestamp)}
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            mov.type === 'VENDA'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : mov.type === 'SUPRIMENTO'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : mov.type === 'VALE'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : mov.type === 'AJUSTE'
                              ? 'bg-amber-50 text-amber-800 border border-amber-300'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {mov.type === 'VENDA' ? 'Venda' : mov.type === 'SUPRIMENTO' ? 'Suprimento (Entrada)' : mov.type === 'VALE' ? 'Vale Funcionário' : mov.type === 'AJUSTE' ? 'Ajuste de Gaveta' : 'Sangria (Retirada)'}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-slate-800 font-medium">
                          {mov.employeeName && (
                            <span className="font-bold text-purple-800 mr-1.5 bg-purple-50 px-1.5 py-0.5 rounded text-[11px] border border-purple-200">
                              👤 {mov.employeeName}
                            </span>
                          )}
                          {mov.description}
                          {mov.orderNumber && (
                            <span className="ml-1.5 font-mono text-[11px] text-amber-700 font-bold">({mov.orderNumber})</span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-slate-600 whitespace-nowrap">
                          {mov.paymentMethod ? getPaymentMethodLabel(mov.paymentMethod) : 'Dinheiro'}
                        </td>
                        <td className={`py-3 px-2 text-right font-mono font-bold whitespace-nowrap ${
                          isAjuste
                            ? mov.amount >= 0 ? 'text-emerald-700' : 'text-rose-600'
                            : isPositive ? 'text-emerald-700' : isVale ? 'text-purple-700' : 'text-rose-600'
                        }`}>
                          {isAjuste
                            ? mov.amount >= 0 ? `+${formatCurrency(mov.amount)}` : `-${formatCurrency(Math.abs(mov.amount))}`
                            : `${isPositive ? '+' : '-'}${formatCurrency(Math.abs(mov.amount))}`}
                        </td>
                        <td className="py-3 px-2 text-slate-500 whitespace-nowrap">
                          {mov.author}
                        </td>
                        <td className="py-3 px-2 text-center whitespace-nowrap">
                          <button
                            onClick={() => setConfirmDeleteMov({ id: mov.id, desc: mov.description, amount: mov.amount })}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Excluir este lançamento"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {/* HISTÓRICO DE FECHAMENTOS DE CAIXA ANTERIORES */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-slate-700" />
            <div>
              <h3 className="text-base font-bold text-slate-900">Histórico de Caixas Fechados ({historyShifts.length})</h3>
              <p className="text-xs text-slate-500">Auditoria dos turnos e fechamentos passados</p>
            </div>
          </div>
        </div>

        {historyShifts.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs italic">
            Nenhum caixa fechado registrado no histórico.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  <th className="py-3 px-2">Data / Abertura</th>
                  <th className="py-3 px-2">Fechamento</th>
                  <th className="py-3 px-2">Operador</th>
                  <th className="py-3 px-2 text-right">Fundo Inicial</th>
                  <th className="py-3 px-2 text-right">Gaveta</th>
                  <th className="py-3 px-2 text-right">Contado</th>
                  <th className="py-3 px-2 text-right">Diferença</th>
                  <th className="py-3 px-2 text-center">Visualizar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historyShifts.map((h) => {
                  const diff = h.difference || 0;
                  const isMatch = Math.abs(diff) < 0.01;
                  const isSobra = diff > 0.01;

                  return (
                    <tr key={h.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3 px-2 font-mono text-[11px] text-slate-700">
                        {formatDateTime(h.openedAt)}
                      </td>
                      <td className="py-3 px-2 font-mono text-[11px] text-slate-500">
                        {h.closedAt ? formatDateTime(h.closedAt) : '—'}
                      </td>
                      <td className="py-3 px-2 text-slate-700 font-medium">
                        {h.openedBy} {h.closedBy && h.closedBy !== h.openedBy ? `/ ${h.closedBy}` : ''}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-slate-600">
                        {formatCurrency(h.initialBalance)}
                      </td>
                      <td className="py-3 px-2 text-right font-mono font-bold text-slate-800">
                        {formatCurrency(h.finalCalculatedBalance || 0)}
                      </td>
                      <td className="py-3 px-2 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(h.finalCountedCash || 0)}
                      </td>
                      <td className={`py-3 px-2 text-right font-mono font-bold ${
                        isMatch ? 'text-slate-500' : isSobra ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {isMatch ? 'R$ 0,00' : isSobra ? `+${formatCurrency(diff)}` : formatCurrency(diff)}
                      </td>
                      <td className="py-3 px-2 text-center">
                        <button
                          onClick={() => setSelectedHistoryShift(h)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold transition"
                        >
                          Ver Espelho
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: ABERTURA DE CAIXA */}
      {isOpenModalActive && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Unlock className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Abertura de Caixa</h3>
              </div>
              <button onClick={() => setIsOpenModalActive(false)} className="text-slate-400 hover:text-slate-800 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleOpenShift} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Saldo Inicial / Fundo de Troco (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={initialBalanceInput}
                  onChange={(e) => setInitialBalanceInput(e.target.value)}
                  placeholder="150.00"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Valor em dinheiro inserido na gaveta para iniciar as operações do dia.
                </p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Operador Responsável *
                </label>
                <input
                  type="text"
                  required
                  value={openedByInput}
                  onChange={(e) => setOpenedByInput(e.target.value)}
                  placeholder="admin"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsOpenModalActive(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
                >
                  Confirmar Abertura
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: FECHAMENTO DE CAIXA */}
      {isCloseModalActive && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-bold text-slate-900">Fechamento e Apuração de Caixa</h3>
              </div>
              <button onClick={() => setIsCloseModalActive(false)} className="text-slate-400 hover:text-slate-800 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary comparison */}
            <div className="p-3.5 bg-slate-50 rounded-xl space-y-2 text-xs text-slate-600 border border-slate-200">
              <div className="flex justify-between">
                <span>Fundo inicial de troco:</span>
                <span className="font-mono font-semibold">{formatCurrency(metrics.initialBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span>Vendas em dinheiro apuradas:</span>
                <span className="font-mono font-semibold text-emerald-700">+{formatCurrency(metrics.cashSales)}</span>
              </div>
              <div className="flex justify-between">
                <span>Suprimentos adicionados:</span>
                <span className="font-mono font-semibold text-emerald-700">+{formatCurrency(metrics.totalSuprimentos)}</span>
              </div>
              <div className="flex justify-between">
                <span>Sangrias (retiradas realizadas):</span>
                <span className="font-mono font-semibold text-rose-600">-{formatCurrency(metrics.totalSangrias)}</span>
              </div>
              <div className="flex justify-between">
                <span>Vales a funcionários:</span>
                <span className="font-mono font-semibold text-purple-700">-{formatCurrency(metrics.totalVales)}</span>
              </div>
              {metrics.totalAjustes !== 0 && (
                <div className="flex justify-between">
                  <span>Ajustes manuais da gaveta:</span>
                  <span className={`font-mono font-semibold ${metrics.totalAjustes > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {metrics.totalAjustes > 0 ? '+' : ''}{formatCurrency(metrics.totalAjustes)}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-900 text-sm">
                <span>Gaveta:</span>
                <span className="text-amber-800">{formatCurrency(metrics.expectedCashInDrawer)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 pt-1">
                <span>Outras formas (não entram na gaveta):</span>
                <span>PIX: {formatCurrency(metrics.pixSales)} · Cartões: {formatCurrency(metrics.cardSales)}</span>
              </div>
            </div>

            <form onSubmit={handleCloseShift} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-800 block mb-1">
                  Valor em Dinheiro Contado na Gaveta (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={countedCashInput}
                  onChange={(e) => setCountedCashInput(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-bold text-slate-900 focus:ring-2 focus:ring-amber-500"
                />

                {countedCashInput && (
                  <div className="mt-2 p-2.5 rounded-xl text-xs font-semibold flex items-center justify-between border bg-slate-50">
                    <span>Diferença apurada:</span>
                    {(() => {
                      const diff = (parseFloat(countedCashInput) || 0) - metrics.expectedCashInDrawer;
                      if (Math.abs(diff) < 0.01) {
                        return <span className="text-emerald-700 font-bold">✓ Caixa Bateu Exatamente!</span>;
                      } else if (diff > 0) {
                        return <span className="text-emerald-700 font-bold">+ {formatCurrency(diff)} (Sobra de Caixa)</span>;
                      } else {
                        return <span className="text-rose-700 font-bold">{formatCurrency(diff)} (Falta / Quebra de Caixa)</span>;
                      }
                    })()}
                  </div>
                )}
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Observações de Fechamento
                </label>
                <textarea
                  rows={2}
                  value={closingNotesInput}
                  onChange={(e) => setClosingNotesInput(e.target.value)}
                  placeholder="Ex: Turno tranquilo, tudo conferido e lacrado..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCloseModalActive(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl"
                >
                  Fechar Caixa Definitivamente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVA SANGRIA, SUPRIMENTO OU VALE */}
      {isMovementModalActive && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                {movementType === 'SANGRIA' ? (
                  <ArrowDownCircle className="w-5 h-5 text-rose-600" />
                ) : movementType === 'VALE' ? (
                  <UserCheck className="w-5 h-5 text-purple-600" />
                ) : (
                  <ArrowUpCircle className="w-5 h-5 text-emerald-600" />
                )}
                <h3 className="text-base font-bold text-slate-900">
                  {movementType === 'SANGRIA' 
                    ? 'Registrar Sangria (Retirada)' 
                    : movementType === 'VALE' 
                    ? 'Registrar Vale / Adiantamento' 
                    : 'Registrar Suprimento (Entrada)'}
                </h3>
              </div>
              <button onClick={() => setIsMovementModalActive(false)} className="text-slate-400 hover:text-slate-800 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddMovement} className="space-y-3.5 text-xs">
              {/* Type Switcher */}
              <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMovementType('SANGRIA')}
                  className={`py-1.5 rounded-lg font-bold text-[11px] transition ${
                    movementType === 'SANGRIA' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Sangria
                </button>
                <button
                  type="button"
                  onClick={() => setMovementType('SUPRIMENTO')}
                  className={`py-1.5 rounded-lg font-bold text-[11px] transition ${
                    movementType === 'SUPRIMENTO' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Suprimento
                </button>
                <button
                  type="button"
                  onClick={() => setMovementType('VALE')}
                  className={`py-1.5 rounded-lg font-bold text-[11px] transition ${
                    movementType === 'VALE' ? 'bg-white text-purple-700 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Vale
                </button>
              </div>

              {movementType === 'VALE' && (
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Nome do Funcionário / Beneficiário *
                  </label>
                  <input
                    type="text"
                    required
                    value={movEmployeeInput}
                    onChange={(e) => setMovEmployeeInput(e.target.value)}
                    placeholder="Ex: Carlos Silva (Pizzaiolo)"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              )}

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Valor da Movimentação (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={movAmountInput}
                  onChange={(e) => setMovAmountInput(e.target.value)}
                  placeholder="50.00"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-base font-bold text-slate-900 focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Motivo / Justificativa *
                </label>
                <input
                  type="text"
                  required
                  value={movDescInput}
                  onChange={(e) => setMovDescInput(e.target.value)}
                  placeholder={
                    movementType === 'SANGRIA' 
                      ? 'Ex: Pagamento de fornecedor de gelo / recolhimento cofre' 
                      : movementType === 'VALE'
                      ? 'Ex: Adiantamento quinzenal / Vale transporte'
                      : 'Ex: Reforço de troco para moedas e notas de 2'
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Operador Autorizado
                </label>
                <input
                  type="text"
                  value={movAuthorInput}
                  onChange={(e) => setMovAuthorInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsMovementModalActive(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2 font-bold rounded-xl text-white ${
                    movementType === 'SANGRIA' 
                      ? 'bg-rose-600 hover:bg-rose-700' 
                      : movementType === 'VALE'
                      ? 'bg-purple-600 hover:bg-purple-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  Salvar Lançamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VISUALIZAR ESPELHO DE CAIXA FECHADO */}
      {selectedHistoryShift && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl border border-slate-100">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-700" />
                <h3 className="text-base font-bold text-slate-900">Espelho de Caixa Fechado</h3>
              </div>
              <button onClick={() => setSelectedHistoryShift(null)} className="text-slate-400 hover:text-slate-800 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                <p><strong>Abertura:</strong> {formatDateTime(selectedHistoryShift.openedAt)} ({selectedHistoryShift.openedBy})</p>
                {selectedHistoryShift.closedAt && (
                  <p><strong>Fechamento:</strong> {formatDateTime(selectedHistoryShift.closedAt)} ({selectedHistoryShift.closedBy})</p>
                )}
                <p><strong>Fundo Inicial:</strong> {formatCurrency(selectedHistoryShift.initialBalance)}</p>
                <p><strong>Total em Dinheiro Contado:</strong> {formatCurrency(selectedHistoryShift.finalCountedCash || 0)}</p>
                <p><strong>Gaveta:</strong> {formatCurrency(selectedHistoryShift.finalCalculatedBalance || 0)}</p>
                <p className="font-bold">
                  <strong>Diferença:</strong> {formatCurrency(selectedHistoryShift.difference || 0)}
                </p>
                {selectedHistoryShift.notes && (
                  <p className="italic text-slate-600 pt-1">Obs: {selectedHistoryShift.notes}</p>
                )}
              </div>

              <div>
                <h4 className="font-bold text-slate-800 mb-2">Movimentações deste turno ({selectedHistoryShift.movements.length})</h4>
                <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto border border-slate-200 rounded-xl">
                  {selectedHistoryShift.movements.map((m) => (
                    <div key={m.id} className="p-2.5 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-slate-900">{m.description}</span>
                        <span className="text-[10px] text-slate-400 block">{formatTime(m.timestamp)} · {m.type === 'AJUSTE' ? 'Ajuste de Gaveta' : m.type}</span>
                      </div>
                      <span className={`font-mono font-bold ${m.type === 'SANGRIA' || (m.type === 'AJUSTE' && m.amount < 0) ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {m.type === 'AJUSTE' 
                          ? (m.amount >= 0 ? `+${formatCurrency(m.amount)}` : `-${formatCurrency(Math.abs(m.amount))}`)
                          : `${m.type === 'SANGRIA' ? '-' : '+'}${formatCurrency(m.amount)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setSelectedHistoryShift(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold text-xs"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR / AJUSTAR SALDO DA GAVETA */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 sm:p-6 space-y-4 shadow-2xl border border-slate-200 animate-in fade-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center shrink-0">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Editar Saldo da Gaveta</h3>
                  <p className="text-[11px] text-slate-500">Ajuste o valor físico disponível em caixa</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs flex justify-between items-center">
              <span className="text-amber-900 font-medium">Saldo atual da Gaveta:</span>
              <strong className="text-amber-950 font-black text-sm">{formatCurrency(metrics.expectedCashInDrawer)}</strong>
            </div>

            <form onSubmit={handleSaveAdjustDrawer} className="space-y-3.5 text-xs">
              <div>
                <label className="font-bold text-slate-800 block mb-1">
                  Novo Saldo da Gaveta (R$) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={adjustDrawerNewValue}
                    onChange={(e) => setAdjustDrawerNewValue(e.target.value)}
                    placeholder="0.00"
                    autoFocus
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-extrabold text-slate-900 focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                {adjustDrawerNewValue !== '' && !isNaN(parseFloat(adjustDrawerNewValue)) && (
                  <div className="mt-1.5 flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-slate-500">Diferença de ajuste:</span>
                    {(() => {
                      const diff = parseFloat(adjustDrawerNewValue) - metrics.expectedCashInDrawer;
                      if (Math.abs(diff) < 0.009) {
                        return <span className="text-slate-500 font-bold">Sem alteração</span>;
                      } else if (diff > 0) {
                        return <span className="text-emerald-700 font-bold">+ {formatCurrency(diff)} (Acréscimo)</span>;
                      } else {
                        return <span className="text-rose-600 font-bold">- {formatCurrency(Math.abs(diff))} (Redução)</span>;
                      }
                    })()}
                  </div>
                )}
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Motivo / Justificativa do Ajuste
                </label>
                <input
                  type="text"
                  value={adjustDrawerReason}
                  onChange={(e) => setAdjustDrawerReason(e.target.value)}
                  placeholder="Ex: Acerto de moedas, recontagem física, conferência"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-bold transition shadow-xs cursor-pointer"
                >
                  Salvar Novo Saldo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM MODAL FOR DELETE MOVEMENT (Eliminates window.confirm) */}
      {confirmDeleteMov && (
        <ConfirmModal
          isOpen={true}
          title="Excluir Lançamento do Caixa"
          message={`Tem certeza que deseja excluir o lançamento "${confirmDeleteMov.desc}" no valor de ${formatCurrency(confirmDeleteMov.amount)}? O saldo da gaveta e os relatórios serão recalculados imediatamente.`}
          confirmLabel="Excluir Lançamento"
          cancelLabel="Cancelar"
          isDanger={true}
          onConfirm={() => executeDeleteMovement(confirmDeleteMov.id)}
          onCancel={() => setConfirmDeleteMov(null)}
        />
      )}
    </div>
  );
};
