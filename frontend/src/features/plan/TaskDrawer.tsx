import { ArrowRight, Ban, Link2, ShieldAlert } from 'lucide-react'
import { useDependencies } from '@/api/queries'
import type { Decision, PlanTask } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Overlay'
import { cn } from '@/lib/cn'
import { DECISION_META, SOFT_BG } from '@/lib/decision'
import { fmt, sprintWeeks } from '@/lib/format'
import type { RiskEntry } from './busRisk'
import { DecisionBadge } from './DecisionBadge'

/** Задача в плане или задача вне квартала (у неё меньше данных). */
export type DrawerTask = Pick<PlanTask, 'task_id' | 'decision' | 'reason' | 'sprint_no'> & Partial<PlanTask>

interface Props {
  task: DrawerTask | null
  risk?: RiskEntry
  onClose: () => void
  onOpenTask: (id: string) => void
  onCancel: (taskId: string, step: 'request' | 'confirm') => void
  cancelling: boolean
}

export function TaskDrawer({ task, risk, onClose, onOpenTask, onCancel, cancelling }: Props) {
  const deps = useDependencies()
  if (!task) return null

  const blockedBy = deps.data?.filter((d) => d.blocked_task_id === task.task_id).map((d) => d.blocking_task_id) ?? []
  const blocks = deps.data?.filter((d) => d.blocking_task_id === task.task_id).map((d) => d.blocked_task_id) ?? []
  const roles = Object.entries(task.role_hours ?? {}).sort((a, b) => b[1] - a[1])
  const maxHours = Math.max(1, ...roles.map(([, h]) => h))
  const canRequestCancel = task.decision === 'postponed' && !task.sprint_no

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="font-mono text-sm">{task.task_id}</span>}
      description={task.summary}
      footer={
        canRequestCancel ? (
          <Button variant="secondary" icon={<Ban className="size-4" />} loading={cancelling} onClick={() => onCancel(task.task_id, 'request')}>
            Предложить отмену
          </Button>
        ) : task.decision === 'cancelled_pending' ? (
          <Button variant="danger" icon={<Ban className="size-4" />} loading={cancelling} onClick={() => onCancel(task.task_id, 'confirm')}>
            Подтвердить отмену
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <ReasonCallout decision={task.decision} reason={task.reason} />

        <dl className="grid grid-cols-3 gap-2">
          <Stat label="Спринт" value={task.sprint_no ? `${task.sprint_no}` : '—'} hint={task.sprint_no ? sprintWeeks(task.sprint_no) : 'вне квартала'} />
          <Stat label="SP в спринте" value={fmt(task.step_points_sp ?? task.estimation_sp)} hint={task.estimation_sp != null ? `оценка ${fmt(task.estimation_sp)}` : undefined} />
          <Stat label="Команда" value={task.team_id ?? '—'} hint={task.parent_id ? `инициатива ${task.parent_id}` : undefined} />
        </dl>

        {risk && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-danger">
              <ShieldAlert className="size-4" /> Риск Bus Factor
            </div>
            <ul className="mt-1.5 space-y-1 text-[13px]">
              {risk.competencies.map((c) => (
                <li key={c.key}>
                  «{c.key}» — единственный носитель <span className="font-mono text-xs">{c.holder}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {roles.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">Часы по ролям</h3>
            <ul className="space-y-2">
              {roles.map(([role, hours]) => (
                <li key={role} className="text-[13px]">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{role}</span>
                    <span className="font-medium tabular-nums">{fmt(hours)} ч</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent/70" style={{ width: `${(hours / maxHours) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(blockedBy.length > 0 || blocks.length > 0) && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-subtle uppercase">
              <Link2 className="size-3" /> Зависимости
            </h3>
            <div className="space-y-1.5 text-[13px]">
              {blockedBy.map((id) => (
                <DepRow key={id} label="ждёт" id={id} onOpen={onOpenTask} />
              ))}
              {blocks.map((id) => (
                <DepRow key={id} label="блокирует" id={id} onOpen={onOpenTask} />
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  )
}

function ReasonCallout({ decision, reason }: { decision: Decision; reason: string }) {
  const tone = DECISION_META[decision].tone
  return (
    <div className={cn('rounded-xl p-3', SOFT_BG[tone])}>
      <DecisionBadge decision={decision} className="bg-surface/70" />
      <p className="mt-2 text-sm leading-relaxed">{reason || 'Задача помещается в спринт по ресурсу команды, часам ролей и зависимостям.'}</p>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <dt className="text-[11px] text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted">{hint}</dd>}
    </div>
  )
}

function DepRow({ label, id, onOpen }: { label: string; id: string; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(id)} className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left hover:bg-surface-2">
      <span className="w-16 text-xs text-muted">{label}</span>
      <span className="font-mono text-xs font-medium">{id}</span>
      <ArrowRight className="ml-auto size-3.5 text-subtle" />
    </button>
  )
}
