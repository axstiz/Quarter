import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

function useOverlay(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [open, onClose])
  return panel
}

interface OverlayProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function Drawer({ open, onClose, title, description, children, footer, className }: OverlayProps) {
  const panel = useOverlay(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/30 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal
        className={cn('absolute inset-y-2 right-2 flex w-[min(460px,calc(100%-16px))] animate-slide-in flex-col rounded-2xl border border-border bg-surface shadow-pop outline-none', className)}
      >
        <OverlayHeader title={title} description={description} onClose={onClose} />
        <div className="scroll-thin flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Dialog({ open, onClose, title, description, children, footer, className }: OverlayProps) {
  const panel = useOverlay(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal
        className={cn('relative flex max-h-[calc(100dvh-32px)] w-full max-w-lg animate-pop-in flex-col rounded-2xl border border-border bg-surface shadow-pop outline-none', className)}
      >
        <OverlayHeader title={title} description={description} onClose={onClose} />
        <div className="scroll-thin overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

function OverlayHeader({ title, description, onClose }: { title: ReactNode; description?: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <button onClick={onClose} className="-mt-1 -mr-1 rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Закрыть">
        <X className="size-4" />
      </button>
    </div>
  )
}
