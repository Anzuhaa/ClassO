// FileVault: the group's shared file repository with upload (with a pre-upload
// naming step, up to 4 files, 20 MB each), rename, delete (type-name confirm),
// in-browser preview, and download via signed Supabase Storage URLs.
import { useEffect, useRef, useState } from 'react'
import { Upload, FolderOpen, X, Lock } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import type { VaultFile } from '../../types'
import { GlassCard, Button, Spinner } from '../../components/ui'
import { FileUploadModal, validateSelection } from './FileUploadModal'
import { FileDeleteModal } from './FileDeleteModal'
import { splitName } from './FileNameField'
import { PreviewBody } from './FilePreview'
import { FileRow } from './FileRow'

export function FileVault({ groupId }: { groupId: string }) {
  const [files, setFiles] = useState<VaultFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nonMember, setNonMember] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Pending uploads (files chosen before naming/confirm) + delete/rename state.
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [deleting, setDeleting] = useState<VaultFile | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [renaming, setRenaming] = useState<VaultFile | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // Preview state.
  const [preview, setPreview] = useState<{ file: VaultFile; url: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setFiles((await api.listFiles(groupId)) ?? [])
      setNonMember(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setFiles([])
        setNonMember(true)
        setError('')
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to load files')
      }
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
        .then((fs) => {
          setFiles(fs ?? [])
          setNonMember(false)
        })
        .catch(() => setNonMember(true))
    }, 5000)
    return () => clearInterval(t)
  }, [groupId])

  const onPick = (list: FileList | null) => {
    if (!list || list.length === 0 || nonMember) return
    const chosen = Array.from(list)
    const problem = validateSelection(chosen)
    if (problem) {
      setError(problem)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setError('')
    setPendingFiles(chosen)
  }

  const onUploadDone = () => {
    setPendingFiles([])
    if (inputRef.current) inputRef.current.value = ''
    void load()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteFile(groupId, deleting.id)
      await load()
      setDeleting(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete')
      throw e
    } finally {
      setDeleteBusy(false)
    }
  }

  const beginRename = (file: VaultFile) => {
    setRenameDraft(splitName(file.name).stem)
    setRenaming(file)
  }

  const saveRename = async () => {
    if (!renaming) return
    const stem = renameDraft.trim()
    const fullName = stem + splitName(renaming.name).ext
    if (!stem || fullName === renaming.name) {
      setRenaming(null)
      return
    }
    try {
      const updated = await api.renameFile(groupId, renaming.id, fullName)
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
      setRenaming(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to rename')
    }
  }

  const openPreview = async (file: VaultFile) => {
    if (nonMember) return
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
    if (nonMember) return
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
    <div className="relative space-y-4">
      <div className={`flex items-center justify-between ${nonMember ? 'blur-sm select-none' : ''}`}>
        <p className="text-sm text-[var(--text-secondary)]">{files.length} files</p>
        <Button onClick={() => inputRef.current?.click()} disabled={nonMember}>
          <Upload size={16} />
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          disabled={nonMember}
          onChange={(e) => {
            onPick(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {error && <GlassCard className="p-4 text-sm text-red-500">{error}</GlassCard>}

      {loading ? (
        <div className="flex justify-center py-16 text-[var(--text-secondary)]">
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <GlassCard className={`p-10 text-center text-[var(--text-secondary)] ${nonMember ? 'blur-sm select-none' : ''}`}>
          <FolderOpen size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-semibold text-[var(--text)]">Vault is empty</p>
          <p className="text-sm">Upload files to share with your group.</p>
        </GlassCard>
      ) : (
        <GlassCard className={`divide-y divide-[var(--border)] ${nonMember ? 'blur-sm select-none' : ''}`}>
          {files.map((f) => (
            <FileRow
              key={f.id}
              file={f}
              nonMember={nonMember}
              renaming={renaming}
              renameDraft={renameDraft}
              onRenameDraft={setRenameDraft}
              onBeginRename={beginRename}
              onSaveRename={() => void saveRename()}
              onCancelRename={() => setRenaming(null)}
              onPreview={openPreview}
              onDownload={download}
              onDelete={setDeleting}
            />
          ))}
        </GlassCard>
      )}

      {/* ---- Non-member privacy overlay ---- */}
      {nonMember && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/40 p-4 text-center backdrop-blur-md">
          <Lock size={24} className="text-white" />
          <p className="text-sm font-semibold text-white">You are not a member of this group</p>
          <p className="text-xs text-white/70">Join this group to view and upload files.</p>
        </div>
      )}

      {/* ---- Upload naming modal ---- */}
      {pendingFiles.length > 0 && (
        <FileUploadModal
          groupId={groupId}
          files={pendingFiles}
          onClose={() => {
            setPendingFiles([])
            if (inputRef.current) inputRef.current.value = ''
          }}
          onDone={onUploadDone}
        />
      )}

      {/* ---- Delete confirmation modal ---- */}
      {deleting && (
        <FileDeleteModal
          file={deleting}
          onClose={() => {
            if (!deleteBusy) setDeleting(null)
          }}
          onConfirm={confirmDelete}
        />
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