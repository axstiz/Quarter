import { Check, CheckCircle2, ClipboardCheck, Lock, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useCurrentPlanId, useDiff, useFacts, usePlan, useRecompute, useSubmitFact, useWarnings } from '@/api/queries'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Label } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { fmt, sprintWeeks } from '@/lib/format'
import { DiffCard, WarningsList } from './WarningsPanel'

export function SprintPage() {
  const planId = useCurrentPlanId()
  const plan = usePlan(planId)
  const facts = useFacts(planId)
  const submit = useSubmitFact(planId ?? '')
  const recompute = useRecompute(planId ?? '')
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const factBySprint = useMemo(() => new Map(facts.data?.map((f) => [f.sprint_no, f])), [facts.data])
  const firstOpen = [1, 2, 3, 4, 5, 6].find((n) => !factBySprint.has(n)) ?? 6
  const [sprintNo, setSprintNo] = useState<number | null>(null)
  const selected = sprintNo ?? firstOpen
  const fact = factBySprint.get(selected)

  const sprintTasks = useMemo(
    () => plan.data?.sprints.find((s) => s.sprint_no === selected)?.tasks.filter((t) => t.decision !== 'cancelled') ?? [],
    [plan.data, selected],
  )
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  useEffect(() => {
    setChecked(new Set())
    setNotes('')
  }, [selected, planId])

  // Warnings/diff бэк считает на версии, в которую загрузили факт, — это родитель текущего плана.
  const analysedPlanId = plan.data?.parent_plan_id ?? null
  const warnings = useWarnings(analysedPlanId)
  const diff = useDiff(analysedPlanId)

  const plannedSp = sprintTasks.reduce((s, t) => s + (t.step_points_sp ?? 0), 0)
  const completedSp = sprintTasks.filter((t) => checked.has(t.task_id)).reduce((s, t) => s + (t.step_points_sp ?? 0), 0)

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const showLatest = () => {
    const next = new URLSearchParams(params)
    next.delete('plan')
    setParams(next)
  }

  const onSubmit = async () => {
    try {
      await submit.mutateAsync({ sprintNo: selected, body: { completed_sp: completedSp, completed_task_ids: [...checked], notes } })
      showLatest()
      setSprintNo(null)
      toast({ tone: 'ok', title: `Факт спринта ${selected} загружен`, description: 'Оставшиеся спринты пересчитаны — открыта новая версия плана.' })
    } catch (e) {
      const conflict = e instanceof ApiError && e.status === 409
      toast({ tone: 'error', title: conflict ? 'Факт уже загружен' : 'Не удалось загрузить факт', description: e instanceof Error ? e.message : undefined })
    }
  }

  const onRecompute = async () => {
    try {
      await recompute.mutateAsync()
      showLatest()
      toast({ tone: 'ok', title: 'План пересчитан', description: 'Создана новая версия плана.' })
    } catch (e) {
      toast({ tone: 'error', title: 'Пересчёт не удался', description: e instanceof Error ? e.message : undefined })
    }
  }

  const header = (
    <PageHeader
      title="Факт и пересчёт"
      description="Раз в 2 недели: отметьте выполненное — сервис пересчитает оставшиеся спринты и покажет риски"
      actions={
        <Button icon={<RefreshCw className="size-4" />} onClick={onRecompute} loading={recompute.isPending} disabled={!planId}>
          Пересчитать
        </Button>
      }
    />
  )

  if (planId === null) {
    return (
      <>
        {header}
        <Card className="m-4 md:m-6">
          <EmptyState icon={<ClipboardCheck className="size-6" />} title="Нет плана" description="Сначала сгенерируйте план квартала на главной." />
        </Card>
      </>
    )
  }

  return (
    <>
      {header}
      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="space-y-4">
          <Card className="p-2">
            <ol className="grid grid-cols-6 gap-1" aria-label="Спринты квартала">
              {[1, 2, 3, 4, 5, 6].map((n) => {
                const done = factBySprint.has(n)
                const active = n === selected
                return (
                  <li key={n}>
                    <button
                      onClick={() => setSprintNo(n)}
                      className={cn(
                        'flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 transition',
                        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2',
                      )}
                      aria-current={active}
                    >
                      <span
                        className={cn(
                          'grid size-7 place-items-center rounded-full text-xs font-semibold',
                          done ? 'bg-ok text-white' : active ? 'bg-accent text-accent-fg' : 'border border-border bg-surface',
                        )}
                      >
                        {done ? <Check className="size-3.5" /> : n}
                      </span>
                      <span className="text-[11px] font-medium">S{n}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </Card>

          <Card>
            <CardHeader
              title={`Спринт ${selected}`}
              hint={sprintWeeks(selected)}
              actions={fact ? <span className="flex items-center gap-1 text-xs font-medium text-ok"><Lock className="size-3" /> факт загружен</span> : undefined}
            />
            {plan.isError ? (
              <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
            ) : plan.isLoading ? (
              <div className="space-y-2 px-4 pb-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : fact ? (
              <div className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-2">
                  <Mini label="Выполнено SP" value={fmt(fact.completed_sp)} />
                  <Mini label="Задач закрыто" value={String(fact.completed_task_ids.length)} />
                </div>
                {fact.completed_task_ids.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {fact.completed_task_ids.map((id) => (
                      <span key={id} className="rounded-md bg-ok-soft px-1.5 py-0.5 font-mono text-[11px] text-ok">
                        {id}
                      </span>
                    ))}
                  </div>
                )}
                {fact.notes && <p className="mt-3 text-sm text-muted">{fact.notes}</p>}
                <p className="mt-3 text-xs text-subtle">Повторная загрузка факта спринта запрещена (409).</p>
              </div>
            ) : (
              <div className="px-4 pb-4">
                <div className="mb-2 flex items-center justify-between">
                  <Label hint={`${checked.size} из ${sprintTasks.length}`}>Выполненные задачи</Label>
                  {sprintTasks.length > 0 && (
                    <button
                      className="text-xs font-medium text-accent hover:underline"
                      onClick={() => setChecked(checked.size === sprintTasks.length ? new Set() : new Set(sprintTasks.map((t) => t.task_id)))}
                    >
                      {checked.size === sprintTasks.length ? 'Снять все' : 'Отметить все'}
                    </button>
                  )}
                </div>
                {sprintTasks.length === 0 ? (
                  <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-sm text-muted">В этом спринте нет задач</p>
                ) : (
                  <ul className="scroll-thin max-h-[420px] space-y-1.5 overflow-y-auto">
                    {sprintTasks.map((t) => {
                      const on = checked.has(t.task_id)
                      return (
                        <li key={t.task_id}>
                          <label
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition',
                              on ? 'border-ok/40 bg-ok-soft' : 'border-border hover:bg-surface-2',
                            )}
                          >
                            <input type="checkbox" checked={on} onChange={() => toggle(t.task_id)} className="mt-0.5 size-4 accent-[var(--ok)]" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-[11px] text-muted">
                                <span className="font-mono">{t.task_id}</span>· {t.team_id}
                              </span>
                              <span className="block truncate text-[13px] font-medium">{t.summary}</span>
                            </span>
                            <span className="text-xs font-semibold tabular-nums">{fmt(t.step_points_sp)} SP</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}

                <div className="mt-4">
                  <Label hint="необязательно">Комментарий</Label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Что помешало, кто болел, что взяли сверх плана…"
                    className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-subtle focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none"
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 p-3">
                  <div className="text-sm">
                    <span className="font-semibold tabular-nums">{fmt(completedSp)}</span>
                    <span className="text-muted"> из {fmt(plannedSp)} SP</span>
                    {plannedSp > 0 && (
                      <span className={cn('ml-2 text-xs font-semibold', completedSp / plannedSp >= 0.8 ? 'text-ok' : 'text-warn')}>
                        {Math.round((completedSp / plannedSp) * 100)}%
                      </span>
                    )}
                  </div>
                  <Button variant="primary" icon={<CheckCircle2 className="size-4" />} onClick={onSubmit} loading={submit.isPending}>
                    Загрузить факт и пересчитать
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Риски после пересчёта</h2>
            <p className="mt-0.5 mb-3 text-xs text-muted">
              {analysedPlanId
                ? `Сравнение с версией до факта спринта ${plan.data?.recomputed_after_sprint ?? ''}`
                : 'Появятся после загрузки первого факта'}
            </p>
            <WarningsList warnings={warnings.data} loading={!!analysedPlanId && warnings.isLoading} />
          </div>
          <DiffCard diff={diff.data} loading={!!analysedPlanId && diff.isLoading} />
        </div>
      </div>
    </>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
