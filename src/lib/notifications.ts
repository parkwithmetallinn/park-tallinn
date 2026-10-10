/**
 * Web Push helpers — permission only after an explicit user tap
 * ("Luba teavitused"), never on page load.
 */

import { sendParkingSession, type SessionOutcome } from './parkingSession'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** True when Push API + Notification + service workers are available. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  )
}

/**
 * iOS Safari (or WebKit) outside an installed standalone PWA —
 * push requires Add to Home Screen.
 */
export function needsIosHomeScreenHint(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent || ''
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIos) return false

  const nav = navigator as Navigator & { standalone?: boolean }
  const standalone =
    nav.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  return !standalone
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch {
    return null
  }
}

/**
 * Request Notification permission, subscribe with VITE_VAPID_PUBLIC_KEY,
 * and POST the subscription via the parking `notify` action.
 * Call only from a user gesture (e.g. "Luba teavitused").
 */
export async function enablePush(_unused?: string): Promise<SessionOutcome> {
  if (!isPushSupported()) {
    return {
      kind: 'ERROR',
      message: 'Veebiteavitused pole selles brauseris toetatud',
    }
  }

  const vapidKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim()
  if (!vapidKey) {
    return {
      kind: 'ERROR',
      message: 'Teavituste võti puudub (VITE_VAPID_PUBLIC_KEY)',
    }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return {
      kind: 'ERROR',
      message:
        permission === 'denied'
          ? 'Teavitused on blokeeritud — kasuta e-posti varuvarianti'
          : 'Teavituste luba ei antud',
    }
  }

  const registration = await registerServiceWorker()
  if (!registration) {
    return { kind: 'ERROR', message: 'Teenusetöötaja registreerimine ebaõnnestus' }
  }

  await navigator.serviceWorker.ready

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    })
  }

  const pushSubscription = subscription.toJSON() as PushSubscriptionJSON

  return sendParkingSession({
    action: 'notify',
    pushSubscription,
  })
}

/** Register email fallback reminder via the `notify` action. */
export async function enableEmailNotify(
  emailOrCarNumber: string,
  emailMaybe?: string,
): Promise<SessionOutcome> {
  // Back-compat: enableEmailNotify(email) or enableEmailNotify(_ignored, email)
  const addr = (emailMaybe ?? emailOrCarNumber).trim()
  if (!addr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
    return { kind: 'ERROR', message: 'Sisesta kehtiv e-posti aadress' }
  }
  return sendParkingSession({
    action: 'notify',
    email: addr,
  })
}

export function notificationPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}
