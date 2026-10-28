// CourseList: the dashboard home showing all courses plus a create form.
import { useEffect, useState } from 'react'
import { Plus, Users } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import type { Course } from '../../types'
import { GlassCard, Button, Input, Label, Spinner } from '../../components/ui'

export function CourseList({
  onOpen,
  onCreated,
}: {
  onOpen: (courseId: string) => void
  onCreated: () => void
}) {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)

  // Form state.
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [groupSize, setGroupSize] = useState(4)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

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
    if (groupSize < 1) {
      setFormError('Group size must be at least 1.')
      return
    }
    setSubmitting(true)
    try {
      await api.createCourse({ name: name.trim(), code: code.trim() || undefined, groupSize })
      setName('')
      setCode('')
      setGroupSize(4)
      setShowForm(false)
      await load()
      onCreated()
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed to create course')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">My Courses</h2>
          <p className="text-sm text-[var(--text-secondary)]">Manage courses and group formation</p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          <Plus size={16} />
          New Course
        </Button>
      </header>

      {showForm && (
        <GlassCard className="p-5 space-y-4 animate-fade-in">
          <h3 className="text-lg font-semibold">Create a course</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Label text="Course name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rekayasa Perangkat Lunak" />
            </Label>
            <Label text="Code (optional)">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="IF4020" />
            </Label>
            <Label text="Members per group">
              <Input type="number" min={1} value={groupSize} onChange={(e) => setGroupSize(Number(e.target.value))} />
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
          <p className="text-sm">Create your first course to start forming groups.</p>
        </GlassCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <GlassCard
              key={c.id}
              className="group cursor-pointer p-5 transition-transform hover:-translate-y-0.5"
              onClick={() => onOpen(c.id)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{c.name}</h3>
                  <p className="text-sm text-[var(--text-secondary)]">{c.code || 'No code'}</p>
                </div>
                <Users size={20} className="text-[var(--text-tertiary)]" />
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 font-medium text-[var(--accent)]">
                  {c.groupSize} / group
                </span>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}