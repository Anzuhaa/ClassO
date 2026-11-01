// FilePreview: in-browser preview of a vault file based on its MIME type
// (images, PDFs inline, and text fetched and shown monospaced).
import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { Spinner } from '../../components/ui'

/** previewKind classifies a file by mime for the preview modal. */
export function previewKind(mimeType?: string): 'image' | 'pdf' | 'text' | 'other' {
  if (!mimeType) return 'other'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('text/')) return 'text'
  return 'other'
}

/** PreviewBody renders the file in-browser based on its kind. */
export function PreviewBody({ url, mimeType }: { url: string; mimeType?: string }) {
  const kind = previewKind(mimeType)
  if (kind === 'image') {
    return (
      <div className="flex justify-center rounded-xl bg-[var(--surface)] p-2">
        <img src={url} alt="Preview" className="max-h-[65vh] rounded-lg object-contain" />
      </div>
    )
  }
  if (kind === 'pdf') {
    return <iframe src={url} title="PDF preview" className="h-[65vh] w-full rounded-lg border-0" />
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
  if (!text)
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  return (
    <pre className="max-h-[65vh] overflow-auto rounded-lg bg-[var(--surface)] p-4 text-xs">{text}</pre>
  )
}