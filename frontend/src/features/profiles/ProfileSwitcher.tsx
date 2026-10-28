// ProfileSwitcher: a modal for selecting or creating a profile (Feature 1).
// The active profile id is persisted to localStorage and sent as X-User-ID on
// every request (see lib/api.ts), giving a fast demo-user switch without
// Supabase email confirmations.
import { useCallback, useEffect, useState } from 'react'
import { User, Check, X, Plus } from 'lucide-react'
import { api, activeUserId, setActiveUserId } from '../../lib/api'
import type { Profile } from '../../types'
import { GlassCard, Button, Input, Label, Spinner } from '../../components/ui'

const SUGGESTED_SKILLS = ['frontend', 'backend', 'design', 'data', 'mobile', 'devops']

export function ProfileSwitcher() {
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  // New profile form.
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'instructor' | 'student'>('student')
  const [skills, setSkills] = useState<string[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProfiles((await api.listProfiles()) ?? [])
    } catch {
      setProfiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const choose = (id: string) => {
    setActiveUserId(id)
    setOpen(false)
    window.dispatchEvent(new Event('classo:profile-changed'))
  }

  const toggleSkill = (s: string) => {
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  const create = async () => {
    if (!fullName.trim()) {
      setError('Enter a full name.')
      return
    }
    setCreating(true)
    setError('')
    try {
      const p = await api.createProfile({ fullName: fullName.trim(), role, skills })
      setActiveUserId(p.id)
      setOpen(false)
      window.dispatchEvent(new Event('classo:profile-changed'))
      setFullName('')
      setRole('student')
      setSkills([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create profile')
    } finally {
      setCreating(false)
    }
  }

  const currentId = activeUserId()

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm"
        aria-label="Switch profile"
      >
        <User size={16} />
        Switch profile
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <GlassCard strong className="w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Switch profile</h3>
              <button onClick={() => setOpen(false)} className="btn-ghost p-2" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {/* Existing profiles */}
            {loading ? (
              <div className="flex justify-center py-6 text-[var(--text-secondary)]">
                <Spinner />
              </div>
            ) : profiles.length === 0 ? (
              <p className="py-4 text-center text-sm text-[var(--text-secondary)]">No profiles yet — create one below.</p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto">
                {profiles.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => choose(p.id)}
                      className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-[var(--surface)] ${
                        p.id === currentId ? 'bg-[var(--surface)]' : ''
                      }`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
                        {initials(p.fullName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.fullName}</p>
                        <p className="truncate text-xs text-[var(--text-tertiary)]">
                          {p.role}
                          {p.skills.length > 0 ? ` · ${p.skills.join(', ')}` : ''}
                        </p>
                      </div>
                      {p.id === currentId && <Check size={16} className="text-[var(--accent)]" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Divider */}
            <div className="hairline" />

            {/* New profile form */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">New profile</h4>
              <Label text="Full name">
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
              </Label>
              <Label text="Role">
                <select
                  className="control px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'instructor' | 'student')}
                >
                  <option value="student">Student</option>
                  <option value="instructor">Instructor</option>
                </select>
              </Label>
              <div>
                <span className="text-xs font-semibold text-[var(--text-secondary)]">Skills / tags</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {SUGGESTED_SKILLS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSkill(s)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        skills.includes(s)
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text)]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button onClick={create} disabled={creating} className="w-full">
                {creating ? <Spinner /> : <Plus size={16} />}
                Create & select
              </Button>
            </div>
          </GlassCard>
        </div>
      )}
    </>
  )
}

/** initials returns up to two uppercase initials for a display name. */
function initials(name: string): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}