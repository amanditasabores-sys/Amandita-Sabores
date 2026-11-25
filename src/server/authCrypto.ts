import crypto from 'crypto';
import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Cryptographic Core (Node.js native crypto.scrypt + timingSafeEqual)
// Zero external dependencies; zero plaintext password storage.
// ---------------------------------------------------------------------------

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keyLen: number;
}

export interface StoredPasswordHash {
  passwordHash: string;
  passwordSalt: string;
  hashAlgo: 'scrypt';
  hashParams: ScryptParams;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 16384,
  r: 8,
  p: 1,
  keyLen: 64,
};

const SCRYPT_MAXMEM = 64 * 1024 * 1024; // 64 MiB safe ceiling

function deriveScryptKey(password: string, saltHex: string, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      saltHex,
      params.keyLen,
      { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      }
    );
  });
}

export async function hashPasswordScrypt(password: string): Promise<StoredPasswordHash> {
  const saltHex = crypto.randomBytes(16).toString('hex');
  const params: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS };
  const derived = await deriveScryptKey(password, saltHex, params);
  return {
    passwordHash: derived.toString('hex'),
    passwordSalt: saltHex,
    hashAlgo: 'scrypt',
    hashParams: params,
  };
}

export async function verifyPasswordScrypt(
  password: string,
  stored: Partial<StoredPasswordHash> | null | undefined
): Promise<boolean> {
  if (!password || !stored || stored.hashAlgo !== 'scrypt') {
    return false;
  }
  if (typeof stored.passwordHash !== 'string' || typeof stored.passwordSalt !== 'string') {
    return false;
  }
  if (!stored.passwordHash || !stored.passwordSalt) {
    return false;
  }

  const rawParams = stored.hashParams || DEFAULT_SCRYPT_PARAMS;
  const N = Number(rawParams.N);
  const r = Number(rawParams.r);
  const p = Number(rawParams.p);
  const keyLen = Number(rawParams.keyLen);

  // Guard against corrupted or abusive scrypt parameters
  if (
    !Number.isInteger(N) || N < 1024 || N > 65536 || (N & (N - 1)) !== 0 ||
    !Number.isInteger(r) || r < 1 || r > 32 ||
    !Number.isInteger(p) || p < 1 || p > 8 ||
    !Number.isInteger(keyLen) || keyLen < 16 || keyLen > 128
  ) {
    return false;
  }

  try {
    const expectedBuf = Buffer.from(stored.passwordHash, 'hex');
    if (expectedBuf.length !== keyLen) {
      return false;
    }
    const actualBuf = await deriveScryptKey(password, stored.passwordSalt, { N, r, p, keyLen });
    if (actualBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Constant-time string equality safe for arbitrary lengths (normalizes via SHA-256).
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    return false;
  }
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

// ---------------------------------------------------------------------------
// Roles, Modules & Delivery Permissions (Preservation of all 6 roles & 11 modules)
// ---------------------------------------------------------------------------

export const OFFICIAL_STAFF_ROLES = [
  'ADMINISTRADOR',
  'GERENTE',
  'CAIXA',
  'COZINHA',
  'ENTREGADOR',
  'ATENDENTE',
] as const;

export type OfficialStaffRole = (typeof OFFICIAL_STAFF_ROLES)[number];

export const OFFICIAL_APP_MODULES = [
  'pdv',
  'kanban',
  'kds',
  'caixa',
  'entregas',
  'relatorios',
  'menu',
  'usuarios',
  'configuracoes',
  'qrcodes',
  'auditoria',
] as const;

export type OfficialAppModule = (typeof OFFICIAL_APP_MODULES)[number];

export const OFFICIAL_DELIVERY_PERMISSION_KEYS = [
  'canViewDeliveryDashboard',
  'canManageDrivers',
  'canAssignDeliveries',
  'canOpenDailyShift',
  'canCloseDailyShift',
  'canViewShiftHistory',
  'canReopenDailyShift',
] as const;

export type DeliveryPermissionsMap = Record<(typeof OFFICIAL_DELIVERY_PERMISSION_KEYS)[number], boolean>;

export const FULL_ADMIN_DELIVERY_PERMISSIONS: DeliveryPermissionsMap = {
  canViewDeliveryDashboard: true,
  canManageDrivers: true,
  canAssignDeliveries: true,
  canOpenDailyShift: true,
  canCloseDailyShift: true,
  canViewShiftHistory: true,
  canReopenDailyShift: true,
};

export const DEFAULT_DELIVERY_PERMISSIONS_BY_ROLE: Record<OfficialStaffRole, DeliveryPermissionsMap> = {
  ADMINISTRADOR: { ...FULL_ADMIN_DELIVERY_PERMISSIONS },
  GERENTE: {
    canViewDeliveryDashboard: true,
    canManageDrivers: true,
    canAssignDeliveries: true,
    canOpenDailyShift: true,
    canCloseDailyShift: true,
    canViewShiftHistory: true,
    canReopenDailyShift: false,
  },
  CAIXA: {
    canViewDeliveryDashboard: false,
    canManageDrivers: false,
    canAssignDeliveries: false,
    canOpenDailyShift: false,
    canCloseDailyShift: false,
    canViewShiftHistory: false,
    canReopenDailyShift: false,
  },
  COZINHA: {
    canViewDeliveryDashboard: false,
    canManageDrivers: false,
    canAssignDeliveries: false,
    canOpenDailyShift: false,
    canCloseDailyShift: false,
    canViewShiftHistory: false,
    canReopenDailyShift: false,
  },
  ENTREGADOR: {
    canViewDeliveryDashboard: true,
    canManageDrivers: false,
    canAssignDeliveries: false,
    canOpenDailyShift: false,
    canCloseDailyShift: false,
    canViewShiftHistory: false,
    canReopenDailyShift: false,
  },
  ATENDENTE: {
    canViewDeliveryDashboard: false,
    canManageDrivers: false,
    canAssignDeliveries: false,
    canOpenDailyShift: false,
    canCloseDailyShift: false,
    canViewShiftHistory: false,
    canReopenDailyShift: false,
  },
};

export const DEFAULT_MODULES_BY_ROLE: Record<OfficialStaffRole, OfficialAppModule[]> = {
  ADMINISTRADOR: [...OFFICIAL_APP_MODULES],
  GERENTE: ['pdv', 'kanban', 'kds', 'caixa', 'entregas', 'relatorios', 'menu', 'qrcodes', 'auditoria'],
  CAIXA: ['pdv', 'kanban', 'caixa'],
  COZINHA: ['kds'],
  ENTREGADOR: ['entregas'],
  ATENDENTE: ['pdv', 'kanban'],
};

const ROLE_SET = new Set<string>(OFFICIAL_STAFF_ROLES);
const MODULE_SET = new Set<string>(OFFICIAL_APP_MODULES);

// ---------------------------------------------------------------------------
// Strict Input Validators (Username-only login; mandatory full name, phone, password)
// ---------------------------------------------------------------------------

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  error?: string;
}

export function validateAndNormalizeUsername(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Nome de login é obrigatório.' };
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return { valid: false, error: 'Nome de login é obrigatório.' };
  }
  if (trimmed.includes('@')) {
    return {
      valid: false,
      error: 'Informe apenas o nome de login (não utilize endereço de e-mail).',
    };
  }
  if (/\s/.test(trimmed)) {
    return {
      valid: false,
      error: 'O nome de login não pode conter espaços.',
    };
  }
  if (trimmed.length < 3 || trimmed.length > 32) {
    return {
      valid: false,
      error: 'O nome de login deve ter entre 3 e 32 caracteres.',
    };
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(trimmed)) {
    return {
      valid: false,
      error: 'O nome de login deve começar com letra ou número e conter apenas letras minúsculas, números, ponto (.), hífen (-) ou underline (_).',
    };
  }
  return { valid: true, value: trimmed };
}

export function validateFullName(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Nome completo é obrigatório.' };
  }
  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (normalized.length < 3) {
    return { valid: false, error: 'Informe o nome completo (mínimo de 3 caracteres).' };
  }
  if (normalized.length > 120) {
    return { valid: false, error: 'O nome completo excede o limite de 120 caracteres.' };
  }
  return { valid: true, value: normalized };
}

export function validateAndNormalizePhone(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Número de contato é obrigatório.' };
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) {
    return {
      valid: false,
      error: 'Informe um número de contato válido com DDD (10 a 13 dígitos).',
    };
  }
  return { valid: true, value: digits };
}

export function validatePasswordStrength(raw: unknown, fieldLabel = 'Senha'): ValidationResult<string> {
  if (typeof raw !== 'string') {
    return { valid: false, error: `${fieldLabel} é obrigatória.` };
  }
  if (!raw.trim()) {
    return { valid: false, error: `${fieldLabel} é obrigatória.` };
  }
  if (raw.length < 6) {
    return { valid: false, error: `${fieldLabel} deve ter no mínimo 6 caracteres.` };
  }
  if (raw.length > 128) {
    return { valid: false, error: `${fieldLabel} excede o limite de 128 caracteres.` };
  }
  return { valid: true, value: raw };
}

export function validateStaffRole(raw: unknown): ValidationResult<OfficialStaffRole> {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Cargo/função é obrigatório.' };
  }
  const normalized = raw.trim().toUpperCase();
  if (!ROLE_SET.has(normalized)) {
    return {
      valid: false,
      error: 'Cargo inválido. Utilize: ADMINISTRADOR, GERENTE, CAIXA, COZINHA, ENTREGADOR ou ATENDENTE.',
    };
  }
  return { valid: true, value: normalized as OfficialStaffRole };
}

export function validateAllowedModules(
  raw: unknown,
  role: OfficialStaffRole
): ValidationResult<OfficialAppModule[]> {
  if (role === 'ADMINISTRADOR') {
    return { valid: true, value: [...OFFICIAL_APP_MODULES] };
  }

  if (raw === undefined || raw === null) {
    return { valid: true, value: [...DEFAULT_MODULES_BY_ROLE[role]] };
  }

  if (!Array.isArray(raw)) {
    return { valid: false, error: 'Lista de módulos permitidos inválida.' };
  }

  const deduped: OfficialAppModule[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const mod = item.trim().toLowerCase();
    if (!MODULE_SET.has(mod)) {
      return { valid: false, error: `Módulo desconhecido: ${item}` };
    }
    if (mod === 'usuarios') {
      return {
        valid: false,
        error: 'O módulo de gestão de funcionários (usuarios) é exclusivo do cargo ADMINISTRADOR.',
      };
    }
    if (!deduped.includes(mod as OfficialAppModule)) {
      deduped.push(mod as OfficialAppModule);
    }
  }

  if (deduped.length === 0) {
    return { valid: false, error: 'Selecione ao menos um módulo autorizado para o funcionário.' };
  }

  return { valid: true, value: deduped };
}

export function normalizeDeliveryPermissions(
  raw: unknown,
  role: OfficialStaffRole
): DeliveryPermissionsMap {
  if (role === 'ADMINISTRADOR') {
    return { ...FULL_ADMIN_DELIVERY_PERMISSIONS };
  }
  const base = { ...DEFAULT_DELIVERY_PERMISSIONS_BY_ROLE[role] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base;
  }
  const obj = raw as Record<string, unknown>;
  for (const key of OFFICIAL_DELIVERY_PERMISSION_KEYS) {
    if (typeof obj[key] === 'boolean') {
      base[key] = obj[key] as boolean;
    }
  }
  return base;
}

export function validateOperationId(raw: unknown): string {
  if (typeof raw === 'string') {
    const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (cleaned.length >= 8 && cleaned.length <= 80) {
      return cleaned;
    }
  }
  return `op-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Strips any sensitive fields so hashes, salts, passwords or internal secrets
 * can NEVER leak into HTTP responses.
 */
export function sanitizeUserProfileForResponse(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: raw.id,
    firebaseUid: raw.firebaseUid || raw.id,
    name: raw.name || '',
    username: raw.username || '',
    phone: raw.phone || '',
    role: raw.role || 'ATENDENTE',
    status: raw.status || 'ATIVO',
    allowedModules: Array.isArray(raw.allowedModules) ? raw.allowedModules : [],
    deliveryPermissions: raw.deliveryPermissions && typeof raw.deliveryPermissions === 'object'
      ? raw.deliveryPermissions
      : undefined,
    provisioningState: raw.provisioningState || 'ACTIVE',
    authProvider: raw.authProvider || 'firebase_custom_token',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    lastLoginAt: raw.lastLoginAt || null,
  };
}

// ---------------------------------------------------------------------------
// Brute-Force & Rate Limiting Controls
// ---------------------------------------------------------------------------

export const MAX_ACCOUNT_LOGIN_FAILURES = 5;
export const ACCOUNT_LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const PROVISIONING_LEASE_DURATION_MS = 60 * 1000; // 60 seconds

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private lastPruneAt = 0;

  constructor(maxAttempts: number, windowMs: number) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  public checkAndConsume(key: string, nowMs = Date.now()): RateLimitCheckResult {
    this.maybePrune(nowMs);
    const cutoff = nowMs - this.windowMs;
    const existing = (this.buckets.get(key) || []).filter((ts) => ts > cutoff);

    if (existing.length >= this.maxAttempts) {
      const oldest = existing[0];
      const retryAfterMs = Math.max(1000, oldest + this.windowMs - nowMs);
      this.buckets.set(key, existing);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    existing.push(nowMs);
    this.buckets.set(key, existing);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxAttempts - existing.length),
      retryAfterSeconds: 0,
    };
  }

  public reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }

  private maybePrune(nowMs: number): void {
    if (nowMs - this.lastPruneAt < this.windowMs) return;
    this.lastPruneAt = nowMs;
    const cutoff = nowMs - this.windowMs;
    for (const [k, timestamps] of this.buckets.entries()) {
      const active = timestamps.filter((ts) => ts > cutoff);
      if (active.length === 0) {
        this.buckets.delete(k);
      } else {
        this.buckets.set(k, active);
      }
    }
  }
}

export function extractClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim().slice(0, 64);
  }
  if (Array.isArray(xff) && xff.length > 0 && xff[0]) {
    return String(xff[0]).split(',')[0].trim().slice(0, 64);
  }
  return (req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}
