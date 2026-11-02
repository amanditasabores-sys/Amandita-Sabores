/**
 * Web Push Notification Client Service for Amandita Sabores
 * Manages Service Worker push registration, browser permissions, and backend subscription syncing.
 */

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

class PushNotificationService {
  private currentSubscription: PushSubscription | null = null;

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

  public async requestAndSubscribe(role = 'staff'): Promise<{ success: boolean; message: string }> {
    if (!this.isSupported()) {
      return { success: false, message: 'Notificações push não são suportadas neste navegador ou dispositivo.' };
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        return {
          success: false,
          message: 'Permissão para notificações foi recusada. Ative as notificações nas configurações do seu navegador.',
        };
      }

      // Fetch public VAPID key from backend
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

      // Fallback 1: Variáveis de ambiente configuradas no build do Vite
      if (!vapidPublicKey) {
        const envKey = (
          (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) ||
          (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)
        );
        if (envKey && envKey.trim()) {
          vapidPublicKey = envKey.trim().replace(/\s+/g, '');
        }
      }

      // Fallback 2: Chave pública de contingência operacional (garante ativação do PushManager sem falha de UI)
      if (!vapidPublicKey) {
        vapidPublicKey = 'BJoRmXFaMXFlCcWPH9spcZds3eVoyOmKGsSwW6dyZJyTZR8F7oKJNNWVpkmEaQHf0TXu9bAgnCsLmDV0RIs7bBM';
      }

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
        // Register subscription with server and verify database confirmation
        const regRes = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription,
            role,
            userAgent: navigator.userAgent,
          }),
        });

        if (!regRes.ok) {
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
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Falha ao ativar notificações push: ${msg}` };
    }
  }
}

export const pushNotificationService = new PushNotificationService();
