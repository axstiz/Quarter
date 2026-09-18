import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { BusFactorReport, Engineer } from '@/api/types'
import { Badge } from '@/components/ui/Badge'

interface Props {
  /** «role:backend» | «skill:kafka» */
  comp: string
  busFactor: BusFactorReport
  engineers: Engineer[]
  roleDemand: Map<string, string[]>
  onPerson: (id: string) => void
}

/** Панель роли или навыка на карте: носители, Bus Factor по компании и командам, задачи плана под угрозой. */
export function CompetencyPanelContent({ comp, busFactor, engineers, roleDemand, onPerson }: Props) {
  const [showAll, setShowAll] = useState(false)
  const sep = comp.indexOf(':')
  const kind = comp.slice(0, sep)
  const key = comp.slice(sep + 1)
  const company = busFactor.items.find((i) => i.scope_type === 'company' && i.key === key)
  if (!company) return <p className="muted">Компетенция не найдена в отчёте Bus Factor.</p>

  const teamItems = busFactor.items.filter((i) => i.scope_type === 'team' && i.key === key).sort((a, b) => a.factor - b.factor || a.scope_id.localeCompare(b.scope_id))
  const demand = kind === 'role' ? (roleDemand.get(`company|${key}`) ?? []) : []
  const byId = new Map<string, Engineer[]>()
  for (const e of engineers) byId.set(e.engineer_id, [...(byId.get(e.engineer_id) ?? []), e])
  const visibleTasks = showAll ? demand : demand.slice(0, 12)

  return (
    <>
      <dl className="fields">
        <dt>Тип</dt>
        <dd>{kind === 'role' ? 'Роль' : 'Навык'}</dd>
        <dt>Bus Factor</dt>
        <dd>
          <Badge plain tone={company.factor <= 1 ? 'over' : company.factor === 2 ? 'shift' : 'done'}>
            <span className="tabular">{company.factor}</span>
          </Badge>{' '}
          <span className="muted">по компании</span>
        </dd>
        {kind === 'role' && (
          <>
            <dt>Задач плана</dt>
            <dd className="tabular">{demand.length}</dd>
          </>
        )}
      </dl>

      {company.factor <= 1 && (
        <div className="callout" data-tone="over">
          <div className="callout__title">
            <ShieldAlert aria-hidden /> Держится на одном человеке
          </div>
          <p>
            Если <span className="mono">{company.holders[0]}</span> выпадет, {kind === 'role' && demand.length ? `под угрозой задачи плана: ${demand.length}` : kind === 'role' ? 'роль пропадёт из компании' : 'навык пропадёт из компании'}.
          </p>
        </div>
      )}

      <section>
        <h3 style={{ marginBottom: 'var(--s-2)' }}>Носители · {company.holders.length}</h3>
        <table className="table table--compact">
          <thead>
            <tr>
              <th>Инженер</th>
              <th>Роль</th>
              <th>Команды</th>
            </tr>
          </thead>
          <tbody>
            {company.holders.map((h) => {
              const rows = byId.get(h) ?? []
              return (
                <tr key={h}>
                  <td>
                    <button type="button" className="link-btn mono" onClick={() => onPerson(h)}>
                      {h}
                    </button>
                  </td>
                  <td className="muted">{rows[0]?.role ?? '—'}</td>
                  <td className="muted">{rows.map((r) => r.team_id).join(', ') || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {teamItems.length > 0 && (
        <section>
          <h3 style={{ marginBottom: 'var(--s-2)' }}>По командам</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {teamItems.map((i) => (
              <Badge key={i.scope_id} plain tone={i.factor <= 1 ? 'over' : undefined}>
                {i.scope_id} · <span className="tabular">{i.factor}</span>
              </Badge>
            ))}
          </div>
        </section>
      )}

      {demand.length > 0 && (
        <section>
          <h3 style={{ marginBottom: 'var(--s-2)' }}>Задачи плана с этой ролью</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {visibleTasks.map((id) => (
              <Link key={id} to={`/plan?task=${encodeURIComponent(id)}`} className="badge badge--plain mono">
                {id}
              </Link>
            ))}
          </div>
          {demand.length > 12 && (
            <button type="button" className="link-btn" style={{ marginTop: 'var(--s-2)' }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Свернуть' : `Показать все ${demand.length}`}
            </button>
          )}
        </section>
      )}
    </>
  )
}
