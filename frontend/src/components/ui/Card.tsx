import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-surface shadow-card', className)} {...rest} />
}

export function CardHeader({ title, icon, actions, hint }: { title: ReactNode; icon?: ReactNode; actions?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon && <span className="text-muted">{icon}</span>}
          {title}
        </div>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {actions}
    </div>
  )
}
