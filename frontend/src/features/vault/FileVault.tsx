// FileVault: the group's shared file repository with upload and list.
import { useEffect, useRef, useState } from 'react'
import { Upload, FileText, FolderOpen } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import type { VaultFile } from '../../types'
import { GlassCard, Button, Spinner } from '../../components/ui'

/** formatBytes renders a human-readable file size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** formatDate renders a short local date. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function FileVault({ groupId }: { groupId: string }) {
  const [files, setFiles] = useState<VaultFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setFiles(await api.listFiles(groupId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [groupId])

  const onPick = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await api.uploadFile(groupId, file)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">{files.length} files</p>
        <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Spinner /> : <Upload size={16} />}
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
      </div>

      {error && <GlassCard className="p-4 text-sm text-red-500">{error}</GlassCard>}

      {loading ? (
        <div className="flex justify-center py-16 text-[var(--text-secondary)]">
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <GlassCard className="p-10 text-center text-[var(--text-secondary)]">
          <FolderOpen size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-semibold text-[var(--text)]">Vault is empty</p>
          <p className="text-sm">Upload files to share with your group.</p>
        </GlassCard>
      ) : (
        <GlassCard className="divide-y divide-[var(--border)]">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                <FileText size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {f.uploaderName || 'Unknown'} · {formatBytes(f.size)} · {formatDate(f.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </GlassCard>
      )}
    </div>
  )
}