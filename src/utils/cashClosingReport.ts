import { CashRegisterShift } from '../types';
import { formatCurrency } from './formatters';

export interface CashShiftFinancialMetrics {
  initialBalance: number;
  cashSales: number;
  grossCashSales: number;
  cashRefunds: number;
  netCashSales: number;
  pixSales: number;
  grossPixSales: number;
  pixRefunds: number;
  netPixSales: number;
  cardSales: number;
  grossCardSales: number;
  cardRefunds: number;
  netCardSales: number;
  grossCreditCardSales: number;
  creditCardRefunds: number;
  netCreditCardSales: number;
  grossDebitCardSales: number;
  debitCardRefunds: number;
  netDebitCardSales: number;
  grossOtherCardOrMixedSales: number;
  otherCardOrMixedRefunds: number;
  netOtherCardOrMixedSales: number;
  totalSangrias: number;
  totalSuprimentos: number;
  totalVales: number;
  totalAjustes: number;
  totalGrossRevenue: number;
  totalRefunds: number;
  totalNetRevenue: number;
  expectedCashInDrawer: number;
  totalRevenue: number;
}

export type CashClosingReportMode = 'OPEN_PREVIEW' | 'CLOSED_OFFICIAL';
export type CashClosingDifferenceStatus = 'EXACT' | 'SURPLUS' | 'SHORTAGE';

export interface CashClosingReportData {
  mode: CashClosingReportMode;
  documentTitle: string;
  statusBanner: string;
  shiftId: string;
  openedAt: string;
  openedBy: string;
  closedAt?: string;
  closedBy?: string;
  generatedAt: string;
  initialBalance: number;
  grossCashSales: number;
  cashRefunds: number;
  netCashSales: number;
  totalSuprimentos: number;
  totalSangrias: number;
  totalVales: number;
  totalAjustes: number;
  expectedCashInDrawer: number;
  grossPixSales: number;
  pixRefunds: number;
  netPixSales: number;
  grossCardSales: number;
  cardRefunds: number;
  netCardSales: number;
  grossCreditCardSales: number;
  creditCardRefunds: number;
  netCreditCardSales: number;
  grossDebitCardSales: number;
  debitCardRefunds: number;
  netDebitCardSales: number;
  grossOtherCardOrMixedSales: number;
  otherCardOrMixedRefunds: number;
  netOtherCardOrMixedSales: number;
  totalNetRevenue: number;
  countedCash: number;
  difference: number;
  differenceStatus: CashClosingDifferenceStatus;
  differenceLabel: string;
  closingNotes: string;
  movementsCount: number;
}

export interface CountedCashValidationResult {
  valid: boolean;
  value: number;
  error?: string;
}

export const OPEN_PREVIEW_BANNER = 'CONFERÊNCIA DE FECHAMENTO — TURNO ABERTO';
export const CLOSED_OFFICIAL_BANNER = 'FECHAMENTO OFICIAL — CAIXA FECHADO';

/**
 * Calcula exatamente os mesmos indicadores financeiros exibidos na tela do caixa.
 * Função pura e somente leitura: nunca altera o objeto do turno nem realiza gravações.
 */
export function calculateCashShiftMetrics(shift: CashRegisterShift | null): CashShiftFinancialMetrics {
  if (!shift) {
    return {
      initialBalance: 0,
      cashSales: 0,
      grossCashSales: 0,
      cashRefunds: 0,
      netCashSales: 0,
      pixSales: 0,
      grossPixSales: 0,
      pixRefunds: 0,
      netPixSales: 0,
      cardSales: 0,
      grossCardSales: 0,
      cardRefunds: 0,
      netCardSales: 0,
      grossCreditCardSales: 0,
      creditCardRefunds: 0,
      netCreditCardSales: 0,
      grossDebitCardSales: 0,
      debitCardRefunds: 0,
      netDebitCardSales: 0,
      grossOtherCardOrMixedSales: 0,
      otherCardOrMixedRefunds: 0,
      netOtherCardOrMixedSales: 0,
      totalSangrias: 0,
      totalSuprimentos: 0,
      totalVales: 0,
      totalAjustes: 0,
      totalGrossRevenue: 0,
      totalRefunds: 0,
      totalNetRevenue: 0,
      expectedCashInDrawer: 0,
      totalRevenue: 0,
    };
  }

  let grossCashSales = 0;
  let cashRefunds = 0;
  let grossPixSales = 0;
  let pixRefunds = 0;
  let grossCreditCardSales = 0;
  let creditCardRefunds = 0;
  let grossDebitCardSales = 0;
  let debitCardRefunds = 0;
  let grossOtherCardOrMixedSales = 0;
  let otherCardOrMixedRefunds = 0;
  let totalSangrias = 0;
  let totalSuprimentos = 0;
  let totalVales = 0;
  let totalAjustes = 0;

  const movements = Array.isArray(shift.movements) ? shift.movements : [];
  movements.forEach((m) => {
    if (m.type === 'VENDA') {
      if (m.paymentMethod === 'DINHEIRO') grossCashSales += m.amount;
      else if (m.paymentMethod === 'PIX') grossPixSales += m.amount;
      else if (m.paymentMethod === 'CARTAO_CREDITO') grossCreditCardSales += m.amount;
      else if (m.paymentMethod === 'CARTAO_DEBITO') grossDebitCardSales += m.amount;
      else grossOtherCardOrMixedSales += m.amount;
    } else if (m.type === 'ESTORNO') {
      if (m.paymentMethod === 'DINHEIRO') cashRefunds += m.amount;
      else if (m.paymentMethod === 'PIX') pixRefunds += m.amount;
      else if (m.paymentMethod === 'CARTAO_CREDITO') creditCardRefunds += m.amount;
      else if (m.paymentMethod === 'CARTAO_DEBITO') debitCardRefunds += m.amount;
      else otherCardOrMixedRefunds += m.amount;
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

  const grossCardSales = grossCreditCardSales + grossDebitCardSales + grossOtherCardOrMixedSales;
  const cardRefunds = creditCardRefunds + debitCardRefunds + otherCardOrMixedRefunds;
  const netCashSales = grossCashSales - cashRefunds;
  const netPixSales = grossPixSales - pixRefunds;
  const netCreditCardSales = grossCreditCardSales - creditCardRefunds;
  const netDebitCardSales = grossDebitCardSales - debitCardRefunds;
  const netOtherCardOrMixedSales = grossOtherCardOrMixedSales - otherCardOrMixedRefunds;
  const netCardSales = grossCardSales - cardRefunds;
  const totalGrossRevenue = grossCashSales + grossPixSales + grossCardSales;
  const totalRefunds = cashRefunds + pixRefunds + cardRefunds;
  const totalNetRevenue = totalGrossRevenue - totalRefunds;

  const expectedCashInDrawer =
    shift.initialBalance +
    grossCashSales -
    cashRefunds +
    totalSuprimentos -
    totalSangrias -
    totalVales +
    totalAjustes;

  return {
    initialBalance: shift.initialBalance,
    cashSales: grossCashSales,
    grossCashSales,
    cashRefunds,
    netCashSales,
    pixSales: grossPixSales,
    grossPixSales,
    pixRefunds,
    netPixSales,
    cardSales: grossCardSales,
    grossCardSales,
    cardRefunds,
    netCardSales,
    grossCreditCardSales,
    creditCardRefunds,
    netCreditCardSales,
    grossDebitCardSales,
    debitCardRefunds,
    netDebitCardSales,
    grossOtherCardOrMixedSales,
    otherCardOrMixedRefunds,
    netOtherCardOrMixedSales,
    totalSangrias,
    totalSuprimentos,
    totalVales,
    totalAjustes,
    totalGrossRevenue,
    totalRefunds,
    totalNetRevenue,
    expectedCashInDrawer,
    totalRevenue: totalNetRevenue,
  };
}

/**
 * Normaliza espaço não-quebrável (\u00A0) retornado por Intl.NumberFormat('pt-BR')
 * para espaço comum, garantindo consistência visual na impressão térmica e no PDF.
 */
export function formatReportCurrency(value: number): string {
  return formatCurrency(value).replace(/\u00A0/g, ' ');
}

/**
 * Classifica e formata a diferença apurada exatamente com a mesma regra exibida na tela.
 */
export function classifyCashDifference(diff: number): {
  status: CashClosingDifferenceStatus;
  label: string;
} {
  if (Math.abs(diff) < 0.01) {
    return {
      status: 'EXACT',
      label: 'Caixa Bateu Exatamente!',
    };
  }
  if (diff > 0) {
    return {
      status: 'SURPLUS',
      label: `+ ${formatReportCurrency(diff)} (Sobra de Caixa)`,
    };
  }
  return {
    status: 'SHORTAGE',
    label: `${formatReportCurrency(diff)} (Falta / Quebra de Caixa)`,
  };
}

/**
 * Valida o campo "Valor em Dinheiro Contado na Gaveta" sem inventar valores.
 */
export function parseCountedCashInput(rawValue: string): CountedCashValidationResult {
  const trimmed = (rawValue ?? '').trim();
  if (!trimmed) {
    return {
      valid: false,
      value: 0,
      error: 'Informe o valor em dinheiro contado na gaveta antes de imprimir ou compartilhar o PDF.',
    };
  }

  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      valid: false,
      value: 0,
      error: 'Informe um valor numérico válido (maior ou igual a zero) em "Valor em Dinheiro Contado na Gaveta".',
    };
  }

  return {
    valid: true,
    value: parsed,
  };
}

/**
 * Monta o relatório de conferência pré-fechamento (Modal "Fechamento e Apuração de Caixa").
 * Utiliza os dados atuais do turno aberto somados ao valor contado e observações digitados na tela.
 */
export function buildOpenShiftClosingReport(
  shift: CashRegisterShift,
  options: {
    countedCash: number;
    closingNotes: string;
    operatorName?: string;
    generatedAt?: string;
  }
): CashClosingReportData {
  const m = calculateCashShiftMetrics(shift);
  const difference = options.countedCash - m.expectedCashInDrawer;
  const diffInfo = classifyCashDifference(difference);

  return {
    mode: 'OPEN_PREVIEW',
    documentTitle: 'Fechamento e Apuração de Caixa',
    statusBanner: OPEN_PREVIEW_BANNER,
    shiftId: shift.id,
    openedAt: shift.openedAt,
    openedBy: shift.openedBy,
    closedBy: options.operatorName || undefined,
    generatedAt: options.generatedAt || new Date().toISOString(),
    initialBalance: m.initialBalance,
    grossCashSales: m.grossCashSales,
    cashRefunds: m.cashRefunds,
    netCashSales: m.netCashSales,
    totalSuprimentos: m.totalSuprimentos,
    totalSangrias: m.totalSangrias,
    totalVales: m.totalVales,
    totalAjustes: m.totalAjustes,
    expectedCashInDrawer: m.expectedCashInDrawer,
    grossPixSales: m.grossPixSales,
    pixRefunds: m.pixRefunds,
    netPixSales: m.netPixSales,
    grossCardSales: m.grossCardSales,
    cardRefunds: m.cardRefunds,
    netCardSales: m.netCardSales,
    grossCreditCardSales: m.grossCreditCardSales,
    creditCardRefunds: m.creditCardRefunds,
    netCreditCardSales: m.netCreditCardSales,
    grossDebitCardSales: m.grossDebitCardSales,
    debitCardRefunds: m.debitCardRefunds,
    netDebitCardSales: m.netDebitCardSales,
    grossOtherCardOrMixedSales: m.grossOtherCardOrMixedSales,
    otherCardOrMixedRefunds: m.otherCardOrMixedRefunds,
    netOtherCardOrMixedSales: m.netOtherCardOrMixedSales,
    totalNetRevenue: m.totalNetRevenue,
    countedCash: options.countedCash,
    difference,
    differenceStatus: diffInfo.status,
    differenceLabel: diffInfo.label,
    closingNotes: (options.closingNotes || '').trim(),
    movementsCount: Array.isArray(shift.movements) ? shift.movements.length : 0,
  };
}

/**
 * Monta o relatório oficial de um turno já fechado (Modal "Espelho de Caixa Fechado" e histórico).
 * Preserva rigorosamente os valores finais gravados no registro histórico
 * (`finalCalculatedBalance`, `finalCountedCash`, `difference`, `notes`, `closedAt`, `closedBy`),
 * sem recalcular nem modificar o histórico.
 */
export function buildClosedShiftClosingReport(
  shift: CashRegisterShift,
  options?: { generatedAt?: string }
): CashClosingReportData {
  const m = calculateCashShiftMetrics(shift);

  const expectedCashInDrawer =
    typeof shift.finalCalculatedBalance === 'number' && Number.isFinite(shift.finalCalculatedBalance)
      ? shift.finalCalculatedBalance
      : m.expectedCashInDrawer;

  const countedCash =
    typeof shift.finalCountedCash === 'number' && Number.isFinite(shift.finalCountedCash)
      ? shift.finalCountedCash
      : 0;

  const difference =
    typeof shift.difference === 'number' && Number.isFinite(shift.difference)
      ? shift.difference
      : countedCash - expectedCashInDrawer;

  const diffInfo = classifyCashDifference(difference);

  return {
    mode: 'CLOSED_OFFICIAL',
    documentTitle: 'Espelho de Caixa Fechado',
    statusBanner: CLOSED_OFFICIAL_BANNER,
    shiftId: shift.id,
    openedAt: shift.openedAt,
    openedBy: shift.openedBy,
    closedAt: shift.closedAt,
    closedBy: shift.closedBy,
    generatedAt: options?.generatedAt || shift.closedAt || new Date().toISOString(),
    initialBalance: m.initialBalance,
    grossCashSales: m.grossCashSales,
    cashRefunds: m.cashRefunds,
    netCashSales: m.netCashSales,
    totalSuprimentos: m.totalSuprimentos,
    totalSangrias: m.totalSangrias,
    totalVales: m.totalVales,
    totalAjustes: m.totalAjustes,
    expectedCashInDrawer,
    grossPixSales: m.grossPixSales,
    pixRefunds: m.pixRefunds,
    netPixSales: m.netPixSales,
    grossCardSales: m.grossCardSales,
    cardRefunds: m.cardRefunds,
    netCardSales: m.netCardSales,
    grossCreditCardSales: m.grossCreditCardSales,
    creditCardRefunds: m.creditCardRefunds,
    netCreditCardSales: m.netCreditCardSales,
    grossDebitCardSales: m.grossDebitCardSales,
    debitCardRefunds: m.debitCardRefunds,
    netDebitCardSales: m.netDebitCardSales,
    grossOtherCardOrMixedSales: m.grossOtherCardOrMixedSales,
    otherCardOrMixedRefunds: m.otherCardOrMixedRefunds,
    netOtherCardOrMixedSales: m.netOtherCardOrMixedSales,
    totalNetRevenue: m.totalNetRevenue,
    countedCash,
    difference,
    differenceStatus: diffInfo.status,
    differenceLabel: diffInfo.label,
    closingNotes: (shift.notes || '').trim(),
    movementsCount: Array.isArray(shift.movements) ? shift.movements.length : 0,
  };
}
