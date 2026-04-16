self.addEventListener('push', (event) => {
  const fallback = {
    title: 'Nueva solicitud de dominio',
    body: 'Hay una solicitud pendiente',
    data: { url: '/dominios' },
    actions: [{ action: 'approve', title: 'Aprobar' }],
  };
  const payload = event.data ? event.data.json() : fallback;
  const title = payload.title || fallback.title;
  const options = {
    body: payload.body || fallback.body,
    icon: payload.icon || '/icons/android-chrome-192x192.png',
    badge: payload.badge || '/icons/badge-96x96.png',
    data: payload.data || fallback.data,
    actions: payload.actions || fallback.actions,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const requestId = data.requestId;
  const targetUrl = data.url || '/dominios';

  if (event.action === 'approve' && requestId) {
    event.waitUntil(
      fetch('/cp/notification-actions/domain-request/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ requestId }),
      })
        .then((response) => {
          const suffix = response.ok
            ? `?approved=${encodeURIComponent(requestId)}`
            : `?action=login&request=${encodeURIComponent(requestId)}`;
          return clients.openWindow(`/dominios${suffix}`);
        })
        .catch(() => clients.openWindow(targetUrl))
    );
    return;
  }

  event.waitUntil(clients.openWindow(targetUrl));
});
