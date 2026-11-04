// EditProfileModal: the unified profile-management surface. It consolidates
// avatar change (with instant local preview) and password management (in-place
// change plus a "send reset email" fallback) behind a single glassmorphic modal.
import { useEffect, useRef, useState } from 'react'
import { Camera, KeyRound, Send, ShieldCheck, Upload, X } from 'lucide-react'
import { persistUser, sendPasswordReset, updatePassword, type AuthUser } from '../../lib/auth'
import { api, ApiError } from '../../lib/api'
import { GlassCard, Button, Input, Label, Spinner } from '../../components/ui'

/** maxAvatarBytes caps an avatar at 4 MiB (mirroring the backend limit). */
const MAX_AVATAR_BYTES = 4 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function EditProfileModal({
  user,
  open,
  onClose,
  onUserUpdated,
}: {
  user: AuthUser
  open: boolean
  onClose: () => void
  onUserUpdated: (user: AuthUser) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [avatarError, setAvatarError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [zoom, setZoom] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordNotice, setPasswordNotice] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  // Reset transient state whenever the modal reopens.
  useEffect(() => {
    if (!open) return
    setPreview(null)
    setFile(null)
    setAvatarError('')
    setZoom(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setPasswordNotice('')
  }, [open])

  const pickAvatar = (f: File | undefined) => {
    if (!f) return
    setAvatarError('')
    if (f.size > MAX_AVATAR_BYTES) {
      setAvatarError('Image must be 4MB or smaller.')
      return
    }
    if (!ALLOWED_AVATAR_TYPES.includes(f.type)) {
      setAvatarError('Use a PNG, JPEG, or WebP image.')
      return
    }

    // Revoke the previous object URL *before* swapping, outside any updater so
    // StrictMode's double-invocation can't revoke a URL mid-render.
    if (preview) URL.revokeObjectURL(preview)

    // Always clear the input's value so picking the same file again still fires
    // `onChange` and the newest selection wins.
    if (fileRef.current) fileRef.current.value = ''

    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const saveAvatar = async () => {
    if (!file) return
    setUploading(true)
    setAvatarError('')
    // Snapshot the file being uploaded so a re-render (or stale closure) can
    // never swap in a different selection mid-flight.
    const selected = file
    try {
      const profile = await api.uploadAvatar(selected)
      const updated: AuthUser = { ...user, avatarUrl: profile.avatarUrl }
      persistUser(updated)
      onUserUpdated(updated)
      setFile(null)
      setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      setAvatarError(e instanceof ApiError ? e.message : 'Failed to upload avatar')
    } finally {
      setUploading(false)
    }
  }

  const changePassword = async () => {
    setPasswordError('')
    setPasswordNotice('')
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.')
      return
    }
    setSavingPassword(true)
    try {
      await updatePassword(newPassword)
      setPasswordNotice('Password updated successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to update password')
    } finally {
      setSavingPassword(false)
    }
  }

  const sendReset = async () => {
    setPasswordError('')
    setPasswordNotice('')
    setSendingReset(true)
    try {
      await sendPasswordReset(user.email)
      setPasswordNotice('Password reset email sent. Check your inbox.')
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to send reset email')
    } finally {
      setSendingReset(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md transition-opacity"
        onClick={onClose}
      >
      <GlassCard strong className="w-full max-w-md space-y-5 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit profile</h3>
          <button onClick={onClose} className="btn-ghost p-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* ---- Avatar ---- */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">Profile picture</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (preview || user.avatarUrl) setZoom(true)
                else fileRef.current?.click()
              }}
              className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)]/10 font-semibold text-[var(--accent)]"
              aria-label="View profile picture"
              title={preview || user.avatarUrl ? 'View larger' : 'Choose avatar'}
            >
              {preview || user.avatarUrl ? (
                <img src={preview || user.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Camera size={22} />
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera size={16} className="text-white" />
              </span>
            </button>
            <div className="min-w-0 flex-1 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept={ALLOWED_AVATAR_TYPES.join(',')}
                className="hidden"
                onChange={(e) => pickAvatar(e.target.files?.[0])}
              />
              <p className="text-xs text-[var(--text-tertiary)]">PNG, JPEG, or WebP · up to 4MB.</p>
              <button
                onClick={() => fileRef.current?.click()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
                disabled={uploading}
              >
                <Camera size={16} />
                Choose new photo
              </button>
              <Button onClick={saveAvatar} disabled={!file || uploading} className="w-full">
                {uploading ? <Spinner /> : <Upload size={16} />}
                {uploading ? 'Uploading…' : 'Upload photo'}
              </Button>
            </div>
          </div>
          {avatarError && <p className="text-xs text-red-500">{avatarError}</p>}
        </div>

        <div className="hairline" />

        {/* ---- Password ---- */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">Change password</p>
          <Label text="Current password">
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Label>
          <Label text="New password">
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Label>
          <Label text="Confirm new password">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Label>

          <Button onClick={changePassword} disabled={savingPassword} className="w-full">
            {savingPassword ? <Spinner /> : <KeyRound size={16} />}
            {savingPassword ? 'Updating…' : 'Update password'}
          </Button>

          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-[var(--text-tertiary)]">Forgot your password?</span>
            <button
              onClick={sendReset}
              disabled={sendingReset}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              {sendingReset ? <Spinner className="h-3 w-3" /> : <Send size={12} />}
              Send reset email
            </button>
          </div>

          {passwordNotice && (
            <p className="flex items-center gap-1 rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-600 dark:text-green-400">
              <ShieldCheck size={13} />
              {passwordNotice}
            </p>
          )}
          {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
        </div>
      </GlassCard>
    </div>

    {/* ---- Enlarged avatar preview ---- */}
    {zoom && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={() => setZoom(false)}
      >
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <img
            src={preview || user.avatarUrl}
            alt="Profile picture preview"
            className="max-h-[80vh] max-w-[80vw] rounded-2xl object-contain shadow-2xl"
          />
          <button
            onClick={() => setZoom(false)}
            className="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-strong)] text-[var(--text)] shadow-md"
            aria-label="Close preview"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    )}
  </>
  )
}