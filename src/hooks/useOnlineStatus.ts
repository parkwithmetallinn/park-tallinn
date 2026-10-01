import { useEffect, useState, useSyncExternalStore } from 'react'
import { drainOfflineQueue, offlineQueueLength } from '../lib/offlineQueue'

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

function getOnlineSnapshot() {
  return navigator.onLine
}

function getServerSnapshot() {
  return true
}

export function useOnlineStatus() {
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerSnapshot,
  )
  const [queueLen, setQueueLen] = useState(() => offlineQueueLength())

  useEffect(() => {
    const sync = () => setQueueLen(offlineQueueLength())
    window.addEventListener('parkvibe:queue-changed', sync)
    return () => window.removeEventListener('parkvibe:queue-changed', sync)
  }, [])

  useEffect(() => {
    if (!online) return
    void drainOfflineQueue().then(() => setQueueLen(offlineQueueLength()))
  }, [online])

  return { online, queueLen, offline: !online }
}
