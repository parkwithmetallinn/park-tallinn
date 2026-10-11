/**
 * Dual-hash vote independence: two votes count as separate only when
 * BOTH client_hash (install) and ip_hash differ.
 */

export type HashPair = {
  client_hash: string
  ip_hash: string
}

/** Effective IP axis — legacy rows without ip_hash fall back to client_hash. */
export function effectiveIpHash(row: {
  client_hash?: string | null
  ip_hash?: string | null
}): string {
  const ip = String(row.ip_hash ?? '').trim()
  if (ip) return ip
  return String(row.client_hash ?? '').trim()
}

export function areIndependent(a: HashPair, b: HashPair): boolean {
  return a.client_hash !== b.client_hash && a.ip_hash !== b.ip_hash
}

/**
 * Greedy chronological filter: keep a vote only if it is independent from
 * every vote already kept (different install AND different IP).
 */
export function filterIndependentVotes<
  T extends { client_hash: string; ip_hash: string; created_at: string },
>(votes: T[]): T[] {
  const sorted = [...votes].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  )
  const kept: T[] = []
  for (const v of sorted) {
    if (kept.every((k) => areIndependent(k, v))) kept.push(v)
  }
  return kept
}
