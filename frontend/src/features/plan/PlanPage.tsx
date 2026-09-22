import { ArrowRight, CalendarRange, Lightbulb, RotateCcw, ShieldAlert, Sparkles, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { canEdit, getRole, getWorkspaceId } from '@/api/auth'
import { ApiError } from '@/api/client'
import { api } from '@/api/endpoints'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useBusFactor, useCurrentPlanId, useFacts, useGeneratePlan, useOptimizePlan, usePlan, usePlanBusRisk, usePlanVersions, useTasks } from '@/api/queries'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { BusyVeil } from '@/components/ui/BusyVeil'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Empty, ErrorAlert, errorHint, errorTitle, SkeletonRows } from '@/components/ui/States'
import { Tabs } from '@/components/ui/Tabs'
import { versionLabel } from '@/lib/labels'
import { buildImprovementSummary } from '@/features/plan/planImprovement'
import { buildPlanModel, isPartial } from '@/lib/planModel'
import { useParam } from '@/lib/useParam'
import { LoadView } from './LoadView'
import { PriorityView } from './PriorityView'
import { RiskPanelContent } from './RiskPanel'
import { GanttView } from './GanttView'
import { RolesView } from './RolesView'
import { TaskPanelContent } from './TaskPanel'
import { AdvicePanelContent } from './AdvicePanel'
import { NotFitPanelContent } from './NotFitPanel'
import { Panel } from '@/components/ui/Panel'

/** 019 §3.1: правился ли датасет после создания активной версии плана (localStorage per workspace). */
function dataEditedAfter(planCreatedAt: string | undefined): boolean {
  if (!planCreatedAt) return false
  try {
    const marker = new Date(localStorage.getItem(`quarter-data-edited:${getWorkspaceId()}`) ?? 0).getTime()
    const created = new Date(planCreatedAt.replace(' ', 'T')).getTime() // «YYYY-MM-DD HH:MM:SS» как у бэка
    return Number.isFinite(marker) && marker > created
  } catch { return false }
}

export function PlanPage() {
  const planId = useCurrentPlanId()
  const versions = usePlanVersions()
  const plan = usePlan(planId)
  const facts = useFacts(planId)
  const tasks = useTasks()
  const bus = useBusFactor()
  const planRisk = usePlanBusRisk(planId)
  const generate = useGeneratePlan()
  const optimize = useOptimizePlan(planId ?? '')
  const qc = useQueryClient()
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  // change 034: вуаль «идёт перестройка» — busy весь solve (031 polling держит флаг до терминала)
  const planBusy = Boolean(optimize.isPending || generate.isPending)
  const planBusyStatus = optimize.isPending
    ? (optimize.pollStatus === 'queued' ? 'Оптимизация: задача в очереди (solver)…'
      : optimize.pollStatus === 'solving' ? 'Solver перестраивает расстановку…'
        : 'Оптимизация плана…')
    : generate.isPending ? 'Строим план заново…' : null
  const demoImport = useMutation({
    mutationFn: api.importDemo,
    onSuccess: (r) => {
      qc.invalidateQueries()
      toast.success('Демо-датасет импортирован', { description: `Записей: ${Object.values(r.counts).join(' · ')}. Постройте план.` })
    },
    onError: (e) => toast.error(errorTitle(e), { description: errorHint(e) }),
  })

  const [view] = useParam('view')
  const [taskId, setTaskId] = useParam('task')
  const [riskPanel, setRiskPanel] = useParam('risks')
  const [advicePanel, setAdvicePanel] = useParam('advice')
  const [fitPanel, setFitPanel] = useParam('fit')
  const [, setPlanParam] = useParam('plan')

  // 021 §3.2: чужой/недоступный план (?plan= чужого workspace) — тост и сброс ссылки, без переброса
  useEffect(() => {
    const err = plan.error
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      toast.error(errorTitle(err), { description: `${errorHint(err)} — ссылка на чужую версию сброшена; выберите пространство на экране «Сменить пространство».` })
      setPlanParam(null)
    }
  }, [plan.error, setPlanParam])

  // change 040: пин — немедленное перемещение на сервере (БД+GET); фронт просто перечитывает план
  const model = useMemo(() => (plan.data ? buildPlanModel(plan.data, tasks.data ?? []) : null), [plan.data, tasks.data])
  const fixedSprints = useMemo(() => new Set(facts.data?.map((f) => f.sprint_no)), [facts.data])
  const factSprintOf = useMemo(() => new Map(facts.data?.flatMap((f) => f.completed_task_ids.map((id) => [id, f.sprint_no] as const))), [facts.data])
  const updatedAtVersion = useMemo(() => versions.data?.at(-1)?.created_at, [versions.data])
  const showStaleDataBanner = useMemo(() => dataEditedAfter(updatedAtVersion), [updatedAtVersion])
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

  const [improvement, setImprovement] = useState<string | null>(null)

  const runOptimize = () =>
    optimize.mutate(undefined, {
      onSuccess: ({ started, job }) => {
        setPlanParam(started.plan_id)
        setImprovement(buildImprovementSummary(job))
        // change 031: терминальный статус job'а — режим и причина деградации честные
        if (job.status === 'failed') {
          toast.error('Оптимизация не удалась', { description: job.error ?? undefined })
          return
        }
        return
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
                  <Upload aria-hidden /> <span className="btn__label">Загрузить файл</span>
                </Link>
              )}
              {canEdit(getRole()) && (
                <Button variant="primary" loading={demoImport.isPending} onClick={() => demoImport.mutate()}>
                  Импортировать демо-датасет
                </Button>
              )}
              {canEdit(getRole()) && (
                <Button variant="ghost" loading={generate.isPending} onClick={runGenerate}>
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
  const panelKey = taskId ? `task:${taskId}` : riskPanel === '1' ? 'risks' : advicePanel === '1' ? 'advice' : fitPanel === '1' ? 'fit' : null
  // Сетки спринтов при сжатии теряют читаемость (ключи обрезаются) — на них панель ложится поверх
  const overlay = current === 'sprints' || current === 'roles'

  const openTask = (id: string) => {
    setRiskPanel(null)
    setAdvicePanel(null)
    setFitPanel(null)
    setTaskId(id)
  }
  const closePanel = () => {
    setTaskId(null)
    setRiskPanel(null)
    setAdvicePanel(null)
    setFitPanel(null)
  }

  return (
    <div className="page" data-panel={panelKey && !overlay ? 'open' : 'closed'} data-busy={planBusy ? '1' : undefined}>
      <BusyVeil active={planBusy} status={planBusyStatus} />
      <div className="content">
        <div className="page-head">
          <div>
            <h1>План квартала</h1>
            <div className="page-head__sub">{plan.data ? `${versionLabel(plan.data)} · 6 спринтов по 2 недели` : 'Загрузка…'}</div>
          </div>
          <div className="page-head__actions">
            <Button variant="ghost" icon={<Lightbulb />} onClick={() => { setTaskId(null); setRiskPanel(null); setFitPanel(null); setAdvicePanel('1') }}>
              Советы
            </Button>
            <Button variant="primary" icon={<Sparkles />} loading={optimize.isPending} disabled={readOnly} onClick={runOptimize}>
              Оптимизировать
            </Button>
            <Button variant="ghost" icon={<RotateCcw />} loading={generate.isPending} disabled={readOnly} onClick={() => setConfirmGenerate(true)}>
              Построить заново
            </Button>
          </div>
        </div>

        {improvement && (
          <div className="callout" role="status" style={{ position: 'relative', paddingRight: 36 }}>
            <div className="callout__title">Оптимизация — что улучшилось</div>
            <p style={{ margin: 0 }}>{improvement}</p>
            <button
              type="button"
              aria-label="Закрыть сводку"
              onClick={() => setImprovement(null)}
              style={{ position: 'absolute', top: 8, right: 10, border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--ink-3)' }}
            >
              ×
            </button>
          </div>
        )}

        {showStaleDataBanner && (
          <div className="callout" data-tone="shift" role="status" style={{ marginBottom: 'var(--s-4)' }}>
            <div className="callout__title">Данные изменились — постройте план заново</div>
            <p style={{ margin: 0 }}>
              Датасет правился в редакторе «Данные» после создания активной версии. Существующие версии истории не переписываются.
              {!canEdit(getRole()) && ' Правка недоступна наблюдателю.'}
            </p>
            {canEdit(getRole()) && (
              <div style={{ marginTop: 8 }}>
                <Button variant="primary" size="sm" loading={generate.isPending} onClick={runGenerate}>
                  Построить план заново
                </Button>
              </div>
            )}
          </div>
        )}

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
                <span className="stat__value">
                  {planRisk.error ? (
                    <span title="Ошибка ручки bus-risk — подробности в панели рисков">—</span>
                  ) : plan.data && bus.data && planRisk.data ? (
                    <AnimatedNumber value={planRisk.data.total_at_risk} />
                  ) : (
                    <span className="skeleton" style={{ display: 'inline-block', width: 40, height: 20 }} />
                  )}
                </span>
                {planRisk.data != null && planRisk.data.total_at_risk > 0 && (
                  <Button size="sm" variant="ghost" className="stat__action" icon={<ShieldAlert />} onClick={() => { setTaskId(null); setAdvicePanel(null); setFitPanel(null); setRiskPanel('1') }}>
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
              right={model && outsideCount + partialCount > 0 && (
                <Button size="sm" variant="ghost" icon={<ArrowRight />} aria-pressed={fitPanel === '1'} onClick={() => { setTaskId(null); setRiskPanel(null); setAdvicePanel(null); setFitPanel('1') }}>
                  Не влезают · {outsideCount + partialCount}
                </Button>
              )}
            />

            {!plan.data || !model || tasks.isLoading ? (
              <SkeletonRows rows={8} cols={6} />
            ) : current === 'sprints' ? (
              <GanttView key={plan.data.plan_id} model={model} planRisk={planRisk.data} factSprintOf={factSprintOf} selectedId={taskId} onSelect={openTask} />
            ) : current === 'roles' ? (
              <RolesView
                key={plan.data.plan_id}
                model={model}
                planId={plan.data.plan_id}
                fixedSprints={fixedSprints}
                readOnly={readOnly}
                selectedId={taskId}
                onSelect={openTask}
                // change 038: оптимистичный слой
              />
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
        eyebrow={taskId ?? (advicePanel === '1' ? 'AI-советник' : fitPanel === '1' ? 'Квартал' : 'Bus Factor')}
        title={taskId ? (model?.tasks.get(taskId)?.summary ?? tasks.data?.find((t) => t.task_id === taskId)?.summary ?? taskId) : advicePanel === '1' ? 'Советы по плану' : fitPanel === '1' ? 'Не влезают в квартал' : 'Задачи под угрозой'}
      >
        {model && plan.data && taskId && <TaskPanelContent model={model} planId={plan.data.plan_id} taskId={taskId} tasksInfo={tasks.data ?? []} busFactor={bus.data} readOnly={readOnly} onSelect={openTask} />}
        {plan.data && !taskId && riskPanel === '1' && <RiskPanelContent planRisk={planRisk.data} error={planRisk.error} onRetry={() => planRisk.refetch()} onSelect={openTask} />}
        {plan.data && !taskId && advicePanel === '1' && <AdvicePanelContent planId={plan.data.plan_id} />}
        {model && !taskId && fitPanel === '1' && <NotFitPanelContent model={model} onSelect={openTask} />}
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
