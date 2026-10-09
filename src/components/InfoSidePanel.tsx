import { useCallback, type ReactNode } from 'react'
import { useSheetClose } from './AnimatedBottomSheet'

/**
 * Compact info panel: left rail on ≥640px, bottom sheet on mobile.
 * Mobile: solid opaque panel + dim backdrop (no GPU backdrop-blur).
 * Desktop: light glass + blur OK (map chrome not overlapping).
 *
 * z-index: detail drawer = 30 (above search z-20 / FABs z-10 / map z-0).
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

  // Solid on mobile (blur kills MapLibre FPS); light glass + blur from md up
  const panel = dark
    ? 'border-white/10 bg-[#1C1C1E]/95 text-[#F5F5F7] shadow-[0_8px_28px_rgba(0,0,0,0.45)] md:bg-[#1C1C1E]/78 md:backdrop-blur-md'
    : 'border-black/8 bg-white/95 text-[#1C1C1E] shadow-[0_8px_28px_rgba(15,23,42,0.14)] md:border-white/55 md:bg-white/72 md:backdrop-blur-md'

  return (
    <>
      {/* Mobile-only dimmer — blocks search chips / map bleed-through (below sheet) */}
      <button
        type="button"
        data-testid="detail-backdrop"
        className="absolute inset-0 z-30 bg-black/40 sm:hidden"
        aria-label="Sulge paneel"
        onClick={requestClose}
      />
      <div
        className={`${sheetClassName} pointer-events-none absolute z-[31] left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[min(80dvh,85vh)] sm:top-[10rem] sm:right-auto sm:bottom-auto sm:left-4 sm:w-[22rem] sm:max-w-[min(24rem,calc(100vw-2rem))] sm:max-h-[min(80vh,calc(100dvh-11rem))]`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="info-side-panel"
      >
        <div
          className={`pointer-events-auto flex max-h-[inherit] flex-col overflow-hidden rounded-2xl border ${panel}`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
            {children({ requestClose })}
          </div>
        </div>
      </div>
    </>
  )
}
