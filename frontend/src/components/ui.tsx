// Shared UI primitives built on the frosted-glass design system.

import { useState } from 'react'
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'

/** GlassCard is a frosted glass panel. `strong` uses a more opaque surface. */
export function GlassCard({
  children,
  className = '',
  strong = false,
  ...rest
}: { children: ReactNode; className?: string; strong?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${strong ? 'glass-strong' : 'glass'} ${className}`} {...rest}>
      {children}
    </div>
  )
}

/** Button renders a primary or ghost action. */
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'danger'
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed'
  const style = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost'
  return (
    <button className={`${base} ${style} ${className}`} {...rest}>
      {children}
    </button>
  )
}

/** Input is a high-contrast text input (readability-first). */
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`control px-3 py-2 text-sm w-full ${className}`} {...rest} />
}

/** TextArea is a high-contrast multiline input. */
export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`control px-3 py-2 text-sm w-full ${className}`} {...rest} />
}

/** Label wraps a control with an accessible caption. */
export function Label({ children, text }: { children: ReactNode; text: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">{text}</span>
      {children}
    </label>
  )
}

/** Spinner is a small indeterminate loader. */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-label="loading"
    />
  )
}

/** Avatar renders a profile picture with an initials fallback when the URL is
 * missing or fails to load.
 */
export function Avatar({
  name,
  src,
  size = 32,
  className = '',
}: {
  name: string
  src?: string
  size?: number
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const showImg = src && !broken
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--accent)]/10 text-xs font-semibold text-[var(--accent)] ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
      aria-hidden
    >
      {showImg ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        init(name)
      )}
    </span>
  )
}

/** init returns up to two uppercase initials from a display name. */
function init(name: string): string {
  if (!name) return '?'
  const parts = name.split(/\s+/).filter(Boolean)
  return (parts.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase()
}