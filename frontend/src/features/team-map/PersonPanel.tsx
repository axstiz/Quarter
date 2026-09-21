import { ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEngineer } from '@/api/queries'
import { Meter } from '@/components/ui/Meter'
import { ErrorAlert } from '@/components/ui/States'
import { fmt } from '@/lib/format'

export function PersonPanelContent({ id }: { id: string }) {
  const profile = useEngineer(id)
  const p = profile.data
  const main = p?.assignments[0]
  const total = Math.min(p?.assignments.reduce((a, x) => a + x.hours_per_sprint, 0) ?? 0, 80)

  if (profile.error) return <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} />
  if (!p || !main)
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {[70, 50, 90].map((w) => (
          <div key={w} className="skeleton" style={{ height: 14, width: `${w}%` }} />
        ))}
      </div>
    )

  return (
    <>
      <dl className="fields">
        <dt>Роль</dt>
        <dd>{main.role}</dd>
        <dt>Грейд</dt>
        <dd>{main.grade}</dd>
        <dt>Доступность</dt>
        <dd>
          <Meter value={total} max={80} unit=" ч" label="Часов за спринт из 80" />
        </dd>
      </dl>

      <div style={{ textAlign: 'right' }}>
        <Link to={`/data?tab=people&row=${id}`} className="muted" style={{ fontSize: 'var(--text-xs)', textDecoration: 'none' }}>
          ✎ Редактировать данные
        </Link>
      </div>

      <section>
        <h3 style={{ marginBottom: 'var(--s-2)' }}>Команды</h3>
        <table className="table table--compact">
          <thead>
            <tr>
              <th>Команда</th>
              <th className="num">Ставка</th>
              <th className="num">Ч / спринт</th>
            </tr>
          </thead>
          <tbody>
            {p.assignments.map((a) => (
              <tr key={a.team_id}>
                <td>{a.team_id}</td>
                <td className="num tabular">
                  {a.capacity_rate}
                  {a.parttime && <span className="muted"> · частичная</span>}
                </td>
                <td className="num tabular">{fmt(a.hours_per_sprint)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 style={{ marginBottom: 'var(--s-2)' }}>Заявленные компетенции</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {main.skills_declared.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
            const single = p.single_holder_alerts.includes(s.toLowerCase())
            return (
              <span key={s} className="badge badge--plain" data-tone={single ? 'over' : undefined} title={single ? 'Единственный носитель в команде' : undefined}>
                {s}
              </span>
            )
          })}
        </div>
      </section>

      {p.single_holder_alerts.length > 0 && (
        <div className="callout" data-tone="over">
          <div className="callout__title">
            <ShieldAlert aria-hidden /> Единственный носитель в своих командах
          </div>
          <p>{p.single_holder_alerts.join(', ')}</p>
          <Link to="/plan?risk=1">Задачи плана с риском Bus Factor →</Link>
        </div>
      )}
    </>
  )
}
