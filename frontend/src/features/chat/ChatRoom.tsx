// ChatRoom: the group discussion room with a real-time text search filter.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Search, Lock } from 'lucide-react'
import { api } from '../../lib/api'
import { getStoredUser } from '../../lib/auth'
import type { Message, Profile, TypingSignal } from '../../types'
import { GlassCard, Button, Input, Avatar, Skeleton, SkeletonCircle, SkeletonText } from '../../components/ui'

// Minimum gap between outbound "typing" presence pings, and how long a peer's
// indicator stays visible after their last ping before it fades.
const TYPING_INTERVAL_MS = 2000
const TYPING_IDLE_MS = 4000

export function ChatRoom({ groupId, members }: { groupId: string; members: Profile[] }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [nonMember, setNonMember] = useState(false)
  const [streamEpoch, setStreamEpoch] = useState(0)
  const [typing, setTyping] = useState<{ name: string; at: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the latest roster in a ref so send() can resolve the sender's name/avatar
  // as a fallback without a re-render.
  const membersRef = useRef(members)
  membersRef.current = members

  // Typing-presence throttle: no more than one emit per interval, and the local
  // "typing" indicator auto-clears after idle. This keeps the number of POSTs
  // tiny (a few per active-speak period), not per keystroke.
  const lastTypingAtRef = useRef(0)

  const currentUser = getStoredUser()
  const currentUserId = currentUser?.id ?? ''

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

  // Live sync via server-sent events: subscribe to the group's message stream and
  // append each pushed message as it lands. The server enriches every event with
  // the sender's name and avatar, so no roster lookup is needed here. On the
  // stream ending, reconnect (re-run the effect) so the feed stays live.
  useEffect(() => {
    let cancelled = false

    const handleMessage = (message: Message) => {
      // Ignore a duplicate echo of our own optimistic send (same id).
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
    }

    const handleTyping = (t: TypingSignal) => {
      if (import.meta.env.DEV) console.log('[typing] received:', t)
      if (t.userId === currentUserId) return // never show our own ping
      setTyping({ name: t.name || 'Someone', at: t.at })
    }

    const handleEnd = () => {
      if (cancelled) return
      // Reconnect after a brief pause so a transient drop heals itself; the
      // backlog re-fetch on the next load() reconciles any missed messages.
      window.setTimeout(() => {
        if (!cancelled) setStreamEpoch((n) => n + 1)
      }, 1500)
    }

    const abort = api.streamMessages(groupId, handleMessage, handleTyping, handleEnd)
    return () => {
      cancelled = true
      abort()
    }
  }, [groupId, streamEpoch, currentUserId])

  // Auto-clear the "is typing" indicator a few seconds after the last ping so a
  // stale presence never lingers.
  useEffect(() => {
    if (!typing) return
    const age = Date.now() - typing.at
    const wait = Math.max(0, TYPING_IDLE_MS - age)
    const t = window.setTimeout(() => setTyping(null), wait)
    return () => window.clearTimeout(t)
  }, [typing])

  // A member is either present in the loaded roster or currently undefined while
  // the roster loads; fall back to the loading state unless a 403 ruled it out.
  const isMember = members.some((m) => m.id === currentUserId) && !nonMember

  // Called on each change of the draft; throttles so we only emit a presence
  // ping when TYPING_INTERVAL_MS has elapsed since the last one.
  const emitTyping = () => {
    if (!isMember) return
    const now = Date.now()
    if (now - lastTypingAtRef.current < TYPING_INTERVAL_MS) return
    lastTypingAtRef.current = now
    void api.sendTyping(groupId).catch((e) => {
      // Presence is best-effort, but a 404 is a strong signal the backend
      // wasn't restarted after the typing endpoint was added — surface it once
      // in dev so it isn't silently invisible.
      if (import.meta.env.DEV) console.warn('[typing] send failed:', e)
    })
  }

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
      const sender = membersRef.current.find((m) => m.id === msg.senderId)
      // Dedup by id: the SSE echo of our own send (broadcast by the server)
      // usually lands before or around this response, so only append if the
      // message isn't already in the list.
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id)
          ? prev
          : [
              ...prev,
              {
                ...msg,
                senderName: sender?.fullName || sender?.email || currentUser?.fullName || currentUser?.email,
                senderAvatarUrl: sender?.avatarUrl || currentUser?.avatarUrl,
              },
            ],
      )
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

      {/* Composer: typing presence sits inline, above the input, inside the
          chat box rather than overlaid on top of it. */}
      <div>
        {typing && (
          <div className="flex items-start gap-2.5 px-4 pt-2">
            <SkeletonCircle size={24} className="mt-0.5" />
            <span className="text-xs italic text-[var(--text-tertiary)]">
              {typing.name} is typing…
            </span>
          </div>
        )}

        <div className="flex gap-2 p-3">
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (e.target.value.trim()) emitTyping()
            }}
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