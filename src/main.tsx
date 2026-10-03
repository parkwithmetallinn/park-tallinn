import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'
import { prefetchParkingLayers } from './lib/parkingDataCache'
import { initAnalytics } from './lib/analytics'

const AdminReviewView = lazy(() =>
  import('./components/AdminReviewView.tsx').then((m) => ({
    default: m.AdminReviewView,
  })),
)

const path = window.location.pathname.replace(/\/+$/, '') || '/'
const isAdmin =
  path === '/admin' ||
  path.endsWith('/admin') ||
  new URLSearchParams(window.location.search).has('admin')

// Warm parking layer cache as soon as the shell boots
prefetchParkingLayers()
initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isAdmin ? (
        <Suspense fallback={null}>
          <AdminReviewView />
        </Suspense>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
)
