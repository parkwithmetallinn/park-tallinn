import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
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
      // n8n parking session webhook (CORS fallback) — inject Header Auth
      '/api/parkimine': {
        target: 'https://mairon8n.app.n8n.cloud',
        changeOrigin: true,
        rewrite: () => '/webhook/parkimine',
        headers: {
          'X-N8N-API-KEY': process.env.VITE_N8N_API_KEY ?? 'SecurityMHMJ26%',
        },
      },
    },
  },
})
