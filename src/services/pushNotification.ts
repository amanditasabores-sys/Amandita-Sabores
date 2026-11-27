/**
 * Web Push Notification Client Service for Amandita Sabores
 * Manages Service Worker push registration, browser permissions, and backend subscription syncing.
 */

import { getCurrentFirebaseUser } from './firebase';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const cleanBase64 = base64String.trim().replace(/\s+/g, '');
  const padding = '='.repeat((4 - (cleanBase64.length % 4)) % 4);
  const base64 = (cleanBase64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function cleanBase64Key(key: string): string {
  return key.trim().replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PushStatus {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  endpoint?: string;
}

export interface PushSubscribeOptions {
  /**
   * When true (default, e.g. manual activation by user), always syncs with backend.
   * When false (e.g. automatic background sync), skips POST /api/push/subscribe
   * if endpoint, role, VAPID key and subscription keys were already synced in this session.
   */
  forceSync?: boolean;
}

const FALLBACK_VAPID_PUBLIC_KEY =
  'BJoRmXFaMXFlCcWPH9spcZds3eVoyOmKGsSwW6dyZJyTZR8F7oKJNNWVpkmEaQHf0TXu9bAgnCsLmDV0RIs7bBM';

export class PushNotificationService {
  private currentSubscription: PushSubscription | null = null;
  private cachedVapidPublicKey: string | null = null;
  private inFlightVapidKeyPromise: Promise<string> | null = null;
  private inFlightSubscribePromise: Promise<{ success: boolean; message: string }> | null = null;
  private inFlightRole: string | null = null;
  private lastSyncedSignature: string | null = null;

  public isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  public getPermission(): NotificationPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }
    return Notification.permission;
  }

  public async getStatus(): Promise<PushStatus> {
    if (!this.isSupported()) {
      return { supported: false, permission: 'denied', subscribed: false };
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      this.currentSubscription = sub;

      return {
        supported: true,
        permission: Notification.permission,
        subscribed: Boolean(sub),
        endpoint: sub?.endpoint,
      };
    } catch {
      return {
        supported: true,
        permission: Notification.permission,
        subscribed: false,
      };
    }
  }

  private async getVapidPublicKey(): Promise<string> {
    if (this.cachedVapidPublicKey) {
      return this.cachedVapidPublicKey;
    }

    if (this.inFlightVapidKeyPromise) {
      return this.inFlightVapidKeyPromise;
    }

    const fetchPromise = (async () => {
      let vapidPublicKey = '';
      try {
        const resKey = await fetch('/api/push/vapid-key');
        if (resKey.ok) {
          const rawKeyText = await resKey.text().catch(() => '');
          if (rawKeyText && rawKeyText.trim()) {
            try {
              const data = JSON.parse(rawKeyText);
              vapidPublicKey = (data.publicKey || '').trim().replace(/\s+/g, '');
            } catch {}
          }
        }
      } catch (keyErr) {
        console.warn('[Push Service] Falha ao consultar vapid-key no servidor:', keyErr);
      }

      // Cache ONLY server-confirmed public keys in memory so transient server failures can recover later
      if (vapidPublicKey) {
        this.cachedVapidPublicKey = vapidPublicKey;
        return vapidPublicKey;
      }

      // Fallback 1: Variáveis de ambiente configuradas no build do Vite
      const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env;
      const envKey = metaEnv?.VITE_FIREBASE_VAPID_KEY || metaEnv?.VITE_VAPID_PUBLIC_KEY;
      if (envKey && envKey.trim()) {
        return envKey.trim().replace(/\s+/g, '');
      }

      // Fallback 2: Chave pública de contingência operacional (garante ativação do PushManager sem falha de UI)
      return FALLBACK_VAPID_PUBLIC_KEY;
    })();

    this.inFlightVapidKeyPromise = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      if (this.inFlightVapidKeyPromise === fetchPromise) {
        this.inFlightVapidKeyPromise = null;
      }
    }
  }

  private buildSubscriptionSignature(
    subscription: PushSubscription,
    normalizedRole: string,
    vapidPublicKey: string
  ): string {
    const subJson = typeof subscription.toJSON === 'function' ? subscription.toJSON() : null;
    const p256dh =
      subJson?.keys?.p256dh ||
      (typeof subscription.getKey === 'function'
        ? arrayBufferToBase64(subscription.getKey('p256dh'))
        : '');
    const auth =
      subJson?.keys?.auth ||
      (typeof subscription.getKey === 'function'
        ? arrayBufferToBase64(subscription.getKey('auth'))
        : '');

    return JSON.stringify({
      endpoint: subscription.endpoint || '',
      role: normalizedRole,
      vapidKey: cleanBase64Key(vapidPublicKey),
      p256dh,
      auth,
    });
  }

  public async requestAndSubscribe(
    role = 'staff',
    options?: PushSubscribeOptions
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isSupported()) {
      return { success: false, message: 'Notificações push não são suportadas neste navegador ou dispositivo.' };
    }

    const normalizedRole = (role || 'staff').trim().toUpperCase();
    const forceSync = options?.forceSync !== false;

    // Prevent concurrent executions; reuse in-flight automatic sync for the same role,
    // or wait for completion before executing a role change / explicit manual sync.
    while (this.inFlightSubscribePromise) {
      if (!forceSync && this.inFlightRole === normalizedRole) {
        return this.inFlightSubscribePromise;
      }
      await this.inFlightSubscribePromise.catch(() => null);
    }

    let runPromise!: Promise<{ success: boolean; message: string }>;
    runPromise = this.executeRequestAndSubscribe(role, normalizedRole, forceSync).finally(() => {
      if (this.inFlightSubscribePromise === runPromise) {
        this.inFlightSubscribePromise = null;
        this.inFlightRole = null;
      }
    });

    this.inFlightRole = normalizedRole;
    this.inFlightSubscribePromise = runPromise;
    return runPromise;
  }

  private async executeRequestAndSubscribe(
    role: string,
    normalizedRole: string,
    forceSync: boolean
  ): Promise<{ success: boolean; message: string }> {
    try {
      const permission =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();

      if (permission !== 'granted') {
        return {
          success: false,
          message: 'Permissão para notificações foi recusada. Ative as notificações nas configurações do seu navegador.',
        };
      }

      const vapidPublicKey = await this.getVapidPublicKey();

      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      // Check if existing subscription key differs from current server VAPID key
      if (subscription) {
        const existingKey = arrayBufferToBase64(subscription.options.applicationServerKey);
        const expectedKey = cleanBase64Key(vapidPublicKey);
        if (existingKey && expectedKey && existingKey !== expectedKey) {
          console.info('[Push Service] Chave VAPID anterior divergia da atual. Renovando inscrição para garantir entrega...');
          await subscription.unsubscribe().catch(() => {});
          subscription = null;
          this.lastSyncedSignature = null;
        }
      }

      if (!subscription) {
        const appServerKey = urlBase64ToUint8Array(vapidPublicKey);
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey as unknown as BufferSource,
        });
      }

      if (subscription) {
        this.currentSubscription = subscription;

        const currentSignature = this.buildSubscriptionSignature(
          subscription,
          normalizedRole,
          vapidPublicKey
        );

        // Skip redundant backend POST when automatic sync confirms endpoint, role, VAPID key and keys are unchanged
        if (!forceSync && this.lastSyncedSignature === currentSignature) {
          return {
            success: true,
            message: 'Notificações em segundo plano já sincronizadas para este dispositivo!',
          };
        }

        // Retrieve auth token if user is signed in to attach Bearer header
        let idToken: string | null = null;
        try {
          const user = getCurrentFirebaseUser();
          if (user) {
            idToken = await user.getIdToken();
          }
        } catch {}

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (idToken) {
          headers['Authorization'] = `Bearer ${idToken}`;
        }

        // Register subscription with server and verify database confirmation
        const regRes = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            subscription,
            role,
            userAgent: navigator.userAgent,
          }),
        });

        if (!regRes.ok) {
          if (this.lastSyncedSignature === currentSignature) {
            this.lastSyncedSignature = null;
          }
          const rawErrText = await regRes.text().catch(() => '');
          let errData: any = {};
          if (rawErrText && rawErrText.trim()) {
            try { errData = JSON.parse(rawErrText); } catch {}
          }
          return {
            success: false,
            message: errData.message || `Servidor não pôde confirmar a gravação da inscrição (HTTP ${regRes.status}).`,
          };
        }

        this.lastSyncedSignature = currentSignature;

        return {
          success: true,
          message: 'Notificações em segundo plano ativadas com sucesso para este dispositivo!',
        };
      }

      return {
        success: true,
        message: 'Permissão concedida. O dispositivo receberá alertas quando pedidos chegarem.',
      };
    } catch (err: unknown) {
      if (forceSync) {
        this.lastSyncedSignature = null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Falha ao ativar notificações push: ${msg}` };
    }
  }
}

export const pushNotificationService = new PushNotificationService();
