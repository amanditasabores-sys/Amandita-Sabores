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
      const isReady = eventType === 'READY_FOR_DELIVERY';

      let title = payload.title;
      if (!title) {
        if (isDelivery) {
          title = 'Entrega Concluída!';
        } else if (isReady) {
          title = 'Pedido pronto para entrega!';
        } else {
          title = 'Amandita Sabores - Novo Pedido!';
        }
      }

      let body = payload.body;
      if (!body) {
        if (isDelivery) {
          body = 'O pedido foi entregue com sucesso.';
        } else if (isReady) {
          body = 'O pedido está pronto na cozinha para retirada e entrega.';
        } else {
          body = 'Um novo pedido acabou de entrar no sistema.';
        }
      }

      let defaultUrl = '/?view=producao';
      if (isDelivery) {
        defaultUrl = '/?view=admin';
      } else if (isReady) {
        defaultUrl = payload.orderId ? `/?view=entregador&pedido=${payload.orderId}` : '/?view=entregador';
      }

      const options = {
        body,
        icon: payload.icon || '/pwa-192x192.png',
        badge: payload.badge || '/favicon-32x32.png',
        vibrate: isReady ? [250, 100, 250, 100, 250] : isDelivery ? [200, 100, 200] : [300, 100, 300, 100, 300],
        tag: payload.tag || ((isReady ? 'ready-' : isDelivery ? 'deliv-' : 'order-') + (payload.orderId || Date.now())),
        renotify: true,
        requireInteraction: true, // Mantém notificação visível na tela de bloqueio até interação
        silent: false,
        timestamp: payload.timestamp || Date.now(),
        data: {
          url: payload.url || defaultUrl,
          orderId: payload.orderId || '',
          event: eventType,
          timestamp: payload.timestamp || Date.now(),
        },
        actions: isDelivery
          ? [
              { action: 'open_orders', title: 'Ver Pedidos' },
              { action: 'close', title: 'Dispensar' }
            ]
          : isReady
          ? [
              { action: 'open_driver', title: 'Ver Entrega' },
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
