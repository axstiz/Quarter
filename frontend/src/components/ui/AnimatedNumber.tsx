import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { fmt } from '@/lib/format'

/** Число плавно доходит до нового значения после пересчёта — видно, что оно изменилось. */
export function AnimatedNumber({ value, suffix = '' }: { value: number | null | undefined; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(value)
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    const from = prev.current
    prev.current = value
    if (!el || value == null) return
    if (from == null || from === value || reduce) {
      el.textContent = fmt(value) + suffix
      return
    }
    const controls = animate(from, value, {
      duration: 0.3,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (v) => (el.textContent = fmt(Math.round(v * 10) / 10) + suffix),
    })
    return () => controls.stop()
  }, [value, suffix, reduce])

  return (
    <span ref={ref} className="tabular">
      {value == null ? '—' : fmt(value) + suffix}
    </span>
  )
}
