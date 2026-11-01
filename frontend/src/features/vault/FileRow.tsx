// FileRow: one row in the vault listing — inline rename, preview, download,
// and delete triggers. Kept separate to keep FileVault under the size target.
import { Upload, FileText, Download, Eye, X, Pencil, Trash2 } from 'lucide-react'
import type { VaultFile } from '../../types'
import { FileNameField } from './FileNameField'
import { formatBytes, formatDate } from './format'

export function FileRow({
  file,
  nonMember,
  renaming,
  renameDraft,
  onRenameDraft,
  onBeginRename,
  onSaveRename,
  onCancelRename,
  onPreview,
  onDownload,
  onDelete,
}: {
  file: VaultFile
  nonMember: boolean
  renaming: VaultFile | null
  renameDraft: string
  onRenameDraft: (stem: string) => void
  onBeginRename: (file: VaultFile) => void
  onSaveRename: () => void
  onCancelRename: () => void
  onPreview: (file: VaultFile) => void
  onDownload: (file: VaultFile) => void
  onDelete: (file: VaultFile) => void
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
        <FileText size={20} />
      </span>
      <div className="min-w-0 flex-1">
        {renaming?.id === file.id ? (
          <div className="flex items-center gap-2">
            <FileNameField
              originalName={renaming.name}
              value={renameDraft}
              onChange={onRenameDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveRename()
                if (e.key === 'Escape') onCancelRename()
              }}
              autoFocus
              className="max-w-xs"
              aria-label="Rename file"
            />
            <button onClick={onSaveRename} className="btn-ghost p-1.5 text-green-500" aria-label="Save">
              <Upload size={14} />
            </button>
            <button onClick={onCancelRename} className="btn-ghost p-1.5" aria-label="Cancel">
              <X size={14} />
            </button>
          </div>
        ) : (
          <>
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-[var(--text-tertiary)]">
              {file.uploaderName || 'Unknown'} · {formatBytes(file.size)} · {formatDate(file.createdAt)}
            </p>
          </>
        )}
      </div>
      <div className="flex gap-1">
        <button className="btn-ghost p-2" onClick={() => onBeginRename(file)} disabled={nonMember} aria-label={`Rename ${file.name}`} title="Rename">
          <Pencil size={16} />
        </button>
        <button className="btn-ghost p-2" onClick={() => onPreview(file)} disabled={nonMember} aria-label={`Preview ${file.name}`}>
          <Eye size={16} />
        </button>
        <button className="btn-ghost p-2" onClick={() => onDownload(file)} disabled={nonMember} aria-label={`Download ${file.name}`}>
          <Download size={16} />
        </button>
        <button
          className="btn-ghost p-2 text-red-500"
          onClick={() => onDelete(file)}
          disabled={nonMember}
          aria-label={`Delete ${file.name}`}
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  )
}