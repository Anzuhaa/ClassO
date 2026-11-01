// LeaveGroupModal: the two-step confirmation dialog shown before a user leaves
// their assigned group.
import { LogOut, X } from 'lucide-react'
import { GlassCard, Button, Spinner } from '../../components/ui'

export function LeaveGroupModal({
  open,
  leaving,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean
  leaving: boolean
  error: string
  onClose: () => void
  onConfirm: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <GlassCard strong className="w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Leave this group?</h3>
          <button onClick={onClose} className="btn-ghost p-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          Are you sure you want to leave this group? You will lose access to this group's workspace, chat, and
          assigned tasks.
        </p>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={onConfirm} disabled={leaving} className="!bg-red-600 !border-red-600">
            {leaving ? <Spinner /> : <LogOut size={16} />}
            Confirm Leave
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={leaving}>
            Cancel
          </Button>
        </div>
      </GlassCard>
    </div>
  )
}