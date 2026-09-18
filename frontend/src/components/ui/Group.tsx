import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  sub?: ReactNode
  /** Сводка в заголовке — чтобы понять спринт, не раскрывая его */
  chips?: ReactNode
  aside?: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** Карточка-секция. Раскрытие: шеврон поворачивается, содержимое проявляется; сворачивание мгновенное. */
export function Group({ title, sub, chips, aside, open, onToggle, children }: Props) {
  return (
    <section className="group" data-open={open}>
      <button type="button" className="group__head" aria-expanded={open} onClick={onToggle}>
        <ChevronRight className="group__chevron" aria-hidden />
        <span className="group__name">
          <span className="group__title">{title}</span>
          {sub && <span className="group__sub">{sub}</span>}
        </span>
        <span className="group__chips">{chips}</span>
        <span className="group__aside">{aside}</span>
      </button>
      {open && <div className="group__body">{children}</div>}
    </section>
  )
}
