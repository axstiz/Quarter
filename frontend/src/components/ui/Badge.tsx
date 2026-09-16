import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import type { Tone } from '@/lib/decision'

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  pending: 'bg-pending-soft text-pending',
  done: 'bg-done-soft text-done',
}

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  dot?: boolean
}

export function Badge({ tone = 'neutral', dot, className, children, ...rest }: Props) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}
      {...rest}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
