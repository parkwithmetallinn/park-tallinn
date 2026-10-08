/**
 * Browser Supabase client (anon key).
 * Keys come from Member B via .env — leave empty for local mock /api/reports fallback.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

let client: SupabaseClient | null = null

/** True when VITE_SUPABASE_* are configured. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

/** Singleton anon client, or null when env keys are missing. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return client
}
