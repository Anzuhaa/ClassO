// CourseDetail: course header (name + join code), group list with AI/random
// formation and self-join, and a course member roster panel (Features 2 & 3).
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Sparkles,
  Shuffle,
  Users,
  Copy,
  Check,
  LogIn,
  UserPlus,
} from 'lucide-react'
import { api, ApiError, activeUserId } from '../../lib/api'
import type { Course, CourseMember, Group } from '../../types'
import { GlassCard, Button, Spinner } from '../../components/ui'

export function CourseDetail({
  courseId,
  onBack,
  onOpenGroup,
}: {
  courseId: string
  onBack: () => void
  onOpenGroup: (groupId: string) => void
}) {
  const [course, setCourse] = useState<Course | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [members, setMembers] = useState<CourseMember[]>([])
  const [myGroupId, setMyGroupId] = useState('')
  const [loading, setLoading] = useState(true)
  const [forming, setForming] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  const [usedAi, setUsedAi] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const userId = activeUserId()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [c, gs, ms, my] = await Promise.all([
        api.getCourse(courseId),
        api.listGroups(courseId),
        api.listCourseMembers(courseId),
        api.myGroup(courseId),
      ])
      setCourse(c)
      setGroups(gs ?? [])
      setMembers(ms ?? [])
      setMyGroupId(my?.groupId ?? '')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load course')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  const isInstructor =
    !!course &&
    (course.ownerId === userId ||
      members.some((m) => m.id === userId && m.courseRole === 'instructor'))

  const runFormation = async (kind: 'ai' | 'random') => {
    setForming(kind === 'ai')
    setAssigning(kind === 'random')
    setError('')
    setMessage('')
    setUsedAi(null)
    try {
      const result = kind === 'ai' ? await api.formGroups(courseId) : await api.randomAssign(courseId)
      setUsedAi(result.usedAi)
      setMessage(
        kind === 'random'
          ? `Randomly formed ${result.groups.length} groups.`
          : result.usedAi
            ? `AI balanced ${result.groups.length} groups.`
            : `Formed ${result.groups.length} groups (deterministic fallback — AI unavailable).`,
      )
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to form groups')
    } finally {
      setForming(false)
      setAssigning(false)
    }
  }

  const joinGroup = async (group: Group) => {
    setJoining(group.id)
    setError('')
    setMessage('')
    try {
      await api.joinGroup(group.id)
      setMessage(`Joined ${group.name}.`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to join group')
    } finally {
      setJoining(null)
    }
  }

  const copyCode = async () => {
    if (!course) return
    try {
      await navigator.clipboard.writeText(course.joinCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="space-y-6">
      {/* ---- Course header ---- */}
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-2" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-2xl font-bold">{course?.name ?? 'Course'}</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {course ? `${course.code ? course.code + ' · ' : ''}${groups.length} groups · ${members.length} members` : 'Loading…'}
            </p>
          </div>
        </div>

        {course && isInstructor && (
          <GlassCard className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              Join code
            </span>
            <span className="rounded-lg bg-[var(--surface)] px-3 py-1 font-mono text-lg font-bold tracking-widest text-[var(--accent)]">
              {course.joinCode}
            </span>
            <Button variant="ghost" onClick={copyCode} className="px-2" aria-label="Copy join code">
              {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </GlassCard>
        )}
      </header>

      {/* ---- Instructor actions ---- */}
      {course && isInstructor && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => runFormation('ai')} disabled={forming || assigning}>
            {forming ? <Spinner /> : <Sparkles size={16} />}
            Form Groups with AI
          </Button>
          <Button onClick={() => runFormation('random')} disabled={forming || assigning} variant="ghost">
            {assigning ? <Spinner /> : <Shuffle size={16} />}
            Random Assign
          </Button>
        </div>
      )}

      {message && (
        <GlassCard className="flex items-center gap-2 p-4 text-sm">
          <Sparkles size={16} className={usedAi ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'} />
          {message}
        </GlassCard>
      )}
      {error && <GlassCard className="p-4 text-sm text-red-500">{error}</GlassCard>}

      {/* ---- Body: groups + roster ---- */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          {loading ? (
            <div className="flex justify-center py-16 text-[var(--text-secondary)]">
              <Spinner />
            </div>
          ) : groups.length === 0 ? (
            <GlassCard className="p-10 text-center text-[var(--text-secondary)]">
              <Users size={40} className="mx-auto mb-3 opacity-40" />
              <p className="font-semibold text-[var(--text)]">No groups yet</p>
              <p className="text-sm">
                {isInstructor
                  ? 'Form groups with AI or random assignment.'
                  : 'Your instructor has not formed groups yet.'}
              </p>
            </GlassCard>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map((g, i) => {
                const full = course != null && (g.memberCount ?? 0) >= course.groupSize
                const alreadyInThis = myGroupId === g.id
                const alreadyElsewhere = myGroupId !== '' && myGroupId !== g.id
                return (
                  <GlassCard key={g.id} className="p-5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{g.name}</h3>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
                        {i + 1}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">
                      {g.memberCount ?? 0}/{course?.groupSize ?? '?'} members
                    </p>
                    <div className="mt-4 flex items-center justify-between">
                      <button
                        className="text-sm font-medium text-[var(--accent)] hover:underline"
                        onClick={() => onOpenGroup(g.id)}
                      >
                        Open workspace →
                      </button>
                      {isInstructor ? null : alreadyInThis ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500">
                          <Check size={14} /> Joined
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          className="px-3 py-1.5 text-xs"
                          disabled={!!joining || full || alreadyElsewhere}
                          onClick={() => joinGroup(g)}
                        >
                          {joining === g.id ? <Spinner /> : <LogIn size={14} />}
                          Join Group
                        </Button>
                      )}
                    </div>
                    {full && !alreadyInThis && (
                      <p className="mt-2 text-xs text-[var(--text-tertiary)]">Group is full.</p>
                    )}
                    {alreadyElsewhere && (
                      <p className="mt-2 text-xs text-[var(--text-tertiary)]">You are already in another group.</p>
                    )}
                  </GlassCard>
                )
              })}
            </div>
          )}
        </div>

        {/* ---- Course member roster ---- */}
        <GlassCard className="h-fit p-4 lg:sticky lg:top-8">
          <div className="mb-3 flex items-center gap-2">
            <UserPlus size={16} className="text-[var(--text-tertiary)]" />
            <h3 className="text-sm font-semibold text-[var(--text-secondary)]">
              Course Members ({members.length})
            </h3>
          </div>
          {members.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--text-tertiary)]">No members yet.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-xs font-semibold text-[var(--accent)]">
                    {initials(m.fullName)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.fullName || m.email}
                      {m.id === userId && <span className="text-[var(--text-tertiary)]"> (you)</span>}
                    </p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">
                      {m.courseRole}
                      {m.skills.length > 0 ? ` · ${m.skills.join(', ')}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>
    </div>
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