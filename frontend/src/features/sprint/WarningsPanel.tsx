import { ArrowRight, CalendarX2, GitFork, UserMinus, Shuffle } from 'lucide-react'
import type { PlanDiff, PlanWarning, WarningKind } from '@/api/types'
import { Card, CardHeader } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { SOFT_BG, TONE_TEXT, WARNING_META } from '@/lib/decision'

const ICONS: Record<WarningKind, typeof CalendarX2> = {
  deadline_overflow: CalendarX2,
  dependency_shift: GitFork,
  role_deficit: UserMinus,
  composition_change: Shuffle,
}

const ORDER: WarningKind[] = ['deadline_overflow', 'dependency_shift', 'role_deficit', 'composition_change']

export function WarningsList({ warnings, loading }: { warnings?: PlanWarning[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-40 rounded-xl" />
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {ORDER.map((kind) => {
        const items = warnings?.filter((w) => w.kind === kind) ?? []
        const meta = WARNING_META[kind]
        const Icon = ICONS[kind]
        const active = items.length > 0
        return (
          <Card key={kind} className={cn('p-3.5', !active && 'shadow-none')}>
            <div className="flex items-center gap-2.5">
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', active ? [SOFT_BG[meta.tone], TONE_TEXT[meta.tone]] : 'bg-surface-2 text-subtle')}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className={cn('text-[13px] font-semibold', !active && 'text-muted')}>{meta.title}</p>
                <p className="text-xs text-subtle">{active ? 'есть риск' : 'не обнаружено'}</p>
              </div>
            </div>
            {items.map((w, i) => (
              <div key={i} className="mt-2.5">
                <p className="text-[13px] leading-snug">{w.message}</p>
                {w.task_ids.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {w.task_ids.map((id) => (
                      <span key={id} className="rounded border border-border px-1 py-px font-mono text-[11px] text-muted">
                        {id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
        )
      })}
    </div>
  )
}

export function DiffCard({ diff, loading }: { diff?: PlanDiff; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Сдвиги задач" hint="Что поменялось относительно предыдущей версии плана" />
      <div className="px-4 pb-4">
        {loading ? (
          <Skeleton className="h-24" />
        ) : !diff || (diff.moved.length === 0 && diff.postponed_now.length === 0) ? (
          <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-sm text-muted">Задачи не сдвигались</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Задача</th>
                  <th className="px-3 py-2 font-medium">Было</th>
                  <th className="w-6" />
                  <th className="px-3 py-2 font-medium">Стало</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {diff.moved.map((m) => (
                  <tr key={m.task_id}>
                    <td className="px-3 py-2 font-mono text-xs">{m.task_id}</td>
                    <td className="px-3 py-2 tabular-nums">Спринт {m.from_sprint}</td>
                    <td className="text-subtle">
                      <ArrowRight className="size-3.5" />
                    </td>
                    <td className="px-3 py-2 font-medium text-warn tabular-nums">Спринт {m.to_sprint}</td>
                  </tr>
                ))}
                {diff.postponed_now.map((id) => (
                  <tr key={id}>
                    <td className="px-3 py-2 font-mono text-xs">{id}</td>
                    <td className="px-3 py-2 text-muted">в квартале</td>
                    <td className="text-subtle">
                      <ArrowRight className="size-3.5" />
                    </td>
                    <td className="px-3 py-2 font-medium text-danger">вне квартала</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
