// GroupWorkspace: the group workspace shell with Tasks / Chat / Vault tabs and
// an inline rename control on the group header (lead or instructor).
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckSquare, MessageSquare, FolderOpen, Pencil, Check, X, Crown } from 'lucide-react'
import { api } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { Group, GroupMemberView } from '../../types'
import { GlassCard, Avatar, Input } from '../../components/ui'
import { TaskBoard } from '../tasks/TaskBoard'
import { ChatRoom } from '../chat/ChatRoom'
import { FileVault } from '../vault/FileVault'

type Tab = 'tasks' | 'chat' | 'vault'

// Remember the last-open tab per group so a browser refresh (or navigating away
// and back) stays on the tab the user was on, instead of always resetting to Tasks.
const TAB_STORAGE_KEY = 'classo.group-tab'
const TABS: { id: Tab }[] = [{ id: 'tasks' }, { id: 'chat' }, { id: 'vault' }]

const TABS_UI: { id: Tab; label: string; icon: typeof CheckSquare }[] = [
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'vault', label: 'File Vault', icon: FolderOpen },
]

export function GroupWorkspace() {
  const { courseId = '', groupId = '' } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(() => {
    const stored = localStorage.getItem(TAB_STORAGE_KEY)
    // Stored as "<groupId>:<tab>" so each group remembers its own tab.
    const [, storedTab] = (stored ?? '').split(':')
    if (storedTab && TABS.some((t) => t.id === storedTab)) return storedTab as Tab
    return 'tasks'
  })
  const [members, setMembers] = useState<GroupMemberView[]>([])
  const [group, setGroup] = useState<Group | null>(null)
  const [isInstructor, setIsInstructor] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [leadError, setLeadError] = useState('')
  const [settingLead, setSettingLead] = useState<string | null>(null)

  const userId = getStoredUser()?.id ?? ''
  const isLead = members.some((m) => m.id === userId && m.groupRole === 'lead')

  // Persist the active tab (per group) so refreshes restore it.
  useEffect(() => {
    localStorage.setItem(TAB_STORAGE_KEY, `${groupId}:${tab}`)
  }, [groupId, tab])

  // Load members once; shared by tasks (assignees) and the member sidebar.
  useEffect(() => {
    api
      .listMembers(groupId)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [groupId])

  // Load the group (name) for the header, and determine whether the current user
  // may rename it (lead, course owner, or course instructor).
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

  const makeLead = async (id: string) => {
    setSettingLead(id)
    setLeadError('')
    try {
      await api.setGroupLead(groupId, id)
      const refreshed = await api.listMembers(groupId)
      setMembers(refreshed)
    } catch (e) {
      setLeadError(e instanceof Error ? e.message : 'Failed to set lead')
    } finally {
      setSettingLead(null)
    }
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
              {(isInstructor || isLead) && (
                <button onClick={beginRename} className="btn-ghost p-2" aria-label="Rename group" title="Rename group">
                  <Pencil size={16} />
                </button>
              )}
              {isLead && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                  <Crown size={12} /> Lead
                </span>
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
          {TABS_UI.map(({ id, label, icon: Icon }) => (
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
          {leadError && (
            <p className="mb-2 text-xs text-red-500">{leadError}</p>
          )}
          <ul className="space-y-2">
            {members.map((m) => {
              const isLeadMember = m.groupRole === 'lead'
              return (
                <li
                  key={m.id}
                  className={`flex items-center gap-2.5 rounded-lg p-1.5 ${
                    isLeadMember ? 'bg-[var(--accent)]/10' : ''
                  }`}
                >
                  <Avatar name={m.fullName || m.email} src={m.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.fullName || m.email}
                      {isLeadMember && (
                        <Crown size={13} className="ml-1.5 inline text-[var(--accent)]" aria-label="Team lead" />
                      )}
                    </p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">
                      {isLeadMember ? 'Team Lead' : m.role}
                    </p>
                  </div>
                  {isInstructor && !isLeadMember && (
                    <button
                      onClick={() => makeLead(m.id)}
                      disabled={settingLead !== null}
                      className="btn-ghost px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]"
                      aria-label={`Make ${m.fullName || m.email} team lead`}
                      title="Set as team lead"
                    >
                      {settingLead === m.id ? '…' : <Crown size={14} />}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </GlassCard>
      </div>
    </div>
  )
}