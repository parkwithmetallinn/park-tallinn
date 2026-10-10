/* Tallinna parkimine — push + app-shell caching */
/* eslint-disable no-undef */

const SHELL_CACHE = 'park-shell-v2'
const TILE_CACHE = 'park-tiles-v2'
const TILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

function isApiRequest(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/api/')
}

function isSameOriginAsset(url) {
  return (
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/data/')
  )
}

function isMapTileRequest(url) {
  const host = url.hostname
  if (
    host === 'tiles.openfreemap.org' ||
    host.endsWith('.openfreemap.org') ||
    host.endsWith('.tile.openstreetmap.org') ||
    host === 'tile.openstreetmap.org' ||
    host.endsWith('.maptiler.com') ||
    host.endsWith('.mapbox.com') ||
    host.endsWith('.openmaptiles.org')
  ) {
    return true
  }
  // Vector/raster tile path heuristics
  if (/\.(pbf|mvt)(\?|$)/i.test(url.pathname)) return true
  if (/\/\d+\/\d+\/\d+(\.png|\.jpg|\.webp)?$/i.test(url.pathname)) return true
  return false
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        void cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => null)
  if (cached) {
    void networkPromise
    return cached
  }
  const network = await networkPromise
  if (network) return network
  return new Response('Offline', { status: 503, statusText: 'Offline' })
}

async function cacheTiles(request) {
  const cache = await caches.open(TILE_CACHE)
  const cached = await cache.match(request)
  if (cached) {
    const cachedAt = Number(cached.headers.get('sw-cached-at') || 0)
    if (cachedAt && Date.now() - cachedAt < TILE_MAX_AGE_MS) {
      return cached
    }
  }
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      const headers = new Headers(response.headers)
      headers.set('sw-cached-at', String(Date.now()))
      const body = await response.clone().arrayBuffer()
      await cache.put(
        request,
        new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
      )
    }
    return response
  } catch {
    if (cached) return cached
    return new Response('', { status: 504, statusText: 'Tile offline' })
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      try {
        await cache.addAll(PRECACHE_URLS)
      } catch {
        /* precache best-effort */
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Never cache API
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ ok: false, message: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          }),
      ),
    )
    return
  }

  // Map tiles / vector tiles — max 7 days
  if (isMapTileRequest(url)) {
    event.respondWith(cacheTiles(request))
    return
  }

  // App shell + same-origin static: stale-while-revalidate
  if (request.mode === 'navigate' || isSameOriginAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE))
  }
})

/* ——— Push (do not break) ——— */
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
