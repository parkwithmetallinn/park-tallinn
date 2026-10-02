import { useCallback, type ReactNode } from 'react'
import { useSheetClose } from './AnimatedBottomSheet'

/**
 * Compact info panel: left rail on ≥640px, bottom sheet on mobile.
 * No backdrop — the map stays interactive underneath.
 */
export function InfoSidePanelShell({
  title,
  dark,
  onClose,
  children,
}: {
  title: string
  dark?: boolean
  onClose: () => void
  children: (api: { requestClose: () => void }) => ReactNode
}) {
  const stableClose = useCallback(() => onClose(), [onClose])
  const { requestClose, sheetClassName } = useSheetClose(stableClose)

  const panel = dark
    ? 'border-white/10 bg-[#1C1C1E]/78 text-[#F5F5F7] shadow-[0_8px_28px_rgba(0,0,0,0.4)]'
    : 'border-white/55 bg-white/72 text-[#1C1C1E] shadow-[0_8px_28px_rgba(15,23,42,0.12)]'

  return (
    <div
      className={`${sheetClassName} pointer-events-none absolute z-40 left-3 right-3 bottom-[max(1rem,env(safe-area-inset-bottom))] max-h-[40vh] sm:top-[10rem] sm:right-auto sm:bottom-auto sm:left-4 sm:w-[22rem] sm:max-w-[min(24rem,calc(100vw-2rem))] sm:max-h-[calc(100%-11rem)]`}
      role="dialog"
      aria-modal="false"
      aria-label={title}
    >
      <div
        className={`pointer-events-auto flex max-h-[inherit] flex-col overflow-hidden rounded-2xl border backdrop-blur-md ${panel}`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5">
          {children({ requestClose })}
        </div>
      </div>
    </div>
  )
}
