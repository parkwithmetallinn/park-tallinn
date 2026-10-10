import type { ParkingLayerKey } from '../types'

/**
 * Single source of truth for on-map parking badge text (`text-field: badge`).
 * Uses the classified layer (operator), never parses prior label strings.
 *
 * Snabb is always "SB" — zone codes like X12 / SB7 stay in `zone_code` for sheets.
 * Estonian product labels: TASUTA / KELL / TASULINE. Never show bare "ZONE".
 */
export function mapLabelForLayer(
  layer: ParkingLayerKey,
  zoneCode?: string | null,
): string {
  if (layer === 'snabb') return 'SB'

  const z = (zoneCode ?? '').trim()
  // Skip placeholder / English category codes — show real codes only (e.g. EP264)
  if (z && !/^(ZONE|FREE|PAID|P|UNKNOWN|TASUTA|TASULINE)$/i.test(z)) {
    return z.length <= 8 ? z : z.slice(0, 8)
  }

  switch (layer) {
    case 'europark':
      return 'EP'
    case 'citypark':
      return 'CP'
    case 'uhisteenused':
      return 'UT'
    case 'parkit':
      return 'PK'
    case 'park_ride':
      return 'P&R'
    case 'ev':
      return 'EV'
    case 'inva':
      return 'INVA'
    case 'loading':
      return 'LAAD'
    case 'timed':
      return 'KELL'
    case 'free_street':
      return 'TASUTA'
    case 'municipal':
      return ''
    default:
      return ''
  }
}
