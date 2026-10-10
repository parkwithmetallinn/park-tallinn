/**
 * PWA helpers: service worker registration, update prompt, install dismissal.
 * Push subscription stays in notifications.ts — this only registers /sw.js early.
 */

const INSTALL_DISMISS_KEY = 'parktallinn:pwa-install-dismissed:v1'
const IOS_HINT_DISMISS_KEY = 'parktallinn:pwa-ios-hint-dismissed:v1'

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore quota / private mode */
  }
}

export function isInstallDismissed(): boolean {
  return lsGet(INSTALL_DISMISS_KEY) === '1'
}

export function dismissInstallHint(): void {
  lsSet(INSTALL_DISMISS_KEY, '1')
}

export function isIosHintDismissed(): boolean {
  return lsGet(IOS_HINT_DISMISS_KEY) === '1'
}

export function dismissIosHint(): void {
  lsSet(IOS_HINT_DISMISS_KEY, '1')
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return (
    nav.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Register the service worker and notify when a new version is waiting.
 * Preserves existing /sw.js (push handlers included).
 */
export async function initServiceWorker(opts?: {
  onNeedRefresh?: () => void
}): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

    const notifyWaiting = () => {
      if (reg.waiting) opts?.onNeedRefresh?.()
    }
    notifyWaiting()

    reg.addEventListener('updatefound', () => {
      const worker = reg.installing
      if (!worker) return
      worker.addEventListener('statechange', () => {
        if (
          worker.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          opts?.onNeedRefresh?.()
        }
      })
    })

    // Periodic update check while the tab is visible
    const check = () => {
      if (document.visibilityState === 'visible') void reg.update()
    }
    document.addEventListener('visibilitychange', check)
    window.setInterval(check, 60 * 60 * 1000)

    return reg
  } catch {
    return null
  }
}

/** Tell the waiting worker to activate, then reload. */
export async function applyServiceWorkerUpdate(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg?.waiting) {
    window.location.reload()
    return
  }
  reg.waiting.postMessage({ type: 'SKIP_WAITING' })
  await new Promise<void>((resolve) => {
    const onChange = () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
      resolve()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    window.setTimeout(resolve, 1500)
  })
  window.location.reload()
}
