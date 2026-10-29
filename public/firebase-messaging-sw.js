// Firebase Cloud Messaging & Web Push Service Worker for Amandita Sabores
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');
importScripts('/push-worker.js');

try {
  // Configured with standard Amandita Sabores project sender ID
  firebase.initializeApp({
    messagingSenderId: '630521361717',
    projectId: 'amandita-sabores'
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(function (payload) {
    const title = payload.notification?.title || payload.data?.title || 'Amandita Sabores - Novo Pedido!';
    const options = {
      body: payload.notification?.body || payload.data?.body || 'Novo pedido recebido no sistema.',
      icon: '/pwa-192x192.png',
      badge: '/favicon-32x32.png',
      tag: payload.data?.orderId ? 'order-' + payload.data.orderId : 'order-' + Date.now(),
      vibrate: [200, 100, 200, 100, 200],
      data: {
        url: payload.data?.url || '/?view=producao',
        orderId: payload.data?.orderId || ''
      }
    };
    return self.registration.showNotification(title, options);
  });
} catch (err) {
  console.info('[FCM SW] Service Worker ativo com suporte a Web Push padrão:', err);
}
