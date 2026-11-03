// useInstructorActions: the instructor-only course mutations (random assign,
// manual group creation, join-code regen/expire) shared by the course header
// controls. Kept out of CourseDetail.tsx to hold that file under its size cap.
import { api, ApiError } from '../../lib/api'
import type { Course } from '../../types'

export function useInstructorActions(
  courseId: string,
  groups: { memberCount?: number }[],
  assignCapacity: number,
  deps: {
    setError: (m: string) => void
    setMessage: (m: string) => void
    setAssigning: (b: boolean) => void
    setCourse: (c: Course) => void
    reload: () => Promise<void>
  },
) {
  const { setError, setMessage, setAssigning, setCourse, reload } = deps

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
      await reload()
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
      await reload()
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

  return { runRandomAssign, createGroups, regenerateCode, expireCode }
}