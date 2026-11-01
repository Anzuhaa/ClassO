// CourseDetail: course header, group list with random assignment and manual
// group creation, and the member roster. Instructor controls live in
// InstructorControls.tsx; group cards in GroupCard.tsx; roster in RosterPanel.tsx.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Users, Check } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { Course, CourseMember, Group } from '../../types'
import { GlassCard, Spinner } from '../../components/ui'
import { GroupCard } from './GroupCard'
import { RosterPanel } from './RosterPanel'
import { InstructorControls, joinCodeActive } from './InstructorControls'
import { LeaveGroupModal } from './LeaveGroupModal'

export function CourseDetail() {
  const { courseId = '' } = useParams()
  const navigate = useNavigate()
  const [course, setCourse] = useState<Course | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [members, setMembers] = useState<CourseMember[]>([])
  const [myGroupId, setMyGroupId] = useState('')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [joining, setJoining] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [forbidden, setForbidden] = useState(false)
  const [assignCapacity, setAssignCapacity] = useState(4)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [leavingGroup, setLeavingGroup] = useState(false)

  const userId = getStoredUser()?.id ?? ''

  // Tick to flip the join-code badge live as expiry is reached/cleared.
  const [, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setForbidden(false)
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
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        setForbidden(true)
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to load course')
      }
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  const isInstructor =
    !!course &&
    (course.ownerId === userId || members.some((m) => m.id === userId && m.courseRole === 'instructor'))

  const runRandomAssign = async () => {
    setError('')
    setMessage('')
    // Confirm before resetting an existing distribution.
    const willReset = groups.length > 0 || groups.some((g) => (g.memberCount ?? 0) > 0)
    if (willReset && !window.confirm('Running random assignment will reset existing group memberships for this course. Do you want to proceed?')) {
      return
    }
    setAssigning(true)
    try {
      const result = await api.randomAssign(courseId, assignCapacity)
      setMessage(`Randomly formed ${result.groups.length} groups.`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to form groups')
    } finally {
      setAssigning(false)
    }
  }

  const createGroups = async (name: string, capacity: number, count: number) => {
    setError('')
    setMessage('')
    try {
      const created = await api.createGroups(courseId, { name, capacity, count })
      setMessage(`Created ${created.length} group(s).`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create groups')
    }
  }

  const regenerateCode = async () => {
    setError('')
    try {
      setCourse(await api.regenerateJoinCode(courseId))
      setMessage('Join code regenerated.')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to regenerate join code')
    }
  }

  const expireCode = async () => {
    setError('')
    try {
      setCourse(await api.expireJoinCode(courseId))
      setMessage('Join code expired.')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to expire join code')
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

  const leaveGroup = async () => {
    setError('')
    setLeavingGroup(true)
    try {
      await api.leaveGroup(myGroupId)
      setMessage('Left the group.')
      setConfirmLeave(false)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to leave group')
    } finally {
      setLeavingGroup(false)
    }
  }

  const removeCourseMember = async (m: CourseMember) => {
    if (!window.confirm(`Remove ${m.fullName || m.email} from this course?`)) return
    setError('')
    try {
      await api.removeCourseMember(courseId, m.id)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to remove member')
    }
  }

  const deleteGroup = async (g: Group) => {
    if (!window.confirm(`Delete ${g.name}? All its messages, tasks, and files will be removed.`)) return
    setError('')
    try {
      await api.deleteGroup(g.id)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete group')
    }
  }

  return (
    <div className="space-y-6">
      {/* ---- Course header ---- */}
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/courses')} className="btn-ghost p-2" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-2xl font-bold">{course?.name ?? 'Course'}</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {course
                ? `${course.code ? course.code + ' · ' : ''}${groups.length} groups · ${members.length} members`
                : 'Loading…'}
            </p>
            {course && (
              <span
                className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  joinCodeActive(course)
                    ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                    : 'bg-red-500/15 text-red-600 dark:text-red-400'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${joinCodeActive(course) ? 'bg-green-500' : 'bg-red-500'}`} />
                Join code {joinCodeActive(course) ? 'Active' : 'Expired'}
              </span>
            )}
          </div>
        </div>

        {course && isInstructor && (
          <InstructorControls
            course={course}
            assigning={assigning}
            assignCapacity={assignCapacity}
            onAssignCapacity={setAssignCapacity}
            onRandomAssign={runRandomAssign}
            onRegenerate={regenerateCode}
            onExpire={expireCode}
            onCreateGroups={createGroups}
          />
        )}
      </header>

      {forbidden && (
        <GlassCard className="p-10 text-center text-[var(--text-secondary)]">
          <Users size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-semibold text-[var(--text)]">You don't have access to this course</p>
          <p className="text-sm">
            This course may be private, or it no longer exists. If you have a join code,
            join from the My Courses page.
          </p>
          <button onClick={() => navigate('/courses')} className="btn-ghost mt-4 px-3 py-2 text-sm">
            Back to My Courses
          </button>
        </GlassCard>
      )}

      {message && (
        <GlassCard className="flex items-center gap-2 p-4 text-sm">
          <Check size={16} className="text-green-500" />
          {message}
        </GlassCard>
      )}
      {error && <GlassCard className="p-4 text-sm text-red-500">{error}</GlassCard>}

      {/* ---- Body: groups + roster ---- */}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {forbidden ? null : loading ? (
            <div className="flex justify-center py-16 text-[var(--text-secondary)]">
              <Spinner />
            </div>
          ) : groups.length === 0 ? (
            <GlassCard className="p-10 text-center text-[var(--text-secondary)]">
              <Users size={40} className="mx-auto mb-3 opacity-40" />
              <p className="font-semibold text-[var(--text)]">No groups yet</p>
              <p className="text-sm">
                {isInstructor ? 'Use Random Assign or create groups manually.' : 'Your instructor has not formed groups yet.'}
              </p>
            </GlassCard>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map((g, i) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  index={i}
                  myGroupId={myGroupId}
                  isInstructor={isInstructor}
                  joining={joining}
                  onOpen={() => navigate(`/courses/${courseId}/groups/${g.id}`)}
                  onJoin={() => joinGroup(g)}
                  onLeave={() => setConfirmLeave(true)}
                  onDelete={() => deleteGroup(g)}
                />
              ))}
            </div>
          )}
        </div>

        {!forbidden && (
          <RosterPanel
            members={members}
            userId={userId}
            isInstructor={isInstructor}
            onRemove={removeCourseMember}
          />
        )}
      </div>

      {/* ---- Leave group double confirmation ---- */}
      <LeaveGroupModal
        open={confirmLeave}
        leaving={leavingGroup}
        error={error}
        onClose={() => setConfirmLeave(false)}
        onConfirm={leaveGroup}
      />
    </div>
  )
}