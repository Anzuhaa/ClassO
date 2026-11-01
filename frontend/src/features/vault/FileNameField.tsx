// FileNameField: a filename editor whose extension is read-only. The live
// (editable) part is the "stem" before the last dot; the extension — including
// its leading dot — is derived from the original filename and rendered as a
// fixed, non-editable suffix so the file's type is never lost by a rename.
import type { InputHTMLAttributes } from 'react'
import { Input } from '../../components/ui'

/** splitName breaks a filename into its editable stem and read-only extension
 * (which includes the leading dot). A file with no extension (or one that only
 * has a leading dot, like ".gitignore") yields an empty extension. */
export function splitName(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.')
  if (i <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, i), ext: name.slice(i) }
}

export function FileNameField({
  originalName,
  value,
  onChange,
  ...rest
}: {
  originalName: string
  value: string
  onChange: (stem: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const { ext } = splitName(originalName)
  return (
    <div className="flex items-center gap-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
        className={`${rest.className ?? ''}`}
      />
      {ext && (
        <span
          className="shrink-0 select-none text-sm text-[var(--text-tertiary)]"
          aria-hidden
          title={`File type ${ext}`}
        >
          {ext}
        </span>
      )}
    </div>
  )
}