/**
 * First-launch onboarding flag — device-local only.
 */

export const ONBOARDING_SEEN_KEY = 'parkvibe_onboarding_seen'

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, 'true')
  } catch {
    /* private mode / quota */
  }
}

/** Clears the flag so the modal can be shown again from Teave/Settings. */
export function resetOnboardingSeen(): void {
  try {
    localStorage.removeItem(ONBOARDING_SEEN_KEY)
  } catch {
    /* ignore */
  }
}
