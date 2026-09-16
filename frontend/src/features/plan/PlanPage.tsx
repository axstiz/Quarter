import { CalendarRange, ListOrdered, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useBusFactor, useCancelTask, useCurrentPlanId, useFacts, useGeneratePlan, usePlan, useTasks, useTeam } from '@/api/queries'
import type { Decision, PlanTask } from '@/api/types'
import { useOpenImport } from '@/app/ImportContext'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SearchInput, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { fmt } from '@/lib/format'
import { tasksAtRisk } from './busRisk'
import { BusRiskWidget } from './BusRiskWidget'
import { NotPlannedColumn } from './NotPlannedColumn'
import { PriorityDrawer, type PriorityItem } from './PriorityDrawer'
import { SprintColumn } from './SprintColumn'
import { TaskDrawer, type DrawerTask } from './TaskDrawer'

type DecisionFilter = 'all' | 'planned' | 'postponed' | 'done'
const MATCH: Record<DecisionFilter, (d: Decision) => boolean> = {
  all: () => true,
  planned: (d) => d === 'planned',
  postponed: (d) => d === 'postponed' || d === 'cancelled_pending',
  done: (d) => d === 'done_actual',
}

export function PlanPage() {
  const planId = useCurrentPlanId()
  const plan = usePlan(planId)
  const facts = useFacts(planId)
  const tasks = useTasks()
  const bus = useBusFactor()
  const generate = useGeneratePlan()
  const cancel = useCancelTask(planId ?? '')
  const openImport = useOpenImport()
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const team = params.get('team') ?? ''
  const [decision, setDecision] = useState<DecisionFilter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [prioritiesOpen, setPrioritiesOpen] = useState(false)
  const teamDetail = useTeam(team || null)

  const allTasks = useMemo(() => plan.data?.sprints.flatMap((s) => s.tasks) ?? [], [plan.data])
  const tasksById = useMemo(() => new Map(tasks.data?.map((t) => [t.task_id, t])), [tasks.data])
  const risks = useMemo(() => tasksAtRisk(allTasks, bus.data), [allTasks, bus.data])
  const riskIds = useMemo(() => new Set(risks.map((r) => r.task.task_id)), [risks])
  const fixedSprints = new Set(facts.data?.map((f) => f.sprint_no))
  const teams = useMemo(() => [...new Set(allTasks.map((t) => t.team_id))].sort(), [allTasks])

  const q = query.trim().toLowerCase()
  const visible = (t: Pick<PlanTask, 'task_id' | 'decision'> & { team_id?: string; summary?: string }) =>
    (!team || t.team_id === team) &&
    MATCH[decision](t.decision) &&
    (!q || t.task_id.toLowerCase().includes(q) || t.summary?.toLowerCase().includes(q))

  const notPlanned = (plan.data?.not_planned ?? []).filter((n) => visible({ ...n, ...tasksById.get(n.task_id), decision: n.decision }))

  const setTeam = (value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set('team', value)
    else next.delete('team')
    setParams(next, { replace: true })
  }

  // Новая версия плана всегда последняя в цепочке — снимаем фиксацию ?plan=
  const showLatestPlan = () => {
    const next = new URLSearchParams(params)
    next.delete('plan')
    setParams(next)
  }

  const onGenerate = async () => {
    try {
      await generate.mutateAsync()
      showLatestPlan()
      toast({ tone: 'ok', title: 'План построен', description: '6 спринтов по velocity × 0.8, часам ролей и зависимостям.' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) openImport()
      else toast({ tone: 'error', title: 'Не удалось построить план', description: e instanceof Error ? e.message : undefined })
    }
  }

  const onCancel = async (taskId: string, step: 'request' | 'confirm') => {
    try {
      await cancel.mutateAsync({ taskId, step })
      toast({ tone: 'ok', title: step === 'request' ? 'Отмена предложена' : 'Задача отменена', description: taskId })
    } catch (e) {
      toast({ tone: 'error', title: 'Ошибка', description: e instanceof Error ? e.message : undefined })
    }
  }

  // Открытая задача: из плана или из «вне квартала»
  const openTask: DrawerTask | null = (() => {
    if (!openId || !plan.data) return null
    const inPlan = allTasks.find((t) => t.task_id === openId)
    if (inPlan) return inPlan
    const np = plan.data.not_planned.find((n) => n.task_id === openId)
    const info = tasksById.get(openId)
    if (np) return { ...info, ...np }
    return info ? { ...info, decision: 'done_actual', reason: 'Задача вне текущего плана (Done до начала квартала).', sprint_no: null } : null
  })()

  const priorityItems: PriorityItem[] = useMemo(
    () => [
      ...allTasks.filter((t) => t.decision !== 'done_actual').map((t) => ({ task_id: t.task_id, summary: t.summary, team_id: t.team_id, sprint_no: t.sprint_no })),
      ...(plan.data?.not_planned ?? [])
        .filter((n) => n.decision !== 'cancelled')
        .map((n) => ({ task_id: n.task_id, summary: tasksById.get(n.task_id)?.summary ?? '', team_id: tasksById.get(n.task_id)?.team_id ?? '', sprint_no: null })),
    ],
    [allTasks, plan.data, tasksById],
  )

  const counts = {
    planned: allTasks.filter((t) => t.decision === 'planned').length,
    postponed: allTasks.filter((t) => MATCH.postponed(t.decision)).length,
    done: allTasks.filter((t) => t.decision === 'done_actual').length,
  }
  const totalSp = allTasks.reduce((s, t) => s + (t.decision !== 'cancelled' ? (t.step_points_sp ?? 0) : 0), 0)

  const header = (
    <PageHeader
      title="План квартала"
      description={
        plan.data
          ? `${plan.data.is_initial ? 'Первичный план' : `Пересчитан после спринта ${plan.data.recomputed_after_sprint}`} · 6 спринтов × 2 недели`
          : '6 спринтов × 2 недели'
      }
      actions={
        <>
          <Button icon={<ListOrdered className="size-4" />} onClick={() => setPrioritiesOpen(true)} disabled={!plan.data}>
            Приоритеты
          </Button>
          <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={onGenerate} loading={generate.isPending}>
            Сгенерировать план
          </Button>
        </>
      }
    >
      <Select value={team} onChange={(e) => setTeam(e.target.value)} options={teams.map((t) => ({ value: t, label: t }))} placeholder="Все команды" className="w-44" />
      <Segmented
        value={decision}
        onChange={setDecision}
        size="sm"
        options={[
          { value: 'all', label: 'Все' },
          { value: 'planned', label: 'В плане', count: counts.planned },
          { value: 'postponed', label: 'Перенесены', count: counts.postponed },
          { value: 'done', label: 'Выполнены', count: counts.done },
        ]}
      />
      <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по ID или названию" className="w-full sm:ml-auto sm:w-64" />
    </PageHeader>
  )

  if (planId === null) {
    return (
      <>
        {header}
        <Card className="m-4 md:m-6">
          <EmptyState
            icon={<CalendarRange className="size-6" />}
            title="Плана пока нет"
            description="Загрузите датасет с задачами и инженерами, затем сгенерируйте план на 6 спринтов."
            action={
              <div className="flex gap-2">
                <Button onClick={openImport}>Загрузить данные</Button>
                <Button variant="primary" onClick={onGenerate} loading={generate.isPending}>
                  Сгенерировать
                </Button>
              </div>
            }
          />
        </Card>
      </>
    )
  }

  return (
    <>
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
        {plan.isError ? (
          <Card>
            <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]">
              <Kpi label="Задач в плане" value={plan.data ? String(allTasks.length) : null} hint={`${counts.planned} по плану · ${counts.postponed} перенесено`} />
              <Kpi label="Story Points" value={plan.data ? fmt(totalSp) : null} hint={team && teamDetail.data ? `ёмкость ${fmt(teamDetail.data.capacity_sp_per_sprint)} SP/спринт` : 'выберите команду для ёмкости'} />
              <Kpi
                label="Вне квартала"
                value={plan.data ? String(plan.data.not_planned.filter((n) => n.decision !== 'cancelled').length) : null}
                hint="ждут решения лида"
                tone={plan.data?.not_planned.length ? 'danger' : undefined}
              />
              <div className="col-span-2 lg:col-span-3 xl:col-span-1">
                <BusRiskWidget risks={team ? risks.filter((r) => r.task.team_id === team) : risks} loading={bus.isLoading || plan.isLoading} onOpenTask={setOpenId} />
              </div>
            </div>

            <div className="scroll-thin -mx-4 min-h-0 flex-1 overflow-x-auto px-4 md:-mx-6 md:px-6">
              <div className="grid h-full min-h-[480px] auto-cols-[272px] grid-flow-col gap-3 pb-2 2xl:auto-cols-[minmax(240px,1fr)]">
                {plan.isLoading || !plan.data
                  ? Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[480px] rounded-xl" />)
                  : (
                    <>
                      {plan.data.sprints.map((s) => (
                        <SprintColumn
                          key={s.sprint_no}
                          sprintNo={s.sprint_no}
                          tasks={s.tasks.filter(visible)}
                          capacity={team ? teamDetail.data?.capacity_sp_per_sprint : undefined}
                          isFixed={fixedSprints.has(s.sprint_no)}
                          riskIds={riskIds}
                          onOpen={(t) => setOpenId(t.task_id)}
                        />
                      ))}
                      <NotPlannedColumn items={notPlanned} tasksById={tasksById} onOpen={(n) => setOpenId(n.task_id)} />
                    </>
                  )}
              </div>
            </div>
          </>
        )}
      </div>

      <TaskDrawer
        task={openTask}
        risk={risks.find((r) => r.task.task_id === openId)}
        onClose={() => setOpenId(null)}
        onOpenTask={setOpenId}
        onCancel={onCancel}
        cancelling={cancel.isPending}
      />
      {planId && (
        <PriorityDrawer open={prioritiesOpen} onClose={() => setPrioritiesOpen(false)} planId={planId} items={priorityItems} onRecomputed={showLatestPlan} />
      )}
    </>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: string | null; hint?: string; tone?: 'danger' }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      {value == null ? <Skeleton className="mt-2 h-7 w-16" /> : <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${tone === 'danger' && value !== '0' ? 'text-danger' : ''}`}>{value}</p>}
      {hint && <p className="mt-0.5 truncate text-xs text-subtle">{hint}</p>}
    </Card>
  )
}
