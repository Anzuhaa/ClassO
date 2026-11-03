// useJoinRequests: fetches and resolves group-change requests. Instructors get
// the full pending queue; students get whether they have a pending request (and
// its target group, to drive the "request pending" state on the group card).
import { useCallback, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import type { GroupJoinRequest } from '../../types'

export function useJoinRequests(courseId: string, userId: string) {
  const [requests, setRequests] = useState<GroupJoinRequest[]>([])
  const [pendingRequestGroupId, setPendingRequestGroupId] = useState<string | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)

  const refresh = useCallback(
    async (isInstructor: boolean) => {
      try {
        const r = await api.listJoinRequests(courseId)
        if (isInstructor) {
          setRequests(r ?? [])
        } else {
          const mine = r?.find((x) => x.userId === userId && x.status === 'pending')
          setPendingRequestGroupId(mine?.groupId ?? null)
        }
      } catch {
        /* approval queue is best-effort */
      }
    },
    [courseId, userId],
  )

  const resolve = useCallback(
    async (requestId: string, approve: boolean): Promise<string | null> => {
      setResolving(requestId)
      try {
        if (approve) await api.approveJoinRequest(courseId, requestId)
        else await api.rejectJoinRequest(courseId, requestId)
        return approve ? 'Request approved.' : 'Request rejected.'
      } catch (e) {
        throw new ApiError(
          e instanceof ApiError ? e.status : 500,
          e instanceof ApiError ? e.message : 'Failed to resolve request',
        )
      } finally {
        setResolving(null)
      }
    },
    [courseId],
  )

  return { requests, pendingRequestGroupId, resolving, refresh, resolve }
}