import { useCallback, type ReactNode } from 'react'
import { useSheetClose, useSheetSwipe } from './AnimatedBottomSheet'

/**
 * Compact info panel: left rail on ≥640px, swipeable bottom sheet on mobile.
 *
 * Mobile performance: solid ~95% opaque panels (no backdrop-blur — keeps MapLibre at 60 FPS).
 * Height: max-h-[45dvh] so the top ~55% of the screen always shows the map.
 *
 * z-index stack: map z-0 → FABs z-10 → search z-20 → this sheet z-30.
 *
 * variant:
 *  - default — parking detail / EV / location sheets
 *  - compact — "Lähimad parklad" (same 45dvh mobile height; lighter dimmer)
 */
export function InfoSidePanelShell({
  title,
  dark,
  onClose,
  children,
  variant = 'default',
}: {
  title: string
  dark?: boolean
  onClose: () => void
  children: (api: { requestClose: () => void }) => ReactNode
  variant?: 'default' | 'compact'
}) {
  const stableClose = useCallback(() => onClose(), [onClose])
  const { requestClose, sheetClassName } = useSheetClose(stableClose)
  const { dragY, swipeHandlers } = useSheetSwipe(requestClose)

  // Solid 95% — never backdrop-blur (blur composites over the GL canvas every frame)
  const panel = dark
    ? 'border-white/10 bg-[#1C1C1E]/95 text-[#F5F5F7] shadow-[0_8px_28px_rgba(0,0,0,0.45)]'
    : 'border-black/8 bg-white/95 text-[#1C1C1E] shadow-[0_8px_28px_rgba(15,23,42,0.14)]'

  const backdropOpacity =
    variant === 'compact' ? 'bg-black/25' : 'bg-black/35'

  const dragStyle =
    dragY > 0
      ? {
          transform: `translate3d(0, ${dragY}px, 0)`,
          transition: 'none',
        }
      : undefined

  return (
    <>
      {/* Mobile dimmer — below sheet, above search/FABs */}
      <button
        type="button"
        data-testid="detail-backdrop"
        className={`absolute inset-0 z-30 sm:hidden ${backdropOpacity}`}
        aria-label="Sulge paneel"
        onClick={requestClose}
      />
      <div
        className={`${sheetClassName} pointer-events-none absolute z-30 left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-h-[45dvh] sm:top-[10rem] sm:right-auto sm:bottom-auto sm:left-4 sm:w-[22rem] sm:max-w-[min(24rem,calc(100vw-2rem))] sm:max-h-[min(80vh,calc(100dvh-11rem))]`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="info-side-panel"
        data-variant={variant}
        style={dragStyle}
      >
        <div
          className={`pointer-events-auto flex max-h-[inherit] flex-col overflow-hidden rounded-2xl border ${panel}`}
        >
          {/* Swipe handle — drag down to dismiss (mobile) */}
          <div
            className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 pb-1 active:cursor-grabbing sm:hidden"
            data-testid="sheet-swipe-handle"
            aria-hidden="true"
            {...swipeHandlers}
          >
            <span
              className={`h-1 w-10 rounded-full ${dark ? 'bg-white/25' : 'bg-black/15'}`}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pt-1 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-3.5 sm:pb-[max(2.5rem,env(safe-area-inset-bottom))]">
            {children({ requestClose })}
          </div>
        </div>
      </div>
    </>
  )
}
