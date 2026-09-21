import { Meter } from '@/components/ui/Meter'
import { Badge } from '@/components/ui/Badge'
import { ErrorAlert, SkeletonRows } from '@/components/ui/States'
import { fmt, plural } from '@/lib/format'
import { useBusForecast } from '@/api/queries'
import type { BusForecastEntry } from '@/api/types'

const SPRINTS = [1, 2, 3, 4, 5, 6]

const LEVEL_LABEL: Record<BusForecastEntry['risk']['level'], { label: string; tone: 'over' | 'shift' | 'plan' }> = {
  high: { label: 'высокий', tone: 'over' },
  medium: { label: 'средний', tone: 'shift' },
  low: { label: 'низкий', tone: 'plan' },
}

/**
 * Вкладка «Прогноз рисков» (change 023): прогноз bus factor по плановой загрузке —
 * кто держит план на себе: объём задач/часов, роли-одиночки, перегруз спринтов,
 * «если уйдёт: N задач / M ч». Данные — ручка GET /plans/{id}/bus-forecast.
 */
export function ForecastTab({ planId, onSelect }: { planId: string | null; onSelect: (id: string) => void }) {
  const forecast = useBusForecast(planId)

  if (!planId) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Плана в этом пространстве нет — постройте план на странице «План квартала», чтобы увидеть прогноз по загрузке людей.
      </p>
    )
  }
  if (forecast.error) return <ErrorAlert error={forecast.error} onRetry={() => forecast.refetch()} />
  if (forecast.isLoading) return <SkeletonRows rows={7} cols={5} />
  if (!forecast.data?.people.length) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Прогноза нет: в текущей версии плана нет плановой загрузки людей (assignments). Постройте план или загрузите данные.
      </p>
    )
  }

  const people = forecast.data.people
  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <table className="table table--compact">
        <thead>
          <tr>
            <th>Человек</th>
            <th>Загрузка по спринтам</th>
            <th>Всего за квартал</th>
            <th>Критичные роли</th>
            <th>Прогноз</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.engineer_id} className="is-link" tabIndex={0}
              onClick={() => onSelect(p.engineer_id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(p.engineer_id))}>
              <td className="table-key">{p.engineer_id}</td>
              <td>
                <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>{p.team_id} · {p.role}</div>
                <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
                  {SPRINTS.map((n) => {
                    const hours = p.hours_per_sprint[String(n)] ?? 0
                    const over = p.overloaded_sprints.includes(String(n))
                    if (!hours) return (
                      <span key={n} className="muted" style={{ fontSize: 'var(--text-2xs)' }}>спринт {n}: —</span>
                    )
                    return (
                      <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="muted" style={{ fontSize: 'var(--text-2xs)', width: 58 }}>спринт {n}</span>
                        <Meter
                          value={hours}
                          max={p.limit_hours_per_sprint}
                          unit=" ч"
                          label={`Спринт ${n}: ${fmt(hours)} ч из ${fmt(p.limit_hours_per_sprint)} ч${over ? ' — перегруз' : ''}`}
                        />
                      </span>
                    )
                  })}
                  {SPRINTS.every((n) => !p.hours_per_sprint[String(n)]) && <span className="muted">—</span>}
                </div>
              </td>
              <td>
                <div className="num tabular">{fmt(p.total_hours)} ч</div>
                <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>{p.tasks_count} {plural(p.tasks_count, 'задача', 'задачи', 'задач')}</div>
              </td>
              <td>
                {p.critical_roles.length
                  ? p.critical_roles.map((r) => <Badge key={r} tone="over">{r}</Badge>)
                  : <span className="muted" style={{ fontSize: 'var(--text-2xs)' }}>все роли с носителями ≥ 2</span>}
                {p.overloaded_sprints.length > 0 && (
                  <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>перегруз: спринты {p.overloaded_sprints.join(', ')}</div>
                )}
              </td>
              <td style={{ minWidth: 260 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Badge tone={LEVEL_LABEL[p.risk.level].tone}>{LEVEL_LABEL[p.risk.level].label}</Badge>
                  <span className="num tabular" style={{ fontSize: 'var(--text-sm)' }}>
                    если уйдёт: {p.risk.affected_tasks} задача(и) / {fmt(p.risk.affected_hours)} ч
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>{p.risk.basis}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <details>
        <summary className="muted" style={{ fontSize: 'var(--text-sm)', cursor: 'pointer' }}>Методика прогноза</summary>
        <p className="muted" style={{ fontSize: 'var(--text-xs)', maxWidth: 720 }}>{forecast.data.methodology}</p>
      </details>
    </div>
  )
}
