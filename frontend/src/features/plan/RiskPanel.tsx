import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { RiskEntry } from './busRisk'

const PREVIEW = 6

/** Роль → единственный носитель → задачи под угрозой. Самые «широкие» риски сверху, длинные списки свёрнуты. */
export function RiskPanelContent({ risks, onSelect }: { risks: RiskEntry[]; onSelect: (taskId: string) => void }) {
  const byRole = new Map<string, { holder: string; tasks: string[] }>()
  for (const r of risks)
    for (const { role, holder } of r.roles) {
      const entry = byRole.get(role) ?? { holder, tasks: [] }
      entry.tasks.push(r.task.task_id)
      byRole.set(role, entry)
    }
  const rows = [...byRole].sort((a, b) => b[1].tasks.length - a[1].tasks.length)

  return (
    <>
      <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        {rows.length} ролей держатся на одном инженере. Сверху — те, от кого зависит больше всего задач плана.
      </p>
      <ol className="list-plain" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--s-3)' }}>
        {rows.map(([role, { holder, tasks }]) => (
          <RoleRisk key={role} role={role} holder={holder} tasks={tasks} onSelect={onSelect} />
        ))}
      </ol>
      <Link to="/team-map?view=competencies&kind=role">Все роли и навыки с методикой →</Link>
    </>
  )
}

function RoleRisk({ role, holder, tasks, onSelect }: { role: string; holder: string; tasks: string[]; onSelect: (id: string) => void }) {
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
        единственный носитель:{' '}
        <Link to={`/team-map?person=${holder}`} className="mono">
          {holder}
        </Link>
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
