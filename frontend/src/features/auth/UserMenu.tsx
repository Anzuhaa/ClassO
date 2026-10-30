// UserMenu: a compact sidebar control showing the signed-in user with logout,
// plus their role. Replaces the old demo profile switcher (Feature 6 auth).
import { useState } from 'react'
import { User, LogOut, ShieldCheck } from 'lucide-react'
import { logout, type AuthUser } from '../../lib/auth'
import { api, ApiError } from '../../lib/api'

export function UserMenu({
  user,
  onLogout,
  onPromoted,
}: {
  user: AuthUser
  onLogout: () => void
  onPromoted: () => void
}) {
  const [promoting, setPromoting] = useState(false)
  const [promoteError, setPromoteError] = useState('')

  const handleLogout = async () => {
    await logout()
    onLogout()
  }

  const handlePromote = async () => {
    setPromoting(true)
    setPromoteError('')
    try {
      await api.promoteMe()
      onPromoted()
    } catch (e) {
      setPromoteError(e instanceof ApiError ? e.message : 'Failed to promote')
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5 rounded-xl p-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
          <User size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.fullName || user.email}</p>
          <p className="truncate text-xs text-[var(--text-tertiary)]">
            {user.email} · {user.role === 'instructor' ? 'Instructor' : 'Student'}
          </p>
        </div>
      </div>
      {user.role === 'student' && (
        <>
          <button
            onClick={handlePromote}
            disabled={promoting}
            className="btn-ghost inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
          >
            <ShieldCheck size={16} />
            {promoting ? 'Promoting…' : 'Become instructor'}
          </button>
          {promoteError && (
            <p className="px-2 text-xs text-red-500">{promoteError}</p>
          )}
        </>
      )}
      <button
        onClick={handleLogout}
        className="btn-ghost inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm"
      >
        <LogOut size={16} />
        Sign out
      </button>
    </div>
  )
}