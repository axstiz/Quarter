import { CalendarRange, RotateCcw, ShieldAlert, Sparkles, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { canEdit, getRole } from '@/api/auth'
import { useBusFactor, useCurrentPlanId, useFacts, useGeneratePlan, useOptimizePlan, usePlan, usePlanVersions, useTasks } from '@/api/queries'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Empty, ErrorAlert, errorHint, errorTitle, SkeletonRows } from '@/components/ui/States'
import { Tabs } from '@/components/ui/Tabs'
import { versionLabel } from '@/lib/labels'
import { buildPlanModel, isPartial } from '@/lib/planModel'
import { useParam } from '@/lib/useParam'
import { tasksAtRisk } from './busRisk'
import { LoadView } from './LoadView'
import { PriorityView } from './PriorityView'
import { RiskPanelContent } from './RiskPanel'
import { GanttView } from './GanttView'
import { RolesView } from './RolesView'
import { TaskPanelContent } from './TaskPanel'
import { Panel } from '@/components/ui/Panel'

export function PlanPage() {
  const planId = useCurrentPlanId()
  const versions = usePlanVersions()
  const plan = usePlan(planId)
  const facts = useFacts(planId)
  const tasks = useTasks()
  const bus = useBusFactor()
  const generate = useGeneratePlan()
  const optimize = useOptimizePlan(planId ?? '')
  const [confirmGenerate, setConfirmGenerate] = useState(false)

  const [view] = useParam('view')
  const [taskId, setTaskId] = useParam('task')
  const [riskPanel, setRiskPanel] = useParam('risks')
  const [, setPlanParam] = useParam('plan')

  const model = useMemo(() => (plan.data ? buildPlanModel(plan.data, tasks.data ?? []) : null), [plan.data, tasks.data])
  const risks = useMemo(() => (model ? tasksAtRisk(model.tasks.values(), bus.data) : []), [model, bus.data])
  const fixedSprints = useMemo(() => new Set(facts.data?.map((f) => f.sprint_no)), [facts.data])
  const factSprintOf = useMemo(() => new Map(facts.data?.flatMap((f) => f.completed_task_ids.map((id) => [id, f.sprint_no] as const))), [facts.data])
  const latestId = versions.data?.at(-1)?.plan_id
  const readOnly = (!!planId && !!latestId && planId !== latestId) || !canEdit(getRole())

  const runGenerate = () =>
    generate.mutate(undefined, {
      onSuccess: () => {
        setConfirmGenerate(false)
        toast.success('План построен', { description: '6 спринтов с учётом ресурса команд, часов ролей и зависимостей.' })
      },
      onError: (e) => {
        setConfirmGenerate(false)
        toast.error(errorTitle(e), { description: errorHint(e) })
      },
    })

  const runOptimize = () =>
    optimize.mutate(undefined, {
      onSuccess: ({ started, job }) => {
        setPlanParam(started.plan_id)
        const moves = job.staffing_moves.length
        const modeLabel = started.mode === 'solver' ? 'solver Timefold' : 'эвристика (сайдкар недоступен)'
        toast.success('План оптимизирован', {
          description: `Режим: ${modeLabel}.${moves ? ` Переносов людей: ${moves}.` : ''} Открыта новая версия — откат через селектор версий.`,
        })
      },
      onError: (e) => {
        toast.error(errorTitle(e), { description: errorHint(e) })
      },
    })

  if (planId === null) {
    return (
      <div className="content">
        <Empty
          icon={<CalendarRange />}
          title="Плана пока нет"
          text="Загрузите задачи и инженеров, затем постройте план на 6 спринтов. Решение по каждой задаче будет с причиной."
          actions={
            <>
              {canEdit(getRole()) && (
                <Link to="/import" className="btn btn--secondary" style={{ textDecoration: 'none' }}>
                  <Upload aria-hidden /> <span className="btn__label">Загрузить данные</span>
                </Link>
              )}
              {canEdit(getRole()) && (
                <Button variant="primary" loading={generate.isPending} onClick={runGenerate}>
                  Построить план
                </Button>
              )}
              {!canEdit(getRole()) && (
                <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                  Просмотр недоступен: данных ещё нет. Заходите как редактор (демо-вход) или загрузите данные.
                </p>
              )}
            </>
          }
        />
      </div>
    )
  }

  const summaries = model ? [...model.tasks.values()] : []
  const inPlan = summaries.filter((t) => t.sprints.length && t.decision !== 'done_actual')
  const doneCount = summaries.filter((t) => t.decision === 'done_actual').length
  const outsideCount = model?.outside.filter((t) => t.decision !== 'cancelled').length ?? 0
  const partialCount = inPlan.filter(isPartial).length
  const spLeft = inPlan.reduce((a, t) => a + t.plannedSp, 0)
  const current = view ?? 'sprints'
  const panelKey = taskId ? `task:${taskId}` : riskPanel === '1' ? 'risks' : null
  // Сетки спринтов при сжатии теряют читаемость (ключи обрезаются) — на них панель ложится поверх
  const overlay = current === 'sprints' || current === 'roles'

  const openTask = (id: string) => {
    setRiskPanel(null)
    setTaskId(id)
  }
  const closePanel = () => {
    setTaskId(null)
    setRiskPanel(null)
  }

  return (
    <div className="page" data-panel={panelKey && !overlay ? 'open' : 'closed'}>
      <div className="content">
        <div className="page-head">
          <div>
            <h1>План квартала</h1>
            <div className="page-head__sub">{plan.data ? `${versionLabel(plan.data)} · 6 спринтов по 2 недели` : 'Загрузка…'}</div>
          </div>
          <div className="page-head__actions">
            <Button variant="primary" icon={<Sparkles />} loading={optimize.isPending} disabled={readOnly} onClick={runOptimize}>
              Оптимизировать
            </Button>
            <Button variant="ghost" icon={<RotateCcw />} loading={generate.isPending} disabled={readOnly} onClick={() => setConfirmGenerate(true)}>
              Построить заново
            </Button>
          </div>
        </div>

        {plan.error ? (
          <ErrorAlert error={plan.error} onRetry={() => plan.refetch()} />
        ) : (
          <>
            <div className="stats" aria-live="polite">
              <Stat label="Задач в плане" value={model ? inPlan.length : null} />
              <Stat label="Story Points к выполнению" value={model ? Math.round(spLeft * 10) / 10 : null} />
              <Stat label="Выполнено по факту" value={model ? doneCount : null} tone={doneCount ? 'done' : undefined} />
              <Stat
                label="Не помещаются целиком"
                value={model ? outsideCount + partialCount : null}
                tone={outsideCount + partialCount ? 'shift' : undefined}
                hint={model ? `${outsideCount} вне квартала · ${partialCount} частично` : undefined}
              />
              <div className="stat">
                <span className="stat__label">Зависят от одного носителя</span>
                <span className="stat__value">{plan.data && bus.data ? <AnimatedNumber value={risks.length} /> : <span className="skeleton" style={{ display: 'inline-block', width: 40, height: 20 }} />}</span>
                {risks.length > 0 && (
                  <Button size="sm" variant="ghost" className="stat__action" icon={<ShieldAlert />} onClick={() => { setTaskId(null); setRiskPanel('1') }}>
                    Какие задачи
                  </Button>
                )}
              </div>
            </div>

            <Tabs
              current={current}
              items={[
                { value: 'sprints', label: 'Диаграмма Ганта' },
                { value: 'roles', label: 'Роли по спринтам' },
                { value: 'load', label: 'Загрузка команд и ролей' },
                { value: 'priority', label: 'Приоритеты' },
              ]}
            />

            {!plan.data || !model || tasks.isLoading ? (
              <SkeletonRows rows={8} cols={6} />
            ) : current === 'sprints' ? (
              <GanttView key={plan.data.plan_id} model={model} planId={plan.data.plan_id} risks={risks} factSprintOf={factSprintOf} selectedId={taskId} onSelect={openTask} />
            ) : current === 'roles' ? (
              <RolesView key={plan.data.plan_id} model={model} planId={plan.data.plan_id} fixedSprints={fixedSprints} readOnly={readOnly} selectedId={taskId} onSelect={openTask} />
            ) : current === 'load' ? (
              <LoadView model={model} />
            ) : (
              <PriorityView model={model} planId={plan.data.plan_id} readOnly={readOnly} />
            )}
          </>
        )}
      </div>

      <Panel
        overlay={overlay}
        contentKey={plan.data ? panelKey : null}
        onClose={closePanel}
        eyebrow={taskId ?? 'Bus Factor'}
        title={taskId ? (model?.tasks.get(taskId)?.summary ?? tasks.data?.find((t) => t.task_id === taskId)?.summary ?? taskId) : 'Задачи под угрозой'}
      >
        {model && plan.data && taskId && <TaskPanelContent model={model} planId={plan.data.plan_id} taskId={taskId} tasksInfo={tasks.data ?? []} busFactor={bus.data} readOnly={readOnly} onSelect={openTask} />}
        {plan.data && !taskId && riskPanel === '1' && <RiskPanelContent risks={risks} onSelect={openTask} />}
      </Panel>

      <ConfirmDialog
        open={confirmGenerate}
        onOpenChange={setConfirmGenerate}
        title="Построить план заново?"
        description="Появится новый первоначальный план: он станет базой для метрик. Текущие версии останутся в истории."
        confirmLabel="Построить"
        loading={generate.isPending}
        onConfirm={runGenerate}
      />
    </div>
  )
}

function Stat({ label, value, tone, hint }: { label: string; value: number | null; tone?: 'over' | 'shift' | 'done'; hint?: string }) {
  return (
    <div className="stat" data-tone={tone}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value == null ? <span className="skeleton" style={{ display: 'inline-block', width: 40, height: 20 }} /> : <AnimatedNumber value={value} />}
      </span>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  )
}
