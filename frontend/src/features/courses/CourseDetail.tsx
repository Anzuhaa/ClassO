// CourseDetail: shows groups within a course plus the AI "Form Groups" action.
import { useEffect, useState } from 'react'
import { ArrowLeft, Sparkles, Users } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import type { Group } from '../../types'
import { GlassCard, Button, Spinner } from '../../components/ui'

export function CourseDetail({
  courseId,
  onBack,
  onOpenGroup,
}: {
  courseId: string
  onBack: () => void
  onOpenGroup: (groupId: string) => void
}) {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [forming, setForming] = useState(false)
  const [usedAi, setUsedAi] = useState<boolean | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setGroups(await api.listGroups(courseId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load groups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [courseId])

  const formGroups = async () => {
    setForming(true)
    setError('')
    setMessage('')
    setUsedAi(null)
    try {
      const result = await api.formGroups(courseId)
      setUsedAi(result.usedAi)
      setMessage(
        result.usedAi
          ? `AI balanced ${result.groups.length} groups.`
          : `Formed ${result.groups.length} groups (deterministic fallback — AI unavailable).`,
      )
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to form groups')
    } finally {
      setForming(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-2" aria-label="Back">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-2xl font-bold">Groups</h2>
            <p className="text-sm text-[var(--text-secondary)]">AI-balanced project teams</p>
          </div>
        </div>
        <Button onClick={formGroups} disabled={forming}>
          {forming ? <Spinner /> : <Sparkles size={16} />}
          Form Groups with AI
        </Button>
      </header>

      {message && (
        <GlassCard className="flex items-center gap-2 p-4 text-sm">
          <Sparkles size={16} className={usedAi ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'} />
          {message}
        </GlassCard>
      )}
      {error && <GlassCard className="p-4 text-sm text-red-500">{error}</GlassCard>}

      {loading ? (
        <div className="flex justify-center py-16 text-[var(--text-secondary)]">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        <GlassCard className="p-10 text-center text-[var(--text-secondary)]">
          <Users size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-semibold text-[var(--text)]">No groups yet</p>
          <p className="text-sm">Click “Form Groups with AI” to auto-split your students.</p>
        </GlassCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g, i) => (
            <GlassCard
              key={g.id}
              className="group cursor-pointer p-5 transition-transform hover:-translate-y-0.5"
              onClick={() => onOpenGroup(g.id)}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{g.name}</h3>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">
                  {i + 1}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">Open workspace →</p>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}