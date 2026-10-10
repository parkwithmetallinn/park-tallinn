import { Download, RefreshCw, Share, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { needsIosHomeScreenHint } from '../lib/notifications'
import {
  applyServiceWorkerUpdate,
  dismissInstallHint,
  dismissIosHint,
  initServiceWorker,
  isInstallDismissed,
  isIosHintDismissed,
  isStandaloneDisplay,
  type BeforeInstallPromptEventLike,
} from '../lib/pwa'

/**
 * Install hint (beforeinstallprompt / iOS) + "new version available" bar.
 */
export function PwaBanners() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEventLike | null>(
    null,
  )
  const [showInstall, setShowInstall] = useState(false)
  const [showIos, setShowIos] = useState(false)
  const [needRefresh, setNeedRefresh] = useState(false)

  useEffect(() => {
    void initServiceWorker({
      onNeedRefresh: () => setNeedRefresh(true),
    })
  }, [])

  useEffect(() => {
    if (isStandaloneDisplay()) return

    const onBip = (e: Event) => {
      e.preventDefault()
      const ev = e as BeforeInstallPromptEventLike
      setDeferred(ev)
      if (!isInstallDismissed()) setShowInstall(true)
    }
    window.addEventListener('beforeinstallprompt', onBip)

    if (needsIosHomeScreenHint() && !isIosHintDismissed()) {
      setShowIos(true)
    }

    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  const onInstall = useCallback(async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      await deferred.userChoice
    } catch {
      /* user dismissed */
    }
    setDeferred(null)
    setShowInstall(false)
    dismissInstallHint()
  }, [deferred])

  const onDismissInstall = () => {
    setShowInstall(false)
    dismissInstallHint()
  }

  const onDismissIos = () => {
    setShowIos(false)
    dismissIosHint()
  }

  return (
    <>
      {needRefresh ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[190] flex justify-center px-3"
          role="status"
        >
          <div className="pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl border border-black/8 bg-white/95 px-3 py-2.5 text-[12px] font-semibold text-[#1C1C1E] shadow-[0_8px_28px_rgba(15,23,42,0.16)]">
            <span className="min-w-0 flex-1 leading-snug">
              Uus versioon saadaval, värskenda
            </span>
            <button
              type="button"
              className="tap-scale inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#007AFF] px-3 text-[12px] font-bold text-white"
              onClick={() => void applyServiceWorkerUpdate()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Värskenda
            </button>
          </div>
        </div>
      ) : null}

      {showInstall && deferred ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[max(6.5rem,env(safe-area-inset-bottom))] z-[175] flex justify-center px-3"
          role="dialog"
          aria-label="Lisa avalehele"
        >
          <div className="pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl border border-black/8 bg-white/95 px-3 py-2.5 text-[12px] font-semibold text-[#1C1C1E] shadow-[0_8px_28px_rgba(15,23,42,0.16)]">
            <Download className="h-4 w-4 shrink-0 text-[#007AFF]" />
            <span className="min-w-0 flex-1 leading-snug">
              Lisa avalehele — kiirem ligipääs
            </span>
            <button
              type="button"
              className="tap-scale inline-flex min-h-11 items-center rounded-xl bg-[#007AFF] px-3 text-[12px] font-bold text-white"
              onClick={() => void onInstall()}
            >
              Lisa
            </button>
            <button
              type="button"
              className="tap-scale inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/5"
              aria-label="Sulge"
              onClick={onDismissInstall}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {showIos && !showInstall ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[max(6.5rem,env(safe-area-inset-bottom))] z-[175] flex justify-center px-3"
          role="status"
        >
          <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl border border-black/8 bg-white/95 px-3 py-2.5 text-[12px] font-semibold text-[#1C1C1E] shadow-[0_8px_28px_rgba(15,23,42,0.16)]">
            <Share className="mt-0.5 h-4 w-4 shrink-0 text-[#007AFF]" />
            <p className="min-w-0 flex-1 leading-snug">
              iOS: Jaga → Lisa avaekraanile
            </p>
            <button
              type="button"
              className="tap-scale inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/5"
              aria-label="Sulge"
              onClick={onDismissIos}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
