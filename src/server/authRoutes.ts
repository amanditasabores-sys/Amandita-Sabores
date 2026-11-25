import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import type { Auth as AdminAuth } from 'firebase-admin/auth';
import {
  ACCOUNT_LOCK_DURATION_MS,
  FULL_ADMIN_DELIVERY_PERMISSIONS,
  MAX_ACCOUNT_LOGIN_FAILURES,
  OFFICIAL_APP_MODULES,
  PROVISIONING_LEASE_DURATION_MS,
  SlidingWindowRateLimiter,
  extractClientIp,
  hashPasswordScrypt,
  normalizeDeliveryPermissions,
  sanitizeUserProfileForResponse,
  timingSafeStringEqual,
  validateAllowedModules,
  validateAndNormalizePhone,
  validateAndNormalizeUsername,
  validateFullName,
  validateOperationId,
  validatePasswordStrength,
  validateStaffRole,
  verifyPasswordScrypt,
  type OfficialStaffRole,
  type StoredPasswordHash,
} from './authCrypto.js';

export interface StaffAuthContext {
  isStaff: boolean;
  role: string;
  uid: string | null;
  email: string | null;
  token: string | null;
}

export interface AuthRoutesDeps {
  getAdminServices: () => {
    adminDb: FirebaseFirestore.Firestore | null;
    adminAuth: AdminAuth | null;
  };
  verifyStaffAuth: (req: Request) => Promise<StaffAuthContext>;
}

class AuthHttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Rate Limiters (Brute-Force Protection)
// ---------------------------------------------------------------------------
const loginIpLimiter = new SlidingWindowRateLimiter(20, 15 * 60 * 1000);       // 20 / 15 min per IP
const loginUserLimiter = new SlidingWindowRateLimiter(10, 15 * 60 * 1000);     // 10 / 15 min per username
const bootstrapIpLimiter = new SlidingWindowRateLimiter(10, 15 * 60 * 1000);   // 10 / 15 min per IP
const recoveryIpLimiter = new SlidingWindowRateLimiter(5, 30 * 60 * 1000);     // 5 / 30 min per IP
const verifyPwLimiter = new SlidingWindowRateLimiter(10, 15 * 60 * 1000);      // 10 / 15 min per uid

export function __resetAuthRateLimitersForTests(): void {
  if (process.env.DISABLE_AUTO_LISTEN !== '1' || process.env.ALLOW_TEST_FIREBASE_OVERRIDES !== '1') {
    throw new Error('Auth rate limiter reset is strictly disabled outside test harness.');
  }
  loginIpLimiter.reset();
  loginUserLimiter.reset();
  bootstrapIpLimiter.reset();
  recoveryIpLimiter.reset();
  verifyPwLimiter.reset();
}

function isLeaseActive(leaseExpiresAt: unknown, nowMs: number): boolean {
  if (typeof leaseExpiresAt !== 'string' || !leaseExpiresAt) return false;
  const parsed = Date.parse(leaseExpiresAt);
  return Number.isFinite(parsed) && parsed > nowMs;
}

function isUserActiveProvisioned(userDoc: Record<string, unknown> | null | undefined): boolean {
  if (!userDoc) return false;
  const prov = userDoc.provisioningState;
  return prov === undefined || prov === 'ACTIVE';
}

function isAuthUserNotFoundError(err: unknown): boolean {
  const code = String((err as { code?: string })?.code || '');
  const msg = err instanceof Error ? err.message : String(err || '');
  return code.includes('user-not-found') || msg.toLowerCase().includes('user-not-found');
}

async function recordAuthAuditLog(
  adminDb: FirebaseFirestore.Firestore,
  entry: {
    userId?: string;
    username: string;
    role?: string;
    action: string;
    details: string;
  }
): Promise<void> {
  try {
    const id = `log-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await adminDb.collection('access_logs').doc(id).set({
      id,
      timestamp: new Date().toISOString(),
      ...(entry.userId ? { userId: entry.userId } : {}),
      username: entry.username,
      ...(entry.role ? { role: entry.role } : {}),
      action: entry.action,
      details: entry.details,
    });
  } catch {
    // Non-fatal audit logging failure
  }
}

async function findActiveAdministrators(
  adminDb: FirebaseFirestore.Firestore
): Promise<Array<Record<string, unknown> & { id: string }>> {
  const snap = await adminDb.collection('users').where('role', '==', 'ADMINISTRADOR').get();
  const list: Array<Record<string, unknown> & { id: string }> = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    if (
      data &&
      String(data.status || 'ATIVO').toUpperCase() === 'ATIVO' &&
      isUserActiveProvisioned(data)
    ) {
      list.push({ ...data, id: docSnap.id });
    }
  });
  return list;
}

async function cleanupOrphanedAuthUser(
  adminAuth: AdminAuth,
  uid: string
): Promise<{ cleaned: boolean; error?: string }> {
  if (!uid) return { cleaned: true };
  try {
    await adminAuth.deleteUser(uid);
    return { cleaned: true };
  } catch (delErr: unknown) {
    if (isAuthUserNotFoundError(delErr)) {
      return { cleaned: true };
    }
    // If deletion fails transiently, force-disable the Auth account so zero access is possible
    try {
      await adminAuth.updateUser(uid, { disabled: true });
    } catch {
      // ignore secondary disable failure
    }
    return {
      cleaned: false,
      error: delErr instanceof Error ? delErr.message : String(delErr),
    };
  }
}

async function compensateFailedBootstrap(params: {
  adminDb: FirebaseFirestore.Firestore;
  adminAuth: AdminAuth;
  operationId: string;
  username: string;
  uid: string | null;
  failedStage: string;
  errorMessage: string;
}): Promise<void> {
  const { adminDb, adminAuth, operationId, username, uid, failedStage, errorMessage } = params;
  const now = new Date().toISOString();

  let authCleanup: { cleaned: boolean; error?: string } = { cleaned: true };
  if (uid) {
    authCleanup = await cleanupOrphanedAuthUser(adminAuth, uid);
  }

  try {
    await adminDb.runTransaction(async (tx) => {
      const setupRef = adminDb.collection('configs').doc('auth_setup');
      const usernameRef = adminDb.collection('auth_usernames').doc(username);
      const userRef = uid ? adminDb.collection('users').doc(uid) : null;
      const credRef = uid ? adminDb.collection('staff_credentials').doc(uid) : null;

      const setupSnap = await tx.get(setupRef);
      const usernameSnap = await tx.get(usernameRef);
      const userSnap = userRef ? await tx.get(userRef) : null;
      const credSnap = credRef ? await tx.get(credRef) : null;

      if (userRef && userSnap?.exists) {
        const uData = userSnap.data() || {};
        if (uData.provisioningOperationId === operationId && uData.provisioningState !== 'ACTIVE') {
          tx.delete(userRef);
        }
      }

      if (credRef && credSnap?.exists) {
        const cData = credSnap.data() || {};
        if (cData.provisioningOperationId === operationId && cData.provisioningState !== 'ACTIVE') {
          tx.delete(credRef);
        }
      }

      if (usernameSnap.exists) {
        const unData = usernameSnap.data() || {};
        if (unData.operationId === operationId && unData.status !== 'ACTIVE') {
          tx.delete(usernameRef);
        }
      }

      if (setupSnap.exists) {
        const sData = setupSnap.data() || {};
        if (sData.operationId === operationId && sData.status !== 'COMPLETED') {
          if (authCleanup.cleaned) {
            tx.delete(setupRef);
          } else {
            tx.set(setupRef, {
              status: 'FAILED_RECOVERABLE',
              initialized: false,
              operationId,
              username,
              lastFailedUid: uid,
              failedStage,
              errorMessage,
              cleanupError: authCleanup.error || 'Falha ao remover conta Auth parcial',
              updatedAt: now,
            });
          }
        }
      }
    });
  } catch (rollbackErr) {
    console.error('[Auth Bootstrap Rollback] Falha ao reverter reserva:', rollbackErr);
  }
}

async function compensateFailedStaffProvisioning(params: {
  adminDb: FirebaseFirestore.Firestore;
  adminAuth: AdminAuth;
  operationId: string;
  username: string;
  uid: string | null;
  failedStage: string;
  errorMessage: string;
}): Promise<void> {
  const { adminDb, adminAuth, operationId, username, uid, failedStage, errorMessage } = params;
  const now = new Date().toISOString();

  let authCleanup: { cleaned: boolean; error?: string } = { cleaned: true };
  if (uid) {
    authCleanup = await cleanupOrphanedAuthUser(adminAuth, uid);
  }

  try {
    await adminDb.runTransaction(async (tx) => {
      const provRef = adminDb.collection('staff_provisioning').doc(operationId);
      const usernameRef = adminDb.collection('auth_usernames').doc(username);
      const userRef = uid ? adminDb.collection('users').doc(uid) : null;
      const credRef = uid ? adminDb.collection('staff_credentials').doc(uid) : null;

      const provSnap = await tx.get(provRef);
      const usernameSnap = await tx.get(usernameRef);
      const userSnap = userRef ? await tx.get(userRef) : null;
      const credSnap = credRef ? await tx.get(credRef) : null;

      if (userRef && userSnap?.exists) {
        const uData = userSnap.data() || {};
        if (uData.provisioningOperationId === operationId && uData.provisioningState !== 'ACTIVE') {
          tx.delete(userRef);
        }
      }

      if (credRef && credSnap?.exists) {
        const cData = credSnap.data() || {};
        if (cData.provisioningOperationId === operationId && cData.provisioningState !== 'ACTIVE') {
          tx.delete(credRef);
        }
      }

      if (usernameSnap.exists) {
        const unData = usernameSnap.data() || {};
        if (unData.operationId === operationId && unData.status !== 'ACTIVE') {
          tx.delete(usernameRef);
        }
      }

      if (provSnap.exists) {
        const pData = provSnap.data() || {};
        if (pData.status !== 'COMPLETED') {
          tx.set(provRef, {
            ...pData,
            status: authCleanup.cleaned ? 'ROLLED_BACK' : 'CLEANUP_PENDING',
            orphanedAuthUid: authCleanup.cleaned ? null : uid,
            failedStage,
            errorMessage,
            ...(authCleanup.error ? { cleanupError: authCleanup.error } : {}),
            updatedAt: now,
          });
        }
      }
    });
  } catch (rollbackErr) {
    console.error('[Auth Staff Rollback] Falha ao reverter provisionamento:', rollbackErr);
  }
}

async function cleanupStalePartialAccount(
  adminDb: FirebaseFirestore.Firestore,
  adminAuth: AdminAuth,
  stale: { uid?: string | null; username?: string | null; operationId?: string | null } | null
): Promise<void> {
  if (!stale) return;
  if (stale.uid) {
    try {
      const existingUserSnap = await adminDb.collection('users').doc(stale.uid).get();
      const existingData = existingUserSnap.exists ? (existingUserSnap.data() as Record<string, unknown>) : null;
      // Never delete an already ACTIVE user
      if (!existingData || existingData.provisioningState !== 'ACTIVE') {
        await cleanupOrphanedAuthUser(adminAuth, stale.uid);
        if (existingUserSnap.exists) {
          await adminDb.collection('users').doc(stale.uid).delete().catch(() => {});
        }
        await adminDb.collection('staff_credentials').doc(stale.uid).delete().catch(() => {});
      }
    } catch {
      // Best-effort stale cleanup
    }
  }
  if (stale.username) {
    try {
      const unRef = adminDb.collection('auth_usernames').doc(stale.username);
      const unSnap = await unRef.get();
      if (unSnap.exists) {
        const data = unSnap.data() || {};
        if (data.status !== 'ACTIVE' && (!stale.operationId || data.operationId === stale.operationId)) {
          await unRef.delete();
        }
      }
    } catch {
      // Best-effort stale cleanup
    }
  }
}

async function setCustomClaimsSafely(adminAuth: AdminAuth, uid: string, role: OfficialStaffRole): Promise<void> {
  if (typeof adminAuth.setCustomUserClaims === 'function') {
    try {
      await adminAuth.setCustomUserClaims(uid, { role });
    } catch {
      // Non-fatal: authoritative role lives in Firestore users/{uid}
    }
  }
}

async function revokeTokensSafely(adminAuth: AdminAuth, uid: string): Promise<void> {
  if (typeof adminAuth.revokeRefreshTokens === 'function') {
    try {
      await adminAuth.revokeRefreshTokens(uid);
    } catch {
      // Non-fatal
    }
  }
}

// ---------------------------------------------------------------------------
// Register All Stage 2A Authentication & Admin Staff Management Endpoints
// ---------------------------------------------------------------------------
export function registerAuthRoutes(app: Express, deps: AuthRoutesDeps): void {
  const requireAdminSdk = (res: Response): { adminDb: FirebaseFirestore.Firestore; adminAuth: AdminAuth } | null => {
    const { adminDb, adminAuth } = deps.getAdminServices();
    if (!adminDb || !adminAuth) {
      res.status(503).json({
        success: false,
        code: 'ADMIN_SDK_UNAVAILABLE',
        message: 'Operação de autenticação bloqueada: Firebase Admin SDK não está configurado no servidor.',
      });
      return null;
    }
    return { adminDb, adminAuth };
  };

  const requireAdminAuth = async (req: Request, res: Response): Promise<StaffAuthContext | null> => {
    const auth = await deps.verifyStaffAuth(req);
    if (!auth.uid || !auth.token || auth.role === 'ANONYMOUS') {
      res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Autenticação obrigatória. Faça login para continuar.',
      });
      return null;
    }
    if (!auth.isStaff || auth.role.toUpperCase() !== 'ADMINISTRADOR') {
      res.status(403).json({
        success: false,
        code: 'ADMIN_ONLY',
        message: 'Acesso negado: apenas o cargo ADMINISTRADOR possui autorização para gerenciar funcionários e acessos.',
      });
      return null;
    }
    return auth;
  };

  // =========================================================================
  // 1. GET /api/auth/bootstrap-status (Public, Zero PII)
  // =========================================================================
  app.get(['/api/auth/bootstrap-status', '/auth/bootstrap-status'], async (_req: Request, res: Response) => {
    try {
      const { adminDb, adminAuth } = deps.getAdminServices();
      if (!adminDb || !adminAuth) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_UNAVAILABLE',
          initialized: true, // Fail-closed: never expose initial setup if Admin SDK is absent
          mode: 'unavailable',
          hasAdminSdk: false,
          message: 'Firebase Admin SDK indisponível no servidor.',
        });
        return;
      }

      const setupSnap = await adminDb.collection('configs').doc('auth_setup').get();
      if (setupSnap.exists) {
        const setupData = setupSnap.data() || {};
        if (setupData.status === 'COMPLETED' && setupData.initialized === true) {
          res.json({
            success: true,
            initialized: true,
            mode: 'login',
            hasAdminSdk: true,
          });
          return;
        }
      }

      const activeAdmins = await findActiveAdministrators(adminDb);
      if (activeAdmins.length > 0) {
        res.json({
          success: true,
          initialized: true,
          mode: 'login',
          hasAdminSdk: true,
        });
        return;
      }

      res.json({
        success: true,
        initialized: false,
        mode: 'setup_required',
        hasAdminSdk: true,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        success: false,
        initialized: true,
        mode: 'error',
        message: `Erro ao verificar estado inicial de autenticação: ${msg}`,
      });
    }
  });

  // =========================================================================
  // 2. POST /api/auth/bootstrap-admin (Staged, Concurrency-Safe, One-Time Setup)
  // =========================================================================
  app.post(['/api/auth/bootstrap-admin', '/auth/bootstrap-admin'], async (req: Request, res: Response) => {
    const ip = extractClientIp(req);
    const rate = bootstrapIpLimiter.checkAndConsume(`bootstrap:${ip}`);
    if (!rate.allowed) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        retryAfterSeconds: rate.retryAfterSeconds,
        message: `Muitas tentativas consecutivas. Aguarde ${rate.retryAfterSeconds}s antes de tentar novamente.`,
      });
      return;
    }

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const nameRes = validateFullName(req.body?.name);
    if (!nameRes.valid || !nameRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_NAME', message: nameRes.error });
      return;
    }

    const userRes = validateAndNormalizeUsername(req.body?.username);
    if (!userRes.valid || !userRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_USERNAME', message: userRes.error });
      return;
    }

    const phoneRes = validateAndNormalizePhone(req.body?.phone);
    if (!phoneRes.valid || !phoneRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_PHONE', message: phoneRes.error });
      return;
    }

    const passRes = validatePasswordStrength(req.body?.password, 'Senha');
    if (!passRes.valid || !passRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_PASSWORD', message: passRes.error });
      return;
    }

    const fullName = nameRes.value;
    const username = userRes.value;
    const phone = phoneRes.value;
    const password = passRes.value;
    const operationId = validateOperationId(req.body?.idempotencyKey || req.body?.operationId);

    // Pre-check: allow password-verified idempotent replay for the exact completed operationId,
    // otherwise strictly block bootstrap if an active ADMINISTRADOR already exists.
    try {
      const setupPreSnap = await adminDb.collection('configs').doc('auth_setup').get();
      if (setupPreSnap.exists) {
        const preData = setupPreSnap.data() || {};
        if (
          preData.status === 'COMPLETED' &&
          preData.initialized === true &&
          preData.operationId === operationId &&
          preData.username === username &&
          typeof preData.initialAdminUid === 'string'
        ) {
          const [existingUserSnap, existingCredSnap] = await Promise.all([
            adminDb.collection('users').doc(preData.initialAdminUid).get(),
            adminDb.collection('staff_credentials').doc(preData.initialAdminUid).get(),
          ]);
          const credData = existingCredSnap.exists ? (existingCredSnap.data() as Record<string, unknown>) : null;
          if (
            existingUserSnap.exists &&
            credData &&
            typeof credData.passwordHash === 'string' &&
            typeof credData.passwordSalt === 'string'
          ) {
            const passwordMatches = await verifyPasswordScrypt(password, {
              hashAlgo: 'scrypt',
              passwordHash: credData.passwordHash,
              passwordSalt: credData.passwordSalt,
              hashParams: (credData.hashParams as any) || { N: 16384, r: 8, p: 1, keyLen: 64 },
            });
            if (passwordMatches) {
              const customToken = await adminAuth.createCustomToken(preData.initialAdminUid);
              res.status(200).json({
                success: true,
                idempotentReplay: true,
                customToken,
                user: sanitizeUserProfileForResponse({
                  ...(existingUserSnap.data() || {}),
                  id: preData.initialAdminUid,
                }),
              });
              return;
            }
          }
          res.status(409).json({
            success: false,
            code: 'BOOTSTRAP_ALREADY_COMPLETED',
            message: 'A configuração inicial do administrador já foi concluída.',
          });
          return;
        }
      }

      const existingAdmins = await findActiveAdministrators(adminDb);
      if (existingAdmins.length > 0) {
        res.status(409).json({
          success: false,
          code: 'BOOTSTRAP_ALREADY_COMPLETED',
          message: 'O administrador inicial já existe no sistema. Utilize a tela de login.',
        });
        return;
      }
    } catch (checkErr: unknown) {
      const msg = checkErr instanceof Error ? checkErr.message : String(checkErr);
      res.status(500).json({ success: false, message: `Erro ao verificar administradores existentes: ${msg}` });
      return;
    }

    type StaleCleanupInfo = { uid?: string | null; username?: string | null; operationId?: string | null };
    type BootstrapStage1Result = {
      createdOrResumedUid: string | null;
      staleCleanup: StaleCleanupInfo | null;
      alreadyCompletedUid: string | null;
    };

    let stage1Result: BootstrapStage1Result;

    // STAGE 1: Firestore Transaction — Acquire Exclusive Setup Lease & Username Reservation
    try {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const leaseExpiresAt = new Date(nowMs + PROVISIONING_LEASE_DURATION_MS).toISOString();

      stage1Result = await adminDb.runTransaction<BootstrapStage1Result>(async (tx) => {
        let txResumedUid: string | null = null;
        let txStaleCleanup: StaleCleanupInfo | null = null;

        const setupRef = adminDb.collection('configs').doc('auth_setup');
        const usernameRef = adminDb.collection('auth_usernames').doc(username);

        const setupSnap = await tx.get(setupRef);
        const usernameSnap = await tx.get(usernameRef);

        if (setupSnap.exists) {
          const setupData = setupSnap.data() || {};
          if (setupData.status === 'COMPLETED' && setupData.initialized === true) {
            if (
              setupData.operationId === operationId &&
              setupData.username === username &&
              typeof setupData.initialAdminUid === 'string'
            ) {
              return {
                createdOrResumedUid: null,
                staleCleanup: null,
                alreadyCompletedUid: setupData.initialAdminUid,
              };
            }
            throw new AuthHttpError(
              409,
              'BOOTSTRAP_ALREADY_COMPLETED',
              'A configuração inicial do administrador já foi concluída anteriormente.'
            );
          }

          if (setupData.status === 'INITIALIZING' || setupData.status === 'FINALIZING') {
            if (setupData.operationId === operationId) {
              if (typeof setupData.uid === 'string' && setupData.uid) {
                txResumedUid = setupData.uid;
              }
            } else if (isLeaseActive(setupData.leaseExpiresAt, nowMs)) {
              throw new AuthHttpError(
                409,
                'BOOTSTRAP_IN_PROGRESS',
                'A configuração inicial do administrador já está em andamento em outra solicitação.'
              );
            } else {
              txStaleCleanup = {
                uid: typeof setupData.uid === 'string' ? setupData.uid : null,
                username: typeof setupData.username === 'string' ? setupData.username : null,
                operationId: typeof setupData.operationId === 'string' ? setupData.operationId : null,
              };
            }
          } else if (setupData.status === 'FAILED_RECOVERABLE' && typeof setupData.lastFailedUid === 'string') {
            txStaleCleanup = {
              uid: setupData.lastFailedUid,
              username: typeof setupData.username === 'string' ? setupData.username : null,
              operationId: typeof setupData.operationId === 'string' ? setupData.operationId : null,
            };
          }
        }

        if (usernameSnap.exists) {
          const unData = usernameSnap.data() || {};
          if (unData.status === 'ACTIVE') {
            throw new AuthHttpError(409, 'USERNAME_TAKEN', 'Este nome de login já está em uso.');
          }
          if (
            (unData.status === 'PENDING' || unData.status === 'FINALIZING') &&
            unData.operationId !== operationId &&
            isLeaseActive(unData.leaseExpiresAt, nowMs)
          ) {
            throw new AuthHttpError(409, 'USERNAME_RESERVED', 'Este nome de login está em processo de cadastro.');
          }
        }

        tx.set(setupRef, {
          status: 'INITIALIZING',
          stage: txResumedUid ? 'AUTH_CREATED' : 'RESERVED',
          initialized: false,
          operationId,
          username,
          uid: txResumedUid,
          startedAt: nowIso,
          updatedAt: nowIso,
          leaseExpiresAt,
        });

        tx.set(usernameRef, {
          username,
          status: 'PENDING',
          operationId,
          uid: txResumedUid,
          reservedAt: nowIso,
          updatedAt: nowIso,
          leaseExpiresAt,
        });

        return {
          createdOrResumedUid: txResumedUid,
          staleCleanup: txStaleCleanup,
          alreadyCompletedUid: null,
        };
      });
    } catch (stage1Err: unknown) {
      if (stage1Err instanceof AuthHttpError) {
        res.status(stage1Err.statusCode).json({
          success: false,
          code: stage1Err.code,
          message: stage1Err.message,
        });
        return;
      }
      const msg = stage1Err instanceof Error ? stage1Err.message : String(stage1Err);
      res.status(500).json({ success: false, message: `Falha ao reservar configuração inicial: ${msg}` });
      return;
    }

    const { createdOrResumedUid, staleCleanup, alreadyCompletedUid } = stage1Result;

    // Idempotent replay for already-completed bootstrap with the same operationId
    if (alreadyCompletedUid) {
      try {
        const [existingSnap, credSnap] = await Promise.all([
          adminDb.collection('users').doc(alreadyCompletedUid).get(),
          adminDb.collection('staff_credentials').doc(alreadyCompletedUid).get(),
        ]);
        const credData = credSnap.exists ? (credSnap.data() as Record<string, unknown>) : null;
        if (
          existingSnap.exists &&
          credData &&
          typeof credData.passwordHash === 'string' &&
          typeof credData.passwordSalt === 'string'
        ) {
          const passwordMatches = await verifyPasswordScrypt(password, {
            hashAlgo: 'scrypt',
            passwordHash: credData.passwordHash,
            passwordSalt: credData.passwordSalt,
            hashParams: (credData.hashParams as any) || { N: 16384, r: 8, p: 1, keyLen: 64 },
          });
          if (passwordMatches) {
            const customToken = await adminAuth.createCustomToken(alreadyCompletedUid);
            res.status(200).json({
              success: true,
              idempotentReplay: true,
              customToken,
              user: sanitizeUserProfileForResponse({ ...(existingSnap.data() || {}), id: alreadyCompletedUid }),
            });
            return;
          }
        }
      } catch {
        // Fall through to conflict if token minting fails
      }
      res.status(409).json({
        success: false,
        code: 'BOOTSTRAP_ALREADY_COMPLETED',
        message: 'A configuração inicial do administrador já foi concluída.',
      });
      return;
    }

    // Clean up any stale orphaned artifacts from a previously crashed setup attempt
    if (staleCleanup) {
      await cleanupStalePartialAccount(adminDb, adminAuth, staleCleanup);
    }

    // STAGE 2: External Call (OUTSIDE Firestore Transaction) — Create Disabled Firebase Auth User
    let stage2CreatedUid: string | null = createdOrResumedUid;
    let uid: string;
    try {
      if (createdOrResumedUid) {
        uid = createdOrResumedUid;
      } else {
        const createdAuthUser = await adminAuth.createUser({
          displayName: fullName,
          disabled: true, // Strictly disabled until ALL stages confirm
        });
        uid = createdAuthUser.uid;
        stage2CreatedUid = uid;
        const checkpointIso = new Date().toISOString();
        await Promise.all([
          adminDb.collection('configs').doc('auth_setup').set(
            {
              stage: 'AUTH_CREATED',
              uid,
              updatedAt: checkpointIso,
            },
            { merge: true }
          ),
          adminDb.collection('auth_usernames').doc(username).set(
            {
              uid,
              updatedAt: checkpointIso,
            },
            { merge: true }
          ),
        ]);
      }
    } catch (stage2Err: unknown) {
      const msg = stage2Err instanceof Error ? stage2Err.message : String(stage2Err);
      await compensateFailedBootstrap({
        adminDb,
        adminAuth,
        operationId,
        username,
        uid: stage2CreatedUid,
        failedStage: 'STAGE_2_AUTH_CREATE',
        errorMessage: msg,
      });
      res.status(500).json({
        success: false,
        code: 'PROVISIONING_AUTH_FAILED',
        message: `Não foi possível criar a identidade do administrador no Firebase Auth: ${msg}`,
      });
      return;
    }

    // STAGE 3: Hash Password (scrypt) & Commit Firestore Docs in FINALIZING State
    let stagedUserDoc: Record<string, unknown>;
    try {
      const hashed = await hashPasswordScrypt(password);
      const stage3NowMs = Date.now();
      const stage3Iso = new Date(stage3NowMs).toISOString();
      const refreshedLease = new Date(stage3NowMs + PROVISIONING_LEASE_DURATION_MS).toISOString();

      stagedUserDoc = {
        id: uid,
        firebaseUid: uid,
        name: fullName,
        username,
        phone,
        role: 'ADMINISTRADOR' as OfficialStaffRole,
        status: 'ATIVO',
        allowedModules: [...OFFICIAL_APP_MODULES],
        deliveryPermissions: { ...FULL_ADMIN_DELIVERY_PERMISSIONS },
        authProvider: 'firebase_custom_token',
        provisioningState: 'FINALIZING',
        provisioningOperationId: operationId,
        createdAt: stage3Iso,
        updatedAt: stage3Iso,
      };

      const stagedCredDoc = {
        uid,
        ...hashed,
        provisioningState: 'FINALIZING',
        provisioningOperationId: operationId,
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: stage3Iso,
        updatedAt: stage3Iso,
      };

      await adminDb.runTransaction(async (tx) => {
        const setupRef = adminDb.collection('configs').doc('auth_setup');
        const usernameRef = adminDb.collection('auth_usernames').doc(username);
        const setupSnap = await tx.get(setupRef);
        const usernameSnap = await tx.get(usernameRef);

        if (!setupSnap.exists || setupSnap.data()?.operationId !== operationId) {
          throw new AuthHttpError(409, 'LEASE_LOST', 'A reserva da configuração inicial expirou ou foi substituída.');
        }
        if (!usernameSnap.exists || usernameSnap.data()?.operationId !== operationId) {
          throw new AuthHttpError(409, 'LEASE_LOST', 'A reserva do nome de login expirou.');
        }

        tx.set(adminDb.collection('users').doc(uid!), stagedUserDoc);
        tx.set(adminDb.collection('staff_credentials').doc(uid!), stagedCredDoc);
        tx.set(usernameRef, {
          username,
          uid,
          status: 'FINALIZING',
          operationId,
          updatedAt: stage3Iso,
          leaseExpiresAt: refreshedLease,
        });
        tx.set(setupRef, {
          status: 'FINALIZING',
          stage: 'DB_STAGED',
          initialized: false,
          operationId,
          username,
          uid,
          updatedAt: stage3Iso,
          leaseExpiresAt: refreshedLease,
        });
      });
    } catch (stage3Err: unknown) {
      const msg = stage3Err instanceof Error ? stage3Err.message : String(stage3Err);
      await compensateFailedBootstrap({
        adminDb,
        adminAuth,
        operationId,
        username,
        uid,
        failedStage: 'STAGE_3_DB_STAGE',
        errorMessage: msg,
      });
      const status = stage3Err instanceof AuthHttpError ? stage3Err.statusCode : 500;
      const code = stage3Err instanceof AuthHttpError ? stage3Err.code : 'PROVISIONING_DB_FAILED';
      res.status(status).json({
        success: false,
        code,
        message: `Não foi possível concluir o armazenamento seguro do administrador: ${msg}`,
      });
      return;
    }

    // STAGE 4: External Call — Enable Firebase Auth User & Mirror Role Claim
    try {
      await adminAuth.updateUser(uid, { disabled: false, displayName: fullName });
      await setCustomClaimsSafely(adminAuth, uid, 'ADMINISTRADOR');
    } catch (stage4Err: unknown) {
      const msg = stage4Err instanceof Error ? stage4Err.message : String(stage4Err);
      await compensateFailedBootstrap({
        adminDb,
        adminAuth,
        operationId,
        username,
        uid,
        failedStage: 'STAGE_4_AUTH_ENABLE',
        errorMessage: msg,
      });
      res.status(500).json({
        success: false,
        code: 'PROVISIONING_ENABLE_FAILED',
        message: `Falha ao ativar conta do administrador no Firebase Auth. Provisionamento revertido com segurança: ${msg}`,
      });
      return;
    }

    // STAGE 5: Final Confirmation Transaction — Promote to ACTIVE & Permanently Lock Setup
    const confirmedIso = new Date().toISOString();
    try {
      await adminDb.runTransaction(async (tx) => {
        const setupRef = adminDb.collection('configs').doc('auth_setup');
        const setupSnap = await tx.get(setupRef);
        if (!setupSnap.exists || setupSnap.data()?.operationId !== operationId) {
          throw new AuthHttpError(409, 'LEASE_LOST', 'Falha na confirmação final da configuração inicial.');
        }

        tx.set(
          adminDb.collection('users').doc(uid!),
          { provisioningState: 'ACTIVE', updatedAt: confirmedIso, lastLoginAt: confirmedIso },
          { merge: true }
        );
        tx.set(
          adminDb.collection('staff_credentials').doc(uid!),
          { provisioningState: 'ACTIVE', updatedAt: confirmedIso },
          { merge: true }
        );
        tx.set(adminDb.collection('auth_usernames').doc(username), {
          username,
          uid,
          status: 'ACTIVE',
          operationId,
          createdAt: confirmedIso,
          updatedAt: confirmedIso,
        });
        tx.set(setupRef, {
          status: 'COMPLETED',
          stage: 'COMPLETED',
          initialized: true,
          operationId,
          initialAdminUid: uid,
          username,
          completedAt: confirmedIso,
          updatedAt: confirmedIso,
        });
      });
    } catch (stage5Err: unknown) {
      const msg = stage5Err instanceof Error ? stage5Err.message : String(stage5Err);
      await compensateFailedBootstrap({
        adminDb,
        adminAuth,
        operationId,
        username,
        uid,
        failedStage: 'STAGE_5_FINAL_CONFIRM',
        errorMessage: msg,
      });
      res.status(500).json({
        success: false,
        code: 'PROVISIONING_CONFIRM_FAILED',
        message: `Falha ao confirmar ativação final do administrador. Provisionamento revertido: ${msg}`,
      });
      return;
    }

    // Mint Custom Token ONLY after ALL 5 stages are confirmed
    try {
      const customToken = await adminAuth.createCustomToken(uid);
      await recordAuthAuditLog(adminDb, {
        userId: uid,
        username,
        role: 'ADMINISTRADOR',
        action: 'PRIMEIRO_ACESSO_ADMIN',
        details: `Administrador inicial configurado com sucesso (@${username}).`,
      });

      res.status(201).json({
        success: true,
        message: 'Administrador inicial configurado com sucesso!',
        customToken,
        user: sanitizeUserProfileForResponse({
          ...stagedUserDoc,
          provisioningState: 'ACTIVE',
          updatedAt: confirmedIso,
          lastLoginAt: confirmedIso,
        }),
      });
    } catch (tokenErr: unknown) {
      const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
      res.status(201).json({
        success: true,
        requiresLogin: true,
        message: `Administrador configurado com sucesso, mas não foi possível emitir sessão automática (${msg}). Faça login com suas novas credenciais.`,
        user: sanitizeUserProfileForResponse({
          ...stagedUserDoc,
          provisioningState: 'ACTIVE',
          updatedAt: confirmedIso,
        }),
      });
    }
  });

  // =========================================================================
  // 3. POST /api/auth/login (Username + Password Only, Scrypt + Custom Token)
  // =========================================================================
  app.post(['/api/auth/login', '/auth/login'], async (req: Request, res: Response) => {
    const ip = extractClientIp(req);
    const ipRate = loginIpLimiter.checkAndConsume(`login:ip:${ip}`);
    if (!ipRate.allowed) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        retryAfterSeconds: ipRate.retryAfterSeconds,
        message: `Muitas tentativas de login. Aguarde ${ipRate.retryAfterSeconds}s antes de tentar novamente.`,
      });
      return;
    }

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const userRes = validateAndNormalizeUsername(req.body?.username);
    if (!userRes.valid || !userRes.value) {
      res.status(400).json({
        success: false,
        code: 'INVALID_USERNAME',
        message: userRes.error || 'Nome de login inválido.',
      });
      return;
    }

    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!rawPassword.trim()) {
      res.status(400).json({
        success: false,
        code: 'INVALID_PASSWORD',
        message: 'Informe sua senha de acesso.',
      });
      return;
    }

    const username = userRes.value;
    const userRate = loginUserLimiter.checkAndConsume(`login:user:${username}`);
    if (!userRate.allowed) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        retryAfterSeconds: userRate.retryAfterSeconds,
        message: `Muitas tentativas para este login. Aguarde ${userRate.retryAfterSeconds}s.`,
      });
      return;
    }

    try {
      const genericInvalidMsg = 'Nome de login ou senha inválidos.';

      const usernameSnap = await adminDb.collection('auth_usernames').doc(username).get();
      if (!usernameSnap.exists) {
        await recordAuthAuditLog(adminDb, {
          username,
          action: 'LOGIN_FALHA',
          details: 'Tentativa de login com credenciais inválidas.',
        });
        res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: genericInvalidMsg });
        return;
      }

      const usernameData = usernameSnap.data() || {};
      const uid = typeof usernameData.uid === 'string' ? usernameData.uid : '';
      // Strictly reject any incomplete/non-active username reservation
      if (usernameData.status !== 'ACTIVE' || !uid) {
        res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: genericInvalidMsg });
        return;
      }

      const [userSnap, credSnap] = await Promise.all([
        adminDb.collection('users').doc(uid).get(),
        adminDb.collection('staff_credentials').doc(uid).get(),
      ]);

      if (!userSnap.exists || !credSnap.exists) {
        res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: genericInvalidMsg });
        return;
      }

      const userData = (userSnap.data() || {}) as Record<string, unknown>;
      const credData = (credSnap.data() || {}) as Record<string, unknown>;

      // Never grant access before ALL provisioning stages are confirmed ACTIVE
      if (!isUserActiveProvisioned(userData) || (credData.provisioningState && credData.provisioningState !== 'ACTIVE')) {
        res.status(403).json({
          success: false,
          code: 'PROVISIONING_INCOMPLETE',
          message: 'Esta conta ainda não teve o provisionamento concluído. Contate o administrador.',
        });
        return;
      }

      const statusUpper = String(userData.status || 'ATIVO').toUpperCase();
      if (statusUpper === 'BLOQUEADO') {
        await recordAuthAuditLog(adminDb, {
          userId: uid,
          username,
          role: String(userData.role || ''),
          action: 'CONTA_BLOQUEADA',
          details: 'Tentativa de login em conta bloqueada.',
        });
        res.status(403).json({
          success: false,
          code: 'ACCOUNT_BLOCKED',
          message: 'Esta conta está bloqueada pelo administrador.',
        });
        return;
      }
      if (statusUpper === 'DESATIVADO') {
        res.status(403).json({
          success: false,
          code: 'ACCOUNT_DISABLED',
          message: 'Esta conta foi desativada.',
        });
        return;
      }

      const nowMs = Date.now();
      if (isLeaseActive(credData.lockedUntil, nowMs)) {
        const retryAfterSeconds = Math.ceil((Date.parse(String(credData.lockedUntil)) - nowMs) / 1000);
        res.status(429).json({
          success: false,
          code: 'ACCOUNT_TEMPORARILY_LOCKED',
          retryAfterSeconds,
          message: `Conta temporariamente bloqueada por excesso de tentativas incorretas. Tente novamente em ${retryAfterSeconds}s.`,
        });
        return;
      }

      const isPasswordValid = await verifyPasswordScrypt(rawPassword, credData as Partial<StoredPasswordHash>);
      if (!isPasswordValid) {
        const nextFailures = Number(credData.failedAttempts || 0) + 1;
        const shouldLock = nextFailures >= MAX_ACCOUNT_LOGIN_FAILURES;
        const nextLockedUntil = shouldLock ? new Date(nowMs + ACCOUNT_LOCK_DURATION_MS).toISOString() : null;

        await adminDb.collection('staff_credentials').doc(uid).set(
          {
            failedAttempts: nextFailures,
            lockedUntil: nextLockedUntil,
            lastFailedAt: new Date(nowMs).toISOString(),
          },
          { merge: true }
        );

        await recordAuthAuditLog(adminDb, {
          userId: uid,
          username,
          role: String(userData.role || ''),
          action: 'LOGIN_FALHA',
          details: shouldLock
            ? `Senha incorreta (${nextFailures} tentativas). Bloqueio temporário ativado.`
            : `Senha incorreta (tentativa ${nextFailures}/${MAX_ACCOUNT_LOGIN_FAILURES}).`,
        });

        if (shouldLock) {
          res.status(429).json({
            success: false,
            code: 'ACCOUNT_TEMPORARILY_LOCKED',
            retryAfterSeconds: Math.ceil(ACCOUNT_LOCK_DURATION_MS / 1000),
            message: 'Muitas tentativas incorretas. Conta bloqueada temporariamente por 5 minutos.',
          });
          return;
        }

        res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: genericInvalidMsg });
        return;
      }

      // Password confirmed — clear lockout counters, update lastLoginAt, mint Firebase Custom Token
      const nowIso = new Date(nowMs).toISOString();
      await Promise.all([
        adminDb.collection('staff_credentials').doc(uid).set(
          { failedAttempts: 0, lockedUntil: null, lastVerifiedAt: nowIso },
          { merge: true }
        ),
        adminDb.collection('users').doc(uid).set(
          { lastLoginAt: nowIso },
          { merge: true }
        ),
      ]);

      const customToken = await adminAuth.createCustomToken(uid);

      await recordAuthAuditLog(adminDb, {
        userId: uid,
        username,
        role: String(userData.role || ''),
        action: 'LOGIN_SUCESSO',
        details: `Login seguro efetuado para @${username} (${String(userData.role || '')}).`,
      });

      res.json({
        success: true,
        message: 'Autenticado com sucesso!',
        customToken,
        user: sanitizeUserProfileForResponse({ ...userData, id: uid, lastLoginAt: nowIso }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro interno na autenticação: ${msg}` });
    }
  });

  // =========================================================================
  // 4. POST /api/auth/verify-password (Authenticated Re-Verification)
  // =========================================================================
  app.post(['/api/auth/verify-password', '/auth/verify-password'], async (req: Request, res: Response) => {
    const auth = await deps.verifyStaffAuth(req);
    if (!auth.uid || !auth.isStaff) {
      res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' });
      return;
    }

    const rate = verifyPwLimiter.checkAndConsume(`verify:${auth.uid}`);
    if (!rate.allowed) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        retryAfterSeconds: rate.retryAfterSeconds,
        message: `Muitas tentativas. Aguarde ${rate.retryAfterSeconds}s.`,
      });
      return;
    }

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb } = services;

    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!rawPassword.trim()) {
      res.status(400).json({ success: false, message: 'A senha é obrigatória.' });
      return;
    }

    try {
      const credSnap = await adminDb.collection('staff_credentials').doc(auth.uid).get();
      if (!credSnap.exists) {
        res.status(401).json({ success: false, message: 'Credenciais não encontradas para revalidação.' });
        return;
      }
      const credData = credSnap.data() as Record<string, unknown>;
      const valid = await verifyPasswordScrypt(rawPassword, credData as Partial<StoredPasswordHash>);
      if (!valid) {
        res.status(401).json({ success: false, message: 'Senha incorreta.' });
        return;
      }
      res.json({ success: true, message: 'Senha confirmada com sucesso.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao revalidar senha: ${msg}` });
    }
  });

  // =========================================================================
  // 5. GET /api/auth/staff (Admin-Only Sanitized Staff Listing)
  // =========================================================================
  app.get(['/api/auth/staff', '/auth/staff'], async (req: Request, res: Response) => {
    const auth = await requireAdminAuth(req, res);
    if (!auth) return;

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb } = services;

    try {
      const snap = await adminDb.collection('users').get();
      const users: Array<Record<string, unknown>> = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        if (data && isUserActiveProvisioned(data)) {
          users.push(sanitizeUserProfileForResponse({ ...data, id: docSnap.id }));
        }
      });
      res.json({ success: true, users });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao listar funcionários: ${msg}` });
    }
  });

  // =========================================================================
  // 6. POST /api/auth/register-staff (Admin-Only Staged Employee Provisioning)
  // =========================================================================
  app.post(['/api/auth/register-staff', '/auth/register-staff'], async (req: Request, res: Response) => {
    const auth = await requireAdminAuth(req, res);
    if (!auth) return;

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const nameRes = validateFullName(req.body?.name);
    if (!nameRes.valid || !nameRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_NAME', message: nameRes.error });
      return;
    }

    const userRes = validateAndNormalizeUsername(req.body?.username);
    if (!userRes.valid || !userRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_USERNAME', message: userRes.error });
      return;
    }

    const phoneRes = validateAndNormalizePhone(req.body?.phone);
    if (!phoneRes.valid || !phoneRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_PHONE', message: phoneRes.error });
      return;
    }

    const passRes = validatePasswordStrength(req.body?.password, 'Senha');
    if (!passRes.valid || !passRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_PASSWORD', message: passRes.error });
      return;
    }

    const roleRes = validateStaffRole(req.body?.role);
    if (!roleRes.valid || !roleRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_ROLE', message: roleRes.error });
      return;
    }

    const modulesRes = validateAllowedModules(req.body?.allowedModules, roleRes.value);
    if (!modulesRes.valid || !modulesRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_MODULES', message: modulesRes.error });
      return;
    }

    const fullName = nameRes.value;
    const username = userRes.value;
    const phone = phoneRes.value;
    const password = passRes.value;
    const role = roleRes.value;
    const allowedModules = modulesRes.value;
    const deliveryPermissions = normalizeDeliveryPermissions(req.body?.deliveryPermissions, role);
    const operationId = validateOperationId(req.body?.idempotencyKey || req.body?.operationId);

    type StaffStaleCleanup = { uid?: string | null; username?: string | null; operationId?: string | null };
    type StaffStage1Result = {
      createdOrResumedUid: string | null;
      alreadyCompletedUid: string | null;
      staleCleanup: StaffStaleCleanup | null;
    };

    let stage1Result: StaffStage1Result;

    // STAGE 1: Firestore Transaction — Reserve Username & Provisioning State
    try {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const leaseExpiresAt = new Date(nowMs + PROVISIONING_LEASE_DURATION_MS).toISOString();

      stage1Result = await adminDb.runTransaction<StaffStage1Result>(async (tx) => {
        let txResumedUid: string | null = null;
        let txStaleCleanup: StaffStaleCleanup | null = null;

        const provRef = adminDb.collection('staff_provisioning').doc(operationId);
        const usernameRef = adminDb.collection('auth_usernames').doc(username);

        const provSnap = await tx.get(provRef);
        const usernameSnap = await tx.get(usernameRef);

        if (provSnap.exists) {
          const pData = provSnap.data() || {};
          if (pData.status === 'COMPLETED' && typeof pData.uid === 'string') {
            return {
              createdOrResumedUid: null,
              alreadyCompletedUid: pData.uid,
              staleCleanup: null,
            };
          }
          if (pData.username && pData.username !== username) {
            throw new AuthHttpError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Chave de operação já utilizada para outro nome de login.'
            );
          }
          if (typeof pData.uid === 'string' && pData.uid && (pData.status === 'AUTH_CREATED' || pData.status === 'DB_STAGED')) {
            txResumedUid = pData.uid;
          }
        }

        if (usernameSnap.exists) {
          const unData = usernameSnap.data() || {};
          if (unData.status === 'ACTIVE') {
            if (unData.operationId === operationId && typeof unData.uid === 'string') {
              return {
                createdOrResumedUid: null,
                alreadyCompletedUid: unData.uid,
                staleCleanup: null,
              };
            }
            throw new AuthHttpError(409, 'USERNAME_TAKEN', 'Nome de login já cadastrado. Escolha outro nome de login.');
          }
          if (unData.operationId !== operationId) {
            if (isLeaseActive(unData.leaseExpiresAt, nowMs)) {
              throw new AuthHttpError(
                409,
                'PROVISIONING_IN_PROGRESS',
                'Este nome de login já está sendo provisionado em outra solicitação.'
              );
            }
            txStaleCleanup = {
              uid: typeof unData.uid === 'string' ? unData.uid : null,
              username,
              operationId: typeof unData.operationId === 'string' ? unData.operationId : null,
            };
          } else if (typeof unData.uid === 'string' && unData.uid) {
            txResumedUid = unData.uid;
          }
        }

        tx.set(provRef, {
          operationId,
          status: txResumedUid ? 'AUTH_CREATED' : 'RESERVED',
          username,
          uid: txResumedUid,
          actorUid: auth.uid,
          role,
          createdAt: nowIso,
          updatedAt: nowIso,
          leaseExpiresAt,
        });

        tx.set(usernameRef, {
          username,
          status: 'PENDING',
          operationId,
          uid: txResumedUid,
          reservedAt: nowIso,
          updatedAt: nowIso,
          leaseExpiresAt,
        });

        return {
          createdOrResumedUid: txResumedUid,
          alreadyCompletedUid: null,
          staleCleanup: txStaleCleanup,
        };
      });
    } catch (stage1Err: unknown) {
      if (stage1Err instanceof AuthHttpError) {
        res.status(stage1Err.statusCode).json({
          success: false,
          code: stage1Err.code,
          message: stage1Err.message,
        });
        return;
      }
      const msg = stage1Err instanceof Error ? stage1Err.message : String(stage1Err);
      res.status(500).json({ success: false, message: `Erro ao reservar nome de login: ${msg}` });
      return;
    }

    const { createdOrResumedUid, alreadyCompletedUid, staleCleanup } = stage1Result;

    if (alreadyCompletedUid) {
      const existingSnap = await adminDb.collection('users').doc(alreadyCompletedUid).get();
      if (existingSnap.exists) {
        res.status(200).json({
          success: true,
          idempotentReplay: true,
          message: 'Funcionário já cadastrado anteriormente para esta operação.',
          user: sanitizeUserProfileForResponse({ ...(existingSnap.data() || {}), id: alreadyCompletedUid }),
        });
        return;
      }
    }

    if (staleCleanup) {
      await cleanupStalePartialAccount(adminDb, adminAuth, staleCleanup);
    }

    // STAGE 2: External Call — Create Disabled Firebase Auth User
    let stage2CreatedUid: string | null = createdOrResumedUid;
    let uid: string;
    try {
      if (createdOrResumedUid) {
        uid = createdOrResumedUid;
      } else {
        const createdAuthUser = await adminAuth.createUser({
          displayName: fullName,
          disabled: true,
        });
        uid = createdAuthUser.uid;
        stage2CreatedUid = uid;
        const checkpointIso = new Date().toISOString();
        await Promise.all([
          adminDb.collection('staff_provisioning').doc(operationId).set(
            { status: 'AUTH_CREATED', uid, updatedAt: checkpointIso },
            { merge: true }
          ),
          adminDb.collection('auth_usernames').doc(username).set(
            { uid, updatedAt: checkpointIso },
            { merge: true }
          ),
        ]);
      }
    } catch (stage2Err: unknown) {
      const msg = stage2Err instanceof Error ? stage2Err.message : String(stage2Err);
      await compensateFailedStaffProvisioning({
        adminDb,
        adminAuth,
        operationId,
        username,
        uid: stage2CreatedUid,
        failedStage: 'STAGE_2_AUTH_CREATE',
        errorMessage: msg,
      });
      res.status(500).json({
        success: false,
        code: 'PROVISIONING_AUTH_FAILED',
        message: `Não foi possível criar a conta no Firebase Auth: ${msg}`,
      });
      return;
    }

    // STAGE 3: Scrypt Hash & Commit Firestore Docs in FINALIZING State
    let stagedUserDoc: Record<string, unknown>;
    try {
      const hashed = await hashPasswordScrypt(password);
      const stage3NowMs = Date.now();
      const stage3Iso = new Date(stage3NowMs).toISOString();
      const refreshedLease = new Date(stage3NowMs + PROVISIONING_LEASE_DURATION_MS).toISOString();

      stagedUserDoc = {
        id: uid,
        firebaseUid: uid,
        name: fullName,
        username,
        phone,
        role,
        status: 'ATIVO',
        allowedModules,
        deliveryPermissions,
        authProvider: 'firebase_custom_token',
        provisioningState: 'FINALIZING',
        provisioningOperationId: operationId,
        createdAt: stage3Iso,
        updatedAt: stage3Iso,
      };

      const stagedCredDoc = {
        uid,
        ...hashed,
        provisioningState: 'FINALIZING',
        provisioningOperationId: operationId,
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: stage3Iso,
        updatedAt: stage3Iso,
      };

      await adminDb.runTransaction(async (tx) => {
        const provRef = adminDb.collection('staff_provisioning').doc(operationId);
        const usernameRef = adminDb.collection('auth_usernames').doc(username);
        const provSnap = await tx.get(provRef);
        const usernameSnap = await tx.get(usernameRef);

        if (!provSnap.exists || provSnap.data()?.operationId !== operationId) {
          throw new AuthHttpError(409, 'LEASE_LOST', 'A reserva de provisionamento expirou.');
        }
        if (!usernameSnap.exists || usernameSnap.data()?.operationId !== operationId) {
          throw new AuthHttpError(409, 'LEASE_LOST', 'A reserva do nome de login foi perdida.');
        }

        tx.set(adminDb.collection('users').doc(uid!), stagedUserDoc);
        tx.set(adminDb.collection('staff_credentials').doc(uid!), stagedCredDoc);
        tx.set(usernameRef, {
          username,
          uid,
          status: 'FINALIZING',
          operationId,
          updatedAt: stage3Iso,
          leaseExpiresAt: refreshedLease,
        });
        tx.set(
          provRef,
          {
            status: 'DB_STAGED',
            uid,
            updatedAt: stage3Iso,
            leaseExpiresAt: refreshedLease,
          },
          { merge: true }
        );
      });
    } catch (stage3Err: unknown) {
      const msg = stage3Err instanceof Error ? stage3Err.message : String(stage3Err);
      await compensateFailedStaffProvisioning({
        adminDb,
        adminAuth,
        operationId,
        username,
        uid,
        failedStage: 'STAGE_3_DB_STAGE',
        errorMessage: msg,
      });
      const status = stage3Err instanceof AuthHttpError ? stage3Err.statusCode : 500;
      const code = stage3Err instanceof AuthHttpError ? stage3Err.code : 'PROVISIONING_DB_FAILED';
      res.status(status).json({
        success: false,
        code,
        message: `Não foi possível salvar os dados do funcionário: ${msg}`,
      });
      return;
    }

    // STAGE 4: External Call — Enable Firebase Auth Account & Mirror Custom Claim
    try {
      await adminAuth.updateUser(uid, { disabled: false, displayName: fullName });
      await setCustomClaimsSafely(adminAuth, uid, role);
    } catch (stage4Err: unknown) {
      const msg = stage4Err instanceof Error ? stage4Err.message : String(stage4Err);
      await compensateFailedStaffProvisioning({
        adminDb,
        adminAuth,
        operationId,
        username,
        uid,
        failedStage: 'STAGE_4_AUTH_ENABLE',
        errorMessage: msg,
      });
      res.status(500).json({
        success: false,
        code: 'PROVISIONING_ENABLE_FAILED',
        message: `Falha ao ativar conta do funcionário. Provisionamento revertido: ${msg}`,
      });
      return;
    }

    // STAGE 5: Final Confirmation Transaction — Promote to ACTIVE
    const confirmedIso = new Date().toISOString();
    try {
      await adminDb.runTransaction(async (tx) => {
        const provRef = adminDb.collection('staff_provisioning').doc(operationId);
        const provSnap = await tx.get(provRef);
        if (!provSnap.exists || provSnap.data()?.operationId !== operationId) {
          throw new AuthHttpError(409, 'LEASE_LOST', 'Falha na confirmação final do provisionamento.');
        }

        tx.set(
          adminDb.collection('users').doc(uid!),
          { provisioningState: 'ACTIVE', updatedAt: confirmedIso },
          { merge: true }
        );
        tx.set(
          adminDb.collection('staff_credentials').doc(uid!),
          { provisioningState: 'ACTIVE', updatedAt: confirmedIso },
          { merge: true }
        );
        tx.set(adminDb.collection('auth_usernames').doc(username), {
          username,
          uid,
          status: 'ACTIVE',
          operationId,
          createdAt: confirmedIso,
          updatedAt: confirmedIso,
        });
        tx.set(
          provRef,
          {
            status: 'COMPLETED',
            uid,
            completedAt: confirmedIso,
            updatedAt: confirmedIso,
          },
          { merge: true }
        );
      });
    } catch (stage5Err: unknown) {
      const msg = stage5Err instanceof Error ? stage5Err.message : String(stage5Err);
      await compensateFailedStaffProvisioning({
        adminDb,
        adminAuth,
        operationId,
        username,
        uid,
        failedStage: 'STAGE_5_FINAL_CONFIRM',
        errorMessage: msg,
      });
      res.status(500).json({
        success: false,
        code: 'PROVISIONING_CONFIRM_FAILED',
        message: `Falha ao confirmar ativação final do funcionário: ${msg}`,
      });
      return;
    }

    await recordAuthAuditLog(adminDb, {
      userId: uid,
      username,
      role,
      action: 'FUNCIONARIO_CADASTRADO',
      details: `Funcionário ${fullName} (@${username}, ${role}) cadastrado pelo administrador (${auth.uid}).`,
    });

    res.status(201).json({
      success: true,
      message: 'Funcionário cadastrado com sucesso!',
      user: sanitizeUserProfileForResponse({
        ...stagedUserDoc,
        provisioningState: 'ACTIVE',
        updatedAt: confirmedIso,
      }),
    });
  });

  // =========================================================================
  // 7. PUT /api/auth/update-staff/:uid & POST /api/auth/update-staff (Admin-Only)
  // =========================================================================
  const handleUpdateStaff = async (req: Request, res: Response) => {
    const auth = await requireAdminAuth(req, res);
    if (!auth) return;

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const targetUid = String(req.params?.uid || req.body?.uid || req.body?.targetUid || '').trim();
    if (!targetUid) {
      res.status(400).json({ success: false, message: 'Identificador do funcionário é obrigatório.' });
      return;
    }

    const nameRes = validateFullName(req.body?.name);
    if (!nameRes.valid || !nameRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_NAME', message: nameRes.error });
      return;
    }

    const userRes = validateAndNormalizeUsername(req.body?.username);
    if (!userRes.valid || !userRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_USERNAME', message: userRes.error });
      return;
    }

    const phoneRes = validateAndNormalizePhone(req.body?.phone);
    if (!phoneRes.valid || !phoneRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_PHONE', message: phoneRes.error });
      return;
    }

    const roleRes = validateStaffRole(req.body?.role);
    if (!roleRes.valid || !roleRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_ROLE', message: roleRes.error });
      return;
    }

    const modulesRes = validateAllowedModules(req.body?.allowedModules, roleRes.value);
    if (!modulesRes.valid || !modulesRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_MODULES', message: modulesRes.error });
      return;
    }

    const rawStatus = req.body?.status ? String(req.body.status).trim().toUpperCase() : 'ATIVO';
    if (!['ATIVO', 'BLOQUEADO', 'DESATIVADO'].includes(rawStatus)) {
      res.status(400).json({ success: false, message: 'Status inválido. Use ATIVO, BLOQUEADO ou DESATIVADO.' });
      return;
    }

    const fullName = nameRes.value;
    const nextUsername = userRes.value;
    const phone = phoneRes.value;
    const nextRole = roleRes.value;
    const nextStatus = rawStatus;
    const nextModules = modulesRes.value;
    const nextDeliveryPerms = normalizeDeliveryPermissions(req.body?.deliveryPermissions, nextRole);

    // Protect last active ADMINISTRADOR and prevent admin self-demotion/self-lockout
    try {
      const existingSnap = await adminDb.collection('users').doc(targetUid).get();
      if (!existingSnap.exists) {
        res.status(404).json({ success: false, message: 'Funcionário não encontrado.' });
        return;
      }
      const existingData = (existingSnap.data() || {}) as Record<string, unknown>;
      const wasAdmin = String(existingData.role || '').toUpperCase() === 'ADMINISTRADOR';
      const losingAdmin = wasAdmin && (nextRole !== 'ADMINISTRADOR' || nextStatus !== 'ATIVO');

      if (targetUid === auth.uid && losingAdmin) {
        res.status(403).json({
          success: false,
          code: 'CANNOT_DEMOTE_SELF',
          message: 'Você não pode remover sua própria função de Administrador nem bloquear sua própria conta.',
        });
        return;
      }

      if (losingAdmin) {
        const activeAdmins = await findActiveAdministrators(adminDb);
        const remainingAdmins = activeAdmins.filter((a) => a.id !== targetUid);
        if (remainingAdmins.length === 0) {
          res.status(403).json({
            success: false,
            code: 'LAST_ADMIN_PROTECTED',
            message: 'Não é permitido rebaixar ou bloquear o único Administrador ativo do sistema.',
          });
          return;
        }
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let updatedProfile: Record<string, unknown> = {};

      await adminDb.runTransaction(async (tx) => {
        const userRef = adminDb.collection('users').doc(targetUid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) {
          throw new AuthHttpError(404, 'USER_NOT_FOUND', 'Funcionário não encontrado.');
        }

        const current = (userSnap.data() || {}) as Record<string, unknown>;
        const oldUsername = String(current.username || '').trim().toLowerCase();

        if (nextUsername !== oldUsername) {
          const newUsernameRef = adminDb.collection('auth_usernames').doc(nextUsername);
          const newUsernameSnap = await tx.get(newUsernameRef);
          if (newUsernameSnap.exists) {
            const existingOwner = newUsernameSnap.data() || {};
            const isOccupiedByOther =
              existingOwner.uid !== targetUid &&
              (existingOwner.status === 'ACTIVE' || isLeaseActive(existingOwner.leaseExpiresAt, nowMs));
            if (isOccupiedByOther) {
              throw new AuthHttpError(409, 'USERNAME_TAKEN', 'Este nome de login já está em uso por outro funcionário.');
            }
          }

          if (oldUsername) {
            const oldUsernameRef = adminDb.collection('auth_usernames').doc(oldUsername);
            const oldUsernameSnap = await tx.get(oldUsernameRef);
            if (oldUsernameSnap.exists && oldUsernameSnap.data()?.uid === targetUid) {
              tx.delete(oldUsernameRef);
            }
          }

          tx.set(newUsernameRef, {
            username: nextUsername,
            uid: targetUid,
            status: 'ACTIVE',
            updatedAt: nowIso,
          });
        }

        updatedProfile = {
          ...current,
          id: targetUid,
          firebaseUid: targetUid,
          name: fullName,
          username: nextUsername,
          phone,
          role: nextRole,
          status: nextStatus,
          allowedModules: nextModules,
          deliveryPermissions: nextDeliveryPerms,
          updatedAt: nowIso,
        };

        tx.set(userRef, updatedProfile, { merge: true });
      });

      // Sync Firebase Auth status, displayName, and role claims outside transaction
      try {
        await adminAuth.updateUser(targetUid, {
          displayName: fullName,
          disabled: nextStatus !== 'ATIVO',
        });
        await setCustomClaimsSafely(adminAuth, targetUid, nextRole);
        if (nextStatus !== 'ATIVO') {
          await revokeTokensSafely(adminAuth, targetUid);
        }
      } catch (authSyncErr) {
        console.warn('[Auth Update Staff] Aviso ao sincronizar Firebase Auth:', authSyncErr);
      }

      await recordAuthAuditLog(adminDb, {
        userId: targetUid,
        username: nextUsername,
        role: nextRole,
        action: 'FUNCIONARIO_ATUALIZADO',
        details: `Cadastro de ${fullName} (@${nextUsername}, ${nextRole}, ${nextStatus}) atualizado pelo administrador (${auth.uid}).`,
      });

      res.json({
        success: true,
        message: 'Dados do funcionário atualizados com sucesso!',
        user: sanitizeUserProfileForResponse(updatedProfile),
      });
    } catch (err: unknown) {
      if (err instanceof AuthHttpError) {
        res.status(err.statusCode).json({ success: false, code: err.code, message: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao atualizar funcionário: ${msg}` });
    }
  };

  app.put(['/api/auth/update-staff/:uid', '/auth/update-staff/:uid'], handleUpdateStaff);
  app.post(['/api/auth/update-staff', '/auth/update-staff'], handleUpdateStaff);

  // =========================================================================
  // 8. POST /api/auth/reset-password (Admin-Only Real Password Reset)
  // =========================================================================
  app.post(['/api/auth/reset-password', '/auth/reset-password'], async (req: Request, res: Response) => {
    const auth = await requireAdminAuth(req, res);
    if (!auth) return;

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const targetUid = String(req.body?.targetUid || req.body?.targetUserId || '').trim();
    if (!targetUid) {
      res.status(400).json({ success: false, message: 'Identificador do funcionário é obrigatório.' });
      return;
    }

    const passRes = validatePasswordStrength(req.body?.newPassword, 'Nova senha');
    if (!passRes.valid || !passRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_PASSWORD', message: passRes.error });
      return;
    }

    try {
      const userSnap = await adminDb.collection('users').doc(targetUid).get();
      if (!userSnap.exists) {
        res.status(404).json({ success: false, message: 'Funcionário não encontrado.' });
        return;
      }
      const userData = (userSnap.data() || {}) as Record<string, unknown>;
      if (!isUserActiveProvisioned(userData)) {
        res.status(409).json({
          success: false,
          code: 'PROVISIONING_INCOMPLETE',
          message: 'Não é possível redefinir senha de conta com provisionamento incompleto.',
        });
        return;
      }

      const hashed = await hashPasswordScrypt(passRes.value);
      const nowIso = new Date().toISOString();

      await adminDb.collection('staff_credentials').doc(targetUid).set(
        {
          uid: targetUid,
          ...hashed,
          provisioningState: 'ACTIVE',
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      await revokeTokensSafely(adminAuth, targetUid);

      await recordAuthAuditLog(adminDb, {
        userId: targetUid,
        username: String(userData.username || targetUid),
        role: String(userData.role || ''),
        action: 'SENHA_ALTERADA',
        details: `Senha redefinida pelo administrador (${auth.uid}) para @${String(userData.username || targetUid)}.`,
      });

      res.json({
        success: true,
        message: 'Senha redefinida com sucesso!',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao redefinir senha: ${msg}` });
    }
  });

  // =========================================================================
  // 9. POST /api/auth/toggle-status (Admin-Only Block / Unblock / Deactivate)
  // =========================================================================
  app.post(['/api/auth/toggle-status', '/auth/toggle-status'], async (req: Request, res: Response) => {
    const auth = await requireAdminAuth(req, res);
    if (!auth) return;

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const targetUid = String(req.body?.targetUid || req.body?.targetUserId || '').trim();
    const nextStatus = String(req.body?.status || '').trim().toUpperCase();

    if (!targetUid) {
      res.status(400).json({ success: false, message: 'Identificador do funcionário é obrigatório.' });
      return;
    }
    if (!['ATIVO', 'BLOQUEADO', 'DESATIVADO'].includes(nextStatus)) {
      res.status(400).json({ success: false, message: 'Status inválido. Use ATIVO, BLOQUEADO ou DESATIVADO.' });
      return;
    }

    if (targetUid === auth.uid && nextStatus !== 'ATIVO') {
      res.status(403).json({
        success: false,
        code: 'CANNOT_BLOCK_SELF',
        message: 'Você não pode bloquear ou desativar a própria conta de Administrador.',
      });
      return;
    }

    try {
      const userRef = adminDb.collection('users').doc(targetUid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        res.status(404).json({ success: false, message: 'Funcionário não encontrado.' });
        return;
      }

      const userData = (userSnap.data() || {}) as Record<string, unknown>;
      if (String(userData.role || '').toUpperCase() === 'ADMINISTRADOR' && nextStatus !== 'ATIVO') {
        const activeAdmins = await findActiveAdministrators(adminDb);
        if (activeAdmins.filter((a) => a.id !== targetUid).length === 0) {
          res.status(403).json({
            success: false,
            code: 'LAST_ADMIN_PROTECTED',
            message: 'Não é permitido bloquear ou desativar o único Administrador ativo.',
          });
          return;
        }
      }

      const nowIso = new Date().toISOString();
      await userRef.set({ status: nextStatus, updatedAt: nowIso }, { merge: true });

      try {
        await adminAuth.updateUser(targetUid, { disabled: nextStatus !== 'ATIVO' });
        if (nextStatus !== 'ATIVO') {
          await revokeTokensSafely(adminAuth, targetUid);
        }
      } catch (authErr) {
        console.warn('[Auth Toggle Status] Aviso ao sincronizar status no Firebase Auth:', authErr);
      }

      await recordAuthAuditLog(adminDb, {
        userId: targetUid,
        username: String(userData.username || targetUid),
        role: String(userData.role || ''),
        action: nextStatus === 'ATIVO' ? 'CONTA_ATIVADA' : 'CONTA_BLOQUEADA',
        details: `Status alterado para ${nextStatus} pelo administrador (${auth.uid}).`,
      });

      res.json({
        success: true,
        message: `Status da conta atualizado para ${nextStatus}.`,
        user: sanitizeUserProfileForResponse({ ...userData, id: targetUid, status: nextStatus, updatedAt: nowIso }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao alterar status da conta: ${msg}` });
    }
  });

  // =========================================================================
  // 10. DELETE /api/auth/delete-staff/:uid (Admin-Only Staged Removal)
  // =========================================================================
  app.delete(['/api/auth/delete-staff/:uid', '/auth/delete-staff/:uid'], async (req: Request, res: Response) => {
    const auth = await requireAdminAuth(req, res);
    if (!auth) return;

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const targetUid = String(req.params?.uid || '').trim();
    if (!targetUid) {
      res.status(400).json({ success: false, message: 'Identificador do funcionário é obrigatório.' });
      return;
    }

    if (targetUid === auth.uid) {
      res.status(403).json({
        success: false,
        code: 'CANNOT_DELETE_SELF',
        message: 'Você não pode excluir sua própria conta.',
      });
      return;
    }

    try {
      const userRef = adminDb.collection('users').doc(targetUid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        res.status(404).json({ success: false, message: 'Funcionário não encontrado.' });
        return;
      }
      const userData = (userSnap.data() || {}) as Record<string, unknown>;
      if (String(userData.role || '').toUpperCase() === 'ADMINISTRADOR') {
        res.status(403).json({
          success: false,
          code: 'CANNOT_DELETE_ADMIN',
          message: 'A conta de Administrador Geral não pode ser excluída.',
        });
        return;
      }

      const targetUsername = String(userData.username || '').trim().toLowerCase();

      // Stage 1: Revoke & delete Firebase Auth user first (if fails, account stays intact)
      const authDel = await cleanupOrphanedAuthUser(adminAuth, targetUid);
      if (!authDel.cleaned) {
        res.status(500).json({
          success: false,
          message: `Não foi possível remover a credencial no Firebase Auth: ${authDel.error}`,
        });
        return;
      }

      // Stage 2: Delete Firestore profile, credentials, and username reservation atomically
      await adminDb.runTransaction(async (tx) => {
        const unRef = targetUsername ? adminDb.collection('auth_usernames').doc(targetUsername) : null;
        const unSnap = unRef ? await tx.get(unRef) : null;
        if (unRef && unSnap?.exists && unSnap.data()?.uid === targetUid) {
          tx.delete(unRef);
        }
        tx.delete(adminDb.collection('staff_credentials').doc(targetUid));
        tx.delete(userRef);
      });

      await recordAuthAuditLog(adminDb, {
        userId: targetUid,
        username: targetUsername || targetUid,
        role: String(userData.role || ''),
        action: 'FUNCIONARIO_REMOVIDO',
        details: `Funcionário @${targetUsername || targetUid} removido pelo administrador (${auth.uid}).`,
      });

      res.json({ success: true, message: 'Funcionário removido com sucesso!' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao remover funcionário: ${msg}` });
    }
  });

  // =========================================================================
  // 11. POST /api/auth/account/credentials (Admin Self-Update Without Losing Role)
  // =========================================================================
  app.post(['/api/auth/account/credentials', '/auth/account/credentials'], async (req: Request, res: Response) => {
    const auth = await requireAdminAuth(req, res);
    if (!auth || !auth.uid) return;

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    if (!currentPassword.trim()) {
      res.status(400).json({
        success: false,
        code: 'CURRENT_PASSWORD_REQUIRED',
        message: 'Informe sua senha atual para confirmar a alteração de credenciais.',
      });
      return;
    }

    const hasNewUsername = req.body?.newUsername !== undefined && String(req.body.newUsername).trim() !== '';
    const hasNewPassword = req.body?.newPassword !== undefined && String(req.body.newPassword).trim() !== '';
    const hasNewName = req.body?.name !== undefined && String(req.body.name).trim() !== '';
    const hasNewPhone = req.body?.phone !== undefined && String(req.body.phone).trim() !== '';

    if (!hasNewUsername && !hasNewPassword && !hasNewName && !hasNewPhone) {
      res.status(400).json({
        success: false,
        message: 'Informe ao menos um campo para atualizar (novo nome de login, nova senha, nome completo ou contato).',
      });
      return;
    }

    let validatedUsername: string | undefined;
    if (hasNewUsername) {
      const uRes = validateAndNormalizeUsername(req.body.newUsername);
      if (!uRes.valid || !uRes.value) {
        res.status(400).json({ success: false, code: 'INVALID_USERNAME', message: uRes.error });
        return;
      }
      validatedUsername = uRes.value;
    }

    let validatedPassword: string | undefined;
    if (hasNewPassword) {
      const pRes = validatePasswordStrength(req.body.newPassword, 'Nova senha');
      if (!pRes.valid || !pRes.value) {
        res.status(400).json({ success: false, code: 'INVALID_PASSWORD', message: pRes.error });
        return;
      }
      validatedPassword = pRes.value;
    }

    let validatedName: string | undefined;
    if (hasNewName) {
      const nRes = validateFullName(req.body.name);
      if (!nRes.valid || !nRes.value) {
        res.status(400).json({ success: false, code: 'INVALID_NAME', message: nRes.error });
        return;
      }
      validatedName = nRes.value;
    }

    let validatedPhone: string | undefined;
    if (hasNewPhone) {
      const phRes = validateAndNormalizePhone(req.body.phone);
      if (!phRes.valid || !phRes.value) {
        res.status(400).json({ success: false, code: 'INVALID_PHONE', message: phRes.error });
        return;
      }
      validatedPhone = phRes.value;
    }

    try {
      const uid = auth.uid;
      const credSnap = await adminDb.collection('staff_credentials').doc(uid).get();
      if (!credSnap.exists) {
        res.status(401).json({ success: false, message: 'Credenciais atuais não encontradas.' });
        return;
      }
      const credData = credSnap.data() as Record<string, unknown>;
      const validCurrent = await verifyPasswordScrypt(currentPassword, credData as Partial<StoredPasswordHash>);
      if (!validCurrent) {
        res.status(401).json({
          success: false,
          code: 'INVALID_CURRENT_PASSWORD',
          message: 'Senha atual incorreta.',
        });
        return;
      }

      const nextHash = validatedPassword ? await hashPasswordScrypt(validatedPassword) : null;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let finalProfile: Record<string, unknown> = {};

      await adminDb.runTransaction(async (tx) => {
        const userRef = adminDb.collection('users').doc(uid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) {
          throw new AuthHttpError(404, 'USER_NOT_FOUND', 'Perfil do administrador não encontrado.');
        }

        const currentProfile = (userSnap.data() || {}) as Record<string, unknown>;
        const oldUsername = String(currentProfile.username || '').trim().toLowerCase();
        const nextUsername = validatedUsername || oldUsername;

        if (nextUsername !== oldUsername) {
          const newUsernameRef = adminDb.collection('auth_usernames').doc(nextUsername);
          const newUsernameSnap = await tx.get(newUsernameRef);
          if (newUsernameSnap.exists) {
            const owner = newUsernameSnap.data() || {};
            if (owner.uid !== uid && (owner.status === 'ACTIVE' || isLeaseActive(owner.leaseExpiresAt, nowMs))) {
              throw new AuthHttpError(409, 'USERNAME_TAKEN', 'Este nome de login já está em uso.');
            }
          }

          if (oldUsername) {
            const oldUsernameRef = adminDb.collection('auth_usernames').doc(oldUsername);
            const oldUsernameSnap = await tx.get(oldUsernameRef);
            if (oldUsernameSnap.exists && oldUsernameSnap.data()?.uid === uid) {
              tx.delete(oldUsernameRef);
            }
          }

          tx.set(newUsernameRef, {
            username: nextUsername,
            uid,
            status: 'ACTIVE',
            updatedAt: nowIso,
          });
        }

        // Explicitly preserve ADMINISTRADOR role, ATIVO status, all 11 modules, and all 7 delivery permissions
        finalProfile = {
          ...currentProfile,
          id: uid,
          firebaseUid: uid,
          name: validatedName || currentProfile.name,
          username: nextUsername,
          phone: validatedPhone || currentProfile.phone,
          role: 'ADMINISTRADOR',
          status: 'ATIVO',
          allowedModules: [...OFFICIAL_APP_MODULES],
          deliveryPermissions: { ...FULL_ADMIN_DELIVERY_PERMISSIONS },
          updatedAt: nowIso,
        };

        tx.set(userRef, finalProfile, { merge: true });

        if (nextHash) {
          tx.set(
            adminDb.collection('staff_credentials').doc(uid),
            {
              uid,
              ...nextHash,
              provisioningState: 'ACTIVE',
              failedAttempts: 0,
              lockedUntil: null,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        }
      });

      if (validatedName) {
        try {
          await adminAuth.updateUser(uid, { displayName: validatedName });
        } catch {
          // non-fatal
        }
      }

      await recordAuthAuditLog(adminDb, {
        userId: uid,
        username: String(finalProfile.username || ''),
        role: 'ADMINISTRADOR',
        action: 'CREDENCIAIS_ALTERADAS',
        details: `Administrador atualizou suas próprias credenciais (@${String(finalProfile.username || '')}) preservando cargo e permissões.`,
      });

      res.json({
        success: true,
        message: 'Credenciais atualizadas com sucesso! Seu cargo e permissões de Administrador foram preservados.',
        user: sanitizeUserProfileForResponse(finalProfile),
      });
    } catch (err: unknown) {
      if (err instanceof AuthHttpError) {
        res.status(err.statusCode).json({ success: false, code: err.code, message: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao atualizar credenciais: ${msg}` });
    }
  });

  // =========================================================================
  // 12. POST /api/auth/admin-recovery (Emergency Server-Only Recovery — Zero Gmail)
  // =========================================================================
  app.post(['/api/auth/admin-recovery', '/auth/admin-recovery'], async (req: Request, res: Response) => {
    const ip = extractClientIp(req);
    const rate = recoveryIpLimiter.checkAndConsume(`recovery:${ip}`);
    if (!rate.allowed) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        retryAfterSeconds: rate.retryAfterSeconds,
        message: `Muitas tentativas de recuperação. Aguarde ${rate.retryAfterSeconds}s.`,
      });
      return;
    }

    const configuredRecoveryKey = (process.env.ADMIN_RECOVERY_KEY || '').trim();
    if (!configuredRecoveryKey || configuredRecoveryKey.length < 16) {
      res.status(503).json({
        success: false,
        code: 'RECOVERY_DISABLED',
        message: 'Recuperação emergencial de administrador não está habilitada no servidor.',
      });
      return;
    }

    const services = requireAdminSdk(res);
    if (!services) return;
    const { adminDb, adminAuth } = services;

    const providedKey = typeof req.body?.recoveryKey === 'string' ? req.body.recoveryKey.trim() : '';
    if (!timingSafeStringEqual(providedKey, configuredRecoveryKey)) {
      await recordAuthAuditLog(adminDb, {
        username: String(req.body?.currentUsername || 'admin_recovery'),
        action: 'RECUPERACAO_ADMIN_FALHA',
        details: `Tentativa de recuperação emergencial com chave inválida (IP: ${ip}).`,
      });
      res.status(403).json({
        success: false,
        code: 'INVALID_RECOVERY_KEY',
        message: 'Chave de recuperação inválida.',
      });
      return;
    }

    const passRes = validatePasswordStrength(req.body?.newPassword, 'Nova senha');
    if (!passRes.valid || !passRes.value) {
      res.status(400).json({ success: false, code: 'INVALID_PASSWORD', message: passRes.error });
      return;
    }

    let nextUsernameValidated: string | undefined;
    if (req.body?.newUsername !== undefined && String(req.body.newUsername).trim() !== '') {
      const nuRes = validateAndNormalizeUsername(req.body.newUsername);
      if (!nuRes.valid || !nuRes.value) {
        res.status(400).json({ success: false, code: 'INVALID_USERNAME', message: nuRes.error });
        return;
      }
      nextUsernameValidated = nuRes.value;
    }

    let createdMissingAuthUser = false;
    let targetUid = '';

    try {
      const adminsSnap = await adminDb.collection('users').where('role', '==', 'ADMINISTRADOR').get();
      const admins: Array<Record<string, unknown> & { id: string }> = [];
      adminsSnap.forEach((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        if (d && isUserActiveProvisioned(d)) {
          admins.push({ ...d, id: docSnap.id });
        }
      });

      if (admins.length === 0) {
        res.status(404).json({
          success: false,
          code: 'ADMIN_NOT_FOUND',
          message: 'Nenhum administrador cadastrado para recuperação.',
        });
        return;
      }

      const rawTargetUid =
        typeof req.body?.targetUid === 'string' ? req.body.targetUid.trim() : '';
      const rawCurrentUsername =
        typeof req.body?.currentUsername === 'string' ? req.body.currentUsername.trim().toLowerCase() : '';

      let targetAdmin: (Record<string, unknown> & { id: string }) | undefined;
      if (rawTargetUid) {
        targetAdmin = admins.find((a) => a.id === rawTargetUid);
        if (!targetAdmin) {
          res.status(404).json({
            success: false,
            code: 'ADMIN_NOT_FOUND',
            message: 'Administrador informado pelo UID não encontrado para recuperação.',
          });
          return;
        }
        if (
          rawCurrentUsername &&
          String(targetAdmin.username || '').trim().toLowerCase() !== rawCurrentUsername
        ) {
          res.status(404).json({
            success: false,
            code: 'ADMIN_NOT_FOUND',
            message: 'O UID e o nome de login atual informados não correspondem ao mesmo administrador.',
          });
          return;
        }
      } else if (rawCurrentUsername) {
        const matchingByUsername = admins.filter(
          (a) => String(a.username || '').trim().toLowerCase() === rawCurrentUsername
        );
        if (matchingByUsername.length === 0) {
          res.status(404).json({
            success: false,
            code: 'ADMIN_NOT_FOUND',
            message: 'Administrador informado não encontrado para recuperação.',
          });
          return;
        }
        if (matchingByUsername.length > 1) {
          res.status(400).json({
            success: false,
            code: 'ADMIN_TARGET_AMBIGUOUS',
            message: 'Existem múltiplos administradores com este nome de login. Informe o targetUid exato para recuperação.',
          });
          return;
        }
        targetAdmin = matchingByUsername[0];
      } else {
        const activeAdmins = admins.filter(
          (a) => String(a.status || 'ATIVO').trim().toUpperCase() === 'ATIVO'
        );
        if (activeAdmins.length === 0) {
          res.status(403).json({
            success: false,
            code: 'ACCOUNT_INACTIVE',
            message: 'Nenhuma conta administrativa ativa disponível para recuperação.',
          });
          return;
        }
        if (activeAdmins.length > 1) {
          res.status(400).json({
            success: false,
            code: 'ADMIN_TARGET_AMBIGUOUS',
            message: 'Existem múltiplos administradores ativos. Informe o targetUid exato do administrador que deseja recuperar.',
          });
          return;
        }
        targetAdmin = activeAdmins[0];
      }

      // Preserve account status: never silently reactivate blocked or disabled accounts
      const targetStatusUpper = String(targetAdmin.status || 'ATIVO').trim().toUpperCase();
      if (targetStatusUpper === 'BLOQUEADO') {
        res.status(403).json({
          success: false,
          code: 'ACCOUNT_BLOCKED',
          message: 'A conta administrativa está bloqueada e não pode ser recuperada neste estado.',
        });
        return;
      }
      if (targetStatusUpper === 'DESATIVADO') {
        res.status(403).json({
          success: false,
          code: 'ACCOUNT_DISABLED',
          message: 'A conta administrativa está desativada e não pode ser recuperada neste estado.',
        });
        return;
      }

      targetUid = targetAdmin.id;
      const existingUsernameCandidate = String(targetAdmin.username || '').trim().toLowerCase();
      const effectiveUsernameRes = validateAndNormalizeUsername(
        nextUsernameValidated || existingUsernameCandidate
      );
      if (!effectiveUsernameRes.valid || !effectiveUsernameRes.value) {
        res.status(400).json({
          success: false,
          code: 'INVALID_USERNAME',
          message:
            'A conta administrativa não possui um nome de login válido. Informe newUsername no formato permitido.',
        });
        return;
      }
      const preValidatedFinalUsername = effectiveUsernameRes.value;

      // Pre-check username ownership BEFORE mutating Firebase Auth
      const preCheckNowMs = Date.now();
      const preUsernameSnap = await adminDb
        .collection('auth_usernames')
        .doc(preValidatedFinalUsername)
        .get();
      if (preUsernameSnap.exists) {
        const owner = preUsernameSnap.data() || {};
        if (
          owner.uid !== targetUid &&
          (owner.status === 'ACTIVE' || isLeaseActive(owner.leaseExpiresAt, preCheckNowMs))
        ) {
          res.status(409).json({
            success: false,
            code: 'USERNAME_TAKEN',
            message: 'O novo nome de login escolhido já está em uso.',
          });
          return;
        }
      }

      // Compute scrypt hash prior to external Firebase Auth and Firestore writes
      const hashed = await hashPasswordScrypt(passRes.value);
      const displayName =
        typeof targetAdmin.name === 'string' && targetAdmin.name.trim()
          ? targetAdmin.name.trim()
          : undefined;

      // Stage 1 (External): Ensure Firebase Authentication user exists with the EXACT preserved UID,
      // is enabled, has ADMINISTRADOR custom claim, and has prior refresh tokens revoked.
      // Never ignore Auth errors.
      try {
        try {
          await adminAuth.updateUser(targetUid, {
            disabled: false,
            ...(displayName ? { displayName } : {}),
          });
        } catch (updateErr: unknown) {
          if (!isAuthUserNotFoundError(updateErr)) {
            throw updateErr;
          }
          try {
            await adminAuth.createUser({
              uid: targetUid,
              disabled: false,
              ...(displayName ? { displayName } : {}),
            });
            createdMissingAuthUser = true;
          } catch (createErr: unknown) {
            const createCode = String((createErr as { code?: string })?.code || '');
            if (createCode.includes('uid-already-exists')) {
              await adminAuth.updateUser(targetUid, {
                disabled: false,
                ...(displayName ? { displayName } : {}),
              });
            } else {
              throw createErr;
            }
          }
        }

        await adminAuth.setCustomUserClaims(targetUid, { role: 'ADMINISTRADOR' });
        await adminAuth.revokeRefreshTokens(targetUid);
      } catch (authSyncErr: unknown) {
        if (createdMissingAuthUser) {
          await cleanupOrphanedAuthUser(adminAuth, targetUid);
          createdMissingAuthUser = false;
        }
        const msg = authSyncErr instanceof Error ? authSyncErr.message : String(authSyncErr);
        await recordAuthAuditLog(adminDb, {
          userId: targetUid,
          username: preValidatedFinalUsername,
          role: 'ADMINISTRADOR',
          action: 'RECUPERACAO_ADMIN_FALHA',
          details: `Falha ao sincronizar conta administrativa no Firebase Auth: ${msg}`,
        });
        res.status(502).json({
          success: false,
          code: 'AUTH_SYNC_FAILED',
          message: `Falha ao sincronizar a conta administrativa no Firebase Authentication: ${msg}`,
        });
        return;
      }

      // Stage 2 (Firestore Transaction): Atomically and idempotently ensure
      // users/{uid}, auth_usernames/{finalUsername}, staff_credentials/{uid}, and configs/auth_setup.
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      let recoveredProfile: Record<string, unknown> = {};

      try {
        await adminDb.runTransaction(async (tx) => {
          const userRef = adminDb.collection('users').doc(targetUid);
          const setupRef = adminDb.collection('configs').doc('auth_setup');
          const credRef = adminDb.collection('staff_credentials').doc(targetUid);

          const [userSnap, setupSnap, credSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(setupRef),
            tx.get(credRef),
          ]);

          if (!userSnap.exists) {
            throw new AuthHttpError(404, 'ADMIN_NOT_FOUND', 'Administrador não encontrado.');
          }

          const current = (userSnap.data() || {}) as Record<string, unknown>;
          if (
            String(current.role || '').trim().toUpperCase() !== 'ADMINISTRADOR' ||
            !isUserActiveProvisioned(current)
          ) {
            throw new AuthHttpError(
              403,
              'ADMIN_STATE_INVALID',
              'A conta selecionada não é um administrador ativo válido.'
            );
          }

          const txStatusUpper = String(current.status || 'ATIVO').trim().toUpperCase();
          if (txStatusUpper === 'BLOQUEADO') {
            throw new AuthHttpError(
              403,
              'ACCOUNT_BLOCKED',
              'A conta administrativa está bloqueada e não pode ser recuperada neste estado.'
            );
          }
          if (txStatusUpper === 'DESATIVADO') {
            throw new AuthHttpError(
              403,
              'ACCOUNT_DISABLED',
              'A conta administrativa está desativada e não pode ser recuperada neste estado.'
            );
          }

          const oldUsername = String(current.username || '').trim().toLowerCase();
          const finalUsernameRes = validateAndNormalizeUsername(
            nextUsernameValidated || oldUsername
          );
          if (!finalUsernameRes.valid || !finalUsernameRes.value) {
            throw new AuthHttpError(
              400,
              'INVALID_USERNAME',
              'A conta administrativa não possui um nome de login válido. Informe newUsername no formato permitido.'
            );
          }
          const finalUsername = finalUsernameRes.value;

          const finalUsernameRef = adminDb.collection('auth_usernames').doc(finalUsername);
          const oldUsernameRef =
            oldUsername && oldUsername !== finalUsername
              ? adminDb.collection('auth_usernames').doc(oldUsername)
              : null;

          // All Firestore transaction reads strictly before writes
          const [finalUsernameSnap, oldUsernameSnap] = await Promise.all([
            tx.get(finalUsernameRef),
            oldUsernameRef ? tx.get(oldUsernameRef) : Promise.resolve(null),
          ]);

          if (finalUsernameSnap.exists) {
            const owner = finalUsernameSnap.data() || {};
            if (
              owner.uid !== targetUid &&
              (owner.status === 'ACTIVE' || isLeaseActive(owner.leaseExpiresAt, nowMs))
            ) {
              throw new AuthHttpError(
                409,
                'USERNAME_TAKEN',
                'O novo nome de login escolhido já está em uso.'
              );
            }
          }

          // Release previous username mapping only if rotating to a different username owned by targetUid
          if (oldUsernameRef && oldUsernameSnap && oldUsernameSnap.exists) {
            if (oldUsernameSnap.data()?.uid === targetUid) {
              tx.delete(oldUsernameRef);
            }
          }

          // ALWAYS guarantee auth_usernames/{finalUsername} is ACTIVE (even when username stayed unchanged)
          const existingUsernameDoc = finalUsernameSnap.exists ? (finalUsernameSnap.data() || {}) : {};
          tx.set(finalUsernameRef, {
            username: finalUsername,
            uid: targetUid,
            status: 'ACTIVE',
            createdAt:
              typeof existingUsernameDoc.createdAt === 'string' && existingUsernameDoc.createdAt.trim()
                ? existingUsernameDoc.createdAt
                : nowIso,
            updatedAt: nowIso,
          });

          // Preserve existing permissions and profile metadata while guaranteeing full admin permissions
          const existingModules = Array.isArray(current.allowedModules)
            ? current.allowedModules.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
            : [];
          const preservedModules = Array.from(new Set([...OFFICIAL_APP_MODULES, ...existingModules]));

          const existingDeliveryPerms =
            current.deliveryPermissions && typeof current.deliveryPermissions === 'object'
              ? (current.deliveryPermissions as Record<string, unknown>)
              : {};
          const preservedDeliveryPermissions = {
            ...existingDeliveryPerms,
            ...FULL_ADMIN_DELIVERY_PERMISSIONS,
          };

          recoveredProfile = {
            ...current,
            id: targetUid,
            firebaseUid: targetUid,
            username: finalUsername,
            role: 'ADMINISTRADOR',
            status: txStatusUpper,
            authProvider: 'firebase_custom_token',
            provisioningState: 'ACTIVE',
            allowedModules: preservedModules,
            deliveryPermissions: preservedDeliveryPermissions,
            updatedAt: nowIso,
          };

          tx.set(userRef, recoveredProfile, { merge: true });

          const existingCred = credSnap.exists ? (credSnap.data() || {}) : {};
          tx.set(
            credRef,
            {
              uid: targetUid,
              ...hashed,
              provisioningState: 'ACTIVE',
              failedAttempts: 0,
              lockedUntil: null,
              createdAt:
                typeof existingCred.createdAt === 'string' && existingCred.createdAt.trim()
                  ? existingCred.createdAt
                  : nowIso,
              updatedAt: nowIso,
            },
            { merge: true }
          );

          // ALWAYS consolidate configs/auth_setup so bootstrap-status and setup state stay consistent
          const existingSetup = setupSnap.exists ? (setupSnap.data() || {}) : {};
          const existingInitialAdminUid =
            typeof existingSetup.initialAdminUid === 'string' && existingSetup.initialAdminUid.trim()
              ? existingSetup.initialAdminUid.trim()
              : targetUid;

          tx.set(
            setupRef,
            {
              ...existingSetup,
              status: 'COMPLETED',
              stage: 'COMPLETED',
              initialized: true,
              initialAdminUid: existingInitialAdminUid,
              recoveredAdminUid: targetUid,
              username:
                existingInitialAdminUid === targetUid
                  ? finalUsername
                  : typeof existingSetup.username === 'string' && existingSetup.username.trim()
                    ? existingSetup.username
                    : finalUsername,
              completedAt:
                typeof existingSetup.completedAt === 'string' && existingSetup.completedAt.trim()
                  ? existingSetup.completedAt
                  : nowIso,
              lastRecoveredAt: nowIso,
              updatedAt: nowIso,
            },
            { merge: true }
          );
        });
      } catch (txErr: unknown) {
        if (createdMissingAuthUser && targetUid) {
          await cleanupOrphanedAuthUser(adminAuth, targetUid);
          createdMissingAuthUser = false;
        }
        throw txErr;
      }

      await recordAuthAuditLog(adminDb, {
        userId: targetUid,
        username: String(recoveredProfile.username || ''),
        role: 'ADMINISTRADOR',
        action: 'RECUPERACAO_ADMIN',
        details: `Recuperação administrativa concluída com sucesso para @${String(recoveredProfile.username || '')}.`,
      });

      res.json({
        success: true,
        message: 'Acesso administrativo recuperado com sucesso! Remova ou rotacione ADMIN_RECOVERY_KEY após entrar.',
        user: sanitizeUserProfileForResponse(recoveredProfile),
      });
    } catch (err: unknown) {
      if (err instanceof AuthHttpError) {
        res.status(err.statusCode).json({ success: false, code: err.code, message: err.message });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro na recuperação administrativa: ${msg}` });
    }
  });

  // =========================================================================
  // 13. POST /api/auth/sync-profile (Hardened Read-Only Transitional Lookup)
  // Never auto-creates accounts, never uses Gmail/email elevation.
  // =========================================================================
  app.post(['/api/auth/sync-profile', '/auth/sync-profile'], async (req: Request, res: Response) => {
    try {
      const auth = await deps.verifyStaffAuth(req);
      if (!auth.uid || !auth.token) {
        res.status(401).json({ success: false, message: 'Token Firebase inválido ou ausente.' });
        return;
      }
      if (!auth.isStaff) {
        res.status(403).json({
          success: false,
          message: 'Conta autenticada não pertence à equipe autorizada ou está inativa.',
        });
        return;
      }

      const { adminDb } = deps.getAdminServices();
      if (adminDb) {
        const uidSnap = await adminDb.collection('users').doc(auth.uid).get();
        if (uidSnap.exists) {
          const profile = (uidSnap.data() || {}) as Record<string, unknown>;
          if (!isUserActiveProvisioned(profile)) {
            res.status(403).json({
              success: false,
              code: 'PROVISIONING_INCOMPLETE',
              message: 'Conta com provisionamento pendente.',
            });
            return;
          }
          res.json({ success: true, profile: sanitizeUserProfileForResponse({ ...profile, id: auth.uid }) });
          return;
        }
      }

      res.status(404).json({
        success: false,
        message: 'Perfil de colaborador não localizado em /users/{uid}.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: `Erro ao consultar perfil: ${msg}` });
    }
  });
}
