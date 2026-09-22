import { ChevronDown, Search } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />
}

export function SearchInput({ style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="input-wrap" style={style}>
      <Search aria-hidden />
      <input type="search" className="input" {...props} />
    </span>
  )
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: { value: string; label: string }[]
  size?: 'md' | 'sm'
  width?: number | string
}

/** Нативный select: клавиатура, скринридеры и мобильные пикеры работают из коробки. */
export function Select({ options, size = 'md', width, ...props }: SelectProps) {
  return (
    <span className={size === 'sm' ? 'select select--sm' : 'select'} style={{ width }}>
      <select className="select__control" {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden />
    </span>
  )
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      {label}
    </label>
  )
}
