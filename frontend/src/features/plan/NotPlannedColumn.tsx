import { CircleSlash } from 'lucide-react'
import type { Explanation, TaskInfo } from '@/api/types'
import { cn } from '@/lib/cn'
import { DecisionBadge } from './DecisionBadge'

interface Props {
  items: Explanation[]
  tasksById: Map<string, TaskInfo>
  onOpen: (item: Explanation) => void
}

export function NotPlannedColumn({ items, tasksById, onOpen }: Props) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-dashed border-border bg-surface/40" aria-label="Вне квартала">
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <CircleSlash className="size-3.5 text-danger" /> Вне квартала
          </h2>
          <span className="rounded-md bg-surface-2 px-1.5 text-xs font-medium text-muted tabular-nums">{items.length}</span>
        </div>
        <p className="mt-2 text-[11px] text-muted">Не влезли даже в спринт 6 — лид решает об отмене</p>
      </header>
      <div className="scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {items.length === 0 ? (
          <div className="grid flex-1 place-items-center py-10 text-center text-xs text-subtle">Всё поместилось в квартал</div>
        ) : (
          items.map((i) => {
            const info = tasksById.get(i.task_id)
            return (
              <button
                key={i.task_id}
                onClick={() => onOpen(i)}
                className={cn(
                  'w-full rounded-lg border border-border bg-surface p-3 text-left shadow-card transition hover:border-accent/40 hover:shadow-pop',
                  i.decision === 'cancelled' && 'opacity-60',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-medium text-muted">{i.task_id}</span>
                  {info && <span className="rounded bg-surface-2 px-1.5 py-px text-[11px] font-medium text-muted">{info.team_id}</span>}
                </div>
                {info && <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug font-medium">{info.summary}</p>}
                <p className="mt-1.5 line-clamp-2 text-xs text-muted">{i.reason}</p>
                <DecisionBadge decision={i.decision} className="mt-2" />
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}
