/**
 * Disable symbol opacity fade transitions (mobile pan stutter).
 * Apply on every symbol layer paint / via setPaintProperty after style load.
 */

export const SYMBOL_NO_FADE_TRANSITION = {
  duration: 0,
  delay: 0,
} as const

/** Spread into symbol layer `paint` to zero icon/text opacity animations. */
export const SYMBOL_NO_FADE_PAINT = {
  'icon-opacity-transition': SYMBOL_NO_FADE_TRANSITION,
  'text-opacity-transition': SYMBOL_NO_FADE_TRANSITION,
} as const

/** Zero fadeDuration-style opacity transitions on all current symbol layers. */
export function disableSymbolLayerFades(map: {
  getStyle: () => { layers?: Array<{ id: string; type: string }> } | undefined
  // MapLibre's setPaintProperty is generic — keep loose for style mutations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setPaintProperty: (id: string, name: any, value: any) => unknown
}): void {
  const layers = map.getStyle()?.layers
  if (!layers) return
  for (const layer of layers) {
    if (layer.type !== 'symbol') continue
    try {
      map.setPaintProperty(
        layer.id,
        'icon-opacity-transition',
        SYMBOL_NO_FADE_TRANSITION,
      )
      map.setPaintProperty(
        layer.id,
        'text-opacity-transition',
        SYMBOL_NO_FADE_TRANSITION,
      )
    } catch {
      /* layer may lack icon/text paint */
    }
  }
}
