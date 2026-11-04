// AuthScreen: email/password login + registration. Registration does not
// require email confirmation, so testing stays frictionless. Username is
// checked for availability (debounced) and again on submit.
import { useEffect, useState } from 'react'
import { CheckCircle2, GraduationCap, LogIn, UserPlus, XCircle } from 'lucide-react'
import { login, register, sendPasswordReset, type AuthUser } from '../../lib/auth'
import { api } from '../../lib/api'
import { GlassCard, Button, Input, Label, Spinner } from '../../components/ui'

type Mode = 'login' | 'register'

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken'

export function AuthScreen({
  onAuthed,
  initialNotice = '',
  onDismissNotice,
}: {
  onAuthed: (user: AuthUser) => void
  initialNotice?: string
  onDismissNotice?: () => void
}) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(initialNotice)
  const [sendingReset, setSendingReset] = useState(false)

  // Surface the post-verification toast injected by App's callback handler, and
  // clear it once the parent has handed it over.
  useEffect(() => {
    if (initialNotice) setNotice(initialNotice)
  }, [initialNotice])

  // Debounced username availability check (400ms). Only meaningful in register
  // mode; a blank or over-long username resets to idle without a round-trip.
  useEffect(() => {
    if (mode !== 'register') return
    const name = username.trim()
    if (!name || name.length < 3) {
      setUsernameStatus('idle')
      return
    }
    setUsernameStatus('checking')
    const t = setTimeout(() => {
      api
        .checkUsername(name)
        .then((res) => setUsernameStatus(res.available ? 'available' : 'taken'))
        .catch(() => setUsernameStatus('idle'))
    }, 400)
    return () => clearTimeout(t)
  }, [username, mode])

  const submit = async () => {
    setError('')
    setNotice('')
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    if (mode === 'register' && !fullName.trim()) {
      setError('Full name is required.')
      return
    }
    if (mode === 'register' && username.trim()) {
      // Strict final check before submitting so a race with the debounce can't
      // let a taken username through.
      try {
        const res = await api.checkUsername(username.trim())
        if (!res.available) {
          setUsernameStatus('taken')
          setError('Username already taken.')
          return
        }
      } catch {
        // Network failure on the final check is non-fatal here; the backend
        // unique index still rejects a collision on signup.
      }
    }
    setSubmitting(true)
    try {
      if (mode === 'register') {
        // Register, then flip to login rather than auto-signing in.
        await register(email.trim(), password, fullName.trim(), username.trim() || undefined)
        setNotice('Registration successful! Please sign in with your credentials.')
        setMode('login')
        setEmail(email.trim())
        setPassword('')
        setUsername('')
        return
      }
      const user = await login(email.trim(), password)
      onAuthed(user)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleForgotPassword = async () => {
    setError('')
    setNotice('')
    if (!email.trim()) {
      setError('Enter your email above, then click "Forgot password?".')
      return
    }
    setSendingReset(true)
    try {
      await sendPasswordReset(email.trim())
      setNotice('Password reset email sent. Check your inbox.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send reset email')
    } finally {
      setSendingReset(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <GlassCard strong className="w-full max-w-sm p-6 space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
            <GraduationCap size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold">ClassO</h1>
            <p className="text-xs text-[var(--text-secondary)]">
              {mode === 'login' ? 'Sign in to continue' : 'Create your account'}
            </p>
          </div>
        </div>

        {mode === 'register' && (
          <Label text="Full name">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </Label>
        )}

        {mode === 'register' && (
          <Label text="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="janedoe"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
            />
            {username.trim().length >= 3 && (
              <span className="text-xs">
                {usernameStatus === 'checking' && (
                  <span className="text-[var(--text-tertiary)]">Checking availability…</span>
                )}
                {usernameStatus === 'available' && (
                  <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                    <CheckCircle2 size={12} /> Username available
                  </span>
                )}
                {usernameStatus === 'taken' && (
                  <span className="inline-flex items-center gap-1 text-red-500">
                    <XCircle size={12} /> Username already taken
                  </span>
                )}
              </span>
            )}
          </Label>
        )}

        <Label text="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@university.edu"
            autoComplete="email"
          />
        </Label>

        <Label text="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </Label>

        {mode === 'login' && (
          <div className="flex justify-end">
            <button
              onClick={handleForgotPassword}
              disabled={sendingReset}
              className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              {sendingReset ? 'Sending…' : 'Forgot password?'}
            </button>
          </div>
        )}

        {notice && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            <span>{notice}</span>
            <button
              onClick={() => {
                setNotice('')
                onDismissNotice?.()
              }}
              className="shrink-0 text-xs font-medium text-inherit opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}

        <Button onClick={submit} disabled={submitting} className="w-full">
          {submitting ? <Spinner /> : mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
          {mode === 'login' ? 'Sign in' : 'Register'}
        </Button>

        <p className="text-center text-sm text-[var(--text-secondary)]">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            className="font-medium text-[var(--accent)] hover:underline"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError('')
              setNotice('')
            }}
          >
            {mode === 'login' ? 'Register' : 'Sign in'}
          </button>
        </p>
      </GlassCard>
    </div>
  )
}