import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'
import { prefetchParkingLayers } from './lib/parkingDataCache'
import { initAnalytics } from './lib/analytics'
import { clearLegacyPlateStorage } from './lib/storage'
import { I18nProvider } from './i18n'

// Drop stale license-plate values left from older builds
clearLegacyPlateStorage()

const AdminReviewView = lazy(() =>
  import('./components/AdminReviewView.tsx').then((m) => ({
    default: m.AdminReviewView,
  })),
)
const PrivacyPage = lazy(() =>
  import('./pages/PrivacyPage.tsx').then((m) => ({ default: m.PrivacyPage })),
)
const SupportPage = lazy(() =>
  import('./pages/SupportPage.tsx').then((m) => ({ default: m.SupportPage })),
)

const path = window.location.pathname.replace(/\/+$/, '') || '/'
/** Admin UI is never linked from the app; only DEV or explicit env opt-in. */
const adminEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_ADMIN === 'true'
const isAdminRoute =
  adminEnabled && (path === '/admin' || path.endsWith('/admin'))
const isPrivacyRoute = path === '/privacy'
const isSupportRoute = path === '/support'

// Warm parking layer cache as soon as the shell boots (skip on legal pages)
if (!isPrivacyRoute && !isSupportRoute) {
  prefetchParkingLayers()
}
initAnalytics()

function RootView() {
  if (isAdminRoute) {
    return (
      <Suspense fallback={null}>
        <AdminReviewView />
      </Suspense>
    )
  }
  if (isPrivacyRoute) {
    return (
      <Suspense fallback={null}>
        <PrivacyPage />
      </Suspense>
    )
  }
  if (isSupportRoute) {
    return (
      <Suspense fallback={null}>
        <SupportPage />
      </Suspense>
    )
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RootView />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
)
