import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const n8nWebhookUrl =
    env.VITE_N8N_WEBHOOK_URL ||
    env.VITE_PARKING_WEBHOOK_URL ||
    env.PARKING_WEBHOOK_URL ||
    ''
  const n8nApiKey = env.VITE_N8N_API_KEY || env.N8N_API_KEY || ''

  let n8nOrigin = 'https://mairon8n.app.n8n.cloud'
  let n8nPath = '/webhook/parkimine'
  try {
    if (n8nWebhookUrl) {
      const u = new URL(n8nWebhookUrl)
      n8nOrigin = u.origin
      n8nPath = u.pathname || n8nPath
    }
  } catch {
    /* keep defaults when URL is missing/invalid during setup */
  }

  return {
    plugins: [react(), tailwindcss()],
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
        // n8n parking session webhook — inject Header Auth from env
        '/api/parkimine': {
          target: n8nOrigin,
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
