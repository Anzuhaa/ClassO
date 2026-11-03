// GroupCard: a single group's card in the course detail view, with join, leave
// (students), and rename/set-lead/delete (instructors) actions, plus a read-only
// member roster so students can see who is in every team without entering the
// workspace. When the course is locked, a student's join/leave becomes an
// approval request.
import { useState } from 'react'
import { Check, LogIn, LogOut, Trash2, Lock, Crown, Pencil, X } from 'lucide-react'
import type { Group } from '../../types'
import { GlassCard, Button, Spinner, Avatar, Input } from '../../components/ui'

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
  onRename,
  onSetLead,
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
  onRename: (groupId: string, name: string) => Promise<void>
  onSetLead: (groupId: string, userId: string) => Promise<void>
}) {
  const full = (group.memberCount ?? 0) >= group.capacity
  const alreadyInThis = myGroupId === group.id
  const alreadyElsewhere = myGroupId !== '' && myGroupId !== group.id
  const members = group.members ?? []

  // Inline rename state (instructors only).
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(group.name)
  const [saving, setSaving] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [settingLead, setSettingLead] = useState<string | null>(null)

  const beginRename = () => {
    setNameDraft(group.name)
    setRenameError('')
    setRenaming(true)
  }

  const saveRename = async () => {
    const name = nameDraft.trim()
    if (!name || name === group.name) {
      setRenaming(false)
      setRenameError('')
      return
    }
    setSaving(true)
    setRenameError('')
    try {
      await onRename(group.id, name)
      setRenaming(false)
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : 'Failed to rename group')
    } finally {
      setSaving(false)
    }
  }

  const setLead = async (userId: string) => {
    setSettingLead(userId)
    try {
      await onSetLead(group.id, userId)
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : 'Failed to set leader')
    } finally {
      setSettingLead(null)
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between">
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="max-w-[140px]"
              aria-label="Group name"
            />
            <button onClick={saveRename} className="btn-ghost p-1 text-green-500" disabled={saving} aria-label="Save name">
              <Check size={16} />
            </button>
            <button onClick={() => setRenaming(false)} className="btn-ghost p-1" aria-label="Cancel rename">
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-semibold">{group.name}</h3>
            {isInstructor && (
              <button onClick={beginRename} className="btn-ghost p-1" aria-label="Rename group" title="Rename group">
                <Pencil size={14} />
              </button>
            )}
          </div>
        )}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
          {index + 1}
        </span>
      </div>

      {renameError && <p className="mt-1 text-xs text-red-500">{renameError}</p>}

      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {group.memberCount ?? 0}/{group.capacity} members
      </p>

      {/* Roster: every group's members, with the leader highlighted. Instructors
          can reassign the leader inline via the crown button. */}
      {members.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-xs">
              <Avatar name={m.fullName || m.email || '?'} src={m.avatarUrl} size={20} />
              <span className="truncate text-[var(--text-secondary)]">
                {m.fullName || m.email}
              </span>
              {m.groupRole === 'lead' && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                  <Crown size={10} /> Lead
                </span>
              )}
              {isInstructor && m.groupRole !== 'lead' && (
                <button
                  onClick={() => setLead(m.id)}
                  disabled={settingLead !== null}
                  className="ml-auto btn-ghost p-1 text-[var(--text-tertiary)] hover:text-[var(--accent)]"
                  aria-label={`Set ${m.fullName || m.email} as team leader`}
                  title="Set as team leader"
                >
                  {settingLead === m.id ? <Spinner /> : <Crown size={13} />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between">
        {alreadyInThis ? (
          <button
            className="text-sm font-medium text-[var(--accent)] hover:underline"
            onClick={onOpen}
          >
            Open workspace →
          </button>
        ) : (
          <span />
        )}

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