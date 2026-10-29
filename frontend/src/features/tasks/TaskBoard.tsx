// TaskBoard: a three-column kanban (To Do / In Progress / Done) with task
// creation and status transitions.
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api'
import type { Profile, Task, TaskStatus } from '../../types'
import { GlassCard, Button, Input, TextArea, Label, Spinner } from '../../components/ui'

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: 'todo', label: 'To Do', color: 'var(--status-todo)' },
  { status: 'in_progress', label: 'In Progress', color: 'var(--status-progress)' },
  { status: 'done', label: 'Done', color: 'var(--status-done)' },
]

export function TaskBoard({ groupId, members }: { groupId: string; members: Profile[] }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // New task form.
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
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

  const create = async () => {
    if (!title.trim()) return
    setSubmitting(true)
    try {
      await api.createTask(groupId, {
        title: title.trim(),
        description: description.trim() || undefined,
        assigneeId: assigneeId || undefined,
      })
      setTitle('')
      setDescription('')
      setAssigneeId('')
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
          <Label text="Assignee">
            <select
              className="control px-3 py-2 text-sm"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName || m.email}
                </option>
              ))}
            </select>
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
                  columnTasks.map((task) => <TaskCard key={task.id} task={task} onMove={move} />)
                )}
              </div>
            </GlassCard>
          )
        })}
      </div>
    </div>
  )
}

/** TaskCard renders one task with controls to move it between columns. */
function TaskCard({ task, onMove }: { task: Task; onMove: (task: Task, status: TaskStatus) => void }) {
  const canMoveBack = task.status !== 'todo'
  const canMoveFwd = task.status !== 'done'
  return (
    <div className="glass-strong rounded-xl p-3">
      <p className="text-sm font-medium">{task.title}</p>
      {task.description && (
        <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">{task.description}</p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-[var(--text-tertiary)]">{task.assigneeName || 'Unassigned'}</span>
        <div className="flex gap-1">
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