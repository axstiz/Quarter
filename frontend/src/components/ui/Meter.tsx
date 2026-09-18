import { fmt } from '@/lib/format'

/** Шкала «план / доступно». Заполнение — transform, чтобы изменение анимировалось без перерасчёта раскладки. */
export function Meter({ value, max, unit = '', label }: { value: number; max?: number | null; unit?: string; label?: string }) {
  if (max == null || max <= 0) {
    return <span className="meter__text">{fmt(value)}{unit}</span>
  }
  const ratio = value / max
  const state = ratio > 1.001 ? 'over' : ratio >= 0.9 ? 'full' : 'ok'
  return (
    <span className="meter" data-state={state} title={label}>
      <span className="meter__track" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <span className="meter__fill" style={{ transform: `scaleX(${Math.min(ratio, 1)})` }} />
      </span>
      <span className="meter__text">
        {fmt(value)} / {fmt(max)}
        {unit}
        {state === 'over' && ` · +${fmt(value - max)}`}
      </span>
    </span>
  )
}
