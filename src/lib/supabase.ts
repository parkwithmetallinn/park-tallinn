/**
 * Browser Supabase client stub.
 * Reports never use the anon key — the browser talks only to /api/reports
 * (SUPABASE_SERVICE_ROLE_KEY on the server). Do not wire VITE_SUPABASE_* here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Always false — reports go through /api/reports, not a browser Supabase client. */
export function isSupabaseConfigured(): boolean {
  return false
}

/** Reserved for future public (non-reports) features — currently unused. */
export function getSupabase(): SupabaseClient | null {
  return null
}
