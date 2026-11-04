// Supabase client singletons. The project URL and anon key come from Vite env
// vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). The anon key is safe to
// ship to the browser; Supabase Auth enforces server-side policies.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAccessToken } from './auth'

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
        autoRefreshToken: true,
        persistSession: true,
        // Parse auth redirects (email confirmation / password recovery) from the
        // URL hash so `getSession()` can report the established session.
        detectSessionInUrl: true,
      },
    })
  }
  return client
}

// A second, realtime-only client that authenticates with the current user's
// access token (read from storage on every use) so Realtime's postgres_changes
// resolve auth.uid() and pass RLS. Unlike getSupabase(), this client is NOT
// used for Supabase Auth login/register (which needs its own auth namespace),
// so we bind the token via the top-level `accessToken` option instead of a
// session. When the token is absent the channel simply receives nothing (RLS
// filters it), which is the correct fallback for a signed-out or
// ALLOW_NO_AUTH visitor.
let realtimeClient: SupabaseClient | null = null

/** getRealtimeClient returns a Supabase client wired for Realtime subscriptions
 * with the current access token, or null when the env is not configured. */
export function getRealtimeClient(): SupabaseClient | null {
  if (!url || !anonKey) return null
  if (!realtimeClient) {
    realtimeClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      accessToken: async () => getAccessToken(),
    })
  }
  return realtimeClient
}