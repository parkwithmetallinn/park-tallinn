import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react'
import { useEffect } from 'react'

export type ToastKind = 'success' | 'error' | 'info' | 'loading'

export type ToastState = {
  kind: ToastKind
  title: string
  detail?: string
} | null

export function Toast({
  toast,
  onClose,
}: {
  toast: ToastState
  onClose: () => void
}) {
  useEffect(() => {
    if (!toast || toast.kind === 'loading') return
    const t = window.setTimeout(onClose, toast.kind === 'error' ? 6500 : 4200)
    return () => window.clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null

  const tone =
    toast.kind === 'success'
      ? 'border-moss/25 bg-moss text-white'
      : toast.kind === 'error'
        ? 'border-clay/30 bg-clay text-white'
        : toast.kind === 'loading'
          ? 'border-white/40 bg-white/90 text-ink'
          : 'border-sea/25 bg-sea text-white'

  const Icon =
    toast.kind === 'success'
      ? CheckCircle2
      : toast.kind === 'error'
        ? XCircle
        : toast.kind === 'loading'
          ? Loader2
          : CheckCircle2

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-[max(5.5rem,env(safe-area-inset-top))] z-[60] flex justify-center px-3 sm:px-4"
      role="status"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto animate-slide-up flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-xl ${tone}`}
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
        {toast.kind !== 'loading' ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 opacity-80 transition hover:opacity-100"
            aria-label="Sulge"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
