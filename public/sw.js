/* Tallinna parkimine — push + notification click */
/* eslint-disable no-undef */

self.addEventListener('push', (event) => {
  let payload = { title: 'Tallinna parkimine', body: '', url: '/' }
  try {
    if (event.data) {
      const data = event.data.json()
      if (data && typeof data === 'object') {
        payload = {
          title:
            typeof data.title === 'string' && data.title.trim()
              ? data.title
              : payload.title,
          body: typeof data.body === 'string' ? data.body : '',
          url:
            typeof data.url === 'string' && data.url.trim() ? data.url : '/',
        }
      }
    }
  } catch {
    try {
      const text = event.data && event.data.text()
      if (text) payload.body = String(text)
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
      icon: '/icon-192.png',
      badge: '/favicon-32x32.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw =
    (event.notification.data && event.notification.data.url) || '/'
  let targetUrl = '/'
  try {
    targetUrl = new URL(raw, self.location.origin).href
  } catch {
    targetUrl = self.location.origin + '/'
  }

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of allClients) {
        if ('focus' in client) {
          try {
            if ('navigate' in client && client.url !== targetUrl) {
              await client.navigate(targetUrl)
            }
          } catch {
            /* navigate may fail on older browsers */
          }
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return undefined
    })(),
  )
})
