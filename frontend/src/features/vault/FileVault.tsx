// FileVault: the group's shared file repository with upload, in-browser
// preview (images/PDFs/text), and download via signed Supabase Storage URLs.
import { useEffect, useRef, useState } from 'react'
import { Upload, FileText, FolderOpen, Download, Eye, X } from 'lucide-react'
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

/** previewKind classifies a file by mime for the preview modal. */
function previewKind(mimeType?: string): 'image' | 'pdf' | 'text' | 'other' {
  if (!mimeType) return 'other'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('text/')) return 'text'
  return 'other'
}

export function FileVault({ groupId }: { groupId: string }) {
  const [files, setFiles] = useState<VaultFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Preview state.
  const [preview, setPreview] = useState<{ file: VaultFile; url: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setFiles((await api.listFiles(groupId)) ?? [])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [groupId])

  // Poll so files uploaded by other group members show up without a reload.
  useEffect(() => {
    const t = setInterval(() => {
      void api
        .listFiles(groupId)
        .then((fs) => setFiles(fs ?? []))
        .catch(() => {})
    }, 5000)
    return () => clearInterval(t)
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

  const openPreview = async (file: VaultFile) => {
    setPreviewLoading(true)
    setError('')
    try {
      const { url } = await api.fileUrl(groupId, file.id)
      setPreview({ file, url })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  const download = async (file: VaultFile) => {
    setError('')
    try {
      const { url } = await api.fileUrl(groupId, file.id)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.target = '_blank'
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to download')
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
              <div className="flex gap-1">
                <button
                  className="btn-ghost p-2"
                  onClick={() => openPreview(f)}
                  aria-label={`Preview ${f.name}`}
                >
                  <Eye size={16} />
                </button>
                <button
                  className="btn-ghost p-2"
                  onClick={() => download(f)}
                  aria-label={`Download ${f.name}`}
                >
                  <Download size={16} />
                </button>
              </div>
            </div>
          ))}
        </GlassCard>
      )}

      {/* ---- Preview modal ---- */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPreview(null)}>
          <GlassCard strong className="w-full max-w-3xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="truncate text-sm font-semibold">{preview.file.name}</h3>
              <button onClick={() => setPreview(null)} className="btn-ghost p-2" aria-label="Close preview">
                <X size={16} />
              </button>
            </div>
            <PreviewBody url={preview.url} mimeType={preview.file.mimeType} />
          </GlassCard>
        </div>
      )}
      {previewLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <Spinner className="h-8 w-8" />
        </div>
      )}
    </div>
  )
}

/** PreviewBody renders the file in-browser based on its kind. */
function PreviewBody({ url, mimeType }: { url: string; mimeType?: string }) {
  const kind = previewKind(mimeType)
  if (kind === 'image') {
    return (
      <div className="flex justify-center rounded-xl bg-[var(--surface)] p-2">
        <img src={url} alt="Preview" className="max-h-[65vh] rounded-lg object-contain" />
      </div>
    )
  }
  if (kind === 'pdf') {
    return (
      <iframe src={url} title="PDF preview" className="h-[65vh] w-full rounded-lg border-0" />
    )
  }
  if (kind === 'text') {
    return <TextPreview url={url} />
  }
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-[var(--text-secondary)]">
      <FileText size={40} className="opacity-40" />
      <p className="text-sm">Preview not available for this file type — use download.</p>
    </div>
  )
}

/** TextPreview fetches a text file's content and renders it monospaced. */
function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to fetch')
        return r.text()
      })
      .then(setText)
      .catch(() => setError('Failed to load text.'))
  }, [url])

  if (error) return <p className="py-8 text-center text-sm text-red-500">{error}</p>
  if (!text) return <div className="flex justify-center py-8"><Spinner /></div>
  return <pre className="max-h-[65vh] overflow-auto rounded-lg bg-[var(--surface)] p-4 text-xs">{text}</pre>
}