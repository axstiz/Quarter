import type { Decision, PlanVersion, WarningKind } from '@/api/types'

export const DECISION_LABEL: Record<Decision, string> = {
  planned: 'В плане',
  postponed: 'Перенесена',
  cancelled_pending: 'Ждёт подтверждения отмены',
  cancelled: 'Отменена',
  done_actual: 'Выполнена',
}

export const WARNING_LABEL: Record<WarningKind, string> = {
  deadline_overflow: 'Выход за пределы квартала',
  dependency_shift: 'Сдвиг цепочки зависимостей',
  role_deficit: 'Дефицит специалистов на следующий спринт',
  grade_deficit: 'Дефицит минимального грейда на спринт',
  composition_change: 'Изменение состава плана',
}

/** Устойчивость к новым видам предупреждений бэка: «kind» вместо undefined. */
export function warningLabel(kind: string): string {
  return (WARNING_LABEL as Record<string, string>)[kind] ?? kind
}

export const versionLabel = (v: Pick<PlanVersion, 'is_initial' | 'recomputed_after_sprint'>) =>
  v.is_initial
    ? 'Первоначальный план'
    : v.recomputed_after_sprint
      ? `Пересчёт после спринта ${v.recomputed_after_sprint}`
      : 'Пересчёт без нового факта'
