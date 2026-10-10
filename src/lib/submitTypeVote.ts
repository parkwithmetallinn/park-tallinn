/**
 * Temporary in-memory type-vote store for unknown parking spots.
 * Easy to swap for Supabase (/api/type-votes) later — keep this function signature.
 */

export type TypeVoteKind = 'FREE' | 'TIMED' | 'PAID'

const VOTED_KEY = 'parktallinn:type-votes-local:v1'

type VoteEntry = {
  parkingId: string
  type: TypeVoteKind
  at: number
}

function readVotes(): VoteEntry[] {
  try {
    const raw = localStorage.getItem(VOTED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as VoteEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeVotes(list: VoteEntry[]) {
  try {
    localStorage.setItem(VOTED_KEY, JSON.stringify(list))
  } catch {
    /* private mode / quota */
  }
}

/** True if this device already voted for the parking lot. */
export function hasLocalTypeVote(parkingId: string): boolean {
  const id = parkingId.trim()
  if (!id) return false
  return readVotes().some((v) => v.parkingId === id)
}

/**
 * Record a type vote locally (placeholder for future Supabase).
 * Returns false if the user already voted for this spot.
 */
export function submitTypeVote(
  parkingId: string,
  type: TypeVoteKind,
): { ok: boolean; message: string; duplicate: boolean } {
  const id = parkingId.trim()
  if (!id) {
    return { ok: false, message: 'Vigane parkla', duplicate: false }
  }
  if (hasLocalTypeVote(id)) {
    return {
      ok: false,
      message: 'Oled selle parkla juba kaardistanud',
      duplicate: true,
    }
  }
  const list = readVotes()
  list.push({ parkingId: id, type, at: Date.now() })
  writeVotes(list)
  return { ok: true, message: 'Aitäh!', duplicate: false }
}
