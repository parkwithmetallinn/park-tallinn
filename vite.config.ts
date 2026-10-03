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
        .replaceAll('%VITE_ROBOTS%', robots)
        .replaceAll('%VITE_CANONICAL%', canonical)
        .replaceAll('%VITE_OG_IMAGE%', ogImage)
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
    plugins: [react(), tailwindcss(), htmlSeoEnvPlugin(env)],
    worker: {
      format: 'es',
    },
    optimizeDeps: {
      exclude: ['maplibre-gl'],
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
        '/api/osrm': {
          target: 'https://router.project-osrm.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/osrm/, ''),
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
