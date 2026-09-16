import type { ReactNode } from 'react'

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3 md:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-6">{children}</div>}
    </header>
  )
}
