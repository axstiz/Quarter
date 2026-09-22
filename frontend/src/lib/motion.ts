import type { Transition } from 'motion/react'

/** Те же кривые, что в tokens.css — анимации CSS и Motion ощущаются одинаково. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const

export const t = {
  fast: { duration: 0.15, ease: EASE_OUT } satisfies Transition,
  base: { duration: 0.2, ease: EASE_OUT } satisfies Transition,
  panelIn: { duration: 0.26, ease: EASE_DRAWER } satisfies Transition,
  panelOut: { duration: 0.18, ease: EASE_OUT } satisfies Transition,
  layout: { type: 'spring', duration: 0.3, bounce: 0 } satisfies Transition,
}

/** Каскад появления: 40 мс между элементами, не более 8 шагов, чтобы не затягивать. */
export const stagger = (i: number) => ({ ...t.base, delay: Math.min(i, 8) * 0.04 })
