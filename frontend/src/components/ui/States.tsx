import { AlertTriangle, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { cn } from '@/lib/cn'
import { Button } from './Button'

export function EmptyState({ icon, title, description, action, className }: { icon: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const status = error instanceof ApiError ? error.status : null
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
  const hint =
    status === 400 ? 'В базе нет данных — сначала загрузите датасет.'
    : status === 404 ? 'Объект не найден. Возможно, план был пересчитан.'
    : status === null ? 'Бэкенд недоступен. Проверьте, что uvicorn запущен на :8000.'
    : null
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-3 grid size-10 place-items-center rounded-xl bg-danger-soft text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <p className="text-sm font-semibold">{status ? `Ошибка ${status}` : 'Не удалось загрузить'}</p>
      <p className="mt-1 max-w-md text-sm text-muted">{message}</p>
      {hint && <p className="mt-1 max-w-md text-xs text-subtle">{hint}</p>}
      {onRetry && (
        <Button size="sm" className="mt-4" icon={<RotateCw className="size-3.5" />} onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  )
}
