import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 shadow-card',
  secondary: 'bg-surface text-fg border border-border hover:bg-surface-2 shadow-card',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110 shadow-card',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }: Props) {
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition select-none',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}
