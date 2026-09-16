import { ChevronDown, Search } from 'lucide-react'
import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const base =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle transition focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={className}>
      <input className={base} {...rest} />
    </div>
  )
}

export function SearchInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" />
      <input type="search" className={cn(base, 'pl-8')} {...rest} />
    </div>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  placeholder?: string
}

export function Select({ options, placeholder, className, ...rest }: SelectProps) {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(base, 'appearance-none pr-8', !rest.value && 'text-muted')} {...rest}>
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-subtle" />
    </div>
  )
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[13px] font-medium">{children}</span>
      {hint && <span className="text-xs text-subtle">{hint}</span>}
    </div>
  )
}
