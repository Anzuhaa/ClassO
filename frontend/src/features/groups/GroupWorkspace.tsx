// GroupWorkspace: the group workspace shell with Tasks / Chat / Vault tabs and
// an inline rename control on the group header (instructors only).
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckSquare, MessageSquare, FolderOpen, Pencil, Check, X } from 'lucide-react'
import { api } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { Group, Profile } from '../../types'
import { GlassCard, Avatar, Input } from '../../components/ui'
import { TaskBoard } from '../tasks/TaskBoard'
import { ChatRoom } from '../chat/ChatRoom'
import { FileVault } from '../vault/FileVault'

type Tab = 'tasks' | 'chat' | 'vault'

const TABS: { id: Tab; label: string; icon: typeof CheckSquare }[] = [
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'vault', label: 'File Vault', icon: FolderOpen },
]

export function GroupWorkspace() {
  const { courseId = '', groupId = '' } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('tasks')
  const [members, setMembers] = useState<Profile[]>([])
  const [group, setGroup] = useState<Group | null>(null)
  const [isInstructor, setIsInstructor] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameError, setRenameError] = useState('')

  const userId = getStoredUser()?.id ?? ''

  // Load members once; shared by tasks (assignees) and the member sidebar.
  useEffect(() => {
    api
      .listMembers(groupId)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [groupId])

  // Load the group (name/owner) for the header + breadcrumb, and determine
  // whether the current user may rename it (course owner or course instructor).
  useEffect(() => {
    api
      .getGroup(groupId)
      .then((g) => {
        setGroup(g)
        setNameDraft(g.name)
      })
      .catch(() => setGroup(null))
    api
      .getCourse(courseId)
      .then((c) => {
        // Course owner is always an instructor for rename purposes.
        if (c.ownerId === userId) return setIsInstructor(true)
        return api
          .listCourseMembers(courseId)
          .then((ms) => {
            const me = ms.find((m) => m.id === userId)
            setIsInstructor(me?.courseRole === 'instructor')
          })
          .catch(() => setIsInstructor(false))
      })
      .catch(() => setIsInstructor(false))
  }, [groupId, courseId, userId])

  const beginRename = () => {
    setNameDraft(group?.name ?? '')
    setRenaming(true)
  }

  const saveRename = async () => {
    const name = nameDraft.trim()
    if (!name || name === group?.name) {
      setRenaming(false)
      setRenameError('')
      return
    }
    setSaving(true)
    setRenameError('')
    try {
      const updated = await api.renameGroup(groupId, name)
      setGroup(updated)
      setRenaming(false)
    } catch (e) {
      // Surface the server's error so a failed rename isn't a silent no-op.
      setRenameError(e instanceof Error ? e.message : 'Failed to rename group')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/courses/${courseId}`)} className="btn-ghost p-2" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          {renaming ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveRename()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="max-w-xs"
                aria-label="Group name"
              />
              <button onClick={saveRename} className="btn-ghost p-2 text-green-500" disabled={saving} aria-label="Save name">
                <Check size={18} />
              </button>
              <button onClick={() => setRenaming(false)} className="btn-ghost p-2" aria-label="Cancel rename">
                <X size={18} />
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-2xl font-bold">{group?.name ?? 'Group Workspace'}</h2>
              {isInstructor && (
                <button onClick={beginRename} className="btn-ghost p-2" aria-label="Rename group" title="Rename group">
                  <Pencil size={16} />
                </button>
              )}
            </div>
          )}
        </div>
        {renameError && (
          <p className="ml-11 mt-1 text-sm text-red-500">{renameError}</p>
        )}
        <p className="ml-11 text-sm text-[var(--text-secondary)]">
          Group workspace · Tasks, chat, and the shared file vault
        </p>

        {/* Tabs */}
        <div className="mt-4 flex gap-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Workspace content */}
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          {tab === 'tasks' && <TaskBoard groupId={groupId} members={members} />}
          {tab === 'chat' && <ChatRoom groupId={groupId} members={members} />}
          {tab === 'vault' && <FileVault groupId={groupId} />}
        </div>

        {/* Members sidebar */}
        <GlassCard className="h-fit p-4 lg:sticky lg:top-8">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)]">
            Members ({members.length})
          </h3>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2.5">
                <Avatar name={m.fullName || m.email} src={m.avatarUrl} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.fullName || m.email}</p>
                  <p className="truncate text-xs text-[var(--text-tertiary)]">{m.role}</p>
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>
    </div>
  )
}