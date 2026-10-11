import type { ReactNode } from 'react'

import { playerColour } from '../store/load'

export function Card({
  label,
  sub,
  right,
  children,
  className = '',
}: {
  label?: string
  sub?: string
  right?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-edge bg-panel p-5 ${className}`}>
      {(label || right) && (
        <div className="flex items-start gap-3">
          <div className="mr-auto">
            {label && <h2 className="text-sm font-semibold text-white">{label}</h2>}
            {sub && <p className="mt-0.5 text-xs text-neutral-500">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function PlayerName({
  name,
  colourKey,
  className = '',
}: {
  name: string
  colourKey: string
  className?: string
}) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: playerColour(colourKey) }}
        aria-hidden
      />
      <span className="truncate text-neutral-100">{name}</span>
    </span>
  )
}

export function TierBadge({ tier }: { tier: number }) {
  return (
    <span className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-neutral-400">
      T{tier}
    </span>
  )
}

export function Banner({
  tone = 'warn',
  title,
  children,
  action,
}: {
  tone?: 'warn' | 'error' | 'info'
  title?: string
  children: ReactNode
  action?: ReactNode
}) {
  const tones = {
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    error: 'border-red-500/40 bg-red-500/10 text-red-300',
    info: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  }

  return (
    <div className={`rounded-xl border p-4 text-sm ${tones[tone]}`}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto">
          {title && <strong className="font-semibold">{title}</strong>} {children}
        </p>
        {action}
      </div>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-neutral-600">{hint}</span>}
    </label>
  )
}

const inputStyle =
  'mt-1 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-white ' +
  'outline-none focus:border-blue-500 disabled:text-neutral-500'

export function TextInput({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <input
      type="text"
      className={inputStyle}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/**
 * A number field that tolerates being empty mid-edit.
 *
 * Parsing on every keystroke and rejecting NaN makes the field impossible to
 * clear — you cannot delete the last digit to type a new one. So the raw text
 * is held as typed and only committed when it parses.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  suffix,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  suffix?: string
}) {
  return (
    <span className="relative block">
      <input
        type="number"
        className={inputStyle}
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value)
          if (event.target.value !== '' && Number.isFinite(parsed)) onChange(parsed)
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 translate-y-[2px] text-xs text-neutral-600">
          {suffix}
        </span>
      )}
    </span>
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-500',
    ghost: 'border border-edge text-neutral-200 hover:border-neutral-600',
    danger: 'border border-red-500/40 text-red-300 hover:border-red-500',
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${variants[variant]}`}
    >
      {children}
    </button>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-neutral-600">{children}</p>
}
