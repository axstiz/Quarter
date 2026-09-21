import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PlanBusRisk } from '@/api/types'

const PREVIEW = 6

/** Роль → единственный носитель → задачи под угрозой. Самые «широкие» риски сверху, длинные списки свёрнуты.
 *  Источник — ручка GET /plans/{id}/bus-risk (change 003/015, клиент не считает). */
export function RiskPanelContent({ planRisk, onSelect }: { planRisk: PlanBusRisk | null | undefined; onSelect: (taskId: string) => void }) {
  // byRole: роль → { holders: [...], tasks: [...] }
  const byRole = new Map<string, { holders: string[]; tasks: string[] }>()
  for (const t of planRisk?.tasks ?? [])
    for (const role of t.at_risk_keys) {
      const holders = t.holders?.[role] ?? []
      const entry = byRole.get(role) ?? { holders, tasks: [] }
      entry.tasks.push(t.task_id)
      byRole.set(role, entry)
    }
  const rows = [...byRole].sort((a, b) => b[1].tasks.length - a[1].tasks.length)

  return (
    <>
      <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        {(planRisk?.total_at_risk ?? 0) > 0
          ? `${rows.length} ролей держатся на одном инженере (или носителя нет вовсе — виртуальный держатель). Сверху — те, от кого зависит больше всего задач плана.`
          : 'Рисков нет: задачи плана не зависят от ролей с единственным носителем. Ответ ручки GET /plans/{id}/bus-risk.'}
      </p>
      {rows.length ? (
        <ol className="list-plain" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--s-3)' }}>
          {rows.map(([role, { holders, tasks }]) => (
            <RoleRisk key={role} role={role} holders={holders} tasks={tasks} onSelect={onSelect} />
          ))}
        </ol>
      ) : null}
      <Link to="/team-map?view=competencies&kind=role">Все роли и навыки с методикой →</Link>
    </>
  )
}

function RoleRisk({ role, holders, tasks, onSelect }: { role: string; holders: string[]; tasks: string[]; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? tasks : tasks.slice(0, PREVIEW)
  return (
    <li className="callout" style={{ background: 'var(--well)', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{role}</strong>
        <span className="tabular" style={{ fontSize: 'var(--text-xs)' }}>
          {tasks.length} задач
        </span>
      </div>
      <div style={{ fontSize: 'var(--text-xs)' }}>
        {holders.length ? (
          <>
            единственный носитель:{' '}
            {holders.map((holder) => (
              <Link key={holder} to={`/team-map?person=${holder}`} className="mono" style={{ marginRight: 6 }}>
                {holder}
              </Link>
            ))}
          </>
        ) : (
          'носителя роли нет во всей компании — задача считается через виртуального держателя'
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {shown.map((id) => (
          <button key={id} type="button" className="badge badge--plain" style={{ border: 0, cursor: 'pointer', background: 'var(--sheet)' }} onClick={() => onSelect(id)}>
            <span className="mono">{id}</span>
          </button>
        ))}
        {tasks.length > PREVIEW && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            <span className="btn__label">{expanded ? 'свернуть' : `ещё ${tasks.length - PREVIEW}`}</span>
          </button>
        )}
      </div>
    </li>
  )
}
