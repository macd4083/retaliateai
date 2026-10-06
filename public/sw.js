function notificationUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/today', self.location.origin);
    if (url.origin !== self.location.origin || !['http:', 'https:'].includes(url.protocol)
      || url.pathname.startsWith('//')) return '/today';
    // Normalize payloads queued by the previous reflection reminder producers.
    if (url.pathname.toLowerCase().replace(/\/+$/, '') === '/reflection') return '/today';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/today';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    // An old or malformed payload still opens a safe daily review.
  }
  const legacyReminder = typeof data.url === 'string' && /\/reflection(?:[/?#]|$)/i.test(data.url);
  const title = legacyReminder ? 'Retaliate AI' : data.title || 'Retaliate AI';
  const options = {
    body: legacyReminder ? 'Review today and prepare tomorrow.' : data.body || 'Review today and prepare tomorrow.',
    icon: '/android-chrome2-192x192.png',
    badge: '/favicon2-32x32.png',
    data: { url: notificationUrl(data.url) },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data?.url);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
