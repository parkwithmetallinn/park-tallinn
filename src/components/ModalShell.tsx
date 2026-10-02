import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="animate-fade-in fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4 font-sans backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        className="animate-slide-up max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/50 bg-white/85 p-6 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-[20px] font-bold leading-tight tracking-tight text-[#1C1C1E]">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="tap-scale flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-100/80 text-[#8E8E93] transition hover:bg-slate-200/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#007AFF]"
            aria-label="Sulge"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
