import { BarChart3, GitCommitVertical, Info } from 'lucide-react'
import { useCurrentPlanId, useFacts, useMetrics, usePlanVersions } from '@/api/queries'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { fmt, formatDateTime, pct, shortId } from '@/lib/format'

const SPRINTS = [1, 2, 3, 4, 5, 6]

export function MetricsPage() {
  const planId = useCurrentPlanId()
  const metrics = useMetrics(planId)
  const facts = useFacts(planId)
  const versions = usePlanVersions()
  const m = metrics.data

  const header = <PageHeader title="Метрики квартала" description="Считаются от первоначального плана — пересчёты не подменяют базу сравнения" />

  if (planId === null) {
    return (
      <>
        {header}
        <Card className="m-4 md:m-6">
          <EmptyState icon={<BarChart3 className="size-6" />} title="Нет плана" description="Метрики появятся после генерации плана и загрузки факта спринтов." />
        </Card>
      </>
    )
  }

  const factValues = SPRINTS.map((n) => (m && !m.sprint_completion_is_forecast[n] ? m.sprint_completion_pct[n] : null)).filter((v): v is number => v != null)
  const avg = factValues.length ? factValues.reduce((s, v) => s + v, 0) / factValues.length : null

  return (
    <>
      {header}
      <div className="space-y-4 p-4 md:p-6">
        {metrics.isError ? (
          <Card>
            <ErrorState error={metrics.error} onRetry={() => metrics.refetch()} />
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <Card className="p-5 md:col-span-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted">Выполнение квартала</p>
                  {m && <ForecastBadge forecast={m.quarter_completion_is_forecast} />}
                </div>
                {m ? (
                  <>
                    <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{pct(m.quarter_completion_pct)}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn('h-full rounded-full transition-[width] duration-700', m.quarter_completion_is_forecast ? 'bg-[repeating-linear-gradient(45deg,var(--accent)_0_6px,color-mix(in_srgb,var(--accent)_55%,transparent)_6px_12px)]' : 'bg-accent')}
                        style={{ width: `${Math.min(m.quarter_completion_pct ?? 0, 100)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-subtle">Завершённые инициативы / инициативы первоначального плана</p>
                  </>
                ) : (
                  <Skeleton className="mt-3 h-14" />
                )}
              </Card>
              <Card className="p-5">
                <p className="text-sm font-medium text-muted">Спринтов с фактом</p>
                {facts.data ? <p className="mt-2 text-4xl font-semibold tabular-nums">{facts.data.length}<span className="text-xl text-subtle"> / 6</span></p> : <Skeleton className="mt-3 h-10 w-20" />}
                <p className="mt-2 text-xs text-subtle">Остальные спринты — прогноз</p>
              </Card>
              <Card className="p-5">
                <p className="text-sm font-medium text-muted">Среднее выполнение спринта</p>
                {m ? <p className="mt-2 text-4xl font-semibold tabular-nums">{pct(avg)}</p> : <Skeleton className="mt-3 h-10 w-24" />}
                <p className="mt-2 text-xs text-subtle">Факт SP / первоначально запланированные SP</p>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader
                  title="Выполнение по спринтам"
                  hint="Сплошной столбец — факт, штриховка — прогноз (значение появится после загрузки факта)"
                />
                <div className="px-4 pb-5">
                  {!m ? (
                    <Skeleton className="h-64" />
                  ) : (
                    <SprintBars pctBySprint={m.sprint_completion_pct} forecast={m.sprint_completion_is_forecast} />
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="История версий плана" hint="Снапшоты: первичный → пересчёты по факту" />
                <ol className="relative mx-4 mb-4 space-y-4 border-l border-border pl-5">
                  {versions.isLoading && <Skeleton className="h-24" />}
                  {versions.data?.map((v) => (
                    <li key={v.plan_id} className="relative">
                      <span className={cn('absolute top-0.5 -left-[27px] grid size-3.5 place-items-center rounded-full border-2 bg-surface', v.plan_id === planId ? 'border-accent' : 'border-border')}>
                        <GitCommitVertical className="size-2 text-subtle" />
                      </span>
                      <p className="text-[13px] font-medium">
                        {v.is_initial ? 'Первичный план' : `Пересчёт после спринта ${v.recomputed_after_sprint}`}
                        {v.is_initial && <Badge tone="accent" className="ml-2">база метрик</Badge>}
                      </p>
                      <p className="font-mono text-[11px] text-subtle">
                        {shortId(v.plan_id)} · {formatDateTime(v.created_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted">
              <Info className="mt-px size-3.5 shrink-0 text-accent" />
              Значения до конца квартала помечены «прогноз». Знаменатель всегда берётся из первоначального плана (is_initial), даже если после пересчётов состав изменился.
            </div>
          </>
        )}
      </div>
    </>
  )
}

function ForecastBadge({ forecast }: { forecast: boolean }) {
  return forecast ? <Badge tone="warn">прогноз</Badge> : <Badge tone="ok">факт</Badge>
}

function SprintBars({ pctBySprint, forecast }: { pctBySprint: Record<string, number | null>; forecast: Record<string, boolean> }) {
  const max = Math.max(100, ...SPRINTS.map((n) => pctBySprint[n] ?? 0))
  return (
    <div>
      <div className="relative flex h-64 items-end gap-3 border-b border-border pt-6 sm:gap-5">
        {[100, 50].map((line) => (
          <div key={line} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${(line / max) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[10px] text-subtle">{line}%</span>
          </div>
        ))}
        {SPRINTS.map((n) => {
          const value = pctBySprint[n]
          const isForecast = forecast[n]
          const height = value != null ? (value / max) * 100 : 18
          return (
            <div key={n} className="group relative flex h-full flex-1 flex-col justify-end">
              <span className={cn('mb-1 text-center text-xs font-semibold tabular-nums', isForecast && 'text-subtle')}>
                {value != null ? `${fmt(value)}%` : '—'}
              </span>
              <div
                className={cn(
                  'rounded-t-md transition-[height] duration-700',
                  isForecast
                    ? 'border border-dashed border-border bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_6px,transparent_6px_12px)]'
                    : value != null && value >= 80
                      ? 'bg-accent'
                      : 'bg-warn',
                )}
                style={{ height: `${height}%` }}
                title={isForecast ? 'прогноз' : 'факт'}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-3 sm:gap-5">
        {SPRINTS.map((n) => (
          <div key={n} className="flex-1 text-center">
            <p className="text-xs font-medium">S{n}</p>
            <p className={cn('text-[10px]', forecast[n] ? 'text-warn' : 'text-ok')}>{forecast[n] ? 'прогноз' : 'факт'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
