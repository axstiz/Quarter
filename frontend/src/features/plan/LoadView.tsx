import { useMemo } from 'react'
import { useEngineers, useTeamDetails } from '@/api/queries'
import type { PlanModel } from '@/lib/planModel'
import { Meter } from '@/components/ui/Meter'
import { fmt } from '@/lib/format'

const SPRINTS = [1, 2, 3, 4, 5, 6]

/** Загрузка как в планировщиках ресурсов: строки — команды/роли, колонки — спринты. */
export function LoadView({ model }: { model: PlanModel }) {
  // выполненные по факту части не нагружают спринт
  const active = useMemo(() => model.sprints.map((s) => ({ ...s, tasks: s.rows.filter((t) => t.decision === 'planned') })), [model])
  const teams = useMemo(() => [...new Set(active.flatMap((s) => s.tasks.map((t) => t.team_id)))].sort(), [active])
  const details = useTeamDetails(teams)
  const engineers = useEngineers({})

  const capacity = new Map(details.map((d, i) => [teams[i], d.data?.capacity_sp_per_sprint]))
  const spBy = (team: string, n: number) => active.find((s) => s.sprint_no === n)?.tasks.filter((t) => t.team_id === team).reduce((a, t) => a + (t.step_points_sp ?? 0), 0) ?? 0

  // Названия ролей в требованиях и профилях расходятся регистром («ДевОпс» / «Девопс») — сравниваем без него
  const roleAvailable = new Map<string, number>()
  for (const e of engineers.data ?? []) {
    const key = e.role.toLowerCase()
    roleAvailable.set(key, (roleAvailable.get(key) ?? 0) + 80 * Math.min(e.capacity_rate, 1))
  }
  const roles = [...new Set(active.flatMap((s) => s.tasks.flatMap((t) => Object.keys(t.role_hours))))].sort()
  // Задача может быть разбита между спринтами — часы роли делим пропорционально SP части
  const hoursBy = (role: string, n: number) =>
    active.find((s) => s.sprint_no === n)?.tasks.reduce((a, t) => a + (t.role_hours[role] ?? 0) * (t.parts > 1 && t.estimation_sp ? (t.step_points_sp ?? 0) / t.estimation_sp : 1), 0) ?? 0
  const deficitRoles = roles.filter((r) => SPRINTS.some((n) => hoursBy(r, n) > (roleAvailable.get(r.toLowerCase()) ?? 0)))

  return (
    <>
      <section className="section" style={{ marginTop: 'var(--s-4)' }}>
        <div className="section__head">
          <h2>Story Points по командам</h2>
          <span className="section__hint">доступно = средняя производительность × 0,8</span>
        </div>
        <div className="block scroll-x" tabIndex={0} role="region" aria-label="Story Points по командам и спринтам">
          <table className="table">
            <thead>
              <tr>
                <th>Команда</th>
                {SPRINTS.map((n) => (
                  <th key={n}>Спринт {n}</th>
                ))}
                <th className="num">Итого SP</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team}>
                  <td className="nowrap">{team}</td>
                  {SPRINTS.map((n) => (
                    <td key={n}>
                      <Meter value={spBy(team, n)} max={capacity.get(team)} label={`${team}, спринт ${n}`} />
                    </td>
                  ))}
                  <td className="num tabular">{fmt(SPRINTS.reduce((a, n) => a + spBy(team, n), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Часы по ролям</h2>
          <span className="section__hint">
            {engineers.isLoading ? 'считаем…' : deficitRoles.length ? `дефицит в ${deficitRoles.length} ролях` : 'дефицита нет'} · 80 ч на ставку 1,0
          </span>
        </div>
        <div className="block scroll-x" tabIndex={0} role="region" aria-label="Часы по ролям и спринтам">
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Роль</th>
                {SPRINTS.map((n) => (
                  <th key={n}>Спринт {n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const available = roleAvailable.get(role.toLowerCase())
                return (
                  <tr key={role}>
                    <td>
                      {role}
                      {!engineers.isLoading && available == null && <div className="risk">нет инженеров в компании</div>}
                    </td>
                    {SPRINTS.map((n) => {
                      const need = hoursBy(role, n)
                      return <td key={n}>{need >= 0.5 ? <Meter value={Math.round(need)} max={available ?? 0.0001} unit=" ч" label={`${role}, спринт ${n}`} /> : <span className="cell-muted">—</span>}</td>
                    })}
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
