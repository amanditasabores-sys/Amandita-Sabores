import { CustomerAddress, OrderStatus, PaymentMethod } from '../types';

export const APP_TIMEZONE = 'America/Fortaleza';

export function getFortalezaDateKey(dateInput?: string | Date | number): string {
  try {
    const date = dateInput === undefined ? new Date() : new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
        return dateInput.slice(0, 10);
      }
      return '';
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
    return date.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

export function formatFortalezaDateLabel(dateKeyOrIso: string): string {
  if (!dateKeyOrIso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKeyOrIso)) {
    const [y, m, d] = dateKeyOrIso.split('-');
    return `${d}/${m}/${y}`;
  }
  try {
    const date = new Date(dateKeyOrIso);
    if (Number.isNaN(date.getTime())) return dateKeyOrIso;
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: APP_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateKeyOrIso;
  }
}

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
      timeZone: APP_TIMEZONE,
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
      timeZone: APP_TIMEZONE,
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
    case 'MISTO':
      return 'Pagamento Misto';
    default:
      return method;
  }
}

function cleanAddressToken(value?: string): string {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') {
    return '';
  }
  return trimmed;
}

function isPlaceholderNeighborhoodOrStreet(value: string): boolean {
  const norm = value.toLowerCase();
  return (
    norm === 'condomínio outros' ||
    norm === 'condominio outros' ||
    norm === 'outros' ||
    norm === 'residência' ||
    norm === 'residencia' ||
    norm === 'outro condomínio / endereço' ||
    norm === 'outro condominio / endereco'
  );
}

export interface FormattedAddressDetails {
  primaryLine: string;
  secondaryLine: string;
  referenceLine?: string;
  fullSingleLine: string;
  navigationQuery: string;
  condoUnitLine?: string;
}

export function formatAddressDetails(address?: CustomerAddress): FormattedAddressDetails {
  if (!address) {
    return {
      primaryLine: 'Endereço não informado',
      secondaryLine: '',
      fullSingleLine: 'Endereço não informado',
      navigationQuery: '',
    };
  }

  const rawCondo = cleanAddressToken(address.condominium);
  const condominium = rawCondo && !isPlaceholderNeighborhoodOrStreet(rawCondo) ? rawCondo : '';
  const rawStreet = cleanAddressToken(address.street);
  const street = rawStreet && !isPlaceholderNeighborhoodOrStreet(rawStreet) ? rawStreet : '';
  const number = cleanAddressToken(address.number);
  const block = cleanAddressToken(address.block);
  const apartment = cleanAddressToken(address.apartment);
  const complement = cleanAddressToken(address.complement);
  const rawNeighborhood = cleanAddressToken(address.neighborhood);
  const neighborhood =
    rawNeighborhood && !isPlaceholderNeighborhoodOrStreet(rawNeighborhood)
      ? rawNeighborhood
      : '';
  const city = cleanAddressToken(address.city);
  const reference = cleanAddressToken(address.reference);

  const unitParts: string[] = [];
  if (block) unitParts.push(`Bloco ${block}`);
  if (apartment) unitParts.push(`Ap ${apartment}`);
  const condoUnitLine = unitParts.length > 0 ? unitParts.join(' · ') : undefined;

  const primarySegments: string[] = [];
  if (condominium) {
    const condoDisplay = /^condom[ií]nio\b/i.test(condominium)
      ? condominium
      : `Condomínio ${condominium}`;
    primarySegments.push(condoDisplay);
  }

  const streetMatchesCondo =
    street &&
    condominium &&
    street.toLowerCase().replace(/^condom[ií]nio\s+/i, '') ===
      condominium.toLowerCase().replace(/^condom[ií]nio\s+/i, '');

  if (street && !streetMatchesCondo) {
    primarySegments.push(number ? `${street}, ${number}` : street);
  } else if (!street && number) {
    primarySegments.push(`Nº ${number}`);
  } else if (street && streetMatchesCondo && number) {
    primarySegments.push(`Nº ${number}`);
  }

  if (condoUnitLine) {
    primarySegments.push(condoUnitLine);
  }

  const primaryLine =
    primarySegments.length > 0
      ? primarySegments.join(' · ')
      : 'Endereço de entrega informado';

  const secondarySegments: string[] = [];
  const neighborhoodMatchesCondo =
    neighborhood &&
    condominium &&
    neighborhood.toLowerCase().replace(/^condom[ií]nio\s+/i, '') ===
      condominium.toLowerCase().replace(/^condom[ií]nio\s+/i, '');

  if (neighborhood && !neighborhoodMatchesCondo) {
    secondarySegments.push(neighborhood);
  }
  if (complement) {
    secondarySegments.push(complement);
  }
  if (city) {
    secondarySegments.push(city);
  }

  const secondaryLine = secondarySegments.join(' · ');

  const singleParts: string[] = [primaryLine];
  if (secondaryLine) singleParts.push(secondaryLine);
  if (reference) singleParts.push(`Ref: ${reference}`);

  const navParts: string[] = [];
  if (condominium) {
    navParts.push(
      /^condom[ií]nio\b/i.test(condominium) ? condominium : `Condomínio ${condominium}`
    );
  }
  if (street && !streetMatchesCondo) {
    navParts.push(number ? `${street}, ${number}` : street);
  } else if (number && (!street || streetMatchesCondo)) {
    navParts.push(number);
  }
  if (neighborhood && !neighborhoodMatchesCondo) {
    navParts.push(neighborhood);
  }
  if (city) {
    navParts.push(city);
  }

  return {
    primaryLine,
    secondaryLine,
    referenceLine: reference || undefined,
    fullSingleLine: singleParts.join(' · '),
    navigationQuery: navParts.join(', '),
    condoUnitLine,
  };
}

export function formatCustomerAddress(
  customer?: { name?: string; address?: CustomerAddress },
  isRetirada?: boolean,
  pickupAddress = 'Balcão'
): string {
  if (isRetirada || !customer?.address) {
    return `Retirada no Balcão (${pickupAddress})`;
  }
  return formatAddressDetails(customer.address).fullSingleLine;
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
