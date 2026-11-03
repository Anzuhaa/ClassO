// InstructorControls: the join-code card (copy/regen/expire) with an activity
// status badge, a group-membership lock toggle, random-assign toolbar, and the
// manual group-creation form.
import { useState } from 'react'
import { Copy, Check, RefreshCw, CircleSlash, Shuffle, Plus, Lock, Unlock } from 'lucide-react'
import type { Course } from '../../types'
import { GlassCard, Button, Input, Label, Spinner } from '../../components/ui'

/** joinCodeActive reports whether a course's join code is still usable. */
export function joinCodeActive(course: Course): boolean {
  if (!course.joinCodeExpiresAt) return true
  return new Date(course.joinCodeExpiresAt).getTime() > Date.now()
}

export function InstructorControls({
  course,
  assigning,
  assignCapacity,
  onAssignCapacity,
  onRandomAssign,
  onRegenerate,
  onExpire,
  onCreateGroups,
  onToggleLock,
}: {
  course: Course
  assigning: boolean
  assignCapacity: number
  onAssignCapacity: (n: number) => void
  onRandomAssign: () => void
  onRegenerate: () => void
  onExpire: () => void
  onCreateGroups: (name: string, capacity: number, count: number) => void
  onToggleLock: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupCapacity, setGroupCapacity] = useState(4)
  const [groupCount, setGroupCount] = useState(1)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(course.joinCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const submitCreate = () => {
    onCreateGroups(groupName.trim() || 'Group', groupCapacity, groupCount)
    setGroupName('')
    setGroupCount(1)
  }

  return (
    <div className="space-y-3">
      <GlassCard className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Join code
        </span>
        <span className="rounded-lg bg-[var(--surface)] px-3 py-1 font-mono text-lg font-bold tracking-widest text-[var(--accent)]">
          {course.joinCode}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            joinCodeActive(course)
              ? 'bg-green-500/15 text-green-600 dark:text-green-400'
              : 'bg-red-500/15 text-red-600 dark:text-red-400'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${joinCodeActive(course) ? 'bg-green-500' : 'bg-red-500'}`} />
          {joinCodeActive(course) ? 'Active' : 'Expired'}
        </span>
        <Button variant="ghost" onClick={copyCode} className="px-2" aria-label="Copy join code">
          {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="ghost" onClick={onRegenerate} className="px-2" aria-label="Regenerate join code">
          <RefreshCw size={16} />
          Regenerate
        </Button>
        <Button variant="ghost" onClick={onExpire} className="px-2" aria-label="Expire join code">
          <CircleSlash size={16} />
          Expire
        </Button>
      </GlassCard>

      <GlassCard className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Group changes
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            course.locked
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'bg-green-500/15 text-green-600 dark:text-green-400'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${course.locked ? 'bg-amber-500' : 'bg-green-500'}`} />
          {course.locked ? 'Locked — approval required' : 'Open — students choose freely'}
        </span>
        <Button variant="ghost" onClick={onToggleLock} className="px-2" aria-label="Toggle group lock">
          {course.locked ? <Lock size={16} /> : <Unlock size={16} />}
          {course.locked ? 'Unlock' : 'Lock'}
        </Button>
      </GlassCard>

      <div className="flex flex-wrap gap-2">
        <Label text={`Capacity ${assignCapacity}`}>
          <Input
            type="number"
            min={1}
            value={assignCapacity}
            onChange={(e) => onAssignCapacity(Number(e.target.value))}
            className="w-24"
          />
        </Label>
        <Button onClick={onRandomAssign} disabled={assigning}>
          {assigning ? <Spinner /> : <Shuffle size={16} />}
          Random Assign
        </Button>
        <Button variant="ghost" onClick={() => setShowForm((s) => !s)}>
          <Plus size={16} />
          Create groups
        </Button>
      </div>

      {showForm && (
        <GlassCard className="p-5 space-y-4 animate-fade-in">
          <h3 className="text-sm font-semibold">Create groups manually</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Label text="Base name">
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group" />
            </Label>
            <Label text="Capacity">
              <Input type="number" min={1} value={groupCapacity} onChange={(e) => setGroupCapacity(Number(e.target.value))} />
            </Label>
            <Label text="How many groups">
              <Input type="number" min={1} value={groupCount} onChange={(e) => setGroupCount(Number(e.target.value))} />
            </Label>
          </div>
          <div className="flex gap-2">
            <Button onClick={submitCreate}>
              <Plus size={16} />
              Create
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </GlassCard>
      )}
    </div>
  )
}