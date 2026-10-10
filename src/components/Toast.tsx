import { CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n'

export type ToastKind = 'success' | 'error' | 'info' | 'loading'

export type ToastState = {
  kind: ToastKind
  title: string
  detail?: string
  /** Optional action (e.g. Undo) — shown as a text button. */
  actionLabel?: string
  onAction?: () => void
} | null

const DISMISS_MS: Record<Exclude<ToastKind, 'loading'>, number> = {
  success: 6500,
  error: 7500,
  info: 6500,
}

export function Toast({
  toast,
  onClose,
}: {
  toast: ToastState
  onClose: () => void
}) {
  const { t } = useI18n()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Dismiss based on toast identity (kind+title+detail), not onClose identity —
  // parent re-renders (GPS / timer) must not reset or clear the toast early.
  // Undo toasts stay ~5s.
  const toastKey = toast
    ? `${toast.kind}|${toast.title}|${toast.detail ?? ''}|${toast.actionLabel ?? ''}`
    : null

  useEffect(() => {
    if (!toast || toast.kind === 'loading') return
    const ms = toast.actionLabel ? 5000 : DISMISS_MS[toast.kind]
    const t = window.setTimeout(() => onCloseRef.current(), ms)
    return () => window.clearTimeout(t)
  }, [toastKey, toast])

  if (!toast) return null

  const tone =
    toast.kind === 'success'
      ? 'border-moss/25 bg-moss text-white'
      : toast.kind === 'error'
        ? 'border-clay/30 bg-clay text-white'
        : toast.kind === 'loading'
          ? 'border-white/50 bg-white/95 text-ink'
          : 'border-sea/25 bg-sea text-white'

  const Icon =
    toast.kind === 'success'
      ? CheckCircle2
      : toast.kind === 'error'
        ? XCircle
        : toast.kind === 'loading'
          ? Loader2
          : Info

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[max(5.5rem,env(safe-area-inset-bottom))] z-[200] flex justify-center px-3 sm:px-4"
      role="status"
      aria-live="polite"
      data-testid="parking-toast"
      data-toast-kind={toast.kind}
    >
      <div
        className={`pointer-events-auto animate-slide-up flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_12px_40px_rgba(15,23,42,0.28)] ${tone}`}
      >
        <Icon
          className={`mt-0.5 h-5 w-5 shrink-0 ${toast.kind === 'loading' ? 'animate-spin text-sea' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug">{toast.title}</p>
          {toast.detail ? (
            <p className="mt-0.5 text-xs leading-snug opacity-90">{toast.detail}</p>
          ) : null}
        </div>
        {toast.actionLabel && toast.onAction ? (
          <button
            type="button"
            data-testid="toast-undo"
            onClick={() => {
              toast.onAction?.()
              onClose()
            }}
            className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1.5 text-[12px] font-bold"
          >
            {toast.actionLabel}
          </button>
        ) : null}
        {toast.kind !== 'loading' ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-1 opacity-80 transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  )
}
