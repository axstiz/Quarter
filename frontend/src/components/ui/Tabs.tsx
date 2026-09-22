import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { t } from '@/lib/motion'

interface Item {
  value: string
  label: string
  count?: number
}

/** Вкладки через ?view= (ссылки сохраняют остальные параметры). Индикатор переезжает между вкладками.
 *  right — действие на одной линии с вкладками, прижато вправо. */
export function Tabs({ items, current, param = 'view', right }: { items: Item[]; current: string; param?: string; right?: ReactNode }) {
  const { pathname, search } = useLocation()
  const id = useId()
  return (
    <nav className="tabs" aria-label="Представление">
      {items.map((it) => {
        const next = new URLSearchParams(search)
        next.set(param, it.value)
        const active = it.value === current
        return (
          <Link key={it.value} className="tabs__item" to={`${pathname}?${next}`} replace aria-current={active ? 'page' : undefined}>
            {it.label}
            {it.count != null && <span className="tabs__count">{it.count}</span>}
            {active && <motion.span layoutId={`tabs-${id}`} className="tabs__indicator" transition={t.layout} />}
          </Link>
        )
      })}
      {right && <div className="tabs__end">{right}</div>}
    </nav>
  )
}
