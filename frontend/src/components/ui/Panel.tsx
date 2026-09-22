import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@/lib/motion'
import { Button } from './Button'

interface Props {
  /** Ключ содержимого: при смене (другая задача) — короткий кроссфейд, панель не переезжает заново */
  contentKey: string | null
  eyebrow?: ReactNode
  title?: ReactNode
  onClose: () => void
  children?: ReactNode
  /** Поверх контента, без сдвига: для сеток, которые при сжатии теряют читаемость */
  overlay?: boolean
}

/**
 * Панель деталей справа. На широком экране сдвигает контент (без затемнения),
 * на узком — ложится поверх с подложкой. Вход 260 мс, выход быстрее — 180 мс.
 */
export function Panel({ contentKey, eyebrow, title, onClose, children, overlay }: Props) {
  const open = contentKey !== null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key === 'Escape' && !target.closest('input, textarea, select, [role="dialog"]')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Портал: предки с transform (переход страниц) не должны ломать position: fixed
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="panel-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: t.base }} exit={{ opacity: 0, transition: t.fast }} />
          <motion.aside
            key="panel"
            className={overlay ? 'panel panel--overlay' : 'panel'}
            aria-label="Подробности"
            initial={{ transform: 'translateX(100%)' }}
            animate={{ transform: 'translateX(0%)', transition: t.panelIn }}
            exit={{ transform: 'translateX(100%)', transition: t.panelOut }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={contentKey}
                className="panel__inner"
                initial={{ opacity: 0, filter: 'blur(2px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)', transition: t.fast }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
              >
                <div className="panel__head">
                  <div style={{ minWidth: 0 }}>
                    {eyebrow && <div className="panel__eyebrow">{eyebrow}</div>}
                    {title && <h2 className="panel__title">{title}</h2>}
                  </div>
                  <Button variant="ghost" size="sm" iconOnly icon={<X />} onClick={onClose} aria-label="Закрыть панель (Esc)" />
                </div>
                <div className="panel__body">{children}</div>
              </motion.div>
            </AnimatePresence>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
