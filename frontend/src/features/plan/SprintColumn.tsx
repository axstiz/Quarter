import type { PlanTask } from '@/api/types'
import { Progress } from '@/components/ui/Progress'
import { cn } from '@/lib/cn'
import { fmt, sprintWeeks } from '@/lib/format'
import { TaskCard } from './TaskCard'

interface Props {
  sprintNo: number
  tasks: PlanTask[]
  /** Ёмкость в SP (velocity × 0.8). Известна только при выбранной команде. */
  capacity?: number
  isFixed?: boolean
  riskIds: Set<string>
  onOpen: (t: PlanTask) => void
}

export function SprintColumn({ sprintNo, tasks, capacity, isFixed, riskIds, onOpen }: Props) {
  const sp = tasks.filter((t) => t.decision !== 'cancelled').reduce((s, t) => s + (t.step_points_sp ?? 0), 0)

  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-surface-2/60" aria-label={`Спринт ${sprintNo}`}>
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">
            Спринт {sprintNo}
            <span className="ml-1.5 text-xs font-normal text-subtle">{sprintWeeks(sprintNo)}</span>
          </h2>
          <span className="rounded-md bg-surface px-1.5 text-xs font-medium text-muted tabular-nums">{tasks.length}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted tabular-nums">
          <span>
            <span className="font-semibold text-fg">{fmt(sp)}</span>
            {capacity != null ? ` / ${fmt(capacity)} SP` : ' SP'}
          </span>
          {isFixed ? <span className="font-medium text-done">зафиксирован</span> : capacity != null && sp > capacity && <span className="font-medium text-danger">перегруз</span>}
        </div>
        {capacity != null && <Progress value={sp} max={capacity} className="mt-1.5" />}
      </header>

      <div className={cn('scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2')}>
        {tasks.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-border py-10 text-xs text-subtle">
            Нет задач
          </div>
        ) : (
          tasks.map((t) => <TaskCard key={t.task_id} task={t} atRisk={riskIds.has(t.task_id)} onOpen={() => onOpen(t)} />)
        )}
      </div>
    </section>
  )
}
