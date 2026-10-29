// UserMenu: a compact sidebar control showing the signed-in user with logout,
// plus their role. Replaces the old demo profile switcher (Feature 6 auth).
import { User, LogOut } from 'lucide-react'
import { logout, type AuthUser } from '../../lib/auth'

export function UserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const handleLogout = async () => {
    await logout()
    onLogout()
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