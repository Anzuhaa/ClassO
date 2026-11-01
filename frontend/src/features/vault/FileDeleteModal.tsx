// FileDeleteModal: a second-chance confirmation that requires the user to type
// the file's exact name before the delete is allowed. Deletion is awaited in
// the parent before any follow-up action proceeds.
import { useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import type { VaultFile } from '../../types'
import { GlassCard, Button, Input, Spinner } from '../../components/ui'

export function FileDeleteModal({
  file,
  onClose,
  onConfirm,
}: {
  file: VaultFile
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const matches = typed.trim() === file.name.trim()

  const confirm = async () => {
    if (!matches || busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md transition-opacity"
      onClick={onClose}
    >
      <GlassCard
        strong
        className="w-full max-w-sm space-y-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Delete file</h3>
          <button onClick={onClose} disabled={busy} className="btn-ghost p-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-[var(--text-secondary)]">
          This permanently deletes <span className="font-medium text-[var(--text)]">{file.name}</span>.
          Type the file name to confirm.
        </p>

        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={file.name}
          disabled={busy}
          autoFocus
          aria-label="Type the file name to confirm"
        />

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!matches || busy} variant="danger">
            {busy ? <Spinner /> : <Trash2 size={16} />}
            Delete
          </Button>
        </div>
      </GlassCard>
    </div>
  )
}