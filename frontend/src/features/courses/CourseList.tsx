// CourseList: the dashboard home showing all courses plus create/join forms
// and per-course delete (with confirmation).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Users, LogIn, X, ClipboardPaste, Trash2 } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { Course } from '../../types'
import { GlassCard, Button, Input, Label, Spinner } from '../../components/ui'

export function CourseList({ onCreated, isInstructor }: { onCreated: () => void; isInstructor: boolean }) {
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showJoin, setShowJoin] = useState(false)

  // Form state.
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  // Join state.
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  // Delete state.
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null)
  const [deleting, setDeleting] = useState(false)

  const userId = getStoredUser()?.id ?? ''

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setCourses((await api.listCourses()) ?? [])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load courses')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    setFormError('')
    if (!name.trim()) {
      setFormError('Course name is required.')
      return
    }
    setSubmitting(true)
    try {
      await api.createCourse({ name: name.trim(), code: code.trim() || undefined })
      setName('')
      setCode('')
      setShowForm(false)
      await load()
      onCreated()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed to create course')
    } finally {
      setSubmitting(false)
    }
  }

  const join = async () => {
    setJoinError('')
    if (!joinCode.trim()) {
      setJoinError('Enter a join code.')
      return
    }
    setJoining(true)
    try {
      await api.joinCourse(joinCode.trim())
      setJoinCode('')
      setShowJoin(false)
      await load()
      onCreated()
    } catch (e) {
      setJoinError(e instanceof ApiError ? e.message : 'Failed to join course')
    } finally {
      setJoining(false)
    }
  }

  // Paste from clipboard (Feature 4) — reads text and sets the join code.
  const pasteCode = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const code = text.trim().toUpperCase().slice(0, 6)
      if (code) setJoinCode(code)
    } catch {
      setJoinError('Clipboard unavailable — paste manually.')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteCourse(deleteTarget.id)
      setDeleteTarget(null)
      await load()
      onCreated()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete course')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">My Courses</h2>
          <p className="text-sm text-[var(--text-secondary)]">Manage courses and group formation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowJoin(true)}>
            <LogIn size={16} />
            Join Course
          </Button>
          {isInstructor && (
            <Button onClick={() => setShowForm((s) => !s)}>
              <Plus size={16} />
              New Course
            </Button>
          )}
        </div>
      </header>

      {showForm && (
        <GlassCard className="p-5 space-y-4 animate-fade-in">
          <h3 className="text-lg font-semibold">Create a course</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="Course name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rekayasa Perangkat Lunak" />
            </Label>
            <Label text="Code (optional)">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="IF4020" />
            </Label>
          </div>
          {formError && <p className="text-sm text-red-500">{formError}</p>}
          <div className="flex gap-2">
            <Button onClick={create} disabled={submitting}>
              {submitting ? <Spinner /> : <Plus size={16} />}
              Create
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </GlassCard>
      )}

      {/* ---- Join course modal ---- */}
      {showJoin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowJoin(false)}>
          <GlassCard strong className="w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Join a course</h3>
              <button onClick={() => setShowJoin(false)} className="btn-ghost p-2" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <Label text="Join code">
              <div className="flex gap-2">
                <Input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="CLS482"
                  className="font-mono tracking-widest"
                  maxLength={6}
                />
                <Button variant="ghost" onClick={pasteCode} className="px-3" aria-label="Paste from clipboard">
                  <ClipboardPaste size={16} />
                </Button>
              </div>
            </Label>
            {joinError && <p className="text-sm text-red-500">{joinError}</p>}
            <Button onClick={join} disabled={joining} className="w-full">
              {joining ? <Spinner /> : <LogIn size={16} />}
              Join
            </Button>
          </GlassCard>
        </div>
      )}

      {/* ---- Delete confirmation modal ---- */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <GlassCard strong className="w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Delete course?</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              This permanently deletes <span className="font-semibold text-[var(--text)]">{deleteTarget.name}</span> and
              all its groups, members, chat, tasks, and files. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button onClick={confirmDelete} disabled={deleting} className="!bg-red-600">
                {deleting ? <Spinner /> : <Trash2 size={16} />}
                Delete
              </Button>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-[var(--text-secondary)]">
          <Spinner />
        </div>
      ) : error ? (
        <GlassCard className="p-6 text-center text-[var(--text-secondary)]">{error}</GlassCard>
      ) : courses.length === 0 ? (
        <GlassCard className="p-10 text-center text-[var(--text-secondary)]">
          <Users size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-semibold text-[var(--text)]">No courses yet</p>
          <p className="text-sm">Create your first course, or join one with a code.</p>
        </GlassCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <div key={c.id} className="relative">
              <GlassCard
                className="group cursor-pointer p-5 transition-transform hover:-translate-y-0.5"
                onClick={() => navigate(`/courses/${c.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{c.name}</h3>
                    <p className="text-sm text-[var(--text-secondary)]">{c.code || `Join: ${c.joinCode}`}</p>
                  </div>
                  <Users size={20} className="text-[var(--text-tertiary)]" />
                </div>
              </GlassCard>
              {c.ownerId === userId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(c)
                  }}
                  className="absolute right-2 top-2 rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--surface)] hover:text-red-500"
                  aria-label={`Delete ${c.name}`}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}