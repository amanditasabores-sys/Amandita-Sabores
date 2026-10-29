import { useEffect, useState } from 'react';

export function usePushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator) {
      setIsSupported(true);
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async (): Promise<NotificationPermission> => {
    if (!isSupported) return 'denied';
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch (err) {
      console.warn('[Push] Erro ao solicitar permissão de notificação:', err);
      return 'denied';
    }
  };

  const showLocalNotification = async (title: string, options?: NotificationOptions) => {
    if (!isSupported || permission !== 'granted') return false;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, {
          icon: '/pwa-192x192.png',
          badge: '/favicon-32x32.png',
          ...options,
        });
        return true;
      } else {
        new Notification(title, {
          icon: '/pwa-192x192.png',
          ...options,
        });
        return true;
      }
    } catch (err) {
      console.warn('[Push] Erro ao disparar notificação local:', err);
      return false;
    }
  };

  return {
    isSupported,
    permission,
    isGranted: permission === 'granted',
    requestPermission,
    showLocalNotification,
  };
}
