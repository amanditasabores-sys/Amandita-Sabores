import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { store } from '../../services/store';
import {
  CashRegisterShift,
  CashMovement,
  PaymentMethod,
  CashPendingDeliveredOrder,
  CashShiftPendingSummary,
  ExceptionalClosingJustificationInput,
  ExceptionalClosingReasonCode,
} from '../../types';
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
  AlertTriangle,
  CheckCircle2, 
  History, 
  Clock, 
  X,
  FileText,
  UserCheck,
  Pencil,
  Share2,
  RefreshCw,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';
import { thermalPrinterService } from '../../services/thermalPrinter';
import {
  calculateCashShiftMetrics,
  parseCountedCashInput,
  buildOpenShiftClosingReport,
  buildClosedShiftClosingReport,
} from '../../utils/cashClosingReport';
import { shareOrDownloadCashClosingPdf } from '../../utils/cashClosingPdf';
import {
  EXCEPTIONAL_CLOSING_REASON_OPTIONS,
  getExceptionalReasonOption,
  getPendingOrderTimingInfo,
} from '../../utils/cashPendingOrders';

interface CashRegisterManagerProps {
  onStateChanged: () => void;
}

export const CashRegisterManager: React.FC<CashRegisterManagerProps> = ({ onStateChanged }) => {
  const [currentShift, setCurrentShift] = useState<CashRegisterShift | null>(() => store.getCurrentCashShift());
  const [cashSyncState, setCashSyncState] = useState(() => store.getCashShiftSyncState());
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

  const defaultOperatorName = store.getCurrentUser()?.name || store.getCurrentUser()?.username || 'admin';

  // Open shift form
  const [initialBalanceInput, setInitialBalanceInput] = useState('150.00');
  const [openedByInput, setOpenedByInput] = useState(defaultOperatorName);

  // Close shift form
  const [countedCashInput, setCountedCashInput] = useState('');
  const [closingNotesInput, setClosingNotesInput] = useState('');

  // Movement form (Sangria / Suprimento / Vale)
  const [movAmountInput, setMovAmountInput] = useState('');
  const [movDescInput, setMovDescInput] = useState('');
  const [movEmployeeInput, setMovEmployeeInput] = useState('');
  const [movAuthorInput, setMovAuthorInput] = useState(defaultOperatorName);
  const [movPaymentMethod, setMovPaymentMethod] = useState<PaymentMethod>('DINHEIRO');

  // Server confirmation & retry safety state
  const [isSubmittingShiftOp, setIsSubmittingShiftOp] = useState(false);
  const [shiftActionError, setShiftActionError] = useState<string | null>(null);
  const pendingShiftIdRef = useRef<string | null>(null);
  const pendingMovementIdRef = useRef<string | null>(null);

  // Read-only output actions (Thermal Print & Share PDF)
  const [isPrintingClosing, setIsPrintingClosing] = useState(false);
  const [isSharingPdf, setIsSharingPdf] = useState(false);
  const [closeModalOutputFeedback, setCloseModalOutputFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [historyModalOutputFeedback, setHistoryModalOutputFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Pending delivered orders reconciliation state (server-authoritative)
  const [pendingSummary, setPendingSummary] = useState<CashShiftPendingSummary | null>(null);
  const [isLoadingPendingOrders, setIsLoadingPendingOrders] = useState(false);
  const [pendingOrdersError, setPendingOrdersError] = useState<string | null>(null);
  const [confirmingPendingOrder, setConfirmingPendingOrder] = useState<CashPendingDeliveredOrder | null>(null);
  const [isConfirmingPendingPayment, setIsConfirmingPendingPayment] = useState(false);
  const [pendingConfirmError, setPendingConfirmError] = useState<string | null>(null);
  const [pendingConfirmToast, setPendingConfirmToast] = useState<string | null>(null);
  const [showPreviousShiftsPending, setShowPreviousShiftsPending] = useState(false);
  const [isExceptionalCloseMode, setIsExceptionalCloseMode] = useState(false);
  const [exceptionalReasonsByOrderId, setExceptionalReasonsByOrderId] = useState<
    Record<string, { reasonCode: ExceptionalClosingReasonCode | ''; reasonDetail: string }>
  >({});
  const pendingPanelRef = useRef<HTMLDivElement | null>(null);
  const pendingRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canManageCash = store.canUserManageCash();

  const loadPendingOrders = useCallback(async (shiftId?: string) => {
    const targetId = shiftId || store.getCurrentCashShift()?.id;
    if (!targetId) {
      setPendingSummary(null);
      setPendingOrdersError(null);
      return null;
    }
    setIsLoadingPendingOrders(true);
    setPendingOrdersError(null);
    try {
      const res = await store.fetchCashShiftPendingOrdersAsync(targetId);
      if (res.success && res.summary) {
        setPendingSummary(res.summary);
        return res.summary;
      }
      setPendingOrdersError(res.error || 'Não foi possível consultar pendências financeiras deste turno.');
      return null;
    } finally {
      setIsLoadingPendingOrders(false);
    }
  }, []);

  const reloadData = () => {
    const latestShift = store.getCurrentCashShift();
    setCurrentShift(latestShift);
    setCashSyncState(store.getCashShiftSyncState());
    setHistoryShifts(store.getCashShiftHistory());
    onStateChanged();
    if (latestShift?.status === 'ABERTO') {
      if (pendingRefreshTimerRef.current) {
        clearTimeout(pendingRefreshTimerRef.current);
      }
      pendingRefreshTimerRef.current = setTimeout(() => {
        loadPendingOrders(latestShift.id).catch(() => {});
      }, 350);
    } else {
      setPendingSummary(null);
      setPendingOrdersError(null);
    }
  };

  useEffect(() => {
    const handleSync = () => reloadData();
    window.addEventListener('gestaofood_state_changed', handleSync);
    return () => {
      window.removeEventListener('gestaofood_state_changed', handleSync);
      if (pendingRefreshTimerRef.current) {
        clearTimeout(pendingRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (currentShift?.status === 'ABERTO' && currentShift.id) {
      loadPendingOrders(currentShift.id).catch(() => {});
    } else {
      setPendingSummary(null);
      setPendingOrdersError(null);
    }
  }, [currentShift?.id, currentShift?.status, loadPendingOrders]);

  const currentShiftPending = useMemo(
    () => (pendingSummary && currentShift && pendingSummary.shiftId === currentShift.id ? pendingSummary.currentShiftPending : []),
    [pendingSummary, currentShift]
  );
  const currentShiftPendingTotal = useMemo(
    () => (pendingSummary && currentShift && pendingSummary.shiftId === currentShift.id ? pendingSummary.currentShiftPendingTotal : 0),
    [pendingSummary, currentShift]
  );
  const previousShiftsPending = useMemo(
    () => (pendingSummary && currentShift && pendingSummary.shiftId === currentShift.id ? pendingSummary.previousShiftsPending : []),
    [pendingSummary, currentShift]
  );
  const previousShiftsPendingTotal = useMemo(
    () => (pendingSummary && currentShift && pendingSummary.shiftId === currentShift.id ? pendingSummary.previousShiftsPendingTotal : 0),
    [pendingSummary, currentShift]
  );

  // Financial calculations for open shift (mesma fórmula centralizada em cashClosingReport.ts)
  const metrics = useMemo(() => calculateCashShiftMetrics(currentShift), [currentShift]);

  // Read-only: Imprimir conferência pré-fechamento (Turno Aberto)
  const handlePrintOpenClosing = async () => {
    if (!currentShift || isSubmittingShiftOp || isPrintingClosing) return;
    setCloseModalOutputFeedback(null);

    const parsed = parseCountedCashInput(countedCashInput);
    if (!parsed.valid) {
      setCloseModalOutputFeedback({
        type: 'error',
        message: parsed.error || 'Informe o valor em dinheiro contado na gaveta.',
      });
      return;
    }

    const operator =
      store.getCurrentUser()?.name ||
      store.getCurrentUser()?.username ||
      openedByInput.trim() ||
      'admin';

    const report = buildOpenShiftClosingReport(currentShift, {
      countedCash: parsed.value,
      closingNotes: closingNotesInput,
      operatorName: operator,
      pendingDeliveredOrders: currentShiftPending,
    });

    setIsPrintingClosing(true);
    try {
      const res = await thermalPrinterService.printCashClosingReceipt(report);
      setCloseModalOutputFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message,
      });
    } catch (err: any) {
      setCloseModalOutputFeedback({
        type: 'error',
        message: `Não foi possível imprimir: ${err?.message || String(err)}`,
      });
    } finally {
      setIsPrintingClosing(false);
    }
  };

  // Read-only: Compartilhar / Baixar PDF da conferência pré-fechamento (Turno Aberto)
  const handleShareOpenClosingPdf = async () => {
    if (!currentShift || isSubmittingShiftOp || isSharingPdf) return;
    setCloseModalOutputFeedback(null);

    const parsed = parseCountedCashInput(countedCashInput);
    if (!parsed.valid) {
      setCloseModalOutputFeedback({
        type: 'error',
        message: parsed.error || 'Informe o valor em dinheiro contado na gaveta.',
      });
      return;
    }

    const operator =
      store.getCurrentUser()?.name ||
      store.getCurrentUser()?.username ||
      openedByInput.trim() ||
      'admin';

    const report = buildOpenShiftClosingReport(currentShift, {
      countedCash: parsed.value,
      closingNotes: closingNotesInput,
      operatorName: operator,
      pendingDeliveredOrders: currentShiftPending,
    });

    setIsSharingPdf(true);
    try {
      const res = await shareOrDownloadCashClosingPdf(report);
      if (!res.cancelled && res.message) {
        setCloseModalOutputFeedback({
          type: res.success ? 'success' : 'error',
          message: res.message,
        });
      }
    } catch (err: any) {
      setCloseModalOutputFeedback({
        type: 'error',
        message: `Não foi possível gerar o PDF: ${err?.message || String(err)}`,
      });
    } finally {
      setIsSharingPdf(false);
    }
  };

  // Read-only: Imprimir espelho de fechamento oficial (Turno Fechado / Histórico)
  const handlePrintHistoryClosing = async () => {
    if (!selectedHistoryShift || isPrintingClosing) return;
    setHistoryModalOutputFeedback(null);

    const report = buildClosedShiftClosingReport(selectedHistoryShift);

    setIsPrintingClosing(true);
    try {
      const res = await thermalPrinterService.printCashClosingReceipt(report);
      setHistoryModalOutputFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message,
      });
    } catch (err: any) {
      setHistoryModalOutputFeedback({
        type: 'error',
        message: `Não foi possível imprimir o espelho: ${err?.message || String(err)}`,
      });
    } finally {
      setIsPrintingClosing(false);
    }
  };

  // Read-only: Compartilhar / Baixar PDF do espelho de fechamento oficial (Turno Fechado / Histórico)
  const handleShareHistoryClosingPdf = async () => {
    if (!selectedHistoryShift || isSharingPdf) return;
    setHistoryModalOutputFeedback(null);

    const report = buildClosedShiftClosingReport(selectedHistoryShift);

    setIsSharingPdf(true);
    try {
      const res = await shareOrDownloadCashClosingPdf(report);
      if (!res.cancelled && res.message) {
        setHistoryModalOutputFeedback({
          type: res.success ? 'success' : 'error',
          message: res.message,
        });
      }
    } catch (err: any) {
      setHistoryModalOutputFeedback({
        type: 'error',
        message: `Não foi possível gerar o PDF do espelho: ${err?.message || String(err)}`,
      });
    } finally {
      setIsSharingPdf(false);
    }
  };

  // Adjust Drawer Balance handler (awaits server confirmation)
  const handleSaveAdjustDrawer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingShiftOp) return;
    setShiftActionError(null);

    const parsed = parseFloat(adjustDrawerNewValue);
    if (isNaN(parsed) || parsed < 0) {
      setShiftActionError('Por favor, informe um valor válido para o saldo da gaveta.');
      return;
    }

    if (!pendingMovementIdRef.current) {
      pendingMovementIdRef.current = `cash-adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }

    setIsSubmittingShiftOp(true);
    try {
      const operator = openedByInput.trim() || defaultOperatorName;
      const res = await store.adjustDrawerBalanceAsync(
        parsed,
        adjustDrawerReason,
        operator,
        { movementId: pendingMovementIdRef.current, shiftId: currentShift?.id }
      );
      if (!res.success) {
        setShiftActionError(res.error || 'Não foi possível ajustar o saldo da gaveta no servidor.');
        return;
      }

      pendingMovementIdRef.current = null;
      setIsAdjustModalOpen(false);
      setAdjustToast(`Saldo da gaveta atualizado com sucesso para ${formatCurrency(parsed)}!`);
      setTimeout(() => setAdjustToast(null), 3500);
      reloadData();
    } finally {
      setIsSubmittingShiftOp(false);
    }
  };

  // Open Cash Register (awaits server confirmation before updating local UI/state)
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingShiftOp) return;
    setShiftActionError(null);

    if (cashSyncState.status !== 'CONFIRMED') {
      setShiftActionError('Aguardando confirmação do estado do caixa com o servidor antes de abrir um novo turno.');
      return;
    }

    const val = parseFloat(initialBalanceInput);
    if (isNaN(val) || val < 0) {
      setShiftActionError('Informe um valor de fundo inicial válido (maior ou igual a zero).');
      return;
    }
    if (!openedByInput.trim()) {
      setShiftActionError('Informe o operador responsável pela abertura.');
      return;
    }

    if (!pendingShiftIdRef.current) {
      pendingShiftIdRef.current = `shift-${Date.now()}`;
    }

    setIsSubmittingShiftOp(true);
    try {
      const res = await store.openCashRegisterAsync(val, openedByInput.trim(), {
        shiftId: pendingShiftIdRef.current,
      });
      if (!res.success) {
        setShiftActionError(res.error || 'Não foi possível abrir o caixa no servidor.');
        return;
      }

      pendingShiftIdRef.current = null;
      setIsOpenModalActive(false);
      reloadData();
    } finally {
      setIsSubmittingShiftOp(false);
    }
  };

  // Close Cash Register (awaits server confirmation before closing locally)
  // Confirm pending delivered order payment exclusively through atomic server endpoint
  const handleConfirmPendingOrderPayment = async () => {
    if (!confirmingPendingOrder || !currentShift || isConfirmingPendingPayment) return;
    if (!canManageCash) {
      setPendingConfirmError('Permissão insuficiente: apenas Caixa, Gerente ou Administrador podem confirmar pagamentos.');
      return;
    }
    setPendingConfirmError(null);
    setIsConfirmingPendingPayment(true);
    try {
      const operator = store.getCurrentUser()?.name || store.getCurrentUser()?.username || defaultOperatorName;
      const methodLabel = getPaymentMethodLabel(confirmingPendingOrder.paymentMethod as PaymentMethod);
      const res = await store.updatePaymentStatusAsync(
        confirmingPendingOrder.orderId,
        'PAGO',
        operator,
        `Conferência financeira no Controle de Caixa (${methodLabel} · ${formatCurrency(confirmingPendingOrder.totalAmount)}) por ${operator}`,
        {
          shiftId: currentShift.id,
          requireOrderInShiftPeriod: true,
          allowServerFetchIfMissing: true,
        }
      );

      if (!res.synced && res.rejected) {
        setPendingConfirmError(res.error || 'O servidor recusou a confirmação de pagamento deste pedido.');
        return;
      }
      if (!res.order || res.order.paymentStatus !== 'PAGO') {
        setPendingConfirmError(res.error || 'Não foi possível confirmar o pagamento no servidor. Nenhuma venda foi duplicada.');
        return;
      }

      const confirmedNum = confirmingPendingOrder.orderNumber;
      const confirmedVal = formatCurrency(confirmingPendingOrder.totalAmount);
      setConfirmingPendingOrder(null);
      setPendingConfirmError(null);
      setPendingConfirmToast(
        res.alreadyConfirmed
          ? `Pedido ${confirmedNum} já estava confirmado anteriormente (idempotência preservada, sem duplicidade).`
          : `Pagamento do pedido ${confirmedNum} (${confirmedVal}) confirmado e lançado no caixa!`
      );
      setTimeout(() => setPendingConfirmToast(null), 6000);
      reloadData();
      await loadPendingOrders(currentShift.id);
    } finally {
      setIsConfirmingPendingPayment(false);
    }
  };

  // Validate exceptional justifications filled in the close modal
  const exceptionalValidationStatus = useMemo(() => {
    if (currentShiftPending.length === 0) {
      return { valid: true, missingCount: 0, payloads: [] as ExceptionalClosingJustificationInput[] };
    }
    const payloads: ExceptionalClosingJustificationInput[] = [];
    let missingCount = 0;

    for (const order of currentShiftPending) {
      const entry = exceptionalReasonsByOrderId[order.orderId];
      if (!entry || !entry.reasonCode) {
        missingCount += 1;
        continue;
      }
      const opt = getExceptionalReasonOption(entry.reasonCode);
      const detail = (entry.reasonDetail || '').trim();
      if (opt.requiresDetail && detail.length < 5) {
        missingCount += 1;
        continue;
      }
      payloads.push({
        orderId: order.orderId,
        reasonCode: entry.reasonCode,
        ...(detail ? { reasonDetail: detail } : {}),
      });
    }

    return {
      valid: missingCount === 0 && payloads.length === currentShiftPending.length,
      missingCount,
      payloads,
    };
  }, [currentShiftPending, exceptionalReasonsByOrderId]);

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingShiftOp) return;
    setShiftActionError(null);

    const counted = parseFloat(countedCashInput);
    if (isNaN(counted) || counted < 0) {
      setShiftActionError('Informe o valor em dinheiro contado na gaveta (maior ou igual a zero).');
      return;
    }

    if (currentShiftPending.length > 0) {
      if (!isExceptionalCloseMode) {
        setShiftActionError(
          `Fechamento bloqueado: existem ${currentShiftPending.length} pedido(s) entregue(s) com pagamento PENDENTE neste turno. Volte para conferência ou registre justificativa excepcional para cada pedido.`
        );
        return;
      }
      if (!exceptionalValidationStatus.valid) {
        setShiftActionError(
          'Preencha uma justificativa válida para cada pedido pendente deste turno (e informe a descrição obrigatória ao escolher "Outra situação").'
        );
        return;
      }
    }

    setIsSubmittingShiftOp(true);
    try {
      const operator = store.getCurrentUser()?.name || store.getCurrentUser()?.username || openedByInput.trim() || 'admin';
      const res = await store.closeCashRegisterAsync(
        counted,
        operator,
        closingNotesInput.trim(),
        {
          shiftId: currentShift?.id,
          ...(currentShiftPending.length > 0 && isExceptionalCloseMode
            ? { exceptionalJustifications: exceptionalValidationStatus.payloads }
            : {}),
        }
      );
      if (!res.success) {
        if (
          (res.code === 'PENDING_DELIVERED_ORDERS_EXIST' || res.code === 'INVALID_EXCEPTIONAL_JUSTIFICATIONS') &&
          Array.isArray(res.pendingOrders) &&
          res.pendingOrders.length > 0 &&
          currentShift
        ) {
          setPendingSummary((prev) => ({
            shiftId: currentShift.id,
            shiftStatus: 'ABERTO',
            shiftOpenedAt: currentShift.openedAt,
            checkedAt: new Date().toISOString(),
            currentShiftPending: res.pendingOrders || [],
            currentShiftPendingCount: res.pendingCount ?? (res.pendingOrders?.length || 0),
            currentShiftPendingTotal: res.pendingTotalAmount ?? 0,
            previousShiftsPending: prev?.previousShiftsPending || [],
            previousShiftsPendingCount: prev?.previousShiftsPendingCount || 0,
            previousShiftsPendingTotal: prev?.previousShiftsPendingTotal || 0,
          }));
        }
        setShiftActionError(res.error || 'Não foi possível fechar o caixa no servidor. O turno permanece aberto.');
        return;
      }

      setIsCloseModalActive(false);
      setIsExceptionalCloseMode(false);
      setExceptionalReasonsByOrderId({});
      setCloseModalOutputFeedback(null);
      setCountedCashInput('');
      setClosingNotesInput('');
      setPendingSummary(null);
      reloadData();
      if (res.shift) {
        setHistoryModalOutputFeedback(null);
        setSelectedHistoryShift(res.shift);
      }
    } finally {
      setIsSubmittingShiftOp(false);
    }
  };

  // Add Movement (Sangria, Suprimento ou Vale) (awaits server confirmation)
  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingShiftOp) return;
    setShiftActionError(null);

    const amt = parseFloat(movAmountInput);
    if (!amt || amt <= 0 || !movDescInput.trim()) {
      setShiftActionError('Informe um valor maior que zero e a justificativa do lançamento.');
      return;
    }
    if (movementType === 'VALE' && !movEmployeeInput.trim()) {
      setShiftActionError('Informe o nome do funcionário beneficiário do vale.');
      return;
    }

    if (!pendingMovementIdRef.current) {
      pendingMovementIdRef.current = `cash-mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }

    setIsSubmittingShiftOp(true);
    try {
      const res = await store.addCashMovementAsync(
        movementType,
        amt,
        movDescInput.trim(),
        movAuthorInput.trim() || defaultOperatorName,
        movPaymentMethod,
        movementType === 'VALE' ? movEmployeeInput.trim() : undefined,
        { movementId: pendingMovementIdRef.current, shiftId: currentShift?.id }
      );
      if (!res.success) {
        setShiftActionError(res.error || 'Não foi possível registrar o lançamento no servidor.');
        return;
      }

      pendingMovementIdRef.current = null;
      setIsMovementModalActive(false);
      setMovAmountInput('');
      setMovDescInput('');
      setMovEmployeeInput('');
      reloadData();
    } finally {
      setIsSubmittingShiftOp(false);
    }
  };

  // Delete Cash Movement with Custom Modal (awaits server confirmation)
  const executeDeleteMovement = async (movementId: string) => {
    if (isSubmittingShiftOp) return;
    setShiftActionError(null);
    setIsSubmittingShiftOp(true);
    try {
      const res = await store.deleteCashMovementAsync(movementId, { shiftId: currentShift?.id });
      if (!res.success) {
        setShiftActionError(res.error || 'Não foi possível excluir o lançamento no servidor.');
        return;
      }
      setConfirmDeleteMov(null);
      reloadData();
    } finally {
      setIsSubmittingShiftOp(false);
    }
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
                cashSyncState.status === 'SYNCING' || cashSyncState.status === 'IDLE'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : cashSyncState.status === 'ERROR'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : currentShift?.status === 'ABERTO'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  cashSyncState.status === 'SYNCING' || cashSyncState.status === 'IDLE'
                    ? 'bg-amber-500 animate-pulse'
                    : cashSyncState.status === 'ERROR'
                    ? 'bg-rose-500'
                    : currentShift?.status === 'ABERTO'
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-rose-500'
                }`} />
                {cashSyncState.status === 'SYNCING' || cashSyncState.status === 'IDLE'
                  ? 'SINCRONIZANDO CAIXA...'
                  : cashSyncState.status === 'ERROR'
                  ? 'ERRO DE SINCRONIZAÇÃO'
                  : currentShift?.status === 'ABERTO'
                  ? 'CAIXA ABERTO'
                  : 'CAIXA FECHADO'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {cashSyncState.status === 'SYNCING' || cashSyncState.status === 'IDLE' ? (
                <span>Aguardando confirmação real do turno de caixa no servidor...</span>
              ) : cashSyncState.status === 'ERROR' ? (
                <span>{cashSyncState.error || 'Não foi possível confirmar o estado do caixa com o servidor.'}</span>
              ) : currentShift?.status === 'ABERTO' ? (
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
                onClick={() => {
                  pendingMovementIdRef.current = `cash-mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  setShiftActionError(null);
                  setMovementType('SANGRIA');
                  setIsMovementModalActive(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition"
              >
                <ArrowDownCircle className="w-4 h-4" />
                <span>Nova Sangria</span>
              </button>

              <button
                onClick={() => {
                  pendingMovementIdRef.current = `cash-mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  setShiftActionError(null);
                  setMovementType('SUPRIMENTO');
                  setIsMovementModalActive(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition"
              >
                <ArrowUpCircle className="w-4 h-4" />
                <span>Novo Suprimento</span>
              </button>

              <button
                onClick={() => {
                  pendingMovementIdRef.current = `cash-mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  setShiftActionError(null);
                  setMovementType('VALE');
                  setIsMovementModalActive(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold transition"
              >
                <UserCheck className="w-4 h-4" />
                <span>Novo Vale / Adiantamento</span>
              </button>

              <button
                onClick={() => {
                  setShiftActionError(null);
                  setCloseModalOutputFeedback(null);
                  setIsExceptionalCloseMode(false);
                  setExceptionalReasonsByOrderId({});
                  setCountedCashInput(metrics.expectedCashInDrawer.toFixed(2));
                  setIsCloseModalActive(true);
                  if (currentShift?.id) {
                    loadPendingOrders(currentShift.id).catch(() => {});
                  }
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
              >
                <Lock className="w-4 h-4 text-amber-400" />
                <span>Fechar Caixa</span>
                {currentShiftPending.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[10px] font-black">
                    {currentShiftPending.length} pend.
                  </span>
                )}
              </button>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  if (cashSyncState.status !== 'CONFIRMED') return;
                  pendingShiftIdRef.current = `shift-${Date.now()}`;
                  setShiftActionError(null);
                  setIsOpenModalActive(true);
                }}
                disabled={cashSyncState.status !== 'CONFIRMED'}
                title={
                  cashSyncState.status === 'ERROR'
                    ? 'Aguardando confirmação do servidor para evitar abertura de caixa duplicado.'
                    : cashSyncState.status === 'SYNCING' || cashSyncState.status === 'IDLE'
                    ? 'Aguardando sincronização inicial do caixa com o servidor.'
                    : 'Abrir um novo turno de caixa'
                }
                className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition shadow-sm cursor-pointer"
              >
                <Unlock className="w-4 h-4" />
                <span>
                  {cashSyncState.status === 'SYNCING' || cashSyncState.status === 'IDLE'
                    ? 'Sincronizando...'
                    : cashSyncState.status === 'ERROR'
                    ? 'Aguardando reconexão...'
                    : 'Abrir Novo Caixa'}
                </span>
              </button>

              {cashSyncState.status === 'ERROR' && (
                <button
                  type="button"
                  onClick={() => {
                    store.refreshStaffSync().catch(() => {});
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-[#F8FAFC] text-[#0F2342] border border-[#E2E8F0] rounded-xl text-xs font-bold transition cursor-pointer"
                  title="Tentar verificar novamente o estado do caixa no servidor"
                >
                  <Clock className="w-4 h-4 text-[#EA580C]" />
                  <span>Tentar reconectar</span>
                </button>
              )}
            </div>
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
            <p className="text-base font-black text-emerald-700 mt-1">{formatCurrency(metrics.netCashSales)}</p>
            <span className="text-[10px] text-emerald-600 block">
              {metrics.cashRefunds > 0 ? `Líq (Devol: -${formatCurrency(metrics.cashRefunds)})` : '+ na gaveta'}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vendas PIX</span>
            <p className="text-base font-black text-blue-700 mt-1">{formatCurrency(metrics.netPixSales)}</p>
            <span className="text-[10px] text-blue-600 block">
              {metrics.pixRefunds > 0 ? `Líq (Devol: -${formatCurrency(metrics.pixRefunds)})` : 'Em conta'}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vendas Cartão</span>
            <p className="text-base font-black text-indigo-700 mt-1">{formatCurrency(metrics.netCardSales)}</p>
            <span className="text-[10px] text-indigo-600 block">
              Créd: {formatCurrency(metrics.netCreditCardSales)} · Déb: {formatCurrency(metrics.netDebitCardSales)}
            </span>
            {metrics.cardRefunds > 0 && (
              <span className="text-[10px] text-rose-600 block">
                Devol: -{formatCurrency(metrics.cardRefunds)}
              </span>
            )}
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
                    pendingMovementIdRef.current = `cash-adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                    setShiftActionError(null);
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
                  pendingMovementIdRef.current = `cash-adj-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  setShiftActionError(null);
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

      {/* PAINEL DE PENDÊNCIAS FINANCEIRAS DO TURNO ABERTO */}
      {currentShift?.status === 'ABERTO' && (
        <div
          ref={pendingPanelRef}
          className={`rounded-2xl border p-5 sm:p-6 shadow-xs space-y-4 ${
            currentShiftPending.length > 0
              ? 'bg-amber-50/70 border-amber-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-200/80">
            <div className="flex items-start gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  currentShiftPending.length > 0
                    ? 'bg-amber-200/80 text-amber-900'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {currentShiftPending.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-black text-slate-900">
                    Pedidos Entregues — Pendentes de Conferência
                  </h3>
                  {currentShiftPending.length > 0 ? (
                    <span className="px-2.5 py-0.5 rounded-lg bg-amber-200 text-amber-950 text-[11px] font-black border border-amber-300">
                      {currentShiftPending.length} pendente(s) · {formatCurrency(currentShiftPendingTotal)}
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold border border-emerald-200">
                      Nenhuma pendência neste turno
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Pedidos do turno atual já marcados como <strong>ENTREGUE</strong> que ainda estão com pagamento{' '}
                  <strong>PENDENTE</strong> e sem movimentação de venda no caixa. Estes valores não compõem o faturamento nem a gaveta até conferência.
                </p>
                {pendingSummary?.checkedAt && (
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Última verificação no servidor: {formatDateTime(pendingSummary.checkedAt)}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={isLoadingPendingOrders}
              onClick={() => loadPendingOrders(currentShift.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPendingOrders ? 'animate-spin' : ''}`} />
              <span>{isLoadingPendingOrders ? 'Verificando...' : 'Atualizar'}</span>
            </button>
          </div>

          {pendingConfirmToast && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{pendingConfirmToast}</span>
              </div>
              <button
                type="button"
                onClick={() => setPendingConfirmToast(null)}
                className="text-emerald-700 hover:text-emerald-950 p-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {pendingOrdersError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{pendingOrdersError}</span>
              </div>
              <button
                type="button"
                onClick={() => loadPendingOrders(currentShift.id)}
                className="px-2.5 py-1 bg-white border border-rose-300 text-rose-700 rounded-lg font-bold hover:bg-rose-50 cursor-pointer"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {isLoadingPendingOrders && !pendingSummary ? (
            <div className="py-6 text-center text-xs text-slate-500">
              Consultando pedidos entregues com pagamento pendente no servidor...
            </div>
          ) : currentShiftPending.length === 0 ? (
            <div className="py-4 px-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                Todos os pedidos entregues neste turno já possuem pagamento confirmado no caixa ou não há pendências em aberto.
              </span>
            </div>
          ) : (
            <div className="overflow-x-auto bg-white rounded-xl border border-amber-200">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-amber-100 bg-amber-50/70 text-[11px] uppercase tracking-wider text-amber-900 font-bold">
                    <th className="py-2.5 px-3">Pedido / ID</th>
                    <th className="py-2.5 px-3">Data / Hora</th>
                    <th className="py-2.5 px-3">Cliente / Origem</th>
                    <th className="py-2.5 px-3">Forma Pgto</th>
                    <th className="py-2.5 px-3">Entregador / Prestação</th>
                    <th className="py-2.5 px-3 text-right">Valor</th>
                    <th className="py-2.5 px-3 text-center">Conferência</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentShiftPending.map((order) => (
                    <tr key={order.orderId} className="hover:bg-amber-50/40 transition">
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-mono font-black text-slate-900 block">{order.orderNumber}</span>
                        <span className="font-mono text-[10px] text-slate-400">{order.orderId}</span>
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                        {(() => {
                          const timing = getPendingOrderTimingInfo(order);
                          return (
                            <div className="space-y-0.5">
                              <div className="whitespace-nowrap">
                                <span className="font-sans text-[10px] text-slate-400 mr-1">Criado:</span>
                                {formatDateTime(order.createdAt)}
                              </div>
                              {timing.deliveredAt ? (
                                <>
                                  <div className="text-[10px] text-slate-500 whitespace-nowrap">
                                    <span className="font-sans text-slate-400 mr-1">
                                      {timing.isApproximateDeliveredAt ? 'Horário alternativo:' : 'Entregue:'}
                                    </span>
                                    {formatDateTime(timing.deliveredAt)}
                                  </div>
                                  {timing.isApproximateDeliveredAt && (
                                    <div className="font-sans text-[10px] text-slate-500 italic leading-snug max-w-[240px]">
                                      Horário alternativo (updatedAt) — não confirma o momento exato da entrega.
                                    </div>
                                  )}
                                  {timing.isDeliveredBeforeCreated && (
                                    <div className="font-sans text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 inline-flex items-center gap-1 leading-snug">
                                      <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                                      <span>Atenção: horário de entrega anterior à criação registrada</span>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="font-sans text-[10px] text-slate-400 italic whitespace-nowrap">
                                  Entrega: horário indisponível
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-semibold text-slate-800 block">{order.customerName}</span>
                        <span className="text-[10px] text-slate-500">Origem: {order.originLabel}</span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-bold text-[11px] border border-slate-200">
                          {getPaymentMethodLabel(order.paymentMethod as PaymentMethod)}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-slate-700 font-medium block">
                          {order.deliveryPersonName || 'Não informado'}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {order.settlementStatus ? `Prestação: ${order.settlementStatus}` : 'Sem prestação vinculada'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-amber-900 whitespace-nowrap">
                        {formatCurrency(order.totalAmount)}
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {canManageCash ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPendingConfirmError(null);
                              setConfirmingPendingOrder(order);
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition shadow-xs cursor-pointer"
                          >
                            Confirmar Pagamento
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">Somente consulta</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* SEÇÃO SEPARADA: PENDÊNCIAS DE TURNOS ANTERIORES (SOMENTE CONSULTA — NUNCA MISTURAR NO TURNO ATUAL) */}
          {previousShiftsPending.length > 0 && (
            <div className="pt-2">
              <div className="rounded-xl border border-slate-300 bg-slate-50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowPreviousShiftsPending((prev) => !prev)}
                  className="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-left hover:bg-slate-100/80 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-slate-600 shrink-0" />
                    <div>
                      <span className="text-xs font-bold text-slate-800">
                        Pendências de Turnos Anteriores (Somente Consulta)
                      </span>
                      <span className="ml-2 px-2 py-0.5 rounded bg-slate-200 text-slate-800 text-[10px] font-bold">
                        {previousShiftsPending.length} pedido(s) · {formatCurrency(previousShiftsPendingTotal)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <span>{showPreviousShiftsPending ? 'Ocultar lista' : 'Visualizar detalhes'}</span>
                    {showPreviousShiftsPending ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </button>

                {showPreviousShiftsPending && (
                  <div className="px-4 pb-4 space-y-3 border-t border-slate-200 pt-3">
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-600">
                      Estes pedidos foram criados <strong>antes da abertura do turno atual</strong> (
                      {formatDateTime(currentShift.openedAt)}). Eles permanecem identificáveis separadamente para auditoria e{' '}
                      <strong>não são misturados nem lançados automaticamente neste turno</strong>.
                    </div>

                    <div className="overflow-x-auto bg-white rounded-lg border border-slate-200">
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                            <th className="py-2 px-2.5">Pedido / ID</th>
                            <th className="py-2 px-2.5">Data</th>
                            <th className="py-2 px-2.5">Cliente / Origem</th>
                            <th className="py-2 px-2.5">Forma Pgto</th>
                            <th className="py-2 px-2.5">Entregador</th>
                            <th className="py-2 px-2.5 text-right">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previousShiftsPending.map((oldOrder) => (
                            <tr key={oldOrder.orderId} className="hover:bg-slate-50/70">
                              <td className="py-2 px-2.5 whitespace-nowrap">
                                <span className="font-mono font-bold text-slate-800 block">{oldOrder.orderNumber}</span>
                                <span className="font-mono text-[10px] text-slate-400">{oldOrder.orderId}</span>
                              </td>
                              <td className="py-2 px-2.5 font-mono text-slate-600">
                                {(() => {
                                  const timing = getPendingOrderTimingInfo(oldOrder);
                                  return (
                                    <div className="space-y-0.5">
                                      <div className="whitespace-nowrap">
                                        <span className="font-sans text-[10px] text-slate-400 mr-1">Criado:</span>
                                        {formatDateTime(oldOrder.createdAt)}
                                      </div>
                                      {timing.deliveredAt ? (
                                        <>
                                          <div className="text-[10px] text-slate-500 whitespace-nowrap">
                                            <span className="font-sans text-slate-400 mr-1">
                                              {timing.isApproximateDeliveredAt ? 'Horário alternativo:' : 'Entregue:'}
                                            </span>
                                            {formatDateTime(timing.deliveredAt)}
                                          </div>
                                          {timing.isApproximateDeliveredAt && (
                                            <div className="font-sans text-[10px] text-slate-500 italic leading-snug max-w-[230px]">
                                              Horário alternativo (updatedAt) — não confirma o momento exato da entrega.
                                            </div>
                                          )}
                                          {timing.isDeliveredBeforeCreated && (
                                            <div className="font-sans text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 inline-flex items-center gap-1 leading-snug">
                                              <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                                              <span>Atenção: horário de entrega anterior à criação registrada</span>
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        <div className="font-sans text-[10px] text-slate-400 italic whitespace-nowrap">
                                          Entrega: horário indisponível
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="py-2 px-2.5">
                                <span className="font-medium text-slate-800 block">{oldOrder.customerName}</span>
                                <span className="text-[10px] text-slate-400">Origem: {oldOrder.originLabel}</span>
                              </td>
                              <td className="py-2 px-2.5 whitespace-nowrap text-slate-700">
                                {getPaymentMethodLabel(oldOrder.paymentMethod as PaymentMethod)}
                              </td>
                              <td className="py-2 px-2.5 text-slate-600">
                                {oldOrder.deliveryPersonName || '—'}
                              </td>
                              <td className="py-2 px-2.5 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                                {formatCurrency(oldOrder.totalAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
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
                    const isEstorno = mov.type === 'ESTORNO';
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
                              : mov.type === 'ESTORNO'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : mov.type === 'SUPRIMENTO'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : mov.type === 'VALE'
                              ? 'bg-purple-50 text-purple-700 border border-purple-200'
                              : mov.type === 'AJUSTE'
                              ? 'bg-amber-50 text-amber-800 border border-amber-300'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {mov.type === 'VENDA' 
                              ? 'Venda' 
                              : mov.type === 'ESTORNO' 
                              ? 'Estorno / Devolução' 
                              : mov.type === 'SUPRIMENTO' 
                              ? 'Suprimento (Entrada)' 
                              : mov.type === 'VALE' 
                              ? 'Vale Funcionário' 
                              : mov.type === 'AJUSTE' 
                              ? 'Ajuste de Gaveta' 
                              : 'Sangria (Retirada)'}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-slate-800 font-medium">
                          {mov.employeeName && (
                            <span className="font-bold text-purple-800 mr-1.5 bg-purple-50 px-1.5 py-0.5 rounded text-[11px] border border-purple-200">
                              👤 {mov.employeeName}
                            </span>
                          )}
                          <span>{mov.description}</span>
                          {mov.orderNumber && (
                            <span className="ml-1.5 font-mono text-[11px] text-amber-700 font-bold">({mov.orderNumber})</span>
                          )}
                          {mov.refundReason && (
                            <span className="block text-[10px] text-rose-700 italic mt-0.5">
                              Motivo: {mov.refundReason}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-slate-600 whitespace-nowrap">
                          {mov.paymentMethod ? getPaymentMethodLabel(mov.paymentMethod) : 'Dinheiro'}
                        </td>
                        <td className={`py-3 px-2 text-right font-mono font-bold whitespace-nowrap ${
                          isAjuste
                            ? mov.amount >= 0 ? 'text-emerald-700' : 'text-rose-600'
                            : isEstorno || isSangria
                            ? 'text-rose-600'
                            : isVale
                            ? 'text-purple-700'
                            : 'text-emerald-700'
                        }`}>
                          {isAjuste
                            ? mov.amount >= 0 ? `+${formatCurrency(mov.amount)}` : `-${formatCurrency(Math.abs(mov.amount))}`
                            : isEstorno
                            ? `-${formatCurrency(mov.amount)}`
                            : `${isPositive ? '+' : '-'}${formatCurrency(Math.abs(mov.amount))}`}
                        </td>
                        <td className="py-3 px-2 text-slate-500 whitespace-nowrap">
                          {mov.author}
                        </td>
                        <td className="py-3 px-2 text-center whitespace-nowrap">
                          <button
                            onClick={() => {
                              setShiftActionError(null);
                              setConfirmDeleteMov({ id: mov.id, desc: mov.description, amount: mov.amount });
                            }}
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
                        <div>{h.openedBy} {h.closedBy && h.closedBy !== h.openedBy ? `/ ${h.closedBy}` : ''}</div>
                        {h.closedWithPendingOrders && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                            Fech. Excepcional · {h.pendingDeliveredAtCloseCount || h.exceptionalPendingJustifications?.length || 0} pend.
                          </span>
                        )}
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
                          type="button"
                          onClick={() => { setHistoryModalOutputFeedback(null); setSelectedHistoryShift(h); }}
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
              <button
                disabled={isSubmittingShiftOp}
                onClick={() => { pendingShiftIdRef.current = null; setShiftActionError(null); setIsOpenModalActive(false); }}
                className="text-slate-400 hover:text-slate-800 p-1 disabled:opacity-50"
              >
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

              {shiftActionError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{shiftActionError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isSubmittingShiftOp}
                  onClick={() => { pendingShiftIdRef.current = null; setShiftActionError(null); setIsOpenModalActive(false); }}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-semibold disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingShiftOp}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-60 cursor-pointer"
                >
                  {isSubmittingShiftOp ? 'Processando...' : 'Confirmar Abertura'}
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
              <button
                type="button"
                disabled={isSubmittingShiftOp}
                onClick={() => { setShiftActionError(null); setCloseModalOutputFeedback(null); setIsCloseModalActive(false); }}
                className="text-slate-400 hover:text-slate-800 p-1 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary comparison */}
            <div className="p-3.5 bg-slate-50 rounded-xl space-y-2 text-xs text-slate-600 border border-slate-200">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-700 pb-1 border-b border-slate-200">
                Vendas Efetivamente Confirmadas e Gaveta
              </div>
              <div className="flex justify-between">
                <span>Fundo inicial de troco:</span>
                <span className="font-mono font-semibold">{formatCurrency(metrics.initialBalance)}</span>
              </div>
              <div className="flex justify-between">
                <span>Vendas em dinheiro (bruto):</span>
                <span className="font-mono font-semibold text-emerald-700">+{formatCurrency(metrics.grossCashSales)}</span>
              </div>
              {metrics.cashRefunds > 0 && (
                <div className="flex justify-between text-rose-600 font-semibold">
                  <span>Estornos/Devoluções em dinheiro:</span>
                  <span className="font-mono">-{formatCurrency(metrics.cashRefunds)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-slate-700">
                <span>Vendas líquidas em dinheiro:</span>
                <span className="font-mono text-emerald-800">+{formatCurrency(metrics.netCashSales)}</span>
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
                <span>Gaveta (Dinheiro Físico Esperado):</span>
                <span className="text-amber-800">{formatCurrency(metrics.expectedCashInDrawer)}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 space-y-1 text-[11px] text-slate-500">
                <div className="flex justify-between">
                  <span>Vendas PIX:</span>
                  <span className="font-semibold text-blue-700">
                    Bruto: {formatCurrency(metrics.grossPixSales)}
                    {metrics.pixRefunds > 0 ? ` | Devol: -${formatCurrency(metrics.pixRefunds)} | Líq: ${formatCurrency(metrics.netPixSales)}` : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Vendas Cartão de Crédito:</span>
                  <span className="font-semibold text-indigo-700">
                    Bruto: {formatCurrency(metrics.grossCreditCardSales)}
                    {metrics.creditCardRefunds > 0 ? ` | Devol: -${formatCurrency(metrics.creditCardRefunds)} | Líq: ${formatCurrency(metrics.netCreditCardSales)}` : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Vendas Cartão de Débito:</span>
                  <span className="font-semibold text-indigo-700">
                    Bruto: {formatCurrency(metrics.grossDebitCardSales)}
                    {metrics.debitCardRefunds > 0 ? ` | Devol: -${formatCurrency(metrics.debitCardRefunds)} | Líq: ${formatCurrency(metrics.netDebitCardSales)}` : ''}
                  </span>
                </div>
                {(metrics.grossOtherCardOrMixedSales > 0 || metrics.otherCardOrMixedRefunds > 0) && (
                  <div className="flex justify-between">
                    <span>Outros / Pagamento Misto (não separado):</span>
                    <span className="font-semibold text-slate-700">
                      Bruto: {formatCurrency(metrics.grossOtherCardOrMixedSales)}
                      {metrics.otherCardOrMixedRefunds > 0 ? ` | Devol: -${formatCurrency(metrics.otherCardOrMixedRefunds)} | Líq: ${formatCurrency(metrics.netOtherCardOrMixedSales)}` : ''}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-700">Total Cartões:</span>
                  <span className="font-semibold text-indigo-800">
                    Bruto: {formatCurrency(metrics.grossCardSales)}
                    {metrics.cardRefunds > 0 ? ` | Devol: -${formatCurrency(metrics.cardRefunds)} | Líq: ${formatCurrency(metrics.netCardSales)}` : ''}
                  </span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-100">
                  <span>Receita Total Líquida do Turno:</span>
                  <span className="text-emerald-700 font-mono">{formatCurrency(metrics.totalNetRevenue)}</span>
                </div>
              </div>
            </div>

            {/* PROTEÇÃO DE FECHAMENTO: PENDÊNCIAS DO TURNO ATUAL */}
            {isLoadingPendingOrders && !pendingSummary && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-slate-500 shrink-0" />
                <span>Verificando pedidos entregues com pagamento pendente no servidor...</span>
              </div>
            )}

            {currentShiftPending.length > 0 && (
              <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-xl space-y-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="font-black text-amber-950 text-sm">
                      Fechamento Bloqueado: {currentShiftPending.length} pedido(s) entregue(s) com pagamento PENDENTE
                    </h4>
                    <p className="text-amber-900">
                      Valor pendente neste turno:{' '}
                      <strong className="font-mono">{formatCurrency(currentShiftPendingTotal)}</strong> (não incluído nas vendas nem na gaveta).
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-amber-200 divide-y divide-amber-100 max-h-40 overflow-y-auto">
                  {currentShiftPending.map((item) => {
                    const timing = getPendingOrderTimingInfo(item);
                    return (
                      <div key={item.orderId} className="px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
                        <div>
                          <span className="font-mono font-bold text-slate-900">{item.orderNumber}</span>{' '}
                          <span className="text-slate-600">· {item.customerName}</span>
                          <span className="block text-[10px] text-slate-500 font-mono">
                            {item.orderId} · {getPaymentMethodLabel(item.paymentMethod as PaymentMethod)}
                          </span>
                          <span className="block text-[10px] text-slate-500 font-mono">
                            Criado: {formatDateTime(item.createdAt)}
                            {timing.deliveredAt
                              ? ` · ${timing.isApproximateDeliveredAt ? 'Horário alternativo' : 'Entregue'}: ${formatDateTime(timing.deliveredAt)}`
                              : ' · Entrega: horário indisponível'}
                          </span>
                          {timing.isApproximateDeliveredAt && (
                            <span className="block text-[10px] text-slate-500 italic">
                              Horário alternativo (updatedAt) — não confirma o momento exato da entrega.
                            </span>
                          )}
                          {timing.isDeliveredBeforeCreated && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-0.5">
                              <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                              <span>Atenção: horário de entrega anterior à criação registrada</span>
                            </span>
                          )}
                        </div>
                        <span className="font-mono font-bold text-amber-900 whitespace-nowrap">
                          {formatCurrency(item.totalAmount)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isSubmittingShiftOp}
                    onClick={() => {
                      setIsCloseModalActive(false);
                      setIsExceptionalCloseMode(false);
                      setShiftActionError(null);
                      setTimeout(() => {
                        pendingPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 100);
                    }}
                    className="flex-1 min-w-[170px] px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Voltar para Conferência
                  </button>

                  {!isExceptionalCloseMode ? (
                    <button
                      type="button"
                      disabled={isSubmittingShiftOp}
                      onClick={() => {
                        setShiftActionError(null);
                        setIsExceptionalCloseMode(true);
                      }}
                      className="flex-1 min-w-[180px] px-3.5 py-2 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-bold rounded-xl text-xs transition cursor-pointer"
                    >
                      Fechamento Excepcional com Justificativa
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isSubmittingShiftOp}
                      onClick={() => {
                        setShiftActionError(null);
                        setIsExceptionalCloseMode(false);
                      }}
                      className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold rounded-xl text-xs transition cursor-pointer"
                    >
                      Cancelar Exceção
                    </button>
                  )}
                </div>

                {isExceptionalCloseMode && (
                  <div className="pt-2 border-t border-amber-200 space-y-3">
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-900">
                      <strong>Importante:</strong> A justificativa de fechamento excepcional{' '}
                      <strong>NÃO confirma recebimento</strong>, <strong>NÃO marca o pedido como PAGO</strong>,{' '}
                      <strong>NÃO lança venda no caixa</strong> e <strong>NÃO altera o saldo da gaveta</strong>.
                    </div>

                    <div className="space-y-2.5">
                      {currentShiftPending.map((item) => {
                        const currentEntry = exceptionalReasonsByOrderId[item.orderId] || {
                          reasonCode: '' as const,
                          reasonDetail: '',
                        };
                        const requiresDetail = currentEntry.reasonCode === 'OUTRA_SITUACAO';

                        return (
                          <div
                            key={item.orderId}
                            className="p-3 bg-white rounded-xl border border-amber-200 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="font-bold text-slate-900">
                                {item.orderNumber} · {item.customerName} ({getPaymentMethodLabel(item.paymentMethod as PaymentMethod)})
                              </span>
                              <span className="font-mono font-bold text-amber-900">
                                {formatCurrency(item.totalAmount)}
                              </span>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                Motivo da pendência *
                              </label>
                              <select
                                value={currentEntry.reasonCode}
                                onChange={(e) => {
                                  const nextCode = e.target.value as ExceptionalClosingReasonCode | '';
                                  setExceptionalReasonsByOrderId((prev) => ({
                                    ...prev,
                                    [item.orderId]: {
                                      reasonCode: nextCode,
                                      reasonDetail: prev[item.orderId]?.reasonDetail || '',
                                    },
                                  }));
                                }}
                                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                              >
                                <option value="">Selecione um motivo...</option>
                                {EXCEPTIONAL_CLOSING_REASON_OPTIONS.map((opt) => (
                                  <option key={opt.code} value={opt.code}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                                {requiresDetail
                                  ? 'Descrição obrigatória da situação (mín. 5 caracteres) *'
                                  : 'Observação complementar (opcional)'}
                              </label>
                              <input
                                type="text"
                                maxLength={400}
                                required={requiresDetail}
                                value={currentEntry.reasonDetail}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setExceptionalReasonsByOrderId((prev) => ({
                                    ...prev,
                                    [item.orderId]: {
                                      reasonCode: prev[item.orderId]?.reasonCode || '',
                                      reasonDetail: val,
                                    },
                                  }));
                                }}
                                placeholder={
                                  requiresDetail
                                    ? 'Descreva claramente o motivo desta pendência...'
                                    : 'Detalhes adicionais para auditoria...'
                                }
                                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

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

              {shiftActionError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{shiftActionError}</span>
                </div>
              )}

              {closeModalOutputFeedback && (
                <div
                  className={`p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border ${
                    closeModalOutputFeedback.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {closeModalOutputFeedback.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    )}
                    <span>{closeModalOutputFeedback.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCloseModalOutputFeedback(null)}
                    className="text-slate-400 hover:text-slate-700 px-1 font-bold"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isSubmittingShiftOp || isPrintingClosing}
                  onClick={handlePrintOpenClosing}
                  className="flex-1 min-w-[130px] px-3 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-700" />
                  <span>{isPrintingClosing ? 'Imprimindo...' : 'Imprimir'}</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmittingShiftOp || isSharingPdf}
                  onClick={handleShareOpenClosingPdf}
                  className="flex-1 min-w-[140px] px-3 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-slate-700" />
                  <span>{isSharingPdf ? 'Gerando PDF...' : 'Compartilhar PDF'}</span>
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isSubmittingShiftOp}
                  onClick={() => {
                    setShiftActionError(null);
                    setCloseModalOutputFeedback(null);
                    setIsExceptionalCloseMode(false);
                    setIsCloseModalActive(false);
                  }}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-semibold disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    isSubmittingShiftOp ||
                    (isLoadingPendingOrders && !pendingSummary) ||
                    (currentShiftPending.length > 0 && (!isExceptionalCloseMode || !exceptionalValidationStatus.valid))
                  }
                  className={`px-5 py-2 font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                    currentShiftPending.length > 0 && isExceptionalCloseMode
                      ? 'bg-rose-700 hover:bg-rose-800 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 text-white'
                  }`}
                >
                  {isSubmittingShiftOp
                    ? 'Processando...'
                    : currentShiftPending.length > 0
                    ? isExceptionalCloseMode
                      ? 'Fechar Caixa Excepcionalmente'
                      : 'Resolva ou Justifique as Pendências'
                    : 'Fechar Caixa Definitivamente'}
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
              <button
                disabled={isSubmittingShiftOp}
                onClick={() => { pendingMovementIdRef.current = null; setShiftActionError(null); setIsMovementModalActive(false); }}
                className="text-slate-400 hover:text-slate-800 p-1 disabled:opacity-50"
              >
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

              {shiftActionError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{shiftActionError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isSubmittingShiftOp}
                  onClick={() => { pendingMovementIdRef.current = null; setShiftActionError(null); setIsMovementModalActive(false); }}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-semibold disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingShiftOp}
                  className={`px-5 py-2 font-bold rounded-xl text-white disabled:opacity-60 cursor-pointer ${
                    movementType === 'SANGRIA' 
                      ? 'bg-rose-600 hover:bg-rose-700' 
                      : movementType === 'VALE'
                      ? 'bg-purple-600 hover:bg-purple-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isSubmittingShiftOp ? 'Processando...' : 'Salvar Lançamento'}
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
              <button
                type="button"
                onClick={() => { setHistoryModalOutputFeedback(null); setSelectedHistoryShift(null); }}
                className="text-slate-400 hover:text-slate-800 p-1"
              >
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

              {(() => {
                const histMetrics = calculateCashShiftMetrics(selectedHistoryShift);
                return (
                  <div className="p-3 bg-slate-50 rounded-xl space-y-1 border border-slate-200">
                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-700 pb-1 mb-1 border-b border-slate-200">
                      Vendas Efetivamente Confirmadas
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">Vendas Dinheiro:</span>
                      <span className="font-mono text-right">
                        Bruto: {formatCurrency(histMetrics.grossCashSales)}
                        {histMetrics.cashRefunds > 0 ? ` | Estornos: -${formatCurrency(histMetrics.cashRefunds)} | Líq: ${formatCurrency(histMetrics.netCashSales)}` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">Vendas PIX:</span>
                      <span className="font-mono text-right">
                        Bruto: {formatCurrency(histMetrics.grossPixSales)}
                        {histMetrics.pixRefunds > 0 ? ` | Estornos: -${formatCurrency(histMetrics.pixRefunds)} | Líq: ${formatCurrency(histMetrics.netPixSales)}` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">Vendas Cartão de Crédito:</span>
                      <span className="font-mono text-right text-indigo-700">
                        Bruto: {formatCurrency(histMetrics.grossCreditCardSales)}
                        {histMetrics.creditCardRefunds > 0 ? ` | Estornos: -${formatCurrency(histMetrics.creditCardRefunds)} | Líq: ${formatCurrency(histMetrics.netCreditCardSales)}` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">Vendas Cartão de Débito:</span>
                      <span className="font-mono text-right text-indigo-700">
                        Bruto: {formatCurrency(histMetrics.grossDebitCardSales)}
                        {histMetrics.debitCardRefunds > 0 ? ` | Estornos: -${formatCurrency(histMetrics.debitCardRefunds)} | Líq: ${formatCurrency(histMetrics.netDebitCardSales)}` : ''}
                      </span>
                    </div>
                    {(histMetrics.grossOtherCardOrMixedSales > 0 || histMetrics.otherCardOrMixedRefunds > 0) && (
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-600">Outros / Pagamento Misto:</span>
                        <span className="font-mono text-right">
                          Bruto: {formatCurrency(histMetrics.grossOtherCardOrMixedSales)}
                          {histMetrics.otherCardOrMixedRefunds > 0 ? ` | Estornos: -${formatCurrency(histMetrics.otherCardOrMixedRefunds)} | Líq: ${formatCurrency(histMetrics.netOtherCardOrMixedSales)}` : ''}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between gap-2 pt-1 border-t border-slate-200 font-semibold">
                      <span className="text-slate-700">Total Cartões:</span>
                      <span className="font-mono text-right text-indigo-800">
                        Bruto: {formatCurrency(histMetrics.grossCardSales)}
                        {histMetrics.cardRefunds > 0 ? ` | Estornos: -${formatCurrency(histMetrics.cardRefunds)} | Líq: ${formatCurrency(histMetrics.netCardSales)}` : ''}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* PENDÊNCIAS ENCERRADAS EXCEPCIONALMENTE COM JUSTIFICATIVA */}
              {Array.isArray(selectedHistoryShift.exceptionalPendingJustifications) &&
                selectedHistoryShift.exceptionalPendingJustifications.length > 0 && (
                  <div className="p-3.5 bg-rose-50/80 rounded-xl border border-rose-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-rose-200">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
                        <h4 className="font-black text-rose-900 text-xs">
                          Pendências Encerradas Excepcionalmente ({selectedHistoryShift.exceptionalPendingJustifications.length})
                        </h4>
                      </div>
                      <span className="font-mono font-bold text-rose-800 text-xs">
                        {formatCurrency(
                          typeof selectedHistoryShift.pendingDeliveredAtCloseTotal === 'number'
                            ? selectedHistoryShift.pendingDeliveredAtCloseTotal
                            : selectedHistoryShift.exceptionalPendingJustifications.reduce(
                                (acc, r) => acc + (Number(r.amount) || 0),
                                0
                              )
                        )}
                      </span>
                    </div>

                    <p className="text-[11px] text-rose-800">
                      Estes pedidos permaneceram com pagamento <strong>PENDENTE</strong> no fechamento e{' '}
                      <strong>NÃO foram computados como vendas recebidas nem no saldo da gaveta</strong>.
                    </p>

                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedHistoryShift.exceptionalPendingJustifications.map((rec) => (
                        <div
                          key={`${rec.shiftId}-${rec.orderId}`}
                          className="p-2.5 bg-white rounded-lg border border-rose-200/80 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-900">
                              {rec.orderNumber}{' '}
                              <span className="font-mono text-[10px] text-slate-400">({rec.orderId})</span>
                            </span>
                            <span className="font-mono font-bold text-rose-700">
                              {formatCurrency(rec.amount)} · {getPaymentMethodLabel(rec.paymentMethod as PaymentMethod)}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-700">
                            <strong>Motivo:</strong> {rec.reasonLabel}
                            {rec.reasonDetail ? ` — ${rec.reasonDetail}` : ''}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Responsável: <strong>{rec.responsibleName}</strong> (UID: {rec.responsibleUid}) ·{' '}
                            {formatDateTime(rec.recordedAt)} · Turno: {rec.shiftId}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              <div>
                <h4 className="font-bold text-slate-800 mb-2">Movimentações deste turno ({selectedHistoryShift.movements.length})</h4>
                <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto border border-slate-200 rounded-xl">
                  {selectedHistoryShift.movements.map((m) => {
                    const isEstorno = m.type === 'ESTORNO';
                    const isAjuste = m.type === 'AJUSTE';
                    const isSangria = m.type === 'SANGRIA';
                    const isVale = m.type === 'VALE';
                    return (
                      <div key={m.id} className="p-2.5 flex justify-between items-center">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900">{m.description}</span>
                            {m.orderNumber && (
                              <span className="font-mono text-[10px] text-amber-800 font-bold">({m.orderNumber})</span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 block">
                            {formatTime(m.timestamp)} · {isAjuste ? 'Ajuste de Gaveta' : isEstorno ? 'Estorno / Devolução' : m.type}
                            {m.paymentMethod ? ` (${getPaymentMethodLabel(m.paymentMethod)})` : ''}
                          </span>
                          {m.refundReason && (
                            <span className="text-[10px] text-rose-600 italic block">Motivo: {m.refundReason}</span>
                          )}
                        </div>
                        <span className={`font-mono font-bold ${
                          isAjuste 
                            ? (m.amount >= 0 ? 'text-emerald-700' : 'text-rose-600')
                            : (isEstorno || isSangria ? 'text-rose-600' : isVale ? 'text-purple-700' : 'text-emerald-700')
                        }`}>
                          {isAjuste 
                            ? (m.amount >= 0 ? `+${formatCurrency(m.amount)}` : `-${formatCurrency(Math.abs(m.amount))}`)
                            : isEstorno
                            ? `-${formatCurrency(m.amount)}`
                            : `${m.type === 'SANGRIA' || m.type === 'VALE' ? '-' : '+'}${formatCurrency(m.amount)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {historyModalOutputFeedback && (
              <div
                className={`p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border ${
                  historyModalOutputFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  {historyModalOutputFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span>{historyModalOutputFeedback.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryModalOutputFeedback(null)}
                  className="text-slate-400 hover:text-slate-700 px-1 font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isPrintingClosing}
                  onClick={handlePrintHistoryClosing}
                  className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl font-semibold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-700" />
                  <span>{isPrintingClosing ? 'Imprimindo...' : 'Imprimir'}</span>
                </button>
                <button
                  type="button"
                  disabled={isSharingPdf}
                  onClick={handleShareHistoryClosingPdf}
                  className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl font-semibold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-slate-700" />
                  <span>{isSharingPdf ? 'Gerando PDF...' : 'Compartilhar PDF'}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setHistoryModalOutputFeedback(null); setSelectedHistoryShift(null); }}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl font-semibold text-xs cursor-pointer"
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
                disabled={isSubmittingShiftOp}
                onClick={() => { pendingMovementIdRef.current = null; setShiftActionError(null); setIsAdjustModalOpen(false); }}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg disabled:opacity-50"
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

              {shiftActionError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{shiftActionError}</span>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSubmittingShiftOp}
                  onClick={() => { pendingMovementIdRef.current = null; setShiftActionError(null); setIsAdjustModalOpen(false); }}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingShiftOp}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-bold transition shadow-xs cursor-pointer disabled:opacity-60"
                >
                  {isSubmittingShiftOp ? 'Processando...' : 'Salvar Novo Saldo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAÇÃO FINANCEIRA DE PEDIDO ENTREGUE PENDENTE */}
      {confirmingPendingOrder && currentShift && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Confirmar Pagamento no Caixa</h3>
              </div>
              <button
                type="button"
                disabled={isConfirmingPendingPayment}
                onClick={() => {
                  setPendingConfirmError(null);
                  setConfirmingPendingOrder(null);
                }}
                className="text-slate-400 hover:text-slate-800 p-1 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Pedido:</span>
                <span className="font-mono font-bold text-slate-900">
                  {confirmingPendingOrder.orderNumber} ({confirmingPendingOrder.orderId})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cliente:</span>
                <span className="font-semibold text-slate-800">{confirmingPendingOrder.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Forma de Pagamento:</span>
                <span className="font-black text-slate-900">
                  {getPaymentMethodLabel(confirmingPendingOrder.paymentMethod as PaymentMethod)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <span className="font-bold text-slate-700">Valor Confirmado:</span>
                <span className="text-lg font-black text-emerald-700 font-mono">
                  {formatCurrency(confirmingPendingOrder.totalAmount)}
                </span>
              </div>
              <div className="flex justify-between pt-1 text-[11px] text-slate-500">
                <span>Responsável pela conferência:</span>
                <span className="font-semibold text-slate-700">{defaultOperatorName}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Turno aberto:</span>
                <span className="font-mono text-slate-700">{currentShift.id}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-600 leading-relaxed">
              Ao confirmar, o servidor executará a transação atômica oficial: marcará o pedido como{' '}
              <strong>PAGO</strong> e registrará exatamente <strong>1 movimentação de VENDA</strong> neste turno aberto,
              com proteção contra duplicidade.
            </p>

            {pendingConfirmError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{pendingConfirmError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={isConfirmingPendingPayment}
                onClick={() => {
                  setPendingConfirmError(null);
                  setConfirmingPendingOrder(null);
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isConfirmingPendingPayment}
                onClick={handleConfirmPendingOrderPayment}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-60 cursor-pointer"
              >
                {isConfirmingPendingPayment ? 'Confirmando...' : 'Confirmar Pagamento'}
              </button>
            </div>
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
          isLoading={isSubmittingShiftOp}
          errorMessage={shiftActionError}
          onConfirm={() => executeDeleteMovement(confirmDeleteMov.id)}
          onCancel={() => { setShiftActionError(null); setConfirmDeleteMov(null); }}
        />
      )}
    </div>
  );
};
