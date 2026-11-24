import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

const PWA_RELOAD_GUARD_KEY = 'amandita_pwa_last_reload_at';
const PWA_RELOAD_COOLDOWN_MS = 60_000;
const PWA_UPDATE_CHECK_MIN_INTERVAL_MS = 30_000;
const PWA_UPDATE_POLL_INTERVAL_MS = 5 * 60 * 1000;

function isUserBusyWithCriticalOperation(): boolean {
  if (typeof document === 'undefined') return false;

  // Avoid interrupting active typing/editing in forms, checkout, PDV or settings
  const active = document.activeElement as HTMLElement | null;
  if (active) {
    const tag = active.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      active.isContentEditable
    ) {
      return true;
    }
  }

  // Avoid interrupting open confirmation/edit/payment/checkout modals
  if (
    document.querySelector(
      '[role="dialog"], [aria-modal="true"], .fixed.inset-0, [data-pwa-busy="true"]'
    )
  ) {
    return true;
  }

  return false;
}

function canReloadSafelyNow(): boolean {
  try {
    const raw = window.sessionStorage.getItem(PWA_RELOAD_GUARD_KEY);
    if (raw) {
      const lastReloadAt = Number(raw);
      if (Number.isFinite(lastReloadAt) && Date.now() - lastReloadAt < PWA_RELOAD_COOLDOWN_MS) {
        return false;
      }
    }
  } catch {
    // sessionStorage may be unavailable in restricted contexts
  }
  return true;
}

function markControlledReloadTimestamp(): void {
  try {
    window.sessionStorage.setItem(PWA_RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }
}

// Register PWA Service Worker with controlled, loop-safe update handling
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const hadInitialController = Boolean(navigator.serviceWorker.controller);
  let hasTriggeredReload = false;
  let pendingUpdateReload = false;
  let needsWaitingActivation = false;
  let deferCheckTimer: ReturnType<typeof setInterval> | null = null;
  let settleReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let lastUpdateCheckAt = 0;
  let swRegistration: ServiceWorkerRegistration | null = null;
  let triggerWaitingUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;

  const stopDeferredCheck = () => {
    if (deferCheckTimer) {
      clearInterval(deferCheckTimer);
      deferCheckTimer = null;
    }
  };

  const executeControlledReload = () => {
    if (hasTriggeredReload) return;
    if (isUserBusyWithCriticalOperation()) return;
    if (!canReloadSafelyNow()) {
      console.info('[PWA] Recarga controlada já realizada recentemente; evitando loop de atualização.');
      pendingUpdateReload = false;
      needsWaitingActivation = false;
      stopDeferredCheck();
      return;
    }

    hasTriggeredReload = true;
    pendingUpdateReload = false;
    stopDeferredCheck();
    markControlledReloadTimestamp();

    if (needsWaitingActivation && triggerWaitingUpdate) {
      needsWaitingActivation = false;
      console.info('[PWA] Ativando nova versão aguardando no Service Worker...');
      triggerWaitingUpdate(true).catch(() => {
        window.location.reload();
      });
      return;
    }

    console.info('[PWA] Nova versão ativada pelo Service Worker. Recarregando aplicativo com segurança...');
    window.location.reload();
  };

  const scheduleControlledReload = () => {
    if (hasTriggeredReload) return;
    pendingUpdateReload = true;

    if (!isUserBusyWithCriticalOperation()) {
      if (settleReloadTimer) clearTimeout(settleReloadTimer);
      settleReloadTimer = setTimeout(() => {
        if (pendingUpdateReload && !isUserBusyWithCriticalOperation()) {
          executeControlledReload();
        }
      }, 400);
    }

    if (!deferCheckTimer) {
      deferCheckTimer = setInterval(() => {
        if (!pendingUpdateReload || hasTriggeredReload) {
          stopDeferredCheck();
          return;
        }
        if (!isUserBusyWithCriticalOperation()) {
          executeControlledReload();
        }
      }, 2500);
    }
  };

  const checkForSWUpdate = (force = false) => {
    if (!swRegistration) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (!force && now - lastUpdateCheckAt < PWA_UPDATE_CHECK_MIN_INTERVAL_MS) return;
    lastUpdateCheckAt = now;
    swRegistration.update().catch(() => {
      // Ignore transient offline/network errors during update check
    });
  };

  // Detect when a newly installed Service Worker replaces the previous controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadInitialController) {
      // First-time SW installation claiming an uncontrolled client: never reload
      return;
    }
    scheduleControlledReload();
  });

  triggerWaitingUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      console.info('[PWA] Nova versão do Amandita Sabores disponível. Aguardando momento seguro para atualizar...');
      needsWaitingActivation = true;
      scheduleControlledReload();
    },
    onOfflineReady() {
      console.info('[PWA] Amandita Sabores pronto para funcionamento offline e instalação!');
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        swRegistration = registration;
        console.info('[PWA] Service Worker registrado com sucesso no escopo:', registration.scope);

        // Immediately check once on startup for any newer deployed sw.js
        checkForSWUpdate(true);

        // Check when returning to the app (critical for mobile/desktop installed PWAs)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            checkForSWUpdate(false);
            if (pendingUpdateReload && !isUserBusyWithCriticalOperation()) {
              scheduleControlledReload();
            }
          }
        });

        // Check when connectivity is restored
        window.addEventListener('online', () => {
          checkForSWUpdate(false);
        });

        // Periodic background check while tab is visible and online
        setInterval(() => {
          if (document.visibilityState === 'visible') {
            checkForSWUpdate(false);
          }
        }, PWA_UPDATE_POLL_INTERVAL_MS);
      }
    },
    onRegisterError(error) {
      console.warn('[PWA] Erro ao registrar Service Worker:', error);
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);

