// Auth helpers: register/login via Supabase Auth (email/password) and token
// persistence in localStorage. No email confirmation is required — Supabase
// Auth with auto-confirm returns a session immediately on signup.
import { getSupabase } from './supabase'

const TOKEN_KEY = 'classo.accessToken'
const USER_KEY = 'classo.user'

export interface AuthUser {
  id: string
  email: string
  fullName?: string
}

/** getAccessToken returns the persisted Supabase access token, or null. */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** getStoredUser returns the persisted user object, or null. */
export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

/** persistSession stores the token + user object. */
function persistSession(token: string, user: AuthUser) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore storage errors */
  }
}

/** clearSession removes persisted auth state (logout). */
export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore storage errors */
  }
}

/** register creates a new account and returns the session user. The new user's
 * profile row is created automatically by the backend (handle_new_user). */
export async function register(email: string, password: string, fullName: string): Promise<AuthUser> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase is not configured (missing VITE_SUPABASE_* env).')

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) throw new Error(error.message)

  const session = data.session
  if (session) {
    persistSession(session.access_token, {
      id: session.user.id,
      email: session.user.email ?? email,
      fullName,
    })
    return { id: session.user.id, email: email, fullName }
  }

  // No session returned (some projects require confirmation); treat as a
  // provisional user so the UI can still proceed in auto-confirm mode.
  const user = data.user
  if (user) {
    return { id: user.id, email: user.email ?? email, fullName }
  }
  throw new Error('Signup returned no user or session.')
}

/** login authenticates an existing account and returns the session user. */
export async function login(email: string, password: string): Promise<AuthUser> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase is not configured (missing VITE_SUPABASE_* env).')

  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)

  const session = data.session
  if (!session) throw new Error('Login returned no session.')

  const meta = session.user.user_metadata as { full_name?: string } | undefined
  persistSession(session.access_token, {
    id: session.user.id,
    email: session.user.email ?? email,
    fullName: meta?.full_name,
  })
  const user: AuthUser = {
    id: session.user.id,
    email: session.user.email ?? email,
    fullName: meta?.full_name,
  }
  return user
}

/** logout clears the local session and signs out of Supabase Auth. */
export async function logout(): Promise<void> {
  const sb = getSupabase()
  if (sb) {
    try {
      await sb.auth.signOut()
    } catch {
      /* ignore */
    }
  }
  clearSession()
}