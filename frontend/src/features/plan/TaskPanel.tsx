import { ArrowRight, Ban, Info, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useCancelTask, useDependencies } from '@/api/queries'
import type { BusFactorReport, TaskInfo } from '@/api/types'
import { DECISION_TONE, DecisionBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { errorHint, errorTitle } from '@/components/ui/States'
import { fmt } from '@/lib/format'
import { formatSprints, type PlanModel } from '@/lib/planModel'
import { companyRoleHolders } from './busRisk'
import { fmtSp } from './SprintsView'

interface Props {
  model: PlanModel
  planId: string
  taskId: string
  tasksInfo: TaskInfo[]
  busFactor?: BusFactorReport
  readOnly: boolean
  onSelect: (taskId: string) => void
}

export function TaskPanelContent({ model, planId, taskId, tasksInfo, busFactor, readOnly, onSelect }: Props) {
  const deps = useDependencies()
  const cancel = useCancelTask(planId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const task = model.tasks.get(taskId)
  const info = tasksInfo.find((x) => x.task_id === taskId)
  const decision = task?.decision
  const reason = task?.reason
  const inPlan = task && task.sprints.length > 0
  const roleHours = task?.role_hours ?? info?.role_hours ?? {}
  const holders = companyRoleHolders(busFactor)
  const singleRoles = Object.keys(roleHours).filter((r) => holders.get(r.toLowerCase())?.length === 1)

  const whereIs = (id: string) => {
    const t = model.tasks.get(id)
    if (!t) return 'выполнена до квартала'
    if (t.decision === 'done_actual') return `выполнена (спринт ${formatSprints(t.sprints)})`
    return t.sprints.length ? `спринт ${formatSprints(t.sprints)}` : 'вне квартала'
  }
  const blockedBy = deps.data?.filter((d) => d.blocked_task_id === taskId).map((d) => d.blocking_task_id) ?? []
  const blocks = deps.data?.filter((d) => d.blocking_task_id === taskId).map((d) => d.blocked_task_id) ?? []

  const runCancel = (step: 'request' | 'confirm') =>
    cancel.mutate(
      { taskId, step },
      {
        onSuccess: () => {
          setConfirmOpen(false)
          toast.success(step === 'request' ? 'Отмена предложена' : 'Задача отменена', { description: `${taskId} · ${step === 'request' ? 'ждёт подтверждения лида' : 'остаётся в списке с причиной'}` })
        },
        onError: (e) => toast.error(errorTitle(e), { description: errorHint(e) }),
      },
    )

  if (!decision && !info) return <p className="muted">Задачи нет в этой версии плана.</p>

  return (
    <>
      <dl className="fields">
        <dt>Решение</dt>
        <dd>{decision ? <DecisionBadge decision={decision} /> : <span className="muted">Выполнена до квартала</span>}</dd>
        <dt>{task && task.sprints.length > 1 ? 'Спринты' : 'Спринт'}</dt>
        <dd className="tabular">{task ? formatSprints(task.sprints) : '—'}</dd>
        {task && task.rows.length > 1 && (
          <>
            <dt>SP по спринтам</dt>
            <dd className="tabular">{task.rows.map((r) => `S${r.sprint_no}: ${fmtSp(r.step_points_sp)}`).join(' · ')}</dd>
          </>
        )}
        <dt>Оценка</dt>
        <dd className="tabular">
          {fmt(task?.estimation_sp ?? info?.estimation_sp)} SP · {fmt(task?.estimated_hh ?? info?.estimated_hh)} ч
        </dd>
        <dt>Команда</dt>
        <dd>{task?.team_id ?? info?.team_id}</dd>
        <dt>Инициатива</dt>
        <dd className="mono">{task?.parent_id ?? info?.parent_id ?? '—'}</dd>
      </dl>

      <div className="callout" data-tone={decision ? (DECISION_TONE[decision] === 'plan' ? undefined : DECISION_TONE[decision]) : undefined}>
        <div className="callout__title">
          <Info aria-hidden /> Почему такое решение
        </div>
        <p>{reason || 'Задача помещается в спринт по ресурсу команды, часам ролей и зависимостям.'}</p>
      </div>

      {!readOnly && decision === 'postponed' && !inPlan && (
        <div className="callout">
          <div className="callout__title">
            <Ban aria-hidden /> Отмена задачи
          </div>
          <p>Не помещается даже в спринт 6. Сервис фиксирует предложение отмены, лид подтверждает отдельно.</p>
          <Button size="sm" loading={cancel.isPending} onClick={() => runCancel('request')}>
            Предложить отмену
          </Button>
        </div>
      )}
      {!readOnly && decision === 'cancelled_pending' && (
        <div className="callout" data-tone="pending">
          <div className="callout__title">
            <Ban aria-hidden /> Отмена ждёт подтверждения
          </div>
          <p>После подтверждения задача получит статус «Отменена» и останется в списке с причиной.</p>
          <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
            Подтвердить отмену
          </Button>
        </div>
      )}

      {singleRoles.length > 0 && decision !== 'done_actual' && (
        <div className="callout" data-tone="over">
          <div className="callout__title">
            <ShieldAlert aria-hidden /> Риск Bus Factor
          </div>
          <p>
            {singleRoles.map((r) => `${r} — только ${holders.get(r.toLowerCase())![0]}`).join('; ')}. При уходе носителя задача окажется под угрозой.
          </p>
        </div>
      )}

      {Object.keys(roleHours).length > 0 && (
        <section>
          <h3 style={{ marginBottom: 'var(--s-2)' }}>Потребность в ролях</h3>
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Роль</th>
                <th className="num">Часы</th>
                <th className="num">Носителей</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(roleHours)
                .sort((a, b) => b[1] - a[1])
                .map(([role, hours]) => {
                  const h = holders.get(role.toLowerCase())
                  return (
                    <tr key={role}>
                      <td>{role}</td>
                      <td className="num tabular">{fmt(hours)}</td>
                      <td className="num tabular" data-over={h?.length === 1 || !h ? 'true' : undefined}>
                        {h ? h.length : busFactor ? '0' : '…'}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3 style={{ marginBottom: 'var(--s-2)' }}>Зависимости</h3>
        {blockedBy.length === 0 && blocks.length === 0 ? (
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            Нет связанных задач
          </p>
        ) : (
          <table className="table table--compact">
            <tbody>
              {[...blockedBy.map((id) => ['Ждёт', id] as const), ...blocks.map((id) => ['Блокирует', id] as const)].map(([kind, id]) => (
                <tr key={kind + id} className="is-link" tabIndex={0} onClick={() => onSelect(id)} onKeyDown={(e) => e.key === 'Enter' && onSelect(id)}>
                  <td className="muted nowrap">{kind}</td>
                  <td className="table-key">{id}</td>
                  <td className="muted">{whereIs(id)}</td>
                  <td className="num">
                    <ArrowRight aria-hidden style={{ width: 14, height: 14, color: 'var(--ink-4)' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Отменить ${taskId}?`}
        description="Задача не будет выполняться в этом квартале. Решение и причина сохранятся в плане."
        confirmLabel="Отменить задачу"
        tone="danger"
        loading={cancel.isPending}
        onConfirm={() => runCancel('confirm')}
      />
    </>
  )
}
