import type { SpotType } from '../types'

export const TYPE_COLORS: Record<SpotType, string> = {
  free: '#0B6E4F',
  timed: '#0E7490',
  pr: '#1D4E89',
  paid: '#C45C26',
}

export const TYPE_LABELS: Record<SpotType, string> = {
  free: '100% tasuta',
  timed: 'Kellaga / ajaga',
  pr: 'Pargi ja Reisi',
  paid: 'Tasuline tsoon',
}

export function minutesFromBadge(badge: string): number {
  if (badge.includes('15')) return 15
  if (badge.includes('4h') || badge.includes('4H')) return 240
  if (badge.includes('3h') || badge.includes('3H')) return 180
  if (badge.includes('2h') || badge.includes('2H')) return 120
  if (badge.includes('1h') || badge.includes('1H')) return 60
  return 60
}

export function formatHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}
