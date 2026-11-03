// CourseDetail: course header, group list with random assignment and manual
// group creation, and the member roster. Instructor controls live in
// InstructorControls.tsx; group cards in GroupCard.tsx; roster in RosterPanel.tsx.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Users, Check } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { Course, CourseMember, Group } from '../../types'
import { GlassCard, Skeleton, SkeletonCircle, SkeletonText } from '../../components/ui'
import { GroupCard } from './GroupCard'
import { RosterPanel } from './RosterPanel'
import { CourseHeader } from './CourseHeader'
import { LeaveGroupModal } from './LeaveGroupModal'
import { JoinRequestsPanel } from './JoinRequestsPanel'
import { useJoinRequests } from './useJoinRequests'
import { useInstructorActions } from './useInstructorActions'

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

  const {
    requests,
    pendingRequestGroupId,
    resolving,
    refresh: refreshRequests,
    resolve,
  } = useJoinRequests(courseId, userId)

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

      // Instructors load the approval queue; students learn whether they have a
      // pending request (its target group drives the card's "request pending" UI).
      const isInst = c.ownerId === userId || ms?.some((m) => m.id === userId && m.courseRole === 'instructor')
      await refreshRequests(isInst)
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        setForbidden(true)
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to load course')
      }
    } finally {
      setLoading(false)
    }
  }, [courseId, userId, refreshRequests])

  useEffect(() => {
    void load()
  }, [load])

  const isInstructor =
    !!course &&
    (course.ownerId === userId || members.some((m) => m.id === userId && m.courseRole === 'instructor'))

  const { runRandomAssign, createGroups, regenerateCode, expireCode } = useInstructorActions(
    courseId,
    groups,
    assignCapacity,
    { setError, setMessage, setAssigning, setCourse, reload: load },
  )

  const joinGroup = async (group: Group) => {
    setJoining(group.id)
    setError('')
    setMessage('')
    try {
      await api.joinGroup(group.id)
      // If the course is locked the join became a pending request rather than an
      // immediate move; still reload so the card reflects the new state.
      setMessage(course?.locked ? `Requested to join ${group.name}. Awaiting instructor approval.` : `Joined ${group.name}.`)
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
      setMessage(course?.locked ? 'Request to leave sent. Awaiting instructor approval.' : 'Left the group.')
      setConfirmLeave(false)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to leave group')
    } finally {
      setLeavingGroup(false)
    }
  }

  const toggleLock = async () => {
    if (!course) return
    setError('')
    setMessage('')
    try {
      setCourse(await api.setCourseLock(courseId, !course.locked))
      setMessage(!course.locked ? 'Group changes now require approval.' : 'Group changes are now open.')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update lock')
    }
  }

  const resolveRequest = async (requestId: string, approve: boolean) => {
    setError('')
    setMessage('')
    try {
      const msg = await resolve(requestId, approve)
      setMessage(msg ?? '')
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to resolve request')
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
      <CourseHeader
        course={course}
        groupCount={groups.length}
        memberCount={members.length}
        isInstructor={isInstructor}
        assigning={assigning}
        assignCapacity={assignCapacity}
        onBack={() => navigate('/courses')}
        onAssignCapacity={setAssignCapacity}
        onRandomAssign={runRandomAssign}
        onRegenerate={regenerateCode}
        onExpire={expireCode}
        onCreateGroups={createGroups}
        onToggleLock={toggleLock}
      />

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

      {/* ---- Instructor approval queue ---- */}
      {isInstructor && (
        <JoinRequestsPanel requests={requests} resolving={resolving} onResolve={resolveRequest} />
      )}

      {/* ---- Body: groups + roster ---- */}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {forbidden ? null : loading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <GlassCard key={i} className="p-5 space-y-3">
                  <SkeletonText className="w-1/3" />
                  <div className="flex items-center gap-2">
                    {Array.from({ length: 3 }).map((_, j) => (
                      <SkeletonCircle key={j} size={28} />
                    ))}
                    <SkeletonText className="w-12" />
                  </div>
                  <Skeleton className="h-8 w-full" />
                </GlassCard>
              ))}
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
                  locked={course?.locked ?? false}
                  joining={joining}
                  pendingRequest={pendingRequestGroupId === g.id}
                  onOpen={() => navigate(`/courses/${courseId}/groups/${g.id}`)}
                  onJoin={() => joinGroup(g)}
                  onLeave={() => setConfirmLeave(true)}
                  onDelete={() => deleteGroup(g)}
                />
              ))}
            </div>
          )}
        </div>

        {!forbidden && loading && (
          <GlassCard className="h-fit p-4 lg:sticky lg:top-8">
            <div className="mb-3 flex items-center gap-2">
              <Skeleton className="h-4 w-4" />
              <SkeletonText className="w-28" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <SkeletonCircle size={32} />
                  <div className="flex-1 space-y-1.5">
                    <SkeletonText className="w-3/4" />
                    <SkeletonText className="w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        {!forbidden && !loading && (
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