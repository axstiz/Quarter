import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { Button } from './Button'

export function Empty({ icon, title, text, actions }: { icon: ReactNode; title: string; text?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden>
        {icon}
      </div>
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  )
}

/** Ошибка отвечает на три вопроса: что случилось, почему, что делать. */
export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      <AlertCircle aria-hidden />
      <div>
        <div className="alert__title">{errorTitle(error)}</div>
        <div>{errorHint(error)}</div>
        {onRetry && (
          <div className="alert__actions">
            <Button size="sm" onClick={onRetry}>
              Повторить
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function errorTitle(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error)
  return error instanceof ApiError ? `${msg} (${error.status})` : msg
}

export function errorHint(error: unknown) {
  const status = error instanceof ApiError ? error.status : null
  if (status === 400) return 'В базе нет данных — сначала загрузите датасет.'
  if (status === 404) return 'Объект не найден. Возможно, открыта устаревшая версия плана.'
  if (status === 409) return 'Это действие уже выполнено ранее.'
  if (status === 422) return 'Сервер не принял данные — проверьте введённое.'
  if (status === null) return 'Сервер не ответил. Проверьте, что бэкенд запущен на :8000.'
  return 'Попробуйте ещё раз.'
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <table className="table" aria-busy="true" aria-label="Загрузка">
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }, (_, c) => (
              <td key={c}>
                <div className="skeleton" style={{ height: 12, width: c === 1 ? '80%' : '50%', animationDelay: `${r * 60}ms` }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
