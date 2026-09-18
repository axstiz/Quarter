import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { ShieldAlert, Users } from 'lucide-react'
import { useEngineers } from '@/api/queries'
import type { BusFactorReport, Engineer, StarMapSummary } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Checkbox, Field, SearchInput, Select } from '@/components/ui/Field'
import { Empty } from '@/components/ui/States'
import { fmt } from '@/lib/format'
import { useParam } from '@/lib/useParam'

/** Справочник людей: фильтры слева (в URL), таблица справа, профиль в панели. Фильтрация — на стороне API. */
export function PeopleTab({ summary, busFactor, selected, onSelect }: { summary: StarMapSummary; busFactor?: BusFactorReport; selected: string | null; onSelect: (id: string) => void }) {
  const [team, setTeam] = useParam('team')
  const [role, setRole] = useParam('role')
  const [grade, setGrade] = useParam('grade')
  const [skill, setSkill] = useParam('skill')
  const [minRate, setMinRate] = useParam('min_rate')
  const [multi, setMulti] = useParam('multi')
  const [single, setSingle] = useParam('single')

  const all = useEngineers({})
  const filtered = useEngineers({ team_id: team ?? undefined, role: role ?? undefined, grade: grade ?? undefined, skill: skill ?? undefined, min_rate: minRate ? Number(minRate) : undefined })

  const teams = summary.teams.map((x) => x.team_id).sort()
  const roles = useMemo(() => [...new Set(all.data?.map((e) => e.role))].sort(), [all.data])
  const grades = useMemo(() => [...new Set(all.data?.map((e) => e.grade).filter(Boolean))].sort(), [all.data])

  // Инженер в нескольких командах приходит несколькими строками — собираем в одного человека
  const rowsById = useMemo(() => {
    const m = new Map<string, Engineer[]>()
    for (const e of all.data ?? []) m.set(e.engineer_id, [...(m.get(e.engineer_id) ?? []), e])
    return m
  }, [all.data])

  const singleSkills = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const i of busFactor?.items ?? []) if (i.scope_type === 'company' && i.factor === 1) m.set(i.holders[0], [...(m.get(i.holders[0]) ?? []), i.key])
    return m
  }, [busFactor])

  const people = [...new Set(filtered.data?.map((e) => e.engineer_id))]
    .map((id) => ({ id, rows: rowsById.get(id) ?? [] }))
    .filter((p) => (!multi || p.rows.length > 1) && (!single || singleSkills.has(p.id)))
    .sort((a, b) => a.id.localeCompare(b.id))

  const anyFilter = !!(team || role || grade || skill || minRate || multi || single)
  const activeCount = [team, role, grade, skill, minRate, multi, single].filter(Boolean).length
  const wide = useWide()
  const reset = () => [setTeam, setRole, setGrade, setSkill, setMinRate, setMulti, setSingle].forEach((f) => f(null))

  return (
    <div className="split">
      <details className="filters-box" open={wide || undefined}>
      <summary>
        <SlidersHorizontal aria-hidden style={{ width: 16, height: 16 }} /> Фильтры{activeCount ? ` · ${activeCount}` : ''}
      </summary>
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Фильтры">
        <Field label="Компетенция">
          <SearchInput placeholder="например, Kafka" value={skill ?? ''} onChange={(e) => setSkill(e.target.value)} />
        </Field>
        <Field label="Команда">
          <Select value={team ?? ''} onChange={(e) => setTeam(e.target.value)} options={[{ value: '', label: 'Все команды' }, ...teams.map((x) => ({ value: x, label: x }))]} />
        </Field>
        <Field label="Роль">
          <Select value={role ?? ''} onChange={(e) => setRole(e.target.value)} options={[{ value: '', label: 'Все роли' }, ...roles.map((x) => ({ value: x, label: x }))]} />
        </Field>
        <Field label="Грейд">
          <Select value={grade ?? ''} onChange={(e) => setGrade(e.target.value)} options={[{ value: '', label: 'Любой' }, ...grades.map((x) => ({ value: x, label: x }))]} />
        </Field>
        <Field label="Ставка">
          <Select
            value={minRate ?? ''}
            onChange={(e) => setMinRate(e.target.value)}
            options={[
              { value: '', label: 'Любая' },
              { value: '0.5', label: 'от 0,5' },
              { value: '1', label: 'полная' },
            ]}
          />
        </Field>
        <div>
          <Checkbox label="В нескольких командах" checked={!!multi} onChange={(e) => setMulti(e.target.checked ? '1' : null)} />
          <Checkbox label="Единственный носитель" checked={!!single} onChange={(e) => setSingle(e.target.checked ? '1' : null)} />
        </div>
        {anyFilter && (
          <Button size="sm" variant="ghost" onClick={reset} style={{ alignSelf: 'flex-start' }}>
            Сбросить фильтры
          </Button>
        )}
      </form>
      </details>

      <div style={{ minWidth: 0 }}>
        <div className="section__head" style={{ marginBottom: 8 }}>
          <span className="muted tabular" style={{ fontSize: 'var(--text-sm)' }} aria-live="polite">
            Найдено: <strong style={{ color: 'var(--ink)' }}>{people.length}</strong>
            {filtered.isFetching && ' · обновляется…'}
          </span>
        </div>
        {people.length === 0 && !filtered.isLoading ? (
          <Empty icon={<Users />} title="Никого не нашли" text="Ослабьте фильтры — например, уберите компетенцию или грейд." actions={<Button onClick={reset}>Сбросить фильтры</Button>} />
        ) : (
          <div className="block scroll-x" style={{ opacity: filtered.isFetching ? 0.7 : 1, transition: 'opacity 150ms ease' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Инженер</th>
                  <th>Роль</th>
                  <th>Грейд</th>
                  <th>Команды</th>
                  <th className="num">Ч / спринт</th>
                  <th>Компетенции</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const main = p.rows[0]
                  const hours = Math.min(p.rows.reduce((a, r) => a + 80 * r.capacity_rate, 0), 80)
                  const singles = singleSkills.get(p.id)
                  return (
                    <tr
                      key={p.id}
                      className="is-link"
                      tabIndex={0}
                      aria-selected={p.id === selected}
                      onClick={() => onSelect(p.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(p.id))}
                    >
                      <td className="table-key">{p.id}</td>
                      <td>{main?.role}</td>
                      <td className="muted">{main?.grade}</td>
                      <td className="nowrap">
                        {p.rows.map((r) => (
                          <div key={r.team_id}>
                            {r.team_id}
                            {r.capacity_rate < 1 && <span className="muted tabular"> · {r.capacity_rate}</span>}
                          </div>
                        ))}
                      </td>
                      <td className="num tabular">{fmt(hours)}</td>
                      <td style={{ minWidth: 220, fontSize: 'var(--text-xs)', color: 'var(--ink-2)' }}>
                        {main?.skills_declared}
                        {singles && (
                          <div className="risk">
                            <ShieldAlert aria-hidden /> единственный: {singles.slice(0, 3).join(', ')}
                            {singles.length > 3 && ` и ещё ${singles.length - 3}`}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** На широком экране фильтры всегда раскрыты; на узком — свёрнуты под кнопкой */
function useWide() {
  const query = '(min-width: 1101px)'
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}
