import { Clock, ShieldAlert } from 'lucide-react'
import type { PlanTask } from '@/api/types'
import { cn } from '@/lib/cn'
import { DECISION_META } from '@/lib/decision'
import { fmt } from '@/lib/format'
import { DecisionBadge } from './DecisionBadge'

interface Props {
  task: PlanTask
  atRisk?: boolean
  onOpen: () => void
}

export function TaskCard({ task, atRisk, onOpen }: Props) {
  const hours = Object.values(task.role_hours).reduce((s, h) => s + h, 0)
  const muted = task.decision === 'done_actual' || task.decision === 'cancelled'

  return (
    <button
      onClick={onOpen}
      className={cn(
        'group relative w-full overflow-hidden rounded-lg border border-border bg-surface p-3 pl-3.5 text-left shadow-card transition',
        'hover:-translate-y-px hover:border-accent/40 hover:shadow-pop focus-visible:-translate-y-px',
        muted && 'opacity-70',
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', DECISION_META[task.decision].bar)} aria-hidden />

      <div className="flex items-center justify-between gap-2">
        <span className={cn('font-mono text-[11px] font-medium text-muted', task.decision === 'done_actual' && 'line-through')}>{task.task_id}</span>
        <span className="flex items-center gap-1">
          {atRisk && (
            <span className="text-danger" title="Зависит от компетенции с единственным носителем">
              <ShieldAlert className="size-3.5" />
            </span>
          )}
          <span className="rounded bg-surface-2 px-1.5 py-px text-[11px] font-medium text-muted">{task.team_id}</span>
        </span>
      </div>

      <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug font-medium">{task.summary || 'Без названия'}</p>

      {task.reason && task.decision !== 'planned' && (
        <p className="mt-1.5 line-clamp-2 text-xs text-muted">{task.reason}</p>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-[11px] text-muted tabular-nums">
          <span className="font-semibold text-fg">{fmt(task.step_points_sp ?? task.estimation_sp)} SP</span>
          {hours > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {fmt(hours)} ч
            </span>
          )}
        </div>
        {task.decision !== 'planned' && <DecisionBadge decision={task.decision} />}
      </div>
    </button>
  )
}
