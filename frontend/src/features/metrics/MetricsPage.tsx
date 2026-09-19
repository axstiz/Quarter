import { motion } from 'motion/react'
import { BarChart3 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCurrentPlanId, useFacts, useMetrics, usePlan, usePlanVersions } from '@/api/queries'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Meter } from '@/components/ui/Meter'
import { Empty, ErrorAlert, SkeletonRows } from '@/components/ui/States'
import { fmt, formatDateTime, pct } from '@/lib/format'
import { versionLabel } from '@/lib/labels'
import { stagger } from '@/lib/motion'

const SPRINTS = [1, 2, 3, 4, 5, 6]

export function MetricsPage() {
  const planId = useCurrentPlanId()
  const versions = usePlanVersions()
  const metrics = useMetrics(planId)
  const facts = useFacts(planId)
  const [, setParams] = useSearchParams()

  // База сравнения — первоначальный план в цепочке версий текущего плана
  const list = versions.data ?? []
  const chain: typeof list = []
  for (let cur = list.find((v) => v.plan_id === planId); cur; cur = list.find((v) => v.plan_id === cur!.parent_plan_id)) chain.unshift(cur)
  const initial = usePlan(chain[0]?.plan_id)

  if (planId === null) {
    return (
      <div className="content">
        <Empty
          icon={<BarChart3 />}
          title="Метрик пока нет"
          text="Они появятся после построения плана и загрузки факта спринтов."
          actions={
            <Link to="/plan" className="btn btn--primary" style={{ textDecoration: 'none' }}>
              <span className="btn__label">К плану квартала</span>
            </Link>
          }
        />
      </div>
    )
  }

  const m = metrics.data
  const plannedSp = (n: number) => initial.data?.sprints.find((s) => s.sprint_no === n)?.tasks.reduce((a, x) => a + (x.step_points_sp ?? 0), 0)
  const fact = (n: number) => facts.data?.find((f) => f.sprint_no === n)
  const factSprints = SPRINTS.filter((n) => m && !m.sprint_completion_is_forecast[n])
  const avg = factSprints.length && m ? factSprints.reduce((a, n) => a + (m.sprint_completion_pct[n] ?? 0), 0) / factSprints.length : null

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Метрики квартала</h1>
          <div className="page-head__sub">Считаются от первоначального плана — пересчёты не подменяют базу сравнения</div>
        </div>
      </div>

      {metrics.error ? (
        <ErrorAlert error={metrics.error} onRetry={() => metrics.refetch()} />
      ) : !m ? (
        <SkeletonRows rows={7} cols={5} />
      ) : (
        <>
          <div className="block" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Kpi label="Выполнение квартального плана" hint="завершённые инициативы / инициативы первоначального плана" forecast={m.quarter_completion_is_forecast} norm={[80, 100]} value={m.quarter_completion_pct}>
              <AnimatedNumber value={m.quarter_completion_pct} suffix="%" />
            </Kpi>
            <Kpi label="Среднее выполнение спринта (Say/Do)" hint="факт SP / первоначально запланированные SP" forecast={false} border norm={[90, 105]} value={avg}>
              {avg == null ? '—' : <AnimatedNumber value={Math.round(avg * 10) / 10} suffix="%" />}
            </Kpi>
            <Kpi label="Спринтов с фактом" hint="остальные значения — прогноз" forecast={false} border>
              <AnimatedNumber value={facts.data?.length ?? 0} />
              <span className="muted" style={{ fontSize: 'var(--text-lg)' }}> / 6</span>
            </Kpi>
          </div>

          <section className="section">
            <div className="section__head">
              <h2>Выполнение по спринтам</h2>
              <span className="section__hint">знаменатель — SP первоначального плана · норма Say/Do 90–105%</span>
            </div>
            <SprintChart
              data={SPRINTS.map((n) => ({
                n,
                planned: plannedSp(n) ?? 0,
                done: m.sprint_completion_is_forecast[n] ? null : (fact(n)?.completed_sp ?? 0),
                pct: m.sprint_completion_pct[n],
                forecast: m.sprint_completion_is_forecast[n],
              }))}
            />
            <div className="block scroll-x" style={{ marginTop: 'var(--s-3)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Спринт</th>
                    <th>Выполнено / запланировано</th>
                    <th className="num">Выполнение</th>
                    <th>Значение</th>
                  </tr>
                </thead>
                <tbody>
                  {SPRINTS.map((n, i) => {
                    const forecast = m.sprint_completion_is_forecast[n]
                    return (
                      <motion.tr key={n} data-forecast={forecast || undefined} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: stagger(i) }}>
                        <td className="nowrap">Спринт {n}</td>
                        <td>{forecast ? <span className="muted tabular">— / {fmt(plannedSp(n))} SP</span> : <Meter value={fact(n)?.completed_sp ?? 0} max={plannedSp(n)} unit=" SP" label={`Спринт ${n}`} />}</td>
                        <td className="num tabular" style={{ fontWeight: forecast ? 400 : 600 }}>
                          {pct(m.sprint_completion_pct[n])}
                        </td>
                        <td>{forecast ? <Badge tone="neutral">прогноз</Badge> : <Badge tone="done">факт</Badge>}</td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="section">
        <div className="section__head">
          <h2>История версий плана</h2>
          <span className="section__hint">{chain.length} в цепочке</span>
        </div>
        <div className="block scroll-x">
          <table className="table table--compact">
            <tbody>
              {chain.map((v) => (
                <tr key={v.plan_id} aria-selected={v.plan_id === planId}>
                  <td>
                    {versionLabel(v)} {v.is_initial && <Badge tone="plan">база метрик</Badge>}
                  </td>
                  <td className="muted tabular nowrap">{formatDateTime(v.created_at)}</td>
                  <td className="num">
                    {v.plan_id === planId ? (
                      <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                        открыта
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setParams({ plan: v.plan_id })}>
                        Открыть
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, hint, forecast, border, norm, value, children }: { label: string; hint: string; forecast: boolean; border?: boolean; norm?: [number, number]; value?: number | null; children: React.ReactNode }) {
  return (
    <div style={{ padding: 'var(--s-4)', borderLeft: border ? '1px solid var(--rule)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span className="stat__label">{label}</span>
        {forecast && <Badge tone="shift">прогноз</Badge>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
        <span style={{ fontSize: 'var(--text-3xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>{children}</span>
        {norm && value != null && <NormStatus value={value} norm={norm} />}
      </div>
      <div className="section__hint">{hint}{norm && ` · бизнес-норма ${norm[0]}–${norm[1]}%`}</div>
    </div>
  )
}

/** Статус относительно бизнес-нормы онбординга — текстом и значком, не только цветом. */
function NormStatus({ value, norm }: { value: number; norm: [number, number] }) {
  const state = value < norm[0] ? 'low' : value > norm[1] ? 'high' : 'ok'
  const text = state === 'ok' ? '✓ в норме' : state === 'low' ? '↓ ниже нормы' : '↑ выше нормы'
  return <span className="norm" data-state={state}>{text}</span>
}

interface SprintPoint { n: number; planned: number; done: number | null; pct: number | null; forecast: boolean }

/**
 * План и факт по спринтам в одном столбике: контур — SP первоначального плана, заливка — выполнено по факту.
 * Прогнозные спринты — только контур с подписью «прогноз». Точные числа — в таблице ниже.
 */
function SprintChart({ data }: { data: SprintPoint[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.planned, d.done ?? 0)))
  const h = (v: number) => `${(v / max) * 100}%`
  return (
    <figure className="sdchart block">
      <figcaption className="sdchart__legend">
        <span><i className="sdchart__key" /> запланировано (первоначальный план)</span>
        <span><i className="sdchart__key" data-fill="true" /> выполнено по факту</span>
      </figcaption>
      <div className="sdchart__plot">
        {data.map((d) => {
          const label = `Спринт ${d.n}: запланировано ${fmt(d.planned)} SP${d.forecast ? ', факт ещё не загружен (прогноз)' : `, выполнено ${fmt(d.done)} SP — ${pct(d.pct)}`}`
          return (
            <div key={d.n} className="sdchart__col" tabIndex={0} aria-label={label} data-forecast={d.forecast || undefined}>
              <div className="sdchart__value">
                {d.forecast ? <span className="muted">прогноз</span> : <><b className="tabular">{pct(d.pct)}</b>{d.pct != null && <NormStatus value={d.pct} norm={[90, 105]} />}</>}
              </div>
              <div className="sdchart__area">
                <span className="sdchart__planned" style={{ height: h(d.planned) }} />
                {d.done != null && d.done > 0 && <span className="sdchart__done" style={{ height: h(d.done) }} />}
              </div>
              <div className="sdchart__x"><b>Спринт {d.n}</b><span className="tabular">{fmt(d.planned)} SP</span></div>
              <div className="sdchart__tip" role="tooltip">{label}</div>
            </div>
          )
        })}
      </div>
    </figure>
  )
}
