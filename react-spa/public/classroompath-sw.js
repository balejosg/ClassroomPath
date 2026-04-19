self.addEventListener('push', (event) => {
  const fallback = {
    title: 'Nueva solicitud de dominio',
    body: 'Hay una solicitud pendiente',
    data: { url: '/dominios' },
    actions: [{ action: 'approve', title: 'Aprobar' }],
  };
  const payload = event.data ? event.data.json() : fallback;
  const title = payload.title || fallback.title;
  const supportsActions = typeof Notification !== 'undefined' && Notification.maxActions > 0;
  const options = {
    body: payload.body || fallback.body,
    icon: payload.icon || '/icons/android-chrome-192x192.png',
    badge: payload.badge || '/icons/badge-96x96.png',
    data: payload.data || fallback.data,
    actions: supportsActions ? payload.actions || fallback.actions : [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

function resolveInternalPath(candidate, fallback) {
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback;
  }

  return candidate;
}

function buildLoginPath(nextPath) {
  return `/login?next=${encodeURIComponent(resolveInternalPath(nextPath, '/dominios'))}`;
}

async function openClientWindow(path) {
  const targetPath = resolveInternalPath(path, '/dominios');
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => {
    try {
      return new URL(client.url).pathname === targetPath.split('?')[0];
    } catch {
      return false;
    }
  });

  if (existing?.navigate) {
    await existing.navigate(targetPath);
    if (existing.focus) {
      await existing.focus();
    }
    return;
  }

  if (existing?.focus) {
    await existing.focus();
    return;
  }

  await clients.openWindow(targetPath);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const requestId = data.requestId;
  const targetUrl = data.url || '/dominios';
  const approvalUrl =
    data.approvalUrl || (requestId ? `/dominios/aprobar/${requestId}` : targetUrl);

  if (event.action === 'approve' && requestId) {
    event.waitUntil(
      fetch('/cp/notification-actions/domain-request/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ requestId }),
      })
        .then((response) => {
          if (response.ok) {
            return openClientWindow(`/dominios?approved=${encodeURIComponent(requestId)}`);
          }

          return openClientWindow(buildLoginPath(approvalUrl));
        })
        .catch(() => openClientWindow(approvalUrl))
    );
    return;
  }

  event.waitUntil(openClientWindow(approvalUrl));
});
