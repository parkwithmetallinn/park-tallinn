import { useEffect, useRef } from 'react'

/**
 * Keep the screen awake while `active` is true (Wake Lock API).
 * No-ops when unsupported or the request fails.
 */
export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!active) {
      void lockRef.current?.release().catch(() => {})
      lockRef.current = null
      return
    }

    let cancelled = false

    const acquire = async () => {
      try {
        if (!('wakeLock' in navigator) || typeof navigator.wakeLock?.request !== 'function') {
          return
        }
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          void lock.release().catch(() => {})
          return
        }
        lockRef.current = lock
        lock.addEventListener('release', () => {
          if (lockRef.current === lock) lockRef.current = null
        })
      } catch {
        /* permission denied / unsupported */
      }
    }

    void acquire()

    const onVisible = () => {
      if (document.visibilityState === 'visible' && active && !lockRef.current) {
        void acquire()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lockRef.current?.release().catch(() => {})
      lockRef.current = null
    }
  }, [active])
}
