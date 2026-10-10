import { CloudOff, RefreshCw } from 'lucide-react'
import { drainOfflineQueue } from '../lib/offlineQueue'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { loadActiveSession, loadTimerState } from '../lib/storage'
import { Pressable } from './ui/Pressable'
import { useI18n } from '../i18n'

/** Non-blocking offline / queued-actions banner. */
export function OfflineBanner() {
  const { online, queueLen } = useOnlineStatus()
  const { t, formatDateTime } = useI18n()

  if (online && queueLen === 0) return null

  const session = !online ? loadActiveSession() : null
  const timer = !online ? loadTimerState() : null
  const endsLabel =
    timer?.mode === 'prepaid' && timer.endsAt
      ? formatDateTime(timer.endsAt)
      : null
  const startedLabel = session?.startedAt
    ? formatDateTime(session.startedAt)
    : null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[max(5.5rem,env(safe-area-inset-bottom))] z-[180] flex justify-center px-3"
      role="status"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto animate-slide-up flex max-w-md items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-[12px] font-semibold shadow-[0_8px_28px_rgba(15,23,42,0.2)] ${
          online
            ? 'border-amber-400/30 bg-amber-50/95 text-amber-950'
            : 'border-white/20 bg-[#1C1C1E]/95 text-white'
        }`}
      >
        <CloudOff className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
        <div className="min-w-0 flex-1 leading-snug">
          {online ? (
            <>{t('offline.queueRestored', { n: queueLen })}</>
          ) : (
            <>
              <p>{t('offline.bannerDetail')}</p>
              {session ? (
                <p className="mt-1 text-[12px] font-medium opacity-85">
                  {t('session.sessionLabel', {
                    name: session.spotName || t('common.lot'),
                  })}{' '}
                  · {session.zone}
                  {startedLabel
                    ? ` · ${t('session.since', { time: startedLabel })}`
                    : ''}
                  {endsLabel
                    ? ` · ${t('offline.ends', { time: endsLabel })}`
                    : ''}
                </p>
              ) : null}
            </>
          )}
        </div>
        {online && queueLen > 0 ? (
          <Pressable
            className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-amber-500/20 px-2 py-1 text-[12px] font-bold text-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
            onClick={() => void drainOfflineQueue()}
            aria-label={t('common.send')}
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            {t('common.send')}
          </Pressable>
        ) : null}
      </div>
    </div>
  )
}
