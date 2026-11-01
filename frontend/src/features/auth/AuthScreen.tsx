// AuthScreen: email/password login + registration. Registration does not
// require email confirmation, so testing stays frictionless.
import { useState } from 'react'
import { GraduationCap, LogIn, UserPlus } from 'lucide-react'
import { login, register, type AuthUser } from '../../lib/auth'
import { GlassCard, Button, Input, Label, Spinner } from '../../components/ui'

type Mode = 'login' | 'register'

export function AuthScreen({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    setSubmitting(true)
    try {
      if (mode === 'register') {
        // Register, then flip to login rather than auto-signing in.
        await register(email.trim(), password, fullName.trim())
        setNotice('Registration successful! Please sign in with your credentials.')
        setMode('login')
        setEmail(email.trim())
        setPassword('')
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

        {notice && (
          <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">{notice}</p>
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