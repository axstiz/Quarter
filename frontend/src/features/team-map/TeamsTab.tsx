import { useTeamDetails } from '@/api/queries'
import type { StarMapSummary } from '@/api/types'
import { fmt } from '@/lib/format'

/** Распределение специалистов: сводка по командам и матрица «роли × команды». */
export function TeamsTab({ summary, onSelect }: { summary: StarMapSummary; onSelect: (id: string) => void }) {
  const teams = summary.teams.map((x) => x.team_id).sort()
  const details = useTeamDetails(teams)
  const roles = [...new Set(summary.teams.flatMap((x) => x.engineers.map((e) => e.role)))].sort()
  const membersOf = (team: string) => summary.teams.find((x) => x.team_id === team)?.engineers ?? []
  const teamsOf = new Map<string, string[]>()
  for (const x of summary.teams) for (const e of x.engineers) teamsOf.set(e.engineer_id, [...(teamsOf.get(e.engineer_id) ?? []), x.team_id])

  return (
    <>
      <section className="section" style={{ marginTop: 'var(--s-4)' }}>
        <div className="section__head">
          <h2>Команды</h2>
          <span className="section__hint">ёмкость = средняя производительность × 0,8</span>
        </div>
        <div className="block scroll-x" tabIndex={0} role="region" aria-label="Сводка по командам">
          <table className="table">
            <thead>
              <tr>
                <th>Команда</th>
                <th className="num">Людей</th>
                <th className="num">FTE</th>
                <th className="num">SP / спринт</th>
                <th>Velocity: факт / план</th>
                <th>Общие с другими командами</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team, i) => {
                const d = details[i]?.data
                const shared = membersOf(team).filter((e) => (teamsOf.get(e.engineer_id)?.length ?? 0) > 1)
                return (
                  <tr key={team}>
                    <td className="nowrap" style={{ fontWeight: 500 }}>
                      {team}
                    </td>
                    <td className="num tabular">{membersOf(team).length}</td>
                    <td className="num tabular">{fmt(summary.fte_distribution[team])}</td>
                    <td className="num tabular">{d ? fmt(d.capacity_sp_per_sprint) : <span className="skeleton" style={{ display: 'inline-block', width: 24, height: 10 }} />}</td>
                    <td className="tabular muted nowrap">{d?.sprint_history.map((h) => `${fmt(h.velocity_achieved)}/${fmt(h.planned_sp)}`).join('  ·  ') || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {shared.map((e) => (
                          <button key={e.engineer_id} type="button" className="badge badge--plain" style={{ border: 0, cursor: 'pointer' }} onClick={() => onSelect(e.engineer_id)} title={`Также в: ${teamsOf.get(e.engineer_id)!.filter((x) => x !== team).join(', ')}`}>
                            <span className="mono">{e.engineer_id}</span> ↔ {teamsOf.get(e.engineer_id)!.filter((x) => x !== team).join(', ')}
                          </button>
                        ))}
                        {shared.length === 0 && <span className="cell-muted">—</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Роли по командам</h2>
          <span className="section__hint">людей (сумма ставок) · красным — роль держится на одном человеке</span>
        </div>
        <div className="block scroll-x" tabIndex={0} role="region" aria-label="Роли по командам">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Роль</th>
                {teams.map((x) => (
                  <th key={x} className="num">
                    {x}
                  </th>
                ))}
                <th className="num">В компании</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const ids = new Set(summary.teams.flatMap((x) => x.engineers.filter((e) => e.role === role).map((e) => e.engineer_id)))
                return (
                  <tr key={role}>
                    <td>{role}</td>
                    {teams.map((team) => {
                      const list = membersOf(team).filter((e) => e.role === role)
                      const fte = list.reduce((a, e) => a + e.capacity_rate, 0)
                      return (
                        <td key={team} className="num tabular" title={list.map((e) => e.engineer_id).join(', ')}>
                          {list.length ? (
                            <>
                              {list.length} <span className="muted">({fmt(fte)})</span>
                            </>
                          ) : (
                            <span className="cell-muted">·</span>
                          )}
                        </td>
                      )
                    })}
                    <td className="num tabular nowrap" data-over={ids.size === 1 ? 'true' : undefined} title={ids.size === 1 ? 'Единственный носитель роли в компании' : undefined}>
                      {ids.size}
                      {ids.size === 1 && <span className="sr-only"> — единственный носитель</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
