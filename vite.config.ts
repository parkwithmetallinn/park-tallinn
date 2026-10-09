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
 * Dev serverless shims for /api/* handlers under api/*.ts (same as Vercel).
 * Server-only env: SUPABASE_*, REPORT_SALT, INTERNAL_SECRET — never VITE_*.
 */
function localApiPlugin(env: Record<string, string>): Plugin {
  if (env.SUPABASE_URL) {
    process.env.SUPABASE_URL = env.SUPABASE_URL
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
  }
  if (env.REPORT_SALT) {
    process.env.REPORT_SALT = env.REPORT_SALT
  }
  if (env.INTERNAL_SECRET) {
    process.env.INTERNAL_SECRET = env.INTERNAL_SECRET
  }

  // Loose typing — each api/*.ts handler has its own ReqReq/ApiRes shape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const routes: Record<string, () => Promise<{ default: (req: any, res: any) => unknown }>> =
    {
      '/api/reports': () => import('./api/reports.ts') as Promise<{ default: (req: any, res: any) => unknown }>,
      '/api/calculate-price': () =>
        import('./api/calculate-price.ts') as Promise<{
          default: (req: any, res: any) => unknown
        }>,
      '/api/cleanup': () =>
        import('./api/cleanup.ts') as Promise<{
          default: (req: any, res: any) => unknown
        }>,
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
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        const loader = routes[path]
        if (!loader) {
          next()
          return
        }

        try {
          const mod = await loader()
          const handler = mod.default

          let body: unknown = undefined
          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            body = await readBody(req as never)
          }

          const fakeReq = {
            method: req.method,
            headers: req.headers as Record<
              string,
              string | string[] | undefined
            >,
            body,
            url: req.url,
            query: Object.fromEntries(
              new URL(req.url || '/', 'http://local').searchParams,
            ),
            socket: { remoteAddress: req.socket?.remoteAddress },
          }

          let statusCode = 200
          const fakeRes = {
            setHeader(k: string, v: string) {
              res.setHeader(k, v)
            },
            status(n: number) {
              statusCode = n
              return this
            },
            json(payload: unknown) {
              res.statusCode = statusCode
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(payload))
            },
            end(payload?: unknown) {
              res.statusCode = statusCode
              if (payload !== undefined) res.end(payload as never)
              else res.end()
            },
          }

          await handler(fakeReq, fakeRes)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              success: false,
              message: err instanceof Error ? err.message : 'Server error',
            }),
          )
        }
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
      localApiPlugin(env),
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
