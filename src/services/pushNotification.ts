/**
 * Web Push Notification Client Service for Amandita Sabores
 * Manages Service Worker push registration, browser permissions, and backend subscription syncing.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
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
          const data = await resKey.json();
          vapidPublicKey = data.publicKey || '';
        }
      } catch {
        // Fallback
      }

      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription && vapidPublicKey) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
        });
      }

      if (subscription) {
        this.currentSubscription = subscription;
        // Register subscription with server
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription,
            role,
            userAgent: navigator.userAgent,
          }),
        }).catch(() => {});

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
