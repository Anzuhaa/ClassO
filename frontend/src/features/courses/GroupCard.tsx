// GroupCard: a single group's card in the course detail view, with join, leave
// (students), and delete (instructors) actions plus capacity/duplicate UI hints.
import { Check, LogIn, Trash2 } from 'lucide-react'
import type { Group } from '../../types'
import { GlassCard, Button, Spinner } from '../../components/ui'

export function GroupCard({
  group,
  index,
  myGroupId,
  isInstructor,
  joining,
  onOpen,
  onJoin,
  onLeave,
  onDelete,
}: {
  group: Group
  index: number
  myGroupId: string
  isInstructor: boolean
  joining: string | null
  onOpen: () => void
  onJoin: () => void
  onLeave: () => void
  onDelete: () => void
}) {
  const full = (group.memberCount ?? 0) >= group.capacity
  const alreadyInThis = myGroupId === group.id
  const alreadyElsewhere = myGroupId !== '' && myGroupId !== group.id

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
            <button className="text-xs text-[var(--text-tertiary)] hover:text-red-500" onClick={onLeave}>
              Leave
            </button>
          </span>
        ) : (
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            disabled={!!joining || full || alreadyElsewhere}
            onClick={onJoin}
          >
            {joining === group.id ? <Spinner /> : <LogIn size={14} />}
            Join Group
          </Button>
        )}
      </div>

      {full && !alreadyInThis && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">Group is full.</p>
      )}
      {alreadyElsewhere && (
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          You are already in another group.
        </p>
      )}
    </GlassCard>
  )
}