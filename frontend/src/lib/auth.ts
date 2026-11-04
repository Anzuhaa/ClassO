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
  role: 'instructor' | 'student'
  avatarUrl?: string
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

/** getStoredUser returns the persisted user object, or null. Older persisted
 * sessions predating the role field default to 'student'. */
export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as Partial<AuthUser>
    if (!u.id || !u.email) return null
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role === 'instructor' ? 'instructor' : 'student',
      avatarUrl: u.avatarUrl,
    }
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

/** persistUser updates only the stored user object (e.g. after a role refresh),
 * leaving the existing token untouched. */
export function persistUser(user: AuthUser) {
  try {
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

/** roleFromMeta reads the instructor/student role from Supabase user metadata,
 * defaulting to 'student'. */
function roleFromMeta(user: { user_metadata?: Record<string, unknown> } | undefined): 'instructor' | 'student' {
  const r = user?.user_metadata?.role
  return r === 'instructor' ? 'instructor' : 'student'
}

/** register creates a new account without signing the user in. The new user's
 * profile row is created automatically by the backend (handle_new_user), which
 * also persists the optional username. Any session Supabase returns from
 * auto-confirm is discarded (and signed out) so the caller can redirect to the
 * login screen instead of auto-authenticating. */
export async function register(email: string, password: string, fullName: string, username?: string): Promise<AuthUser> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase is not configured (missing VITE_SUPABASE_* env).')

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, username: username?.trim() || undefined } },
  })
  if (error) throw new Error(error.message)

  // Auto-confirm returns a session immediately; drop it so the caller can send
  // the user to /login rather than auto-signing them in.
  if (data.session) {
    try {
      await sb.auth.signOut()
    } catch {
      /* ignore */
    }
  }
  clearSession()

  const user = data.user
  if (user) {
    const role = roleFromMeta(user)
    return { id: user.id, email: user.email ?? email, fullName, role }
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
  const role = roleFromMeta(session.user)
  persistSession(session.access_token, {
    id: session.user.id,
    email: session.user.email ?? email,
    fullName: meta?.full_name,
    role,
  })
  return {
    id: session.user.id,
    email: session.user.email ?? email,
    fullName: meta?.full_name,
    role,
  }
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

/** sendPasswordReset triggers Supabase's password-recovery email for an address.
 * The emailed link lands directly on `/reset-password`; that page establishes the
 * recovery session from the URL and lets the user choose a new password. */
export async function sendPasswordReset(email: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase is not configured (missing VITE_SUPABASE_* env).')
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw new Error(error.message)
}

/** parseHashParams extracts the auth tokens Supabase returns in the URL hash
 * (implicit flow): #access_token=…&refresh_token=…&type=recovery. */
function parseHashParams(): Record<string, string> {
  const out: Record<string, string> = {}
  const hash = window.location.hash.replace(/^#/, '')
  for (const pair of hash.split('&')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1))
  }
  return out
}

/** establishRecoverySession reads the password-reset link's tokens from the URL
 * (implicit `#access_token=…` or PKCE `?code=`) and establishes the auth session
 * so the user can then set a new password. Returns false when the link is
 * invalid or expired. */
export async function establishRecoverySession(): Promise<boolean> {
  const sb = getSupabase()
  if (!sb) return false

  const hash = parseHashParams()
  const code = new URLSearchParams(window.location.search).get('code')

  // PKCE flow: exchange the one-time code for a session.
  if (code) {
    const { data, error } = await sb.auth.exchangeCodeForSession(code)
    return !error && !!data.session
  }

  // Implicit flow: set the session from the tokens in the hash.
  if (hash.access_token) {
    const { data, error } = await sb.auth.setSession({
      access_token: hash.access_token,
      refresh_token: hash.refresh_token ?? '',
    })
    return !error && !!data.session
  }

  // Nothing to exchange — the user may have landed here directly, or already
  // have a valid recovery session persisted.
  const { data } = await sb.auth.getSession()
  return !!data.session
}

/** completePasswordReset sets a new password using the recovery session
 * established by establishRecoverySession (the reset-email link). */
export async function completePasswordReset(newPassword: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase is not configured (missing VITE_SUPABASE_* env).')
  const { data, error } = await sb.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
  if (!data.user) throw new Error('Password reset returned no user.')
}

/** updatePassword sets a new password for the currently signed-in user (used by
 * the "change password" flow inside the Edit Profile modal). */
export async function updatePassword(newPassword: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase is not configured (missing VITE_SUPABASE_* env).')
  const { error } = await sb.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}

/** handleAuthCallback processes an incoming Supabase email-verification redirect.
 * It establishes the session from the URL (PKCE `?code=` or implicit
 * `#access_token=…`), then signs the user out and clears state so the caller can
 * route to `/login` with a success notice rather than auto-signing them in.
 * (Password recovery now routes directly to `/reset-password` instead.) */
export async function handleAuthCallback(): Promise<{ message: string }> {
  const message = 'Email verified successfully! Please log in to continue.'
  const sb = getSupabase()
  if (!sb) {
    clearSession()
    return { message }
  }

  try {
    const search = new URLSearchParams(window.location.search)
    const hash = parseHashParams()

    // PKCE flow.
    const code = search.get('code')
    if (code) {
      const { data } = await sb.auth.exchangeCodeForSession(code)
      if (data?.session) {
        await sb.auth.signOut().catch(() => {})
      }
    } else if (hash.access_token) {
      // Implicit flow.
      const { data } = await sb.auth.setSession({
        access_token: hash.access_token,
        refresh_token: hash.refresh_token ?? '',
      })
      if (data?.session) {
        await sb.auth.signOut().catch(() => {})
      }
    }
  } catch {
    /* ignore — we always clear state and route to login */
  }

  clearSession()
  return { message }
}