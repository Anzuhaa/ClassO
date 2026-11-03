// JoinRequestsPanel: the instructor's approval queue for pending group-change
// requests (join / switch / leave), rendered in the course detail view.
import type { GroupJoinRequest } from '../../types'
import { GlassCard, Button, Spinner } from '../../components/ui'

export function JoinRequestsPanel({
  requests,
  resolving,
  onResolve,
}: {
  requests: GroupJoinRequest[]
  resolving: string | null
  onResolve: (requestId: string, approve: boolean) => void
}) {
  if (requests.length === 0) return null

  return (
    <GlassCard className="space-y-3 p-5">
      <h3 className="font-semibold">Group change requests</h3>
      <p className="text-sm text-[var(--text-secondary)]">
        These students want to change groups. Approve or reject each request.
      </p>
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{r.userName || 'Student'}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {r.groupId
                  ? `wants to join ${r.targetGroupName || 'a group'}`
                  : 'wants to leave their current group'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => onResolve(r.id, true)}
                disabled={resolving === r.id}
                className="!bg-green-600 !border-green-600"
              >
                {resolving === r.id ? <Spinner /> : 'Approve'}
              </Button>
              <Button variant="ghost" onClick={() => onResolve(r.id, false)} disabled={resolving === r.id}>
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </GlassCard>
  )
}