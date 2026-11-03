// GroupCard: a single group's card in the course detail view, with join, leave
// (students), and delete (instructors) actions, plus a read-only member roster
// so students can see who is in every team without entering the workspace.
// When the course is locked, a student's join/leave becomes an approval request.
import { Check, LogIn, LogOut, Trash2, Lock } from 'lucide-react'
import type { Group } from '../../types'
import { GlassCard, Button, Spinner, Avatar } from '../../components/ui'

export function GroupCard({
  group,
  index,
  myGroupId,
  isInstructor,
  locked,
  joining,
  pendingRequest,
  onOpen,
  onJoin,
  onLeave,
  onDelete,
}: {
  group: Group
  index: number
  myGroupId: string
  isInstructor: boolean
  locked: boolean
  joining: string | null
  pendingRequest: boolean
  onOpen: () => void
  onJoin: () => void
  onLeave: () => void
  onDelete: () => void
}) {
  const full = (group.memberCount ?? 0) >= group.capacity
  const alreadyInThis = myGroupId === group.id
  const alreadyElsewhere = myGroupId !== '' && myGroupId !== group.id
  const members = group.members ?? []

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{group.name}</h3>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
          {index + 1}
        </span>
      </div>

      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {group.memberCount ?? 0}/{group.capacity} members
      </p>

      {/* Read-only roster: every group's members, transparently visible. */}
      {members.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-xs">
              <Avatar name={m.fullName || m.email || '?'} src={m.avatarUrl} size={20} />
              <span className="truncate text-[var(--text-secondary)]">
                {m.fullName || m.email}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between">
        <button
          className="text-sm font-medium text-[var(--accent)] hover:underline"
          onClick={onOpen}
        >
          Open workspace →
        </button>

        {isInstructor ? (
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={onDelete}
            aria-label={`Delete ${group.name}`}
          >
            <Trash2 size={14} className="text-red-500" />
          </Button>
        ) : alreadyInThis ? (
          <span className="inline-flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500">
              <Check size={14} /> Joined
            </span>
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-2 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
              onClick={onLeave}
            >
              <LogOut size={13} />
              {locked ? 'Request to Leave' : 'Leave Group'}
            </button>
          </span>
        ) : pendingRequest ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Lock size={13} />
            Request pending
          </span>
        ) : (
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            disabled={!!joining || full || alreadyElsewhere}
            onClick={onJoin}
          >
            {joining === group.id ? <Spinner /> : locked ? <Lock size={14} /> : <LogIn size={14} />}
            {locked ? 'Request Join' : 'Join Group'}
          </Button>
        )}
      </div>

      {full && !alreadyInThis && !pendingRequest && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">Group is full.</p>
      )}
      {alreadyElsewhere && !pendingRequest && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Leave your current group before joining another.
        </p>
      )}
    </GlassCard>
  )
}