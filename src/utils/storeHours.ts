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

export const DEFAULT_SECOND_OPEN_TIME = '15:30';
export const DEFAULT_SECOND_CLOSE_TIME = '17:00';

export interface OperatingShiftInterval {
  openTime: string;
  closeTime: string;
}

const TIME_24H_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeHHmm(value: unknown): value is string {
  return typeof value === 'string' && TIME_24H_REGEX.test(value.trim());
}

export function getSuggestedSecondShift(firstCloseTime?: string): OperatingShiftInterval {
  if (isValidTimeHHmm(firstCloseTime) && firstCloseTime.trim() < DEFAULT_SECOND_OPEN_TIME) {
    return { openTime: DEFAULT_SECOND_OPEN_TIME, closeTime: DEFAULT_SECOND_CLOSE_TIME };
  }
  if (isValidTimeHHmm(firstCloseTime)) {
    const [hh, mm] = firstCloseTime.trim().split(':').map(Number);
    const baseMinutes = hh * 60 + mm;
    const startMin = Math.min(baseMinutes + 60, 22 * 60);
    const endMin = Math.min(startMin + 120, 23 * 60 + 59);
    if (startMin > baseMinutes && endMin > startMin) {
      const fmt = (total: number) =>
        `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      return { openTime: fmt(startMin), closeTime: fmt(endMin) };
    }
  }
  return { openTime: DEFAULT_SECOND_OPEN_TIME, closeTime: DEFAULT_SECOND_CLOSE_TIME };
}

export function getDayOperatingShifts(day: DayOperatingHours): OperatingShiftInterval[] {
  if (!day || !day.isOpen) return [];
  const shifts: OperatingShiftInterval[] = [];
  const open1 = isValidTimeHHmm(day.openTime) ? day.openTime.trim() : '';
  const close1 = isValidTimeHHmm(day.closeTime) ? day.closeTime.trim() : '';
  if (open1 && close1 && open1 < close1) {
    shifts.push({ openTime: open1, closeTime: close1 });
  }
  if (day.hasSecondShift === true) {
    const open2 = isValidTimeHHmm(day.secondOpenTime) ? day.secondOpenTime.trim() : '';
    const close2 = isValidTimeHHmm(day.secondCloseTime) ? day.secondCloseTime.trim() : '';
    if (open2 && close2 && open2 < close2 && (!shifts.length || open2 > shifts[0].closeTime)) {
      shifts.push({ openTime: open2, closeTime: close2 });
    }
  }
  return shifts;
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

    const base: DayOperatingHours = {
      dayKey: canon.dayKey,
      label: canon.label,
      isOpen,
      openTime,
      closeTime,
    };

    if (
      found &&
      found.hasSecondShift === true &&
      isValidTimeHHmm(found.secondOpenTime) &&
      isValidTimeHHmm(found.secondCloseTime)
    ) {
      base.hasSecondShift = true;
      base.secondOpenTime = found.secondOpenTime.trim();
      base.secondCloseTime = found.secondCloseTime.trim();
    }

    return base;
  });
}

export function validateOperatingDay(entry: unknown, labelOverride?: string): string | null {
  if (!entry || typeof entry !== 'object') {
    return 'Registro de horário inválido.';
  }
  const dayKey = String((entry as any).dayKey || '').trim().toLowerCase();
  const canon = CANONICAL_WEEKDAYS.find((c) => c.dayKey === dayKey);
  const label = labelOverride || canon?.label || dayKey || 'Dia';

  const isOpen = Boolean((entry as any).isOpen);
  const openTime = String((entry as any).openTime || '').trim();
  const closeTime = String((entry as any).closeTime || '').trim();
  if (!isValidTimeHHmm(openTime) || !isValidTimeHHmm(closeTime)) {
    return `Horário inválido para ${label}. Utilize o formato HH:MM (ex: 07:30).`;
  }
  if (isOpen && openTime >= closeTime) {
    return `Em ${label} (1º turno), o horário de abertura (${openTime}) deve ser anterior ao horário de fechamento (${closeTime}).`;
  }

  const hasSecondShift = (entry as any).hasSecondShift === true;
  if (hasSecondShift) {
    const secondOpenTime = String((entry as any).secondOpenTime || '').trim();
    const secondCloseTime = String((entry as any).secondCloseTime || '').trim();
    if (!isValidTimeHHmm(secondOpenTime) || !isValidTimeHHmm(secondCloseTime)) {
      return `Horário do 2º turno inválido para ${label}. Utilize o formato HH:MM (ex: 15:30).`;
    }
    if (isOpen) {
      if (secondOpenTime >= secondCloseTime) {
        return `Em ${label} (2º turno), o horário de abertura (${secondOpenTime}) deve ser anterior ao horário de fechamento (${secondCloseTime}).`;
      }
      if (secondCloseTime <= openTime) {
        return `Em ${label}, o 2º turno (${secondOpenTime} às ${secondCloseTime}) deve ocorrer após o 1º turno (${openTime} às ${closeTime}).`;
      }
      if (secondOpenTime < closeTime) {
        return `Em ${label}, o 2º turno (${secondOpenTime} às ${secondCloseTime}) sobrepõe o 1º turno (${openTime} às ${closeTime}).`;
      }
      if (secondOpenTime === closeTime) {
        return `Em ${label}, o 2º turno (${secondOpenTime} às ${secondCloseTime}) deve iniciar após o fechamento do 1º turno (${closeTime}).`;
      }
    }
  }

  return null;
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

    const dayError = validateOperatingDay(entry, canon.label);
    if (dayError) {
      return {
        valid: false,
        hours: normalizeOperatingHours(input),
        error: dayError,
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
