import type { Decision, WarningKind } from '@/api/types'

export const DECISION_META: Record<Decision, { label: string; tone: Tone; bar: string }> = {
  planned: { label: 'В плане', tone: 'ok', bar: 'bg-ok' },
  postponed: { label: 'Перенесена', tone: 'warn', bar: 'bg-warn' },
  cancelled_pending: { label: 'Ждёт отмены', tone: 'pending', bar: 'bg-pending' },
  cancelled: { label: 'Отменена', tone: 'danger', bar: 'bg-danger' },
  done_actual: { label: 'Выполнена', tone: 'done', bar: 'bg-done' },
}

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'pending' | 'done'

export const WARNING_META: Record<WarningKind, { title: string; tone: Tone }> = {
  deadline_overflow: { title: 'Выход за квартал', tone: 'danger' },
  dependency_shift: { title: 'Сдвиг цепочки зависимостей', tone: 'warn' },
  role_deficit: { title: 'Дефицит ролей', tone: 'pending' },
  composition_change: { title: 'Изменение состава плана', tone: 'accent' },
}

/** Полные имена классов — Tailwind не видит динамически собранные строки. */
export const SOFT_BG: Record<Tone, string> = {
  neutral: 'bg-surface-2',
  accent: 'bg-accent-soft',
  ok: 'bg-ok-soft',
  warn: 'bg-warn-soft',
  danger: 'bg-danger-soft',
  pending: 'bg-pending-soft',
  done: 'bg-done-soft',
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted',
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  pending: 'text-pending',
  done: 'text-done',
}
