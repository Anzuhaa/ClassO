// UserMenu: the signed-in user control with avatar (view + upload), logout, and
// self-promotion to instructor for allowlisted emails.
import { useRef, useState } from 'react'
import { Camera, LogOut, Pencil, ShieldCheck, User } from 'lucide-react'
import { logout, persistUser, type AuthUser } from '../../lib/auth'
import { api, ApiError } from '../../lib/api'

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
  const [uploading, setUploading] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

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

  const handleAvatarChange = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      setAvatarError('Image must be 4MB or smaller.')
      return
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setAvatarError('Use a PNG, JPEG, or WebP image.')
      return
    }
    setUploading(true)
    setAvatarError('')
    try {
      const profile = await api.uploadAvatar(file)
      const updated: AuthUser = { ...user, avatarUrl: profile.avatarUrl }
      persistUser(updated)
      onUserUpdated(updated)
    } catch (e) {
      setAvatarError(e instanceof ApiError ? e.message : 'Failed to upload avatar')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2.5 rounded-xl p-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]"
          aria-label="Change profile picture"
          title="Change profile picture"
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <User size={18} />
          )}
          {/* Hover overlay only — no persistent pencil obscuring the photo. */}
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            {uploading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Camera size={14} className="text-white" />
            )}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void handleAvatarChange(e.target.files?.[0])}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.fullName || user.email}</p>
          <p className="truncate text-xs text-[var(--text-tertiary)]">
            {user.email} · {user.role === 'instructor' ? 'Instructor' : 'Student'}
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
          >
            <Pencil size={10} />
            Change photo
          </button>
        </div>
      </div>

      {avatarError && <p className="px-2 text-xs text-red-500">{avatarError}</p>}

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
    </div>
  )
}