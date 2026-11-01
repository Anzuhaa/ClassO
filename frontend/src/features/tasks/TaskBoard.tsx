// TaskBoard: a three-column kanban (To Do / In Progress / Done) with task
// creation, status transitions, and editable assignees.
import { useEffect, useState } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { api } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { Profile, Task, TaskStatus } from '../../types'
import { GlassCard, Button, Input, TextArea, Label, Spinner } from '../../components/ui'
import { TaskEditModal } from './TaskEditModal'

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'todo', label: 'To Do', color: 'var(--status-todo)' },
  { status: 'in_progress', label: 'In Progress', color: 'var(--status-progress)' },
  { status: 'done', label: 'Done', color: 'var(--status-done)' },
]

export function TaskBoard({ groupId, members }: { groupId: string; members: Profile[] }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  // Task being edited (assignee reassignment modal).
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const currentUserId = getStoredUser()?.id ?? ''

  // New task form.
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setTasks(await api.listTasks(groupId))
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [groupId])

  // Live sync: poll every 4s so task status changes (Todo → In Progress →
  // Done) reflect across all group members without a manual reload.
  useEffect(() => {
    const t = setInterval(() => {
      void api
        .listTasks(groupId)
        .then((ts) => setTasks(ts ?? []))
        .catch(() => {})
    }, 4000)
    return () => clearInterval(t)
  }, [groupId])

  const move = async (task: Task, status: TaskStatus) => {
    // Optimistically update the local list.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)))
    try {
      await api.updateTaskStatus(groupId, task.id, status)
    } catch {
      // Revert on failure.
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)))
    }
  }

  // Reassign (or unassign) a task and reflect the updated badge reactively.
  const reassign = async (task: Task, assigneeIds: string[]) => {
    setError('')
    try {
      const updated = await api.updateTaskAssignees(groupId, task.id, assigneeIds)
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
      setEditingTask(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update assignment')
    }
  }

  const create = async () => {
    if (!title.trim()) return
    setSubmitting(true)
    try {
      await api.createTask(groupId, {
        title: title.trim(),
        description: description.trim() || undefined,
        assigneeIds,
      })
      setTitle('')
      setDescription('')
      setAssigneeIds([])
      setShowForm(false)
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-[var(--text-secondary)]">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">{tasks.length} tasks</p>
        <Button onClick={() => setShowForm((s) => !s)}>
          <Plus size={16} />
          Add Task
        </Button>
      </div>

      {showForm && (
        <GlassCard className="p-4 space-y-3 animate-fade-in">
          <h4 className="text-sm font-semibold">New task</h4>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" />
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
          />
          <Label text="Assignees">
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
              {members.length === 0 && (
                <p className="px-1 py-2 text-xs text-[var(--text-tertiary)]">No members</p>
              )}
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-hover)]"
                >
                  <input
                    type="checkbox"
                    checked={assigneeIds.includes(m.id)}
                    onChange={() =>
                      setAssigneeIds((prev) =>
                        prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                      )
                    }
                    className="accent-[var(--accent)]"
                  />
                  <span className="truncate">{m.fullName || m.email}</span>
                </label>
              ))}
            </div>
          </Label>
          <div className="flex gap-2">
            <Button onClick={create} disabled={submitting || !title.trim()}>
              {submitting ? <Spinner /> : 'Create'}
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </GlassCard>
      )}

      {error && <GlassCard className="p-4 text-sm text-red-500">{error}</GlassCard>}

      {/* Kanban columns */}
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map(({ status, label, color }) => {
          const columnTasks = tasks.filter((t) => t.status === status)
          return (
            <GlassCard key={status} className="p-3">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                <h4 className="text-sm font-semibold">{label}</h4>
                <span className="ml-auto text-xs text-[var(--text-tertiary)]">{columnTasks.length}</span>
              </div>

              <div className="space-y-2">
                {columnTasks.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-[var(--text-tertiary)]">Empty</p>
                ) : (
                  columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      currentUserId={currentUserId}
                      onMove={move}
                      onEdit={(t) => setEditingTask(t)}
                    />
                  ))
                )}
              </div>
            </GlassCard>
          )
        })}
      </div>

      {/* ---- Assignee edit modal ---- */}
      {editingTask && (
        <TaskEditModal
          task={editingTask}
          members={members}
          onClose={() => setEditingTask(null)}
          onSave={(assigneeIds) => reassign(editingTask, assigneeIds)}
        />
      )}
    </div>
  )
}

/** TaskCard renders one task with controls to move it between columns and edit
 * its assignee. */
function TaskCard({
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