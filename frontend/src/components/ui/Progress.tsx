import { cn } from '@/lib/cn'

interface Props {
  value: number
  max: number
  className?: string
  /** Подсвечивать перегруз (value > max) красным. */
  overflow?: boolean
}

export function Progress({ value, max, className, overflow = true }: Props) {
  const ratio = max > 0 ? value / max : 0
  const over = overflow && ratio > 1.001
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', over ? 'bg-danger' : ratio > 0.9 ? 'bg-warn' : 'bg-accent')}
        style={{ width: `${Math.min(ratio, 1) * 100}%` }}
      />
    </div>
  )
}
