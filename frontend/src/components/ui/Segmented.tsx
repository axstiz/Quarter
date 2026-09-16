import { cn } from '@/lib/cn'

interface Option<T extends string> {
  value: T
  label: React.ReactNode
  count?: number
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: Option<T>[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition',
            size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
          {o.count != null && <span className="text-subtle tabular-nums">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}
