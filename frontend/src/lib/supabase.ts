// Supabase client singleton (auth only). The project URL and anon key come
// from Vite env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). The anon key
// is safe to ship to the browser; Supabase Auth enforces server-side policies.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

/** getSupabase returns a lazily-created Supabase client (or null when the env
 * vars are not configured, e.g. during local ALLOW_NO_AUTH development). */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        // No email confirmation: signup returns a session immediately so
        // testing stays frictionless.
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}