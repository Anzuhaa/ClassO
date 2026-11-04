// UserMenu: the signed-in user control with avatar, an "Edit profile" entry
// point (which opens the unified EditProfileModal), logout, and self-promotion to
// instructor for allowlisted emails.
import { useState } from 'react'
import { LogOut, Pencil, ShieldCheck, User } from 'lucide-react'
import { logout, type AuthUser } from '../../lib/auth'
import { api, ApiError } from '../../lib/api'
import { EditProfileModal } from './EditProfileModal'

const FRIENDLY_PROMOTE_403 =
  'This email is not registered on the instructor allowlist. Please contact the administrator for access.'

export function UserMenu({
  user,
  onLogout,
  onPromoted,
  onUserUpdated,
}: {
  user: AuthUser
  onLogout: () => void
  onPromoted: () => void
  onUserUpdated: (user: AuthUser) => void
}) {
  const [promoting, setPromoting] = useState(false)
  const [promoteError, setPromoteError] = useState('')
  const [editing, setEditing] = useState(false)

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
      setPromoteError(
        e instanceof ApiError && e.status === 403 ? FRIENDLY_PROMOTE_403 : e instanceof ApiError ? e.message : 'Failed to promote',
      )
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5 rounded-xl p-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <User size={18} />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.fullName || user.email}</p>
          <p className="truncate text-xs text-[var(--text-tertiary)]">
            {user.email} · {user.role === 'instructor' ? 'Instructor' : 'Student'}
          </p>
          <button
            onClick={() => setEditing(true)}
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
          >
            <Pencil size={10} />
            Edit profile
          </button>
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
          {promoteError && <p className="px-2 text-xs text-red-500">{promoteError}</p>}
        </>
      )}
      <button
        onClick={handleLogout}
        className="btn-ghost inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm"
      >
        <LogOut size={16} />
        Sign out
      </button>

      <EditProfileModal
        user={user}
        open={editing}
        onClose={() => setEditing(false)}
        onUserUpdated={onUserUpdated}
      />
    </div>
  )
}