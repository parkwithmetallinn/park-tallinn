/**
 * Local display profile — no authentication.
 * Name + initials live in localStorage only.
 */

export const LOCAL_PROFILE_KEY = 'parking-app:profile'

export type LocalProfile = {
  displayName: string
  /** Optional contact shown in Profile UI only — never sent to analytics. */
  email: string
}

const DEFAULT_NAME = 'Kasutaja'

export function loadLocalProfile(): LocalProfile {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY)
    if (!raw) return { displayName: DEFAULT_NAME, email: '' }
    const parsed = JSON.parse(raw) as Partial<LocalProfile>
    const displayName =
      typeof parsed.displayName === 'string' && parsed.displayName.trim()
        ? parsed.displayName.trim().slice(0, 40)
        : DEFAULT_NAME
    const email =
      typeof parsed.email === 'string' ? parsed.email.trim().slice(0, 120) : ''
    return { displayName, email }
  } catch {
    return { displayName: DEFAULT_NAME, email: '' }
  }
}

export function saveLocalProfile(profile: LocalProfile): void {
  try {
    localStorage.setItem(
      LOCAL_PROFILE_KEY,
      JSON.stringify({
        displayName: profile.displayName.trim().slice(0, 40) || DEFAULT_NAME,
        email: profile.email.trim().slice(0, 120),
      }),
    )
  } catch {
    /* ignore */
  }
}

/** Up to two initials from the display name. */
export function profileInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return 'K'
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase()
}
