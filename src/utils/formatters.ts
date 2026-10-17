import { OrderStatus, PaymentMethod } from '../types';

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
}

export function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
}

export function getStatusDetails(status: OrderStatus): {
  label: string;
  colorClass: string;
  bgLightClass: string;
  borderClass: string;
  dotColorClass: string;
  step: number;
} {
  switch (status) {
    case 'NOVO':
      return {
        label: 'Novo Pedido',
        colorClass: 'text-amber-700',
        bgLightClass: 'bg-amber-50',
        borderClass: 'border-amber-200',
        dotColorClass: 'bg-amber-500 animate-pulse',
        step: 1,
      };
    case 'EM_PREPARO':
      return {
        label: 'Em Preparo (Cozinha)',
        colorClass: 'text-blue-700',
        bgLightClass: 'bg-blue-50',
        borderClass: 'border-blue-200',
        dotColorClass: 'bg-blue-500 animate-spin',
        step: 2,
      };
    case 'PRONTO':
      return {
        label: 'Pronto / Aguardando Motoboy',
        colorClass: 'text-purple-700',
        bgLightClass: 'bg-purple-50',
        borderClass: 'border-purple-200',
        dotColorClass: 'bg-purple-500',
        step: 3,
      };
    case 'EM_ROTA':
      return {
        label: 'Em Rota de Entrega',
        colorClass: 'text-indigo-700',
        bgLightClass: 'bg-indigo-50',
        borderClass: 'border-indigo-200',
        dotColorClass: 'bg-indigo-500 animate-bounce',
        step: 4,
      };
    case 'ENTREGUE':
      return {
        label: 'Entregue Concluído',
        colorClass: 'text-emerald-700',
        bgLightClass: 'bg-emerald-50',
        borderClass: 'border-emerald-200',
        dotColorClass: 'bg-emerald-500',
        step: 5,
      };
    case 'CANCELADO':
      return {
        label: 'Cancelado',
        colorClass: 'text-rose-700',
        bgLightClass: 'bg-rose-50',
        borderClass: 'border-rose-200',
        dotColorClass: 'bg-rose-500',
        step: 0,
      };
    default:
      return {
        label: status,
        colorClass: 'text-slate-700',
        bgLightClass: 'bg-slate-50',
        borderClass: 'border-slate-200',
        dotColorClass: 'bg-slate-400',
        step: 0,
      };
  }
}

export function getPaymentMethodLabel(method: PaymentMethod): string {
  switch (method) {
    case 'PIX':
      return 'PIX Instantâneo';
    case 'CARTAO_CREDITO':
      return 'Cartão de Crédito';
    case 'CARTAO_DEBITO':
      return 'Cartão de Débito';
    case 'DINHEIRO':
      return 'Dinheiro';
    default:
      return method;
  }
}

export function formatCustomerAddress(customer?: { name?: string; address?: { condominium?: string; block?: string; apartment?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; reference?: string; } }, isRetirada?: boolean, pickupAddress = 'Balcão'): string {
  if (isRetirada || !customer?.address) {
    return `Retirada no Balcão (${pickupAddress})`;
  }
  const addr = customer.address;
  const parts: string[] = [];

  if (addr.condominium) {
    let condoText = `Condomínio ${addr.condominium}`;
    if (addr.block) condoText += ` · Bloco ${addr.block}`;
    if (addr.apartment) condoText += ` · Ap ${addr.apartment}`;
    parts.push(condoText);
  }

  if (addr.street) {
    let streetText = addr.street;
    if (addr.number) streetText += `, ${addr.number}`;
    if (addr.neighborhood) streetText += ` - ${addr.neighborhood}`;
    if (addr.complement) streetText += ` (${addr.complement})`;
    parts.push(streetText);
  }

  if (parts.length === 0) {
    if (addr.block || addr.apartment) {
      parts.push(`Bloco ${addr.block || '-'}, Ap ${addr.apartment || '-'}`);
    } else {
      parts.push('Entrega solicitada');
    }
  }

  if (addr.reference) {
    parts.push(`Ref: ${addr.reference}`);
  }

  return parts.join(' | ');
}

export function generateWhatsAppOrderMessage(params: {
  orderNumber: string;
  customerName: string;
  itemsList: string;
  total: number;
  paymentMethod: string;
  address: string;
  trackingUrl: string;
}): string {
  return encodeURIComponent(
    `🍔 *NOVO PEDIDO - ${params.orderNumber}*\n\n` +
    `👤 *Cliente:* ${params.customerName}\n` +
    `📍 *Endereço:* ${params.address}\n\n` +
    `📋 *Itens:*\n${params.itemsList}\n\n` +
    `💰 *Total:* ${formatCurrency(params.total)}\n` +
    `💳 *Forma de Pagamento:* ${params.paymentMethod}\n\n` +
    `🛵 *Acompanhe seu pedido em tempo real:*\n${params.trackingUrl}\n\n` +
    `Obrigado pela preferência!`
  );
}
