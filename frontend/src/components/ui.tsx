// Shared UI primitives built on the frosted-glass design system.

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
  variant?: 'primary' | 'ghost'
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed'
  const style = variant === 'primary' ? 'btn-primary' : 'btn-ghost'
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