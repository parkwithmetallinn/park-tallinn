import { X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useI18n } from '../i18n'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

export function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const panel = panelRef.current
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? panel).focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const nodes = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (nodes.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus?.()
    }
  }, [onClose])

  const onBackdropKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 font-sans"
      onClick={onClose}
      onKeyDown={onBackdropKey}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="animate-slide-up max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-black/8 bg-white/95 p-6 shadow-2xl outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3
            id={titleId}
            className="text-[20px] font-bold leading-tight tracking-tight text-[#1C1C1E]"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="tap-scale flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-100/80 text-[#3A3A3C] transition hover:bg-slate-200/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
