import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { User } from '../../types';
import { getFirebaseIdToken } from '../../services/firebase';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  FileSearch,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Search,
  Eye,
  X,
  Info,
  HelpCircle,
} from 'lucide-react';

interface FinancialAuditPanelProps {
  currentUser: User | null;
}

type AuditOriginClassification =
  | 'CARDAPIO_PUBLICO_CONFIRMADO'
  | 'PDV_CONFIRMADO'
  | 'PROVAVEL_CARDAPIO_PUBLICO'
  | 'PROVAVEL_PDV'
  | 'ORIGEM_INDETERMINADA';

interface AuditMatchedMovement {
  shiftId: string;
  shiftStatus: string;
  shiftOpenedAt: string | null;
  shiftClosedAt: string | null;
  movementId: string | null;
  amount: number;
  paymentMethod: string | null;
  timestamp: string | null;
}

interface FinancialAuditOrderEntry {
  orderId: string;
  orderNumber: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  totalAmount: number;
  paymentMethod: string | null;
  status: string;
  paymentStatus: string;
  originClassification: AuditOriginClassification;
  originIsDefinitive: boolean;
  originNote: string;
  originEvidence: string[];
  saleCashShiftId: string | null;
  saleCashMovementId: string | null;
  relatedShiftIds: string[];
  hasFinancialMovement: boolean;
  matchedMovementCount: number;
  recordedCashAmount: number;
  matchedMovements: AuditMatchedMovement[];
  inconsistencies: string[];
}

interface AuditGroupSummary {
  count: number;
  returnedCount: number;
  truncated: boolean;
  totalOrderAmount: number;
  totalRecordedCashAmount: number;
  byOrigin: {
    counts: Record<AuditOriginClassification, number>;
    amounts: Record<AuditOriginClassification, number>;
  };
  items: FinancialAuditOrderEntry[];
}

interface GroupFSummary extends AuditGroupSummary {
  nonCancelledCount: number;
  nonCancelledTotalAmount: number;
  missingCashCount: number;
  missingCashAmount: number;
}

interface FinancialAuditResponse {
  success: boolean;
  readOnly: boolean;
  generatedAt: string;
  executedByUid: string;
  maxItemsPerGroup: number;
  overview: {
    totalOrdersScanned: number;
    nonCancelledOrdersCount: number;
    nonCancelledOrdersTotalAmount: number;
    cancelledOrdersCount: number;
    totalShiftsScanned: number;
    openShiftsCount: number;
    totalUniqueVendaMovements: number;
    totalUniqueVendaAmountAcrossShifts: number;
    potentiallyUnrecordedOrderCount: number;
    potentiallyUnrecordedRevenue: number;
    probablePublicMenuNonCancelledCount: number;
    probablePublicMenuMissingCashCount: number;
    probablePublicMenuMissingCashAmount: number;
    unmatchedCashSalesCount: number;
    unmatchedCashSalesTotal: number;
  };
  groups: {
    A_deliveredPendingWithoutMovement: AuditGroupSummary;
    B_paidWithoutMovement: AuditGroupSummary;
    C_movementInLaterShift: AuditGroupSummary;
    D_cancelledOrders: AuditGroupSummary;
    E_consistentWithMovement: AuditGroupSummary;
    F_probablePublicMenuWithoutDefinitiveOrigin: GroupFSummary;
    otherNonCancelledOrders: AuditGroupSummary;
  };
  unmatchedCashSales: {
    count: number;
    returnedCount: number;
    truncated: boolean;
    totalAmount: number;
    items: Array<{
      shiftId: string;
      shiftStatus: string;
      movementId: string | null;
      orderId: string | null;
      amount: number;
      paymentMethod: string | null;
      timestamp: string | null;
    }>;
  };
  shiftsSummary: Array<{
    id: string;
    status: string;
    openedAt: string | null;
    closedAt: string | null;
    vendaCount: number;
    vendaTotalAmount: number;
  }>;
}

type GroupKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'OTHER';

const ORIGIN_LABELS: Record<AuditOriginClassification, string> = {
  CARDAPIO_PUBLICO_CONFIRMADO: 'Cardápio Público (Confirmado)',
  PDV_CONFIRMADO: 'PDV (Confirmado)',
  PROVAVEL_CARDAPIO_PUBLICO: 'Provável Cardápio Público',
  PROVAVEL_PDV: 'Provável PDV',
  ORIGEM_INDETERMINADA: 'Origem Indeterminada',
};

const PAYMENT_LABELS: Record<string, string> = {
  PIX: 'PIX',
  DINHEIRO: 'Dinheiro',
  CARTAO_CREDITO: 'Cartão Crédito',
  CARTAO_DEBITO: 'Cartão Débito',
  MISTO: 'Pagamento Misto',
};

const INCONSISTENCY_LABELS: Record<string, string> = {
  MOVEMENT_IN_LATER_SHIFT: 'Lançado em caixa aberto após o pedido',
  ORPHAN_SALE_CASH_REFERENCE: 'Referência de caixa sem lançamento correspondente',
  PENDING_PAYMENT_WITH_CASH_MOVEMENT: 'Pagamento PENDENTE porém possui lançamento no caixa',
  CANCELLED_WITH_SALE_AND_NO_REFUND: 'Cancelado com lançamento de VENDA e sem ESTORNO',
};

function formatInconsistencyLabel(code: string): string {
  if (INCONSISTENCY_LABELS[code]) return INCONSISTENCY_LABELS[code];
  if (code.startsWith('DUPLICATE_CASH_MOVEMENTS')) {
    return `Múltiplos lançamentos de venda no caixa (${code})`;
  }
  if (code.startsWith('AMOUNT_MISMATCH')) {
    return `Divergência de valor entre pedido e caixa (${code})`;
  }
  return code;
}

function formatPaymentMethod(method: string | null): string {
  if (!method) return 'Não informado';
  return PAYMENT_LABELS[method.toUpperCase()] || method;
}

export const FinancialAuditPanel: React.FC<FinancialAuditPanelProps> = ({ currentUser }) => {
  const isAdmin = currentUser?.role === 'ADMINISTRADOR';

  const [report, setReport] = useState<FinancialAuditResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupKey>('A');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedOrder, setSelectedOrder] = useState<FinancialAuditOrderEntry | null>(null);

  const runAudit = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Obtain Firebase ID Token directly from the authenticated session; never persist, render, or log it.
      const idToken = await getFirebaseIdToken(false);
      if (!idToken) {
        setErrorMessage(
          'Sessão Firebase Auth não encontrada neste navegador. Faça login novamente com sua conta ADMINISTRADOR para executar a auditoria.'
        );
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/admin/financial-audit', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Cache-Control': 'no-cache',
        },
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload || payload.success !== true) {
        const serverMsg =
          payload && typeof payload.message === 'string' && payload.message.trim()
            ? payload.message.trim()
            : `Falha ao consultar auditoria financeira (HTTP ${response.status}).`;
        setErrorMessage(serverMsg);
        setIsLoading(false);
        return;
      }

      setReport(payload as FinancialAuditResponse);
    } catch {
      setErrorMessage('Erro de comunicação ao consultar o servidor de auditoria. Verifique sua conexão e tente novamente.');
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      void runAudit();
    }
  }, [isAdmin, runAudit]);

  const groupMetaList = useMemo(() => {
    if (!report) return [];
    const g = report.groups;
    const base: Array<{
      key: GroupKey;
      code: string;
      title: string;
      description: string;
      data: AuditGroupSummary;
      tone: 'rose' | 'amber' | 'slate' | 'emerald' | 'indigo';
    }> = [
      {
        key: 'A',
        code: 'Grupo A',
        title: 'Entregues + Pendentes sem caixa',
        description: 'Pedidos com status ENTREGUE, pagamento PENDENTE e sem nenhuma movimentação de venda no caixa.',
        data: g.A_deliveredPendingWithoutMovement,
        tone: 'rose',
      },
      {
        key: 'B',
        code: 'Grupo B',
        title: 'Pagos sem movimentação no caixa',
        description: 'Pedidos marcados como PAGO, mas sem movimentação correspondente em nenhum turno de caixa.',
        data: g.B_paidWithoutMovement,
        tone: 'rose',
      },
      {
        key: 'C',
        code: 'Grupo C',
        title: 'Lançados em caixa posterior',
        description: 'Pedidos cuja movimentação de venda foi registrada em um caixa aberto depois da criação do pedido.',
        data: g.C_movementInLaterShift,
        tone: 'amber',
      },
      {
        key: 'D',
        code: 'Grupo D',
        title: 'Pedidos cancelados',
        description: 'Pedidos cancelados que não devem ser contabilizados como vendas.',
        data: g.D_cancelledOrders,
        tone: 'slate',
      },
      {
        key: 'E',
        code: 'Grupo E',
        title: 'Consistentes com movimentação',
        description: 'Pedidos não cancelados, pagos e com movimentação financeira correspondente e consistente.',
        data: g.E_consistentWithMovement,
        tone: 'emerald',
      },
      {
        key: 'F',
        code: 'Grupo F',
        title: 'Provável Cardápio Público (sem origem definitiva)',
        description:
          'Pedidos cuja origem provável é o cardápio público por múltiplos sinais concordantes, sem campo definitivo de origem gravado no banco.',
        data: g.F_probablePublicMenuWithoutDefinitiveOrigin,
        tone: 'indigo',
      },
    ];

    if (g.otherNonCancelledOrders.count > 0) {
      base.push({
        key: 'OTHER',
        code: 'Em andamento',
        title: 'Outros não cancelados (não entregues)',
        description: 'Pedidos ainda em aberto/andamento (NOVO, EM_PREPARO, PRONTO ou EM_ROTA) aguardando conclusão/pagamento.',
        data: g.otherNonCancelledOrders,
        tone: 'slate',
      });
    }

    return base;
  }, [report]);

  const activeGroupMeta = useMemo(
    () => groupMetaList.find((m) => m.key === selectedGroup) || groupMetaList[0] || null,
    [groupMetaList, selectedGroup]
  );

  const filteredItems = useMemo(() => {
    if (!activeGroupMeta) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeGroupMeta.data.items;
    return activeGroupMeta.data.items.filter((item) => {
      const fields = [
        item.orderNumber || '',
        item.orderId,
        item.paymentMethod || '',
        item.status,
        item.paymentStatus,
        ORIGIN_LABELS[item.originClassification] || item.originClassification,
        ...item.relatedShiftIds,
      ];
      return fields.some((f) => f.toLowerCase().includes(q));
    });
  }, [activeGroupMeta, searchQuery]);

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-rose-200 p-6 shadow-xs flex items-start gap-3">
        <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-bold text-[#0F2342]">Acesso restrito ao Administrador</h2>
          <p className="text-xs text-slate-600 mt-1">
            A seção de Auditoria Financeira está disponível exclusivamente para usuários com perfil ADMINISTRADOR ativo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#0F2342] text-white flex items-center justify-center shrink-0">
              <FileSearch className="w-4 h-4 text-[#FB923C]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold text-[#0F2342] tracking-tight">
                  Auditoria Financeira
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <ShieldCheck className="w-3 h-3" />
                  Somente leitura
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Cruzamento histórico entre pedidos e movimentações de caixa via servidor. Nenhuma alteração é gravada no banco.
              </p>
            </div>
          </div>
          {report?.generatedAt && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-1">
              <Clock className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>
                Última consulta: <strong className="text-[#0F2342] tabular-nums">{formatDateTime(report.generatedAt)}</strong>
              </span>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void runAudit()}
          disabled={isLoading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0F2342] hover:bg-[#1B365D] disabled:opacity-60 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{isLoading ? 'Consultando servidor...' : report ? 'Atualizar Auditoria' : 'Executar Auditoria'}</span>
        </button>
      </section>

      {/* Error State */}
      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3 text-rose-800">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-bold">Não foi possível concluir a consulta de auditoria</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && !report && (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center space-y-3">
          <RefreshCw className="w-6 h-6 text-[#EA580C] animate-spin mx-auto" />
          <p className="text-sm font-bold text-[#0F2342]">Executando cruzamento histórico no servidor...</p>
          <p className="text-xs text-slate-500">
            Consultando exclusivamente em modo leitura as coleções de pedidos e turnos de caixa.
          </p>
        </div>
      )}

      {/* Results */}
      {report && (
        <>
          {/* Overview KPI Row */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-2xs">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Pedidos Analisados</p>
              <p className="text-2xl font-extrabold text-[#0F2342] mt-1 tabular-nums">
                {report.overview.totalOrdersScanned}
              </p>
              <p className="text-xs text-slate-500 mt-1 tabular-nums">
                {report.overview.nonCancelledOrdersCount} não cancelados ({formatCurrency(report.overview.nonCancelledOrdersTotalAmount)})
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-rose-200 p-4 shadow-2xs">
              <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wide">
                Potencialmente Fora do Caixa (A + B)
              </p>
              <p className="text-2xl font-extrabold text-rose-700 mt-1 tabular-nums">
                {formatCurrency(report.overview.potentiallyUnrecordedRevenue)}
              </p>
              <p className="text-xs text-rose-600 mt-1 tabular-nums">
                {report.overview.potentiallyUnrecordedOrderCount} pedido(s) sem lançamento de venda
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-2xs">
              <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">
                Vendas Únicas nos Caixas ({report.overview.totalShiftsScanned} turnos)
              </p>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">
                {formatCurrency(report.overview.totalUniqueVendaAmountAcrossShifts)}
              </p>
              <p className="text-xs text-slate-500 mt-1 tabular-nums">
                {report.overview.totalUniqueVendaMovements} lançamento(s) · {report.overview.openShiftsCount} turno(s) aberto(s)
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-indigo-200 p-4 shadow-2xs">
              <p className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide">
                Provável Cardápio Público s/ Caixa
              </p>
              <p className="text-2xl font-extrabold text-indigo-700 mt-1 tabular-nums">
                {formatCurrency(report.overview.probablePublicMenuMissingCashAmount)}
              </p>
              <p className="text-xs text-slate-500 mt-1 tabular-nums">
                {report.overview.probablePublicMenuMissingCashCount} de {report.overview.probablePublicMenuNonCancelledCount} não cancelado(s)
              </p>
            </div>
          </section>

          {/* Group Selector Cards (A - F + Other) */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groupMetaList.map((meta) => {
              const isSelected = activeGroupMeta?.key === meta.key;
              const badgeColor =
                meta.tone === 'rose'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : meta.tone === 'amber'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : meta.tone === 'emerald'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : meta.tone === 'indigo'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200';

              return (
                <button
                  key={meta.key}
                  type="button"
                  onClick={() => setSelectedGroup(meta.key)}
                  className={`text-left rounded-2xl border p-4 transition cursor-pointer ${
                    isSelected
                      ? 'bg-[#0F2342] text-white border-[#0F2342] shadow-sm'
                      : 'bg-white text-[#0F2342] border-[#E2E8F0] hover:border-[#EA580C]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                        isSelected ? 'bg-[#EA580C] text-white border-[#EA580C]' : badgeColor
                      }`}
                    >
                      {meta.code}
                    </span>
                    <span
                      className={`text-xs font-extrabold font-mono tabular-nums ${
                        isSelected ? 'text-[#FB923C]' : 'text-[#0F2342]'
                      }`}
                    >
                      {meta.data.count} pedido(s)
                    </span>
                  </div>
                  <p className={`text-xs font-bold mt-2 ${isSelected ? 'text-white' : 'text-[#0F2342]'}`}>
                    {meta.title}
                  </p>
                  <p
                    className={`text-lg font-extrabold font-mono tabular-nums mt-1 ${
                      isSelected ? 'text-white' : 'text-[#0F2342]'
                    }`}
                  >
                    {formatCurrency(meta.data.totalOrderAmount)}
                  </p>
                </button>
              );
            })}
          </section>

          {/* Active Group Details & Orders Table */}
          {activeGroupMeta && (
            <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xs overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-[#E2E8F0] space-y-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-[#0F2342]">
                      {activeGroupMeta.code} — {activeGroupMeta.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">{activeGroupMeta.description}</p>
                  </div>
                  <div className="relative w-full md:w-72">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filtrar por pedido, ID, pagamento ou caixa..."
                      className="w-full pl-9 pr-3 py-2 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl text-[#0F2342] placeholder:text-slate-400 focus:outline-none focus:border-[#EA580C]"
                    />
                  </div>
                </div>

                {/* Origin Breakdown Bar */}
                <div className="flex flex-wrap items-center gap-2 text-[11px] pt-1">
                  <span className="font-bold text-slate-500">Por origem:</span>
                  {(Object.keys(activeGroupMeta.data.byOrigin.counts) as AuditOriginClassification[])
                    .filter((orig) => activeGroupMeta.data.byOrigin.counts[orig] > 0)
                    .map((orig) => (
                      <span
                        key={orig}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F2342] font-semibold tabular-nums"
                      >
                        <span>{ORIGIN_LABELS[orig]}:</span>
                        <strong>{activeGroupMeta.data.byOrigin.counts[orig]}</strong>
                        <span className="text-slate-500">
                          ({formatCurrency(activeGroupMeta.data.byOrigin.amounts[orig])})
                        </span>
                      </span>
                    ))}
                  {activeGroupMeta.data.count === 0 && (
                    <span className="text-slate-500">Nenhum pedido neste grupo.</span>
                  )}
                </div>

                {activeGroupMeta.key === 'F' && (
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-900 flex items-start gap-2">
                    <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Origem apenas provável:</strong> o documento de pedido atual não persiste um campo definitivo de origem. Este grupo lista pedidos com múltiplos sinais concordantes do cardápio público (não apenas ausência de <code>processedBy</code>). Dos{' '}
                      <strong>{report.groups.F_probablePublicMenuWithoutDefinitiveOrigin.nonCancelledCount}</strong> não cancelados,{' '}
                      <strong>{report.groups.F_probablePublicMenuWithoutDefinitiveOrigin.missingCashCount}</strong> (
                      {formatCurrency(report.groups.F_probablePublicMenuWithoutDefinitiveOrigin.missingCashAmount)}) não possuem movimentação de venda no caixa.
                    </span>
                  </div>
                )}

                {activeGroupMeta.data.truncated && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    Exibindo os primeiros <strong>{activeGroupMeta.data.returnedCount}</strong> de{' '}
                    <strong>{activeGroupMeta.data.count}</strong> pedidos (limite de resposta). Os totais acima consideram 100% dos registros.
                  </div>
                )}
              </div>

              {/* Orders Table */}
              {filteredItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  {activeGroupMeta.data.count === 0
                    ? 'Nenhum pedido enquadrado neste grupo.'
                    : 'Nenhum pedido corresponde ao filtro digitado.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-bold text-slate-600 uppercase">
                        <th className="py-2.5 px-4">Pedido / ID</th>
                        <th className="py-2.5 px-3">Data e Hora</th>
                        <th className="py-2.5 px-3 text-right">Valor</th>
                        <th className="py-2.5 px-3">Pagamento</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Origem</th>
                        <th className="py-2.5 px-3">Caixa / Lançamento</th>
                        <th className="py-2.5 px-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {filteredItems.map((item) => (
                        <tr key={item.orderId} className="hover:bg-[#F8FAFC]/80 transition">
                          <td className="py-2.5 px-4">
                            <p className="font-extrabold text-[#0F2342] font-mono">
                              {item.orderNumber || 'S/N'}
                            </p>
                            <p className="text-[11px] text-slate-500 font-mono truncate max-w-[170px]" title={item.orderId}>
                              {item.orderId}
                            </p>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-700 tabular-nums">
                            {item.createdAt ? formatDateTime(item.createdAt) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-extrabold font-mono tabular-nums text-[#0F2342] whitespace-nowrap">
                            {formatCurrency(item.totalAmount)}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <p className="font-semibold text-[#0F2342]">{formatPaymentMethod(item.paymentMethod)}</p>
                            <span
                              className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                item.paymentStatus === 'PAGO'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {item.paymentStatus}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[#0F2342] font-bold text-[11px]">
                              {item.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                                item.originClassification === 'PROVAVEL_CARDAPIO_PUBLICO'
                                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                  : item.originClassification === 'PROVAVEL_PDV'
                                  ? 'bg-slate-100 text-slate-700 border-slate-200'
                                  : item.originClassification === 'ORIGEM_INDETERMINADA'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }`}
                            >
                              {!item.originIsDefinitive && <HelpCircle className="w-3 h-3 shrink-0" />}
                              <span>{ORIGIN_LABELS[item.originClassification]}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {item.hasFinancialMovement ? (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {item.matchedMovementCount} lançamento(s)
                                </span>
                                <p className="text-[11px] text-slate-500 font-mono truncate max-w-[160px]" title={item.relatedShiftIds.join(', ')}>
                                  {item.relatedShiftIds.join(', ')}
                                </p>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700">
                                <XCircle className="w-3.5 h-3.5" />
                                Sem lançamento
                              </span>
                            )}
                            {item.inconsistencies.length > 0 && (
                              <p className="text-[10px] font-bold text-amber-700 mt-0.5">
                                {item.inconsistencies.length} inconsistência(s)
                              </p>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedOrder(item)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F8FAFC] hover:bg-[#0F2342] text-[#0F2342] hover:text-white border border-[#E2E8F0] text-[11px] font-bold transition cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Detalhes</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Unmatched Cash Sales Notice (if any) */}
          {report.unmatchedCashSales.count > 0 && (
            <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <h3 className="text-xs font-extrabold">
                  Movimentações de VENDA no caixa sem pedido correspondente na coleção orders ({report.unmatchedCashSales.count} ·{' '}
                  {formatCurrency(report.unmatchedCashSales.totalAmount)})
                </h3>
              </div>
              <div className="overflow-x-auto bg-white rounded-xl border border-amber-200">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-amber-50/60 border-b border-amber-200 text-[11px] font-bold text-amber-900">
                      <th className="py-2 px-3">Turno de Caixa</th>
                      <th className="py-2 px-3">Movement ID</th>
                      <th className="py-2 px-3">Order ID Referenciado</th>
                      <th className="py-2 px-3">Pagamento</th>
                      <th className="py-2 px-3 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {report.unmatchedCashSales.items.map((u, idx) => (
                      <tr key={`${u.shiftId}-${u.movementId || idx}`}>
                        <td className="py-2 px-3 font-mono text-[11px]">{u.shiftId} ({u.shiftStatus})</td>
                        <td className="py-2 px-3 font-mono text-[11px]">{u.movementId || '—'}</td>
                        <td className="py-2 px-3 font-mono text-[11px]">{u.orderId || '—'}</td>
                        <td className="py-2 px-3">{formatPaymentMethod(u.paymentMethod)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">{formatCurrency(u.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* Read-Only Order Detail Modal */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 bg-[#09172E]/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-[#0F2342] text-white px-5 py-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-[#FB923C]">Consulta somente leitura · Detalhes do Pedido</p>
                <h3 className="text-base font-extrabold font-mono">
                  {selectedOrder.orderNumber || 'Sem número'} · {selectedOrder.orderId}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
                aria-label="Fechar detalhes"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[11px] text-slate-500 block">Valor do Pedido</span>
                  <strong className="text-sm font-mono tabular-nums text-[#0F2342]">
                    {formatCurrency(selectedOrder.totalAmount)}
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[11px] text-slate-500 block">Valor Registrado no Caixa</span>
                  <strong className="text-sm font-mono tabular-nums text-[#0F2342]">
                    {formatCurrency(selectedOrder.recordedCashAmount)}
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[11px] text-slate-500 block">Forma de Pagamento</span>
                  <strong className="text-sm text-[#0F2342]">
                    {formatPaymentMethod(selectedOrder.paymentMethod)}
                  </strong>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[11px] text-slate-500 block">Status do Pedido</span>
                  <strong className="text-sm text-[#0F2342]">{selectedOrder.status}</strong>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[11px] text-slate-500 block">Status do Pagamento</span>
                  <strong className="text-sm text-[#0F2342]">{selectedOrder.paymentStatus}</strong>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  <span className="text-[11px] text-slate-500 block">Criado em</span>
                  <strong className="text-sm tabular-nums text-[#0F2342]">
                    {selectedOrder.createdAt ? formatDateTime(selectedOrder.createdAt) : '—'}
                  </strong>
                </div>
              </div>

              {/* Origin Evidence */}
              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
                <p className="font-bold text-[#0F2342]">
                  Classificação de Origem: {ORIGIN_LABELS[selectedOrder.originClassification]}{' '}
                  <span className="text-slate-500 font-normal">
                    ({selectedOrder.originIsDefinitive ? 'definitiva' : 'provável / inferida'})
                  </span>
                </p>
                <p className="text-slate-600">{selectedOrder.originNote}</p>
                {selectedOrder.originEvidence.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedOrder.originEvidence.map((ev, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] text-[11px] text-slate-700"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Direct References on Order Document */}
              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] text-slate-500 block">saleCashShiftId (no pedido)</span>
                  <span className="font-mono text-[#0F2342]">{selectedOrder.saleCashShiftId || 'Não preenchido'}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block">saleCashMovementId (no pedido)</span>
                  <span className="font-mono text-[#0F2342]">{selectedOrder.saleCashMovementId || 'Não preenchido'}</span>
                </div>
              </div>

              {/* Inconsistencies */}
              {selectedOrder.inconsistencies.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
                  <p className="font-bold text-amber-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Inconsistências detectadas
                  </p>
                  <ul className="list-disc pl-5 text-amber-900 space-y-0.5">
                    {selectedOrder.inconsistencies.map((inc, idx) => (
                      <li key={idx}>{formatInconsistencyLabel(inc)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Matched Cash Movements */}
              <div className="space-y-2">
                <p className="font-bold text-[#0F2342]">
                  Movimentações de VENDA localizadas nos caixas ({selectedOrder.matchedMovements.length})
                </p>
                {selectedOrder.matchedMovements.length === 0 ? (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
                    Nenhuma movimentação de venda correspondente foi localizada em nenhum turno de caixa.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedOrder.matchedMovements.map((mov, idx) => (
                      <div
                        key={`${mov.shiftId}-${mov.movementId || idx}`}
                        className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-bold text-[#0F2342]">
                            Caixa: {mov.shiftId} ({mov.shiftStatus})
                          </span>
                          <span className="font-mono font-extrabold text-emerald-700 tabular-nums">
                            {formatCurrency(mov.amount)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 font-mono">
                          Movement ID: {mov.movementId || '—'} · Pagamento: {formatPaymentMethod(mov.paymentMethod)}
                        </p>
                        <p className="text-[11px] text-slate-600 tabular-nums">
                          Lançamento: {mov.timestamp ? formatDateTime(mov.timestamp) : '—'} · Abertura do caixa:{' '}
                          {mov.shiftOpenedAt ? formatDateTime(mov.shiftOpenedAt) : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-[#E2E8F0] flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="px-4 py-2 rounded-xl bg-[#0F2342] hover:bg-[#1B365D] text-white font-bold text-xs transition cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
