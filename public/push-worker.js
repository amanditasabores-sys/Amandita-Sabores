// Web Push Background Event Listener for Amandita Sabores
// Receives push events when the device/browser is in background or closed
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  event.waitUntil(
    (async function () {
      let payload = {};
      if (event.data) {
        try {
          payload = event.data.json();
        } catch (err) {
          payload = { title: 'Notificação Amandita Sabores', body: event.data.text() };
        }
      }

      const eventType = payload.eventType || payload.event || 'NEW_ORDER';
      const isDelivery = eventType === 'DELIVERY_CONFIRMED';
      const title = payload.title || (isDelivery ? 'Entrega Concluída!' : 'Amandita Sabores - Novo Pedido!');
      const options = {
        body: payload.body || (isDelivery ? 'O pedido foi entregue com sucesso.' : 'Um novo pedido acabou de entrar no sistema.'),
        icon: payload.icon || '/pwa-192x192.png',
        badge: payload.badge || '/favicon-32x32.png',
        vibrate: isDelivery ? [200, 100, 200] : [300, 100, 300, 100, 300],
        tag: payload.tag || ((isDelivery ? 'deliv-' : 'order-') + (payload.orderId || Date.now())),
        renotify: true,
        requireInteraction: true, // Mantém notificação visível na tela de bloqueio até interação
        silent: false,
        timestamp: payload.timestamp || Date.now(),
        data: {
          url: payload.url || (isDelivery ? '/?view=admin' : '/?view=producao'),
          orderId: payload.orderId || '',
          event: eventType,
          timestamp: payload.timestamp || Date.now(),
        },
        actions: isDelivery
          ? [
              { action: 'open_orders', title: 'Ver Pedidos' },
              { action: 'close', title: 'Dispensar' }
            ]
          : [
              { action: 'open_kds', title: 'Ver na Cozinha' },
              { action: 'close', title: 'Dispensar' }
            ]
      };

      await self.registration.showNotification(title, options);
    })()
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  if (event.action === 'close') return;

  const targetUrl = (event.notification.data && event.notification.data.url) || '/?view=producao';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('focus' in client) {
          if ('navigate' in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
