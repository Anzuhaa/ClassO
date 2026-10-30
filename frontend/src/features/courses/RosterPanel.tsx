// RosterPanel: the course member roster with instructor "remove member" action.
import { UserPlus, UserMinus } from 'lucide-react'
import type { CourseMember } from '../../types'
import { GlassCard, Avatar } from '../../components/ui'

export function RosterPanel({
  members,
  userId,
  isInstructor,
  onRemove,
}: {
  members: CourseMember[]
  userId: string
  isInstructor: boolean
  onRemove: (m: CourseMember) => void
}) {
  return (
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
              <Avatar name={m.fullName || m.email} src={m.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.fullName || m.email}
                  {m.id === userId && <span className="text-[var(--text-tertiary)]"> (you)</span>}
                </p>
                <p className="truncate text-xs text-[var(--text-tertiary)]">{m.courseRole}</p>
              </div>
              {isInstructor && m.id !== userId && (
                <button
                  className="rounded-lg p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--surface)] hover:text-red-500"
                  onClick={() => onRemove(m)}
                  aria-label={`Remove ${m.fullName || m.email}`}
                >
                  <UserMinus size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  )
}