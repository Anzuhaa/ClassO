import { Pencil } from 'lucide-react'
import type { Task, TaskStatus } from '../../types'

/** TaskCard renders one task with controls to move it between columns and edit
 * its assignee. */
export function TaskCard({
  task,
  currentUserId,
  onMove,
  onEdit,
}: {
  task: Task
  currentUserId: string
  onMove: (task: Task, status: TaskStatus) => void
  onEdit: (task: Task) => void
}) {
  const canMoveBack = task.status !== 'todo'
  const canMoveFwd = task.status !== 'done'
  // Assignees as a fallback list when the backend has not returned `assignees`.
  const assignees = task.assignees ?? (task.assigneeId ? [{ id: task.assigneeId, fullName: task.assigneeName ?? '' }] : [])
  // Highlight tasks assigned to "you" with a stronger accent border.
  const isMine = assignees.some((a) => a.id === currentUserId)
  return (
    <div
      className={`glass-strong rounded-xl p-3 ${
        isMine ? 'ring-2 ring-[var(--accent)]/60 border-transparent' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{task.title}</p>
        <button
          className="btn-ghost p-1.5 shrink-0"
          onClick={() => onEdit(task)}
          aria-label={`Edit assignment for ${task.title}`}
          title="Edit assignment"
        >
          <Pencil size={14} />
        </button>
      </div>
      {task.description && (
        <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">{task.description}</p>
      )}
      {assignees.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {assignees.map((a) => (
            <span
              key={a.id}
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                a.id === currentUserId
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-blue-500/40 text-[var(--text-secondary)]'
              }`}
            >
              {a.fullName || 'Unassigned'}
            </span>
          ))}
        </div>
      )}
      {assignees.length === 0 && (
        <div className="mt-2">
          <span className="inline-flex items-center rounded-full border border-blue-500/40 px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
            Unassigned
          </span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-1 ml-auto">
          {canMoveBack && (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onMove(task, back(task.status))}>
              ←
            </button>
          )}
          {canMoveFwd && (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onMove(task, fwd(task.status))}>
              →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** back returns the previous status in the kanban flow. */
function back(status: TaskStatus): TaskStatus {
  if (status === 'done') return 'in_progress'
  return 'todo'
}

/** fwd returns the next status in the kanban flow. */
function fwd(status: TaskStatus): TaskStatus {
  if (status === 'todo') return 'in_progress'
  return 'done'
}