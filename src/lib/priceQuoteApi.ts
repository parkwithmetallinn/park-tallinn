/**
 * Client helper for POST /api/calculate-price.
 * Returns a display-ready estimate (or error message). Never throws.
 */

export type PriceQuoteView =
  | {
      ok: true
      totalPriceCents: number
      totalPriceFormatted: string
      /** User-facing line: amount + “hinnang, mitte arve” */
      label: string
    }
  | { ok: false; message: string }

export async function fetchPriceQuote(input: {
  zone: string
  startTime: string
  endTime: string
  startMarked?: boolean
}): Promise<PriceQuoteView> {
  try {
    const res = await fetch('/api/calculate-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zone: input.zone,
        startTime: input.startTime,
        endTime: input.endTime,
        startMarked: input.startMarked !== false,
      }),
    })
    const data = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!data) {
      return { ok: false, message: 'Hinna vastust ei õnnestunud lugeda' }
    }
    if (!res.ok || data.ok === false) {
      const message =
        typeof data.message === 'string' && data.message.trim()
          ? data.message
          : 'Hinna arvutus ebaõnnestus'
      return { ok: false, message }
    }
    const quote =
      data.quote && typeof data.quote === 'object'
        ? (data.quote as Record<string, unknown>)
        : data
    const cents = Number(quote.totalPriceCents)
    const formatted =
      typeof quote.totalPriceFormatted === 'string'
        ? quote.totalPriceFormatted
        : Number.isFinite(cents)
          ? `${(cents / 100).toFixed(2).replace('.', ',')} €`
          : null
    if (!formatted || !Number.isFinite(cents)) {
      return { ok: false, message: 'Hinna vastus on vigane' }
    }
    return {
      ok: true,
      totalPriceCents: cents,
      totalPriceFormatted: formatted,
      label: `${formatted} (hinnang, mitte arve)`,
    }
  } catch {
    return { ok: false, message: 'Hinna päring ebaõnnestus' }
  }
}
