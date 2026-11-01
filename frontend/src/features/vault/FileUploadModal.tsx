// FileUploadModal: the "name before upload" step for one or more files. Each
// selected file shows an editable name; on confirm the files upload
// sequentially (one must finish before the next starts) with live progress.
import { useEffect, useState } from 'react'
import { X, Upload } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { GlassCard, Button, Spinner } from '../../components/ui'
import { FileNameField, splitName } from './FileNameField'
import { formatBytes } from './format'

/** Maximum number of files per upload batch. */
export const MAX_FILES = 4
/** Maximum size of a single file (20 MiB). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/** validate returns a user-facing error for any selection that violates the
 * per-file size or batch-count limits, else null. */
export function validateSelection(files: File[]): string | null {
  if (files.length === 0) return null
  if (files.length > MAX_FILES) return `You can upload at most ${MAX_FILES} files at once.`
  const tooBig = files.find((f) => f.size > MAX_FILE_BYTES)
  if (tooBig) {
    return `"${tooBig.name}" is ${formatBytes(tooBig.size)}, over the ${formatBytes(MAX_FILE_BYTES)} limit.`
  }
  return null
}

export function FileUploadModal({
  groupId,
  files,
  onClose,
  onDone,
}: {
  groupId: string
  files: File[]
  onClose: () => void
  onDone: () => void
}) {
  // Each entry pairs a File with the (editable) stem it will upload as; the
  // extension is fixed from the file's own name. The full name is stem + ext.
  const [entries, setEntries] = useState(() =>
    files.map((f) => ({ file: f, stem: splitName(f.name).stem })),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doneCount, setDoneCount] = useState(0)

  // Re-seed entries if the parent hands us a new selection.
  useEffect(() => {
    setEntries(files.map((f) => ({ file: f, stem: splitName(f.name).stem })))
    setDoneCount(0)
    setError('')
  }, [files])

  const renameStem = (index: number, stem: string) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, stem } : e)))
  }

  const uploadAll = async () => {
    // Guard against empty names and re-validate sizes right before sending.
    const blank = entries.find((e) => e.stem.trim() === '')
    if (blank) {
      setError('Every file needs a name.')
      return
    }
    const sizeError = validateSelection(entries.map((e) => e.file))
    if (sizeError) {
      setError(sizeError)
      return
    }

    setBusy(true)
    setError('')
    try {
      for (let i = 0; i < entries.length; i++) {
        const { file, stem } = entries[i]
        const fullName = stem.trim() + splitName(file.name).ext
        await api.uploadFile(groupId, file, fullName)
        setDoneCount(i + 1)
      }
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed')
    } finally {
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
        className="w-full max-w-md space-y-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Upload files</h3>
          <button
            onClick={onClose}
            disabled={busy}
            className="btn-ghost p-2"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-[var(--text-secondary)]">
          Name each file before it is uploaded. Up to {MAX_FILES} files, {formatBytes(MAX_FILE_BYTES)} each.
        </p>

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {entries.map((entry, i) => (
            <div key={i} className="space-y-1">
              <p className="truncate text-xs text-[var(--text-tertiary)]">
                {entry.file.name} · {formatBytes(entry.file.size)}
              </p>
              <FileNameField
                originalName={entry.file.name}
                value={entry.stem}
                onChange={(stem) => renameStem(i, stem)}
                disabled={busy}
                aria-label={`Name for ${entry.file.name}`}
              />
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-tertiary)]">
            {busy ? `Uploading ${doneCount}/${entries.length}…` : `${entries.length} file(s)`}
          </span>
          <div className="flex gap-2">
            <Button onClick={uploadAll} disabled={busy}>
              {busy ? <Spinner /> : <Upload size={16} />}
              Upload
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}