import type { DayOfWeekKey, DayOperatingHours, StoreClosedSettings } from '../types/index.js';

export const DEFAULT_CLOSED_PRIMARY_MESSAGE = 'Não estamos funcionando no momento';
export const DEFAULT_CLOSED_SECONDARY_MESSAGE =
  'Nosso atendimento está encerrado no momento. Confira abaixo nossos dias e horários de funcionamento e volte assim que estivermos abertos!';

export const CANONICAL_WEEKDAYS: Array<{
  dayKey: DayOfWeekKey;
  label: string;
  defaultOpen: boolean;
  defaultOpenTime: string;
  defaultCloseTime: string;
}> = [
  { dayKey: 'seg', label: 'Segunda-feira', defaultOpen: true, defaultOpenTime: '07:30', defaultCloseTime: '14:00' },
  { dayKey: 'ter', label: 'Terça-feira', defaultOpen: true, defaultOpenTime: '07:30', defaultCloseTime: '14:00' },
  { dayKey: 'qua', label: 'Quarta-feira', defaultOpen: true, defaultOpenTime: '07:30', defaultCloseTime: '14:00' },
  { dayKey: 'qui', label: 'Quinta-feira', defaultOpen: true, defaultOpenTime: '07:30', defaultCloseTime: '14:00' },
  { dayKey: 'sex', label: 'Sexta-feira', defaultOpen: true, defaultOpenTime: '07:30', defaultCloseTime: '14:00' },
  { dayKey: 'sab', label: 'Sábado', defaultOpen: true, defaultOpenTime: '07:30', defaultCloseTime: '14:00' },
  { dayKey: 'dom', label: 'Domingo', defaultOpen: false, defaultOpenTime: '08:00', defaultCloseTime: '13:00' },
];

export const DEFAULT_OPERATING_HOURS: DayOperatingHours[] = CANONICAL_WEEKDAYS.map((d) => ({
  dayKey: d.dayKey,
  label: d.label,
  isOpen: d.defaultOpen,
  openTime: d.defaultOpenTime,
  closeTime: d.defaultCloseTime,
}));

const TIME_24H_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeHHmm(value: unknown): value is string {
  return typeof value === 'string' && TIME_24H_REGEX.test(value.trim());
}

export function normalizeOperatingHours(input?: unknown): DayOperatingHours[] {
  const inputList = Array.isArray(input) ? input : [];
  const byKey = new Map<string, any>();
  for (const item of inputList) {
    if (item && typeof item === 'object' && typeof (item as any).dayKey === 'string') {
      byKey.set((item as any).dayKey.trim().toLowerCase(), item);
    }
  }

  return CANONICAL_WEEKDAYS.map((canon) => {
    const found = byKey.get(canon.dayKey);
    const openTime = found && isValidTimeHHmm(found.openTime) ? found.openTime.trim() : canon.defaultOpenTime;
    const closeTime = found && isValidTimeHHmm(found.closeTime) ? found.closeTime.trim() : canon.defaultCloseTime;
    const isOpen = found && typeof found.isOpen === 'boolean' ? found.isOpen : canon.defaultOpen;
    return {
      dayKey: canon.dayKey,
      label: canon.label,
      isOpen,
      openTime,
      closeTime,
    };
  });
}

export function validateOperatingHours(input: unknown): {
  valid: boolean;
  hours: DayOperatingHours[];
  error?: string;
} {
  if (!Array.isArray(input) || input.length !== 7) {
    return {
      valid: false,
      hours: normalizeOperatingHours(input),
      error: 'Informe os horários para todos os 7 dias da semana (Segunda a Domingo).',
    };
  }

  const seen = new Set<string>();
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') {
      return { valid: false, hours: normalizeOperatingHours(input), error: 'Registro de horário inválido.' };
    }
    const dayKey = String((entry as any).dayKey || '').trim().toLowerCase();
    const canon = CANONICAL_WEEKDAYS.find((c) => c.dayKey === dayKey);
    if (!canon || seen.has(dayKey)) {
      return { valid: false, hours: normalizeOperatingHours(input), error: 'Dia da semana inválido ou duplicado.' };
    }
    seen.add(dayKey);

    const isOpen = Boolean((entry as any).isOpen);
    const openTime = String((entry as any).openTime || '').trim();
    const closeTime = String((entry as any).closeTime || '').trim();
    if (!isValidTimeHHmm(openTime) || !isValidTimeHHmm(closeTime)) {
      return {
        valid: false,
        hours: normalizeOperatingHours(input),
        error: `Horário inválido para ${canon.label}. Utilize o formato HH:MM (ex: 07:30).`,
      };
    }
    if (isOpen && openTime >= closeTime) {
      return {
        valid: false,
        hours: normalizeOperatingHours(input),
        error: `Em ${canon.label}, o horário de abertura (${openTime}) deve ser anterior ao horário de fechamento (${closeTime}).`,
      };
    }
  }

  return {
    valid: true,
    hours: normalizeOperatingHours(input),
  };
}

export function validateWhatsAppNumber(raw?: string | null): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) {
    return {
      valid: false,
      normalized: '',
      error: 'Informe o número do WhatsApp do estabelecimento com DDD (ex: 5583991234567 ou 83991234567).',
    };
  }
  if (digits.length < 10 || digits.length > 15) {
    return {
      valid: false,
      normalized: digits,
      error: 'Número de WhatsApp inválido. Informe DDD + número (10 a 15 dígitos numéricos, ex: 5583991234567).',
    };
  }
  return { valid: true, normalized: digits };
}

export function formatWhatsAppDisplay(raw?: string | null): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length === 13) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.startsWith('55') && digits.length === 12) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `+${digits}`;
}

export function buildWhatsAppUrl(raw?: string | null, message?: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  const withCountry = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  const base = `https://wa.me/${withCountry}`;
  if (message && message.trim()) {
    return `${base}?text=${encodeURIComponent(message.trim())}`;
  }
  return base;
}

export function normalizeClosedSettings(raw?: Partial<StoreClosedSettings> | null): StoreClosedSettings {
  const primary =
    typeof raw?.closedPrimaryMessage === 'string' && raw.closedPrimaryMessage.trim()
      ? raw.closedPrimaryMessage.trim().slice(0, 200)
      : DEFAULT_CLOSED_PRIMARY_MESSAGE;
  const secondary =
    typeof raw?.closedSecondaryMessage === 'string'
      ? raw.closedSecondaryMessage.trim().slice(0, 500)
      : DEFAULT_CLOSED_SECONDARY_MESSAGE;
  return {
    operatingHours: normalizeOperatingHours(raw?.operatingHours),
    closedPrimaryMessage: primary,
    closedSecondaryMessage: secondary,
  };
}
