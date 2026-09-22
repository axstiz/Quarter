import { motion } from 'motion/react'
import { useId } from 'react'
import { t } from '@/lib/motion'

/** Сегментный переключатель (радиогруппа): подложка выбранного пункта переезжает. */
export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; hint?: string }[]; label: string }) {
  const id = useId()
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {items.map((it) => (
        <button key={it.value} type="button" role="radio" aria-checked={it.value === value} title={it.hint} className="segmented__item" onClick={() => onChange(it.value)}>
          {it.value === value && <motion.span layoutId={`seg-${id}`} className="segmented__thumb" transition={t.layout} />}
          <span className="segmented__label">{it.label}</span>
        </button>
      ))}
    </div>
  )
}
