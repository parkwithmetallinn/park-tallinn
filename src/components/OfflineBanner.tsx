import { CloudOff, RefreshCw } from 'lucide-react'
import { drainOfflineQueue } from '../lib/offlineQueue'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { Pressable } from './ui/Pressable'

/** Non-blocking offline / queued-actions banner. */
export function OfflineBanner() {
  const { online, queueLen } = useOnlineStatus()

  if (online && queueLen === 0) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[max(5.5rem,env(safe-area-inset-bottom))] z-[180] flex justify-center px-3"
      role="status"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto animate-slide-up flex max-w-md items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-[12px] font-semibold shadow-[0_8px_28px_rgba(15,23,42,0.2)] backdrop-blur-xl ${
          online
            ? 'border-amber-400/30 bg-amber-50/95 text-amber-900'
            : 'border-white/20 bg-[#1C1C1E]/92 text-white'
        }`}
      >
        <CloudOff className="h-4 w-4 shrink-0 opacity-90" />
        <div className="min-w-0 flex-1 leading-snug">
          {online ? (
            <>
              Ühendus taastatud — järjekorras {queueLen} toimingut
            </>
          ) : (
            <>
              Offline · toimingud salvestatakse ja saadetakse hiljem
              {queueLen > 0 ? ` (${queueLen})` : ''}
            </>
          )}
        </div>
        {online && queueLen > 0 ? (
          <Pressable
            className="inline-flex items-center gap-1 rounded-lg bg-amber-500/20 px-2 py-1 text-[11px] font-bold text-amber-950"
            onClick={() => void drainOfflineQueue()}
          >
            <RefreshCw className="h-3 w-3" />
            Saada
          </Pressable>
        ) : null}
      </div>
    </div>
  )
}
