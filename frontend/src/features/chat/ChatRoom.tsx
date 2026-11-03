// ChatRoom: the group discussion room with a real-time text search filter.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Search, Lock } from 'lucide-react'
import { api } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { Message, Profile } from '../../types'
import { GlassCard, Button, Input, Avatar, Skeleton, SkeletonCircle, SkeletonText } from '../../components/ui'

export function ChatRoom({ groupId, members }: { groupId: string; members: Profile[] }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [nonMember, setNonMember] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const currentUserId = getStoredUser()?.id ?? ''

  const load = async () => {
    setLoading(true)
    try {
      setMessages((await api.listMessages(groupId)) ?? [])
      setNonMember(false)
    } catch {
      // A 403 means the current user is not a member: blur the feed.
      setMessages([])
      setNonMember(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [groupId])

  // Live sync via polling every 3s so all members see new messages.
  useEffect(() => {
    const t = setInterval(() => {
      void api
        .listMessages(groupId)
        .then((msgs) => {
          setMessages(msgs ?? [])
          setNonMember(false)
        })
        .catch(() => setNonMember(true))
    }, 3000)
    return () => clearInterval(t)
  }, [groupId])

  // A member is either present in the loaded roster or currently undefined while
  // the roster loads; fall back to the loading state unless a 403 ruled it out.
  const isMember = members.some((m) => m.id === currentUserId) && !nonMember

  // Auto-scroll to the newest message (only when unfiltered).
  useEffect(() => {
    if (!query) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, query])

  const send = async () => {
    const content = draft.trim()
    if (!content || sending || !isMember) return
    setSending(true)
    try {
      const msg = await api.sendMessage(groupId, content)
      const sender = members.find((m) => m.id === msg.senderId)
      setMessages((prev) => [...prev, { ...msg, senderName: sender?.fullName || sender?.email }])
      setDraft('')
    } catch {
      /* keep draft on failure */
    } finally {
      setSending(false)
    }
  }

  // Filter visible messages by a case-insensitive substring match in real time.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return messages
    return messages.filter((m) => m.content.toLowerCase().includes(q) || (m.senderName?.toLowerCase().includes(q) ?? false))
  }, [messages, query])

  return (
    <GlassCard className="flex flex-col overflow-hidden">
      {/* Search input */}
      <div className="hairline flex items-center gap-2 p-3">
        <Search size={16} className="text-[var(--text-tertiary)]" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages…"
          className="border-0 bg-transparent focus:shadow-none"
        />
      </div>

      <div className="relative flex-1">
        <div
          ref={scrollRef}
          className={`space-y-3 overflow-y-auto p-4 transition-[filter] ${nonMember ? 'blur-sm select-none' : ''}`}
          style={{ maxHeight: '60vh', minHeight: '320px' }}
        >
          {loading ? (
            <div className="space-y-4 py-2">
              {Array.from({ length: 5 }).map((_, i) => {
                const mine = i % 2 === 1
                return (
                  <div key={i} className={`flex items-start gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                    <SkeletonCircle size={28} />
                    <div className={`flex min-w-0 flex-col ${mine ? 'items-end' : ''}`}>
                      <SkeletonText className="w-24" />
                      <Skeleton
                        className={`mt-1 h-10 ${mine ? 'w-48' : 'w-40'}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--text-tertiary)]">
              {query ? 'No messages match your search.' : 'No messages yet — say hello to your group!'}
            </p>
          ) : (
            visible.map((m) => <Bubble key={m.id} message={m} />)
          )}
        </div>

        {nonMember && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <Lock size={24} className="text-[var(--text-secondary)]" />
            <p className="text-sm font-semibold text-[var(--text)]">You are not a member of this group</p>
            <p className="text-xs text-[var(--text-tertiary)]">Join this group to view and send messages.</p>
          </div>
        )}
      </div>

      <div className="hairline flex gap-2 p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={nonMember ? 'Join this group to send messages' : 'Type a message…'}
          disabled={nonMember}
        />
        <Button onClick={send} disabled={sending || !draft.trim() || nonMember} aria-label="Send">
          <Send size={16} />
        </Button>
      </div>
    </GlassCard>
  )
}

/** Bubble renders one chat message. */
function Bubble({ message }: { message: Message }) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar name={message.senderName || 'Unknown'} src={message.senderAvatarUrl} size={28} className="mt-0.5" />
      <div className="flex min-w-0 flex-col">
        <p className="px-1 text-xs text-[var(--text-tertiary)]">
          {message.senderName || 'Unknown'} · {formatTime(message.createdAt)}
        </p>
        <div className="mt-1 max-w-[80%] rounded-2xl bg-[var(--surface-strong)] px-3 py-2 text-sm">
          {message.content}
        </div>
      </div>
    </div>
  )
}

/** formatTime renders a short HH:MM local time. */
function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}