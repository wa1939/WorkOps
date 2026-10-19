/* Business routes deliberately remain network-only: no fetch/cache handler. */
self.addEventListener('push', (event) => {
  let notificationId = '';
  try {
    const payload = event.data ? event.data.json() : {};
    if (typeof payload.notificationId === 'string' &&
        /^[A-Za-z0-9_-]{1,128}$/.test(payload.notificationId)) {
      notificationId = payload.notificationId;
    }
  } catch {
    // A visible generic notification is still required for user-visible push.
  }
  event.waitUntil(self.registration.showNotification('WorkOps', {
    body: 'You have a new update.',
    icon: '/icons/app-192.png',
    badge: '/icons/app-192.png',
    tag: notificationId || 'departmenthub-update',
    data: { notificationId },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL('/inbox', self.location.origin).href));
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'ACTIVATE_UPDATE') return;
  event.waitUntil((async () => {
    if (!event.source || !event.source.id) return;
    const client = await self.clients.get(event.source.id);
    if (!client || new URL(client.url).origin !== self.location.origin) return;
    await self.skipWaiting();
  })());
});
