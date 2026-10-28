// ChatRoom: the group discussion room with an AI chat-summary panel.
import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'
import type { AISummary, Message, Profile } from '../../types'
import { GlassCard, Button, Input, Spinner } from '../../components/ui'

export function ChatRoom({ groupId, members }: { groupId: string; members: Profile[] }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [summary, setSummary] = useState<AISummary | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [msgs, latest] = await Promise.all([api.listMessages(groupId), api.latestSummary(groupId)])
      setMessages(msgs)
      setSummary(latest)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [groupId])

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  const send = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const msg = await api.sendMessage(groupId, content)
      // Attach the sender's display name from the members list.
      const sender = members.find((m) => m.id === msg.senderId)
      setMessages((prev) => [...prev, { ...msg, senderName: sender?.fullName || sender?.email }])
      setDraft('')
    } catch {
      /* keep draft on failure */
    } finally {
      setSending(false)
    }
  }

  const summarize = async () => {
    setSummarizing(true)
    try {
      setSummary(await api.summarize(groupId))
    } catch {
      /* ignore */
    } finally {
      setSummarizing(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      {/* Chat panel */}
      <GlassCard className="flex flex-col overflow-hidden">
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto p-4"
          style={{ maxHeight: '65vh', minHeight: '320px' }}
        >
          {loading ? (
            <div className="flex justify-center py-10 text-[var(--text-secondary)]">
              <Spinner />
            </div>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--text-tertiary)]">
              No messages yet — say hello to your group!
            </p>
          ) : (
            messages.map((m) => <Bubble key={m.id} message={m} />)
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
            placeholder="Type a message…"
          />
          <Button onClick={send} disabled={sending || !draft.trim()} aria-label="Send">
            <Send size={16} />
          </Button>
        </div>
      </GlassCard>

      {/* AI summary panel */}
      <GlassCard className="flex h-fit flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold">AI Summary</h3>
        </div>

        <Button variant="ghost" onClick={summarize} disabled={summarizing} className="w-full">
          {summarizing ? <Spinner /> : <Sparkles size={14} />}
          Summarize chat
        </Button>

        {summary && (
          <div className="prose-summary text-sm">
            <SummaryText text={summary.summary} />
          </div>
        )}
      </GlassCard>
    </div>
  )
}

/** Bubble renders one chat message. */
function Bubble({ message }: { message: Message }) {
  return (
    <div className="flex flex-col">
      <p className="px-1 text-xs text-[var(--text-tertiary)]">
        {message.senderName || 'Unknown'} · {formatTime(message.createdAt)}
      </p>
      <div className="mt-1 max-w-[80%] rounded-2xl bg-[var(--surface-strong)] px-3 py-2 text-sm">
        {message.content}
      </div>
    </div>
  )
}

/** SummaryText renders the Markdown-ish summary as styled text. */
function SummaryText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="h-1" />
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={i} className="flex gap-2">
              <span className="text-[var(--accent)]">•</span>
              <span>{trimmed.slice(2)}</span>
            </div>
          )
        }
        return <p key={i}>{trimmed}</p>
      })}
    </div>
  )
}

/** formatTime renders a short HH:MM local time. */
function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}