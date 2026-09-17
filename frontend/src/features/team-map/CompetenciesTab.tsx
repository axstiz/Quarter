import { Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { BusFactorReport, StarMapSummary } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { SearchInput, Select } from '@/components/ui/Field'
import { useParam } from '@/lib/useParam'

/** Bus Factor: методика и область расчёта всегда рядом с цифрами. */
export function CompetenciesTab({ report, summary, roleDemand, hasPlan, onSelect }: { report: BusFactorReport; summary: StarMapSummary; roleDemand: Map<string, string[]>; hasPlan: boolean; onSelect: (id: string) => void }) {
  const [scope, setScope] = useParam('scope')
  const [kind, setKind] = useParam('kind')
  const [maxFactor, setMaxFactor] = useParam('max')
  const [q, setQ] = useParam('cq')

  const scopeId = scope ?? 'company'
  const teams = summary.teams.map((x) => x.team_id).sort()
  const roleKeys = useMemo(() => new Set(summary.teams.flatMap((x) => x.engineers.map((e) => e.role.toLowerCase()))), [summary])
  const limit = maxFactor === null ? 1 : Number(maxFactor) || Infinity
  const query = (q ?? '').toLowerCase()

  const rows = report.items
    .filter((i) => (scopeId === 'company' ? i.scope_type === 'company' : i.scope_type === 'team' && i.scope_id === scopeId))
    .filter((i) => !kind || (kind === 'role') === roleKeys.has(i.key))
    .filter((i) => i.factor <= limit)
    .filter((i) => !query || i.key.includes(query))
    .map((i) => ({ ...i, demand: roleDemand.get(`${i.scope_type === 'company' ? 'company' : i.scope_id}|${i.key}`) ?? [] }))
    // Сначала то, что грозит плану: больше задач под угрозой → меньше носителей → роли раньше навыков
    .sort((a, b) => b.demand.length - a.demand.length || a.factor - b.factor || Number(roleKeys.has(b.key)) - Number(roleKeys.has(a.key)) || a.key.localeCompare(b.key))

  return (
    <>
      <div className="callout" data-tone="plan" style={{ marginTop: 'var(--s-3)' }}>
        <div className="callout__title">
          <Info aria-hidden /> Методика · область: {scopeId === 'company' ? 'вся компания' : `команда ${scopeId}`}
        </div>
        <p>{report.methodology}</p>
        <p>
          Колонка «Задач плана» — сколько незакрытых задач {hasPlan ? 'текущего плана' : '(плана пока нет)'} требуют роль; навыки к задачам в данных не привязаны.
        </p>
      </div>

      <div className="toolbar">
        <SearchInput placeholder="Компетенция или роль" value={q ?? ''} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} aria-label="Поиск компетенции" />
        <Select aria-label="Область" value={scopeId} onChange={(e) => setScope(e.target.value === 'company' ? null : e.target.value)} options={[{ value: 'company', label: 'Вся компания' }, ...teams.map((x) => ({ value: x, label: `Команда ${x}` }))]} />
        <Select
          aria-label="Тип"
          value={kind ?? ''}
          onChange={(e) => setKind(e.target.value)}
          options={[
            { value: '', label: 'Роли и навыки' },
            { value: 'role', label: 'Только роли' },
            { value: 'skill', label: 'Только навыки' },
          ]}
        />
        <Select
          aria-label="Bus Factor"
          value={maxFactor ?? '1'}
          onChange={(e) => setMaxFactor(e.target.value === '1' ? null : e.target.value)}
          options={[
            { value: '1', label: 'Bus Factor ≤ 1 (риск)' },
            { value: '2', label: 'Bus Factor ≤ 2' },
            { value: 'all', label: 'Все' },
          ]}
        />
        <span className="toolbar__end muted tabular" style={{ fontSize: 'var(--text-xs)' }} aria-live="polite">
          Найдено: {rows.length}
        </span>
      </div>

      <div className="block scroll-x">
        <table className="table table--compact">
          <thead>
            <tr>
              <th>Компетенция</th>
              <th>Тип</th>
              <th className="num">Bus Factor</th>
              <th className="num" title="Незакрытые задачи текущего плана, которым нужна эта роль">Задач плана</th>
              <th>Носители</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={`${i.scope_id}-${i.key}`}>
                <td style={{ fontWeight: 500 }}>{i.key}</td>
                <td className="muted">{roleKeys.has(i.key) ? 'роль' : 'навык'}</td>
                <td className="num">
                  <Badge plain tone={i.factor <= 1 ? 'over' : i.factor === 2 ? 'shift' : 'done'}>
                    <span className="tabular">{i.factor}</span>
                  </Badge>
                </td>
                <td className="num tabular">
                  {i.demand.length ? (
                    <Link to={`/plan?risk=1${i.scope_type === 'team' ? `&team=${i.scope_id}` : ''}`} title={i.demand.slice(0, 12).join(', ')}>
                      {i.demand.length}
                    </Link>
                  ) : (
                    <span className="cell-muted">{roleKeys.has(i.key) ? '0' : '—'}</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {i.holders.map((h) => (
                      <button key={h} type="button" className="badge badge--plain" style={{ border: 0, cursor: 'pointer' }} onClick={() => onSelect(h)}>
                        <span className="mono">{h}</span>
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
