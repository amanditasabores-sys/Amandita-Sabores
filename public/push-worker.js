// Web Push Background Event Listener for Amandita Sabores
// Receives push events when the device/browser is in background or closed
self.addEventListener('push', function (event) {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (err) {
    payload = { title: 'Novo Pedido Recebido!', body: event.data.text() };
  }

  const title = payload.title || 'Amandita Sabores - Novo Pedido!';
  const options = {
    body: payload.body || 'Um novo pedido acabou de entrar no sistema.',
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/favicon-32x32.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: payload.tag || ('order-' + (payload.orderId || Date.now())),
    renotify: true,
    data: {
      url: payload.url || '/?view=producao',
      orderId: payload.orderId || '',
      timestamp: Date.now()
    },
    actions: [
      { action: 'open_kds', title: 'Ver na Cozinha' },
      { action: 'close', title: 'Dispensar' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
