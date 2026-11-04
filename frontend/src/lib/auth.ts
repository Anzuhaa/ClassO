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
 * The emailed link lands on the app's `/auth/callback` route, which establishes
 * the recovery session and then forwards the user to `/reset-password` to choose
 * a new password. */
export async function sendPasswordReset(email: string): Promise<void> {
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase is not configured (missing VITE_SUPABASE_* env).')
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/auth/callback`,
  })
  if (error) throw new Error(error.message)
}

/** completePasswordReset sets a new password using the recovery session
 * established by handleAuthCallback (the reset-email link). */
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

/** handleAuthCallback processes an incoming Supabase auth redirect (email
 * confirmation or password recovery). It establishes the session from the URL
 * (PKCE `?code=` or implicit `#access_token=…`), then reports which flow it was.
 * For a recovery link the session is kept so the caller can route to
 * `/reset-password`; for email verification the session is cleared so the caller
 * routes to `/login`. */
export async function handleAuthCallback(): Promise<{
  kind: 'verify' | 'recovery'
  message: string
}> {
  const sb = getSupabase()
  const search = new URLSearchParams(window.location.search)
  const hash = parseHashParams()
  const isRecovery = search.get('type') === 'recovery' || hash.type === 'recovery'

  if (!sb) {
    clearSession()
    return { kind: isRecovery ? 'recovery' : 'verify', message: 'Please continue.' }
  }

  try {
    // PKCE flow: a `?code=` query param is exchanged for a verified session.
    const code = search.get('code')
    if (code) {
      const { data } = await sb.auth.exchangeCodeForSession(code)
      if (data?.session) {
        if (isRecovery) {
          return { kind: 'recovery', message: 'Set a new password to finish signing in.' }
        }
        // Email verification: do not auto-authenticate — sign out and go to login.
        await sb.auth.signOut().catch(() => {})
        clearSession()
        return { kind: 'verify', message: 'Email verified successfully! Please log in to continue.' }
      }
    }

    // Implicit flow: the tokens arrive in the hash fragment.
    if (hash.access_token) {
      const { data } = await sb.auth.setSession({
        access_token: hash.access_token,
        refresh_token: hash.refresh_token ?? '',
      })
      if (data?.session) {
        if (isRecovery) {
          return { kind: 'recovery', message: 'Set a new password to finish signing in.' }
        }
        await sb.auth.signOut().catch(() => {})
        clearSession()
        return { kind: 'verify', message: 'Email verified successfully! Please log in to continue.' }
      }
    }
  } catch {
    /* ignore — fall through to clearing state */
  }

  clearSession()
  return {
    kind: isRecovery ? 'recovery' : 'verify',
    message: isRecovery ? 'Set a new password to finish signing in.' : 'Email verified successfully! Please log in to continue.',
  }
}