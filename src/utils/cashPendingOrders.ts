import type {
  CashPendingDeliveredOrder,
  CashRegisterShift,
  CashShiftPendingSummary,
  ExceptionalClosingJustificationInput,
  ExceptionalClosingPendingRecord,
  ExceptionalClosingReasonCode,
} from '../types/index.js';

export interface ExceptionalClosingReasonOption {
  code: ExceptionalClosingReasonCode;
  label: string;
  requiresDetail: boolean;
}

export const EXCEPTIONAL_CLOSING_REASON_OPTIONS: readonly ExceptionalClosingReasonOption[] = [
  {
    code: 'CLIENTE_NAO_PAGOU',
    label: 'Cliente ainda não realizou o pagamento',
    requiresDetail: false,
  },
  {
    code: 'PIX_AGUARDANDO_EXTRATO',
    label: 'PIX aguardando conferência no extrato',
    requiresDetail: false,
  },
  {
    code: 'ENTREGADOR_SEM_PRESTACAO_CONTAS',
    label: 'Entregador ainda não prestou contas',
    requiresDetail: false,
  },
  {
    code: 'PAGO_SEM_COMPROVANTE',
    label: 'Pagamento realizado, mas sem comprovante disponível',
    requiresDetail: false,
  },
  {
    code: 'OUTRA_SITUACAO',
    label: 'Outra situação',
    requiresDetail: true,
  },
] as const;

const REASON_OPTION_MAP = new Map<ExceptionalClosingReasonCode, ExceptionalClosingReasonOption>(
  EXCEPTIONAL_CLOSING_REASON_OPTIONS.map((opt) => [opt.code, opt])
);

export function isValidExceptionalReasonCode(value: unknown): value is ExceptionalClosingReasonCode {
  return typeof value === 'string' && REASON_OPTION_MAP.has(value as ExceptionalClosingReasonCode);
}

export function getExceptionalReasonOption(code: ExceptionalClosingReasonCode): ExceptionalClosingReasonOption {
  return REASON_OPTION_MAP.get(code) || EXCEPTIONAL_CLOSING_REASON_OPTIONS[EXCEPTIONAL_CLOSING_REASON_OPTIONS.length - 1];
}

export function roundCurrencyValue(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Coleta os IDs de pedidos que já possuem movimentação efetiva do tipo VENDA
 * em qualquer turno de caixa (por orderId ou ID determinístico cash-sale-{orderId}).
 */
export function collectVendaOrderIdsFromShifts(
  shifts: Array<{ movements?: Array<{ id?: string; type?: string; orderId?: string }> }>
): Set<string> {
  const covered = new Set<string>();
  for (const shift of shifts) {
    const movs = Array.isArray(shift?.movements) ? shift.movements : [];
    for (const mov of movs) {
      if (!mov || mov.type !== 'VENDA') continue;
      if (typeof mov.orderId === 'string' && mov.orderId.trim()) {
        covered.add(mov.orderId.trim());
      }
      if (typeof mov.id === 'string' && mov.id.startsWith('cash-sale-')) {
        const extracted = mov.id.slice('cash-sale-'.length).trim();
        if (extracted) {
          covered.add(extracted);
        }
      }
    }
  }
  return covered;
}

function resolveKnownOriginLabel(order: Record<string, any>): { origin?: string; originLabel: string } {
  const rawOrigin = typeof order.origin === 'string' ? order.origin.trim() : '';
  const rawSource = typeof order.source === 'string' ? order.source.trim() : '';
  const token = (rawOrigin || rawSource).toUpperCase();

  if (!token) {
    return { originLabel: 'Não informada' };
  }
  if (token === 'PUBLIC_MENU' || token === 'CARDAPIO_PUBLICO' || token === 'ONLINE' || token === 'CUSTOMER_MENU') {
    return { origin: rawOrigin || rawSource, originLabel: 'Cardápio Público' };
  }
  if (token === 'PDV' || token === 'POS') {
    return { origin: rawOrigin || rawSource, originLabel: 'PDV' };
  }
  if (token === 'ADMIN' || token === 'BALCAO') {
    return { origin: rawOrigin || rawSource, originLabel: token === 'BALCAO' ? 'Balcão' : 'Painel Admin' };
  }
  return { origin: rawOrigin || rawSource, originLabel: rawOrigin || rawSource };
}

export type DeliveredAtSource =
  | 'DELIVERY_PERSON'
  | 'MOVEMENT_HISTORY'
  | 'ORDER_FIELD'
  | 'UPDATED_AT_FALLBACK';

export interface ResolvedDeliveredAt {
  deliveredAt?: string;
  deliveredAtSource?: DeliveredAtSource;
  isApproximateDeliveredAt: boolean;
}

export interface CashPendingDeliveredOrderWithTiming extends CashPendingDeliveredOrder {
  deliveredAtSource?: DeliveredAtSource;
  isApproximateDeliveredAt?: boolean;
  isDeliveredBeforeCreated?: boolean;
}

export interface PendingOrderTimingInfo {
  deliveredAt?: string;
  deliveredAtSource?: DeliveredAtSource;
  isApproximateDeliveredAt: boolean;
  isDeliveredBeforeCreated: boolean;
}

/**
 * Resolve o horário de entrega respeitando estritamente a prioridade:
 *  1. order.deliveryPerson?.deliveredAt
 *  2. Último movimento com toStatus === 'ENTREGUE'
 *  3. order.deliveredAt (caso exista)
 *  4. order.updatedAt (somente como último recurso, marcado como horário alternativo/aproximado)
 *
 * Não inventa horários nem altera timestamps armazenados.
 */
export function resolveDeliveredAt(order: Record<string, any>): ResolvedDeliveredAt {
  const deliveryPersonDeliveredAt =
    order?.deliveryPerson &&
    typeof order.deliveryPerson === 'object' &&
    typeof order.deliveryPerson.deliveredAt === 'string'
      ? order.deliveryPerson.deliveredAt.trim()
      : '';
  if (deliveryPersonDeliveredAt) {
    return {
      deliveredAt: deliveryPersonDeliveredAt,
      deliveredAtSource: 'DELIVERY_PERSON',
      isApproximateDeliveredAt: false,
    };
  }

  const movs = Array.isArray(order?.movements) ? order.movements : [];
  for (let i = movs.length - 1; i >= 0; i--) {
    const m = movs[i];
    if (m && m.toStatus === 'ENTREGUE' && typeof m.timestamp === 'string' && m.timestamp.trim()) {
      return {
        deliveredAt: m.timestamp.trim(),
        deliveredAtSource: 'MOVEMENT_HISTORY',
        isApproximateDeliveredAt: false,
      };
    }
  }

  if (typeof order?.deliveredAt === 'string' && order.deliveredAt.trim()) {
    return {
      deliveredAt: order.deliveredAt.trim(),
      deliveredAtSource: 'ORDER_FIELD',
      isApproximateDeliveredAt: false,
    };
  }

  if (typeof order?.updatedAt === 'string' && order.updatedAt.trim()) {
    return {
      deliveredAt: order.updatedAt.trim(),
      deliveredAtSource: 'UPDATED_AT_FALLBACK',
      isApproximateDeliveredAt: true,
    };
  }

  return {
    isApproximateDeliveredAt: false,
  };
}

/**
 * Verifica por comparação real de instante (epoch ms) se o horário de entrega
 * armazenado é anterior ao horário de criação registrado.
 */
export function isDeliveredBeforeCreated(createdAt?: string, deliveredAt?: string): boolean {
  const createdMs = Date.parse(String(createdAt || '').trim());
  const deliveredMs = Date.parse(String(deliveredAt || '').trim());
  if (!Number.isFinite(createdMs) || !Number.isFinite(deliveredMs)) {
    return false;
  }
  return deliveredMs < createdMs;
}

/**
 * Extrai metadados de exibição de horários de um item pendente no Controle de Caixa,
 * preservando compatibilidade com payloads sem os campos adicionais.
 */
export function getPendingOrderTimingInfo(order: CashPendingDeliveredOrder): PendingOrderTimingInfo {
  const ext = order as CashPendingDeliveredOrderWithTiming;
  const deliveredAt =
    typeof order.deliveredAt === 'string' && order.deliveredAt.trim()
      ? order.deliveredAt.trim()
      : undefined;
  const deliveredAtSource = ext.deliveredAtSource;
  const isApproximateDeliveredAt = Boolean(
    ext.isApproximateDeliveredAt || deliveredAtSource === 'UPDATED_AT_FALLBACK'
  );
  const deliveredBeforeCreated =
    typeof ext.isDeliveredBeforeCreated === 'boolean'
      ? ext.isDeliveredBeforeCreated
      : isDeliveredBeforeCreated(order.createdAt, deliveredAt);

  return {
    ...(deliveredAt ? { deliveredAt } : {}),
    ...(deliveredAtSource ? { deliveredAtSource } : {}),
    isApproximateDeliveredAt,
    isDeliveredBeforeCreated: deliveredBeforeCreated,
  };
}

function resolveSettlementInfo(order: Record<string, any>): { settlementStatus?: string; settlementId?: string } {
  const status = typeof order.settlementStatus === 'string' && order.settlementStatus.trim()
    ? order.settlementStatus.trim()
    : undefined;
  const id = typeof order.settlementId === 'string' && order.settlementId.trim()
    ? order.settlementId.trim()
    : undefined;
  return {
    ...(status ? { settlementStatus: status } : {}),
    ...(id ? { settlementId: id } : {}),
  };
}

export function toCashPendingDeliveredOrder(order: Record<string, any>): CashPendingDeliveredOrderWithTiming {
  const originInfo = resolveKnownOriginLabel(order);
  const settlementInfo = resolveSettlementInfo(order);
  const deliveryTiming = resolveDeliveredAt(order);
  const createdAt = String(order.createdAt || '').trim();
  const deliveredBeforeCreated = isDeliveredBeforeCreated(createdAt, deliveryTiming.deliveredAt);
  const deliveryPersonName =
    typeof order.deliveryPersonName === 'string' && order.deliveryPersonName.trim()
      ? order.deliveryPersonName.trim()
      : undefined;
  const deliveryPersonId =
    typeof order.deliveryPersonId === 'string' && order.deliveryPersonId.trim()
      ? order.deliveryPersonId.trim()
      : undefined;

  return {
    orderId: String(order.id || '').trim(),
    orderNumber: String(order.orderNumber || '#0000').trim(),
    createdAt,
    ...(deliveryTiming.deliveredAt ? { deliveredAt: deliveryTiming.deliveredAt } : {}),
    ...(deliveryTiming.deliveredAtSource ? { deliveredAtSource: deliveryTiming.deliveredAtSource } : {}),
    ...(deliveryTiming.isApproximateDeliveredAt ? { isApproximateDeliveredAt: true } : {}),
    ...(deliveredBeforeCreated ? { isDeliveredBeforeCreated: true } : {}),
    totalAmount: roundCurrencyValue(Number(order.totalAmount) || 0),
    paymentMethod: String(order.paymentMethod || 'PIX'),
    customerName: String(order.customer?.name || 'Cliente').trim(),
    ...(originInfo.origin ? { origin: originInfo.origin } : {}),
    originLabel: originInfo.originLabel,
    ...(deliveryPersonId ? { deliveryPersonId } : {}),
    ...(deliveryPersonName ? { deliveryPersonName } : {}),
    ...(typeof order.fulfillmentType === 'string' && order.fulfillmentType.trim()
      ? { fulfillmentType: order.fulfillmentType.trim() }
      : {}),
    ...settlementInfo,
  };
}

/**
 * Verifica se o pedido foi criado dentro do período do turno analisado (>= shiftOpenedAt
 * e, se fechado, <= shiftClosedAt).
 */
export function isOrderWithinShiftPeriod(
  orderCreatedAt: string | undefined,
  shiftOpenedAt: string | undefined,
  shiftClosedAt?: string
): boolean {
  const orderMs = Date.parse(String(orderCreatedAt || ''));
  const openedMs = Date.parse(String(shiftOpenedAt || ''));
  if (!Number.isFinite(orderMs) || !Number.isFinite(openedMs)) {
    return false;
  }
  if (orderMs < openedMs) {
    return false;
  }
  if (shiftClosedAt) {
    const closedMs = Date.parse(String(shiftClosedAt));
    if (Number.isFinite(closedMs) && orderMs > closedMs) {
      return false;
    }
  }
  return true;
}

/**
 * Classifica pedidos entregues com pagamento PENDENTE e sem movimentação de VENDA
 * separando rigorosamente:
 *  - currentShiftPending: criados no período do turno em análise
 *  - previousShiftsPending: criados antes da abertura do turno em análise (somente consulta, nunca misturados)
 */
export function classifyShiftPendingDeliveredOrders(params: {
  orders: Array<Record<string, any>>;
  shift: Pick<CashRegisterShift, 'id' | 'status' | 'openedAt' | 'closedAt' | 'movements'>;
  allShifts?: Array<{ id?: string; movements?: Array<{ id?: string; type?: string; orderId?: string }> }>;
  checkedAt?: string;
}): CashShiftPendingSummary {
  const { orders, shift, allShifts = [], checkedAt = new Date().toISOString() } = params;

  const shiftsForVendaScan = [shift, ...allShifts];
  const vendaOrderIds = collectVendaOrderIdsFromShifts(shiftsForVendaScan);

  const shiftOpenedMs = Date.parse(String(shift.openedAt || ''));
  const shiftClosedMs =
    shift.status === 'FECHADO' && shift.closedAt ? Date.parse(String(shift.closedAt)) : NaN;

  const currentShiftPending: CashPendingDeliveredOrder[] = [];
  const previousShiftsPending: CashPendingDeliveredOrder[] = [];

  for (const order of orders) {
    if (!order || typeof order !== 'object') continue;
    const orderId = String(order.id || '').trim();
    if (!orderId) continue;

    // Critérios obrigatórios simultâneos:
    // 1. Status do pedido: ENTREGUE
    // 2. Status do pagamento: PENDENTE
    // 3. Sem movimentação de VENDA correspondente no caixa
    if (order.status !== 'ENTREGUE') continue;
    if (order.paymentStatus !== 'PENDENTE') continue;
    if (vendaOrderIds.has(orderId)) continue;

    const orderMs = Date.parse(String(order.createdAt || ''));
    const summaryItem = toCashPendingDeliveredOrder(order);

    if (Number.isFinite(orderMs) && Number.isFinite(shiftOpenedMs)) {
      if (orderMs < shiftOpenedMs) {
        previousShiftsPending.push(summaryItem);
      } else if (!Number.isFinite(shiftClosedMs) || orderMs <= shiftClosedMs) {
        currentShiftPending.push(summaryItem);
      }
      // Pedidos criados após o fechamento de um turno já fechado não pertencem àquele turno.
    } else {
      // Sem timestamp válido: não misturar no turno atual
      previousShiftsPending.push(summaryItem);
    }
  }

  const sortDesc = (a: CashPendingDeliveredOrder, b: CashPendingDeliveredOrder) => {
    const aMs = Date.parse(a.createdAt) || 0;
    const bMs = Date.parse(b.createdAt) || 0;
    return bMs - aMs;
  };
  currentShiftPending.sort(sortDesc);
  previousShiftsPending.sort(sortDesc);

  const currentShiftPendingTotal = roundCurrencyValue(
    currentShiftPending.reduce((acc, item) => acc + item.totalAmount, 0)
  );
  const previousShiftsPendingTotal = roundCurrencyValue(
    previousShiftsPending.reduce((acc, item) => acc + item.totalAmount, 0)
  );

  return {
    shiftId: shift.id,
    shiftStatus: shift.status,
    shiftOpenedAt: shift.openedAt,
    ...(shift.closedAt ? { shiftClosedAt: shift.closedAt } : {}),
    checkedAt,
    currentShiftPending,
    currentShiftPendingCount: currentShiftPending.length,
    currentShiftPendingTotal,
    previousShiftsPending,
    previousShiftsPendingCount: previousShiftsPending.length,
    previousShiftsPendingTotal,
  };
}

export interface ValidateExceptionalJustificationsResult {
  ok: boolean;
  records: ExceptionalClosingPendingRecord[];
  error?: string;
  missingOrderIds?: string[];
}

/**
 * Valida e normaliza justificativas de fechamento excepcional no servidor.
 * Exige cobertura de 100% dos pedidos pendentes do turno e descrição obrigatória
 * quando o motivo for OUTRA_SITUACAO.
 */
export function validateExceptionalClosingJustifications(params: {
  pendingOrders: CashPendingDeliveredOrder[];
  submitted: unknown;
  shiftId: string;
  responsibleUid: string;
  responsibleName: string;
  responsibleRole?: string;
  recordedAt: string;
}): ValidateExceptionalJustificationsResult {
  const { pendingOrders, submitted, shiftId, responsibleUid, responsibleName, responsibleRole, recordedAt } = params;

  if (!Array.isArray(submitted) || submitted.length === 0) {
    return {
      ok: false,
      records: [],
      error: 'Informe uma justificativa individual válida para cada pedido entregue com pagamento pendente antes de realizar o fechamento excepcional.',
      missingOrderIds: pendingOrders.map((p) => p.orderId),
    };
  }

  const submittedMap = new Map<string, ExceptionalClosingJustificationInput>();
  for (const rawItem of submitted) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;
    const orderId = typeof item.orderId === 'string' ? item.orderId.trim() : '';
    if (!orderId) continue;
    const reasonCode = item.reasonCode;
    const reasonDetail = typeof item.reasonDetail === 'string' ? item.reasonDetail.trim() : undefined;
    if (isValidExceptionalReasonCode(reasonCode)) {
      submittedMap.set(orderId, {
        orderId,
        reasonCode,
        ...(reasonDetail ? { reasonDetail: reasonDetail.slice(0, 400) } : {}),
      });
    }
  }

  const missingOrderIds: string[] = [];
  const records: ExceptionalClosingPendingRecord[] = [];

  for (const pending of pendingOrders) {
    const match = submittedMap.get(pending.orderId);
    if (!match) {
      missingOrderIds.push(pending.orderId);
      continue;
    }

    const option = getExceptionalReasonOption(match.reasonCode);
    const cleanedDetail = (match.reasonDetail || '').trim();

    if (option.requiresDetail && cleanedDetail.length < 5) {
      return {
        ok: false,
        records: [],
        error: `O pedido ${pending.orderNumber} (${pending.orderId}) selecionou "Outra situação" e exige uma descrição obrigatória com pelo menos 5 caracteres.`,
        missingOrderIds: [pending.orderId],
      };
    }

    records.push({
      orderId: pending.orderId,
      orderNumber: pending.orderNumber,
      amount: roundCurrencyValue(pending.totalAmount),
      paymentMethod: pending.paymentMethod,
      orderCreatedAt: pending.createdAt,
      customerName: pending.customerName,
      reasonCode: option.code,
      reasonLabel: option.label,
      ...(cleanedDetail ? { reasonDetail: cleanedDetail.slice(0, 400) } : {}),
      responsibleUid: String(responsibleUid || '').trim() || 'unknown',
      responsibleName: String(responsibleName || '').trim().slice(0, 128) || 'Operador',
      ...(responsibleRole ? { responsibleRole: String(responsibleRole).trim().toUpperCase() } : {}),
      recordedAt,
      shiftId,
    });
  }

  if (missingOrderIds.length > 0) {
    return {
      ok: false,
      records: [],
      error: `Faltam justificativas válidas para ${missingOrderIds.length} pedido(s) entregue(s) com pagamento pendente neste turno.`,
      missingOrderIds,
    };
  }

  return {
    ok: true,
    records,
  };
}
