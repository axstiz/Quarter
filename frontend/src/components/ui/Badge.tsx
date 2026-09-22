import type { ReactNode } from 'react'
import type { Decision } from '@/api/types'
import { DECISION_LABEL } from '@/lib/labels'

export type Tone = 'neutral' | 'plan' | 'done' | 'shift' | 'over' | 'pending' | 'fact'

export function Badge({ tone = 'neutral', plain, children }: { tone?: Tone; plain?: boolean; children: ReactNode }) {
  return (
    <span className={plain ? 'badge badge--plain' : 'badge'} data-tone={tone}>
      {children}
    </span>
  )
}

/** Спека ui: запланировано — зелёный, перенос — жёлтый, кандидат на отмену — оранжевый, отмена — красный, факт — серый. */
export const DECISION_TONE: Record<Decision, Tone> = {
  planned: 'done',
  postponed: 'shift',
  cancelled_pending: 'pending',
  cancelled: 'over',
  done_actual: 'fact',
}

/** Цвет дублируется текстом — статус не передаётся одним цветом. */
export function DecisionBadge({ decision }: { decision: Decision }) {
  return <Badge tone={DECISION_TONE[decision]}>{DECISION_LABEL[decision]}</Badge>
}
