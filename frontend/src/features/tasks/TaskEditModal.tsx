// TaskEditModal: reassigns an existing task to any number of group members, or
// unassigns everyone. Saving calls back into the board so the card updates reactively.
import { useState } from 'react'
import { X } from 'lucide-react'
import type { Profile, Task } from '../../types'
import { GlassCard, Button, Label, Spinner } from '../../components/ui'

export function TaskEditModal({
  task,
  members,
  onClose,
  onSave,
}: {
  task: Task
  members: Profile[]
  onClose: () => void
  onSave: (assigneeIds: string[]) => void
}) {
  const existing = task.assignees?.map((a) => a.id) ?? (task.assigneeId ? [task.assigneeId] : [])
  const [assigneeIds, setAssigneeIds] = useState<string[]>(existing)
  const [saving, setSaving] = useState(false)

  const toggle = (id: string) => {
    setAssigneeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      onSave(assigneeIds)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <GlassCard strong className="w-full max-w-sm space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Edit assignment</h3>
          <button onClick={onClose} className="btn-ghost p-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="line-clamp-2 text-sm text-[var(--text-secondary)]">{task.title}</p>
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
                  onChange={() => toggle(m.id)}
                  className="accent-[var(--accent)]"
                />
                <span className="truncate">{m.fullName || m.email}</span>
              </label>
            ))}
          </div>
        </Label>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-tertiary)]">
            {assigneeIds.length} selected
          </span>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner /> : 'Save'}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}