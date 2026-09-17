import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { Button } from './Button'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children?: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  loading?: boolean
  onConfirm: () => void
}

/** Подтверждение необратимых действий. Radix: фокус-ловушка, Esc, возврат фокуса на кнопку. */
export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, tone = 'primary', loading, onConfirm }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title className="dialog__title">{title}</Dialog.Title>
          {description ? <Dialog.Description className="dialog__desc">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
          {children && <div className="dialog__body">{children}</div>}
          <div className="dialog__actions">
            <Dialog.Close asChild>
              <Button variant="ghost" disabled={loading}>
                Отмена
              </Button>
            </Dialog.Close>
            <Button variant={tone} loading={loading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
