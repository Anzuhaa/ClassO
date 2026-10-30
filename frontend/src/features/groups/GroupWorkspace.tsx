// GroupWorkspace: the group workspace shell with Tasks / Chat / Vault tabs.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckSquare, MessageSquare, FolderOpen } from 'lucide-react'
import { api } from '../../lib/api'
import type { Profile } from '../../types'
import { GlassCard, Avatar } from '../../components/ui'
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

  // Load members once; shared by tasks (assignees) and the member sidebar.
  useEffect(() => {
    api
      .listMembers(groupId)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [groupId])

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/courses/${courseId}`)} className="btn-ghost p-2" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <h2 className="text-2xl font-bold">Group Workspace</h2>
        </div>

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