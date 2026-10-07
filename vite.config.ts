import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Inject indexing + canonical placeholders into index.html from env. */
function htmlSeoEnvPlugin(env: Record<string, string>): Plugin {
  const allowIndexing = env.VITE_ALLOW_INDEXING === 'true'
  const siteUrl = (env.VITE_SITE_URL || '').replace(/\/$/, '')
  const canonical = siteUrl || 'https://park-tallinn.local'
  const ogImage = `${canonical}/og-image.png`
  const robots = allowIndexing ? 'index, follow' : 'noindex, nofollow'

  return {
    name: 'html-seo-env',
    transformIndexHtml(html) {
      return html
        .replaceAll('__SEO_ROBOTS__', robots)
        .replaceAll('__SEO_CANONICAL__', canonical)
        .replaceAll('__SEO_OG_IMAGE__', ogImage)
    },
  }
}

/**
 * Dev-only GET/POST /api/reports — mirrors api/reports.js for Vite.
 * Production uses the Vercel serverless function.
 */
function communityReportsApiPlugin(): Plugin {
  const TTL_MS = 60 * 60 * 1000
  type Row = {
    spotId: string
    isFull: boolean
    lat?: number
    lng?: number
    until: number
  }
  const store = new Map<string, Row>()

  const prune = (now = Date.now()) => {
    for (const [id, row] of store) {
      if (row.until <= now) store.delete(id)
    }
  }

  const listActive = (now = Date.now()) => {
    prune(now)
    return [...store.values()]
      .filter((r) => r.isFull)
      .map((r) => ({
        spotId: r.spotId,
        isFull: true as const,
        lat: r.lat,
        lng: r.lng,
        until: r.until,
      }))
  }

  const readBody = async (req: {
    on: (ev: string, cb: (chunk?: unknown) => void) => void
  }): Promise<unknown> =>
    new Promise((resolve) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)))
      })
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw) {
          resolve(null)
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve(null)
        }
      })
    })

  return {
    name: 'community-reports-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url !== '/api/reports') {
          next()
          return
        }

        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method === 'GET') {
          send(200, { success: true, reports: listActive() })
          return
        }

        if (req.method === 'POST') {
          const body = (await readBody(req as never)) as Record<
            string,
            unknown
          > | null
          const spotId = String(body?.spotId ?? body?.id ?? '').trim()
          if (!spotId) {
            send(400, { success: false, message: 'Vigane päring' })
            return
          }
          const isFull = body?.isFull !== false
          const now = Date.now()
          if (!isFull) {
            store.delete(spotId)
          } else {
            store.set(spotId, {
              spotId,
              isFull: true,
              lat:
                typeof body?.lat === 'number' && Number.isFinite(body.lat)
                  ? body.lat
                  : undefined,
              lng:
                typeof body?.lng === 'number' && Number.isFinite(body.lng)
                  ? body.lng
                  : undefined,
              until: now + TTL_MS,
            })
          }
          send(200, { success: true, reports: listActive(now) })
          return
        }

        send(405, { success: false, message: 'Method not allowed' })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Server-only secrets (no VITE_ prefix — never exposed to the browser)
  const env = loadEnv(mode, process.cwd(), '')
  const n8nWebhookUrl = env.N8N_WEBHOOK_URL || ''
  const n8nApiKey = env.N8N_API_KEY || ''

  let n8nOrigin = ''
  let n8nPath = '/webhook/parkimine'
  try {
    if (n8nWebhookUrl) {
      const u = new URL(n8nWebhookUrl)
      n8nOrigin = u.origin
      n8nPath = u.pathname || n8nPath
    }
  } catch {
    /* keep empty when URL is missing/invalid during setup */
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      htmlSeoEnvPlugin(env),
      communityReportsApiPlugin(),
    ],
    worker: {
      format: 'es',
    },
    optimizeDeps: {
      exclude: ['maplibre-gl'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/maplibre-gl')) return 'maplibre'
            if (id.includes('node_modules/@turf')) return 'turf'
            if (id.includes('node_modules/zod')) return 'zod'
            return undefined
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 43127,
      strictPort: true,
      // Allow Cloudflare quick-tunnel / forwarded preview hosts
      allowedHosts: true,
      proxy: {
        // Nominatim has no browser CORS — proxy in dev
        '/api/nominatim': {
          target: 'https://nominatim.openstreetmap.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/nominatim/, ''),
          headers: {
            'User-Agent': 'ParkTallinn/1.0 (parking-map)',
          },
        },
        // In-AKS (Maa-amet) gazetteer reverse geocoding
        '/api/inaks': {
          target: 'https://aks.geoportaal.ee',
          changeOrigin: true,
          rewrite: (path) =>
            path.replace(/^\/api\/inaks/, '/inaks/inaadress'),
          headers: {
            'User-Agent': 'ParkTallinn/1.0 (parking-map; address-resolution)',
            Accept: 'application/json',
            Referer: 'https://aks.geoportaal.ee/',
          },
        },
        // OSRM public router (no API key) — avoid browser CORS
        // Fallback car profile only (project-osrm has no foot instance)
        '/api/osrm': {
          target: 'https://router.project-osrm.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/osrm/, ''),
        },
        // OSM-hosted car router (primary driving)
        '/api/route-car': {
          target: 'https://routing.openstreetmap.de',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/route-car/, '/routed-car'),
        },
        // OSM-hosted foot router (pedestrian shortcuts / park paths)
        '/api/route-foot': {
          target: 'https://routing.openstreetmap.de',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/route-foot/, '/routed-foot'),
        },
        // n8n parking session webhook — inject Header Auth from server env
        '/api/parkimine': {
          target: n8nOrigin || 'http://127.0.0.1',
          changeOrigin: true,
          rewrite: () => n8nPath,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (n8nApiKey) {
                proxyReq.setHeader('X-N8N-API-KEY', n8nApiKey)
              }
              proxyReq.setHeader('Content-Type', 'application/json')
            })
          },
        },
      },
    },
  }
})
