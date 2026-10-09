/**
 * Pure parking price calculation (30-min increments + optional 24h daily cap).
 * Used by /api/calculate-price — no I/O.
 */

export type ZonePricing = {
  zoneId: string
  zoneName: string
  hourlyRate: number
  freeMinutes: number
  /** EUR per rolling 24h block; null/undefined = no cap */
  dailyCap: number | null
}

export type PriceBreakdown = {
  zoneId: string
  zoneName: string
  durationMinutes: number
  billableMinutes: number
  freeMinutesUsed: number
  hourlyRate: number
  totalPrice: number
  currency: 'EUR'
}

export const DEFAULT_ZONE_PRICING: Omit<ZonePricing, 'zoneId' | 'zoneName'> = {
  hourlyRate: 2.0,
  freeMinutes: 15,
  dailyCap: 15.0,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Round billable minutes up to the next 30-minute increment. */
export function roundUpTo30Minutes(minutes: number): number {
  if (minutes <= 0) return 0
  return Math.ceil(minutes / 30) * 30
}

/**
 * Price a parking interval.
 * Free minutes apply once at the start; remaining time is billed in rolling
 * 24h blocks, each capped at `dailyCap` when set.
 */
export function calculateParkingPrice(
  zone: ZonePricing,
  startMs: number,
  endMs: number,
): PriceBreakdown {
  const durationMinutes = Math.max(
    0,
    Math.ceil((endMs - startMs) / 60_000),
  )
  const freeMinutes = Math.max(0, Math.floor(zone.freeMinutes))
  const freeMinutesUsed = Math.min(durationMinutes, freeMinutes)
  const billableMinutes = Math.max(0, durationMinutes - freeMinutesUsed)
  const hourlyRate = Math.max(0, zone.hourlyRate)

  if (billableMinutes <= 0 || hourlyRate <= 0) {
    return {
      zoneId: zone.zoneId,
      zoneName: zone.zoneName,
      durationMinutes,
      billableMinutes: 0,
      freeMinutesUsed,
      hourlyRate,
      totalPrice: 0,
      currency: 'EUR',
    }
  }

  const billingStartMs = startMs + freeMinutesUsed * 60_000
  const dailyCap =
    zone.dailyCap != null && Number.isFinite(zone.dailyCap) && zone.dailyCap > 0
      ? zone.dailyCap
      : null

  let total = 0
  let cursor = billingStartMs
  while (cursor < endMs) {
    const blockEnd = Math.min(cursor + DAY_MS, endMs)
    const blockMinutes = Math.max(0, Math.ceil((blockEnd - cursor) / 60_000))
    const rounded = roundUpTo30Minutes(blockMinutes)
    let blockPrice = (rounded / 60) * hourlyRate
    if (dailyCap != null) blockPrice = Math.min(blockPrice, dailyCap)
    total += blockPrice
    cursor = blockEnd
  }

  return {
    zoneId: zone.zoneId,
    zoneName: zone.zoneName,
    durationMinutes,
    billableMinutes,
    freeMinutesUsed,
    hourlyRate,
    totalPrice: round2(total),
    currency: 'EUR',
  }
}
