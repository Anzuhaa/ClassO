// ResetPassword: the destination of the "forgot password" email link. The user
// chooses a new password (and confirms it); on success they are routed to /login.
import { useState } from 'react'
import { KeyRound, LogIn } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { completePasswordReset } from '../../lib/auth'
import { GlassCard, Button, Input, Label, Spinner } from '../../components/ui'

export function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    if (!password || !confirm) {
      setError('Both fields are required.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    try {
      await completePasswordReset(password)
      navigate('/login', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <GlassCard strong className="w-full max-w-sm p-6 space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
            <KeyRound size={24} />
          </div>
          <div>
            <h1 className="text-lg font-bold">Reset your password</h1>
            <p className="text-xs text-[var(--text-secondary)]">Choose a new password to sign in.</p>
          </div>
        </div>

        <Label text="New password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            autoFocus
          />
        </Label>
        <Label text="Confirm new password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </Label>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <Button onClick={submit} disabled={busy} className="w-full">
          {busy ? <Spinner /> : <KeyRound size={16} />}
          {busy ? 'Saving…' : 'Set new password'}
        </Button>

        <button
          onClick={() => navigate('/login', { replace: true })}
          className="inline-flex w-full items-center justify-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text)]"
        >
          <LogIn size={14} />
          Back to sign in
        </button>
      </GlassCard>
    </div>
  )
}