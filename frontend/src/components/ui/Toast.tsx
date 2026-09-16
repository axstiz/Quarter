import { CheckCircle2, AlertCircle, X } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

interface Toast {
  id: number
  title: string
  description?: string
  tone: 'ok' | 'error'
}

const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id))
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((ts) => [...ts, { ...t, id }])
    setTimeout(() => dismiss(id), 4500)
  }, [])

  return (
    <Ctx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(360px,calc(100%-32px))] flex-col gap-2" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto flex animate-pop-in gap-3 rounded-xl border border-border bg-surface p-3 shadow-pop">
              {t.tone === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.description && <p className={cn('mt-0.5 text-xs text-muted')}>{t.description}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="self-start rounded p-0.5 text-subtle hover:text-fg" aria-label="Скрыть">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
