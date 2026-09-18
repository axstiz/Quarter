import { ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTeamDetails } from '@/api/queries'
import { Badge, DecisionBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox, SearchInput, Select } from '@/components/ui/Field'
import { Group } from '@/components/ui/Group'
import { Meter } from '@/components/ui/Meter'
import { fmt, plural, sprintWeeks, sumHours } from '@/lib/format'
import { DECISION_LABEL } from '@/lib/labels'
import type { PlanModel, PlanRow, TaskSummary } from '@/lib/planModel'
import { useParam } from '@/lib/useParam'
import type { RiskEntry } from './busRisk'

interface Props {
  model: PlanModel
  fixedSprints: Set<number>
  risks: RiskEntry[]
  selectedId: string | null
  onSelect: (taskId: string) => void
}

/** Часть задачи может получить < 0,05 SP (часы легли, SP округлились) — «0» здесь вводит в заблуждение */
export const fmtSp = (sp: number | null) => (sp !== null && sp > 0 && sp < 0.05 ? '<0,1' : sp === 0 ? '<0,1' : fmt(sp))

const tasksWord = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`

/** Бэклог в стиле Jira: спринт — карточка со сводкой в заголовке и строками задач. */
export function SprintsView({ model, fixedSprints, risks, selectedId, onSelect }: Props) {
  const [team, setTeam] = useParam('team')
  const [decision, setDecision] = useParam('decision')
  const [q, setQ] = useParam('q')
  const [onlyRisk, setOnlyRisk] = useParam('risk')

  const riskById = useMemo(() => new Map(risks.map((r) => [r.task.task_id, r])), [risks])
  const teams = useMemo(() => [...new Set([...model.tasks.values()].map((t) => t.team_id).filter(Boolean))].sort(), [model])
  const teamDetails = useTeamDetails(team ? [team] : [])
  const capacity = team ? teamDetails[0]?.data?.capacity_sp_per_sprint : undefined
  const query = (q ?? '').trim().toLowerCase()
  const filtered = !!(team || decision || query || onlyRisk)

  const match = (t: { task_id: string; decision: string; team_id: string; summary: string }) =>
    (!team || t.team_id === team) &&
    (!decision || t.decision === decision) &&
    (!onlyRisk || riskById.has(t.task_id)) &&
    (!query || t.task_id.toLowerCase().includes(query) || t.summary.toLowerCase().includes(query))

  const outside = model.outside.filter(match)
  const sections = [
    ...model.sprints.map((s) => ({ key: s.sprint_no, fixed: fixedSprints.has(s.sprint_no), matches: s.rows.filter(match).length })),
    { key: 0, fixed: false, matches: outside.length },
  ]
  const foundTasks = new Set([...model.sprints.flatMap((s) => s.rows.filter(match).map((r) => r.task_id)), ...outside.map((t) => t.task_id)]).size

  // По умолчанию раскрыт только текущий спринт (первый без факта) и «вне квартала»: остальное — сводкой в заголовках.
  // При фильтре раскрыты все секции с совпадениями. Явный выбор пользователя важнее.
  const currentSprint = model.sprints.find((s) => !fixedSprints.has(s.sprint_no) && s.rows.length)?.sprint_no
  const [openState, setOpenState] = useState<Record<number, boolean>>({})
  const defaultOpenFor = (key: number, matches: number) => matches > 0 && (filtered || key === 0 || key === currentSprint)
  const isOpen = (key: number, _fixed: boolean, matches: number) => openState[key] ?? defaultOpenFor(key, matches)
  const toggle = (key: number, fixed: boolean, matches: number) => setOpenState((prev) => ({ ...prev, [key]: !isOpen(key, fixed, matches) }))
  // если открыта хоть одна секция — кнопка сворачивает: так надпись совпадает с тем, что пользователь видит
  const anyOpen = sections.some((x) => isOpen(x.key, x.fixed, x.matches))
  const setAll = (value: boolean) => setOpenState(Object.fromEntries(sections.map((x) => [x.key, value])))

  return (
    <>
      <div className="toolbar" role="search">
        <SearchInput placeholder="Ключ или название" value={q ?? ''} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} aria-label="Поиск задач" />
        <Select aria-label="Команда" value={team ?? ''} onChange={(e) => setTeam(e.target.value)} options={[{ value: '', label: 'Все команды' }, ...teams.map((t) => ({ value: t, label: t }))]} />
        <Select
          aria-label="Решение"
          value={decision ?? ''}
          onChange={(e) => setDecision(e.target.value)}
          options={[{ value: '', label: 'Любое решение' }, ...Object.entries(DECISION_LABEL).map(([value, label]) => ({ value, label }))]}
        />
        <Checkbox label="Только с риском Bus Factor" checked={!!onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked ? '1' : null)} />
        <div className="toolbar__end">
          {filtered && (
            <>
              <span className="muted tabular" style={{ fontSize: 'var(--text-xs)' }} aria-live="polite">
                Найдено: {tasksWord(foundTasks)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => { setTeam(null); setDecision(null); setQ(null); setOnlyRisk(null); setOpenState({}) }}>
                Сбросить
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setAll(!anyOpen)}>
            {anyOpen ? 'Свернуть все' : 'Развернуть все'}
          </Button>
        </div>
      </div>

      <div className="groups">
        {/* «Вне квартала» — первым: это главный вопрос к плану, а не хвост списка */}
        {model.outside.length > 0 && (
        <Group
          open={isOpen(0, false, outside.length)}
          onToggle={() => toggle(0, false, outside.length)}
          title="Не помещаются в квартал"
          sub="не помещаются даже в спринт 6 — решите, отменять ли"
          chips={
            <>
              <Badge plain>{filtered ? `${outside.length} из ${tasksWord(model.outside.length)}` : tasksWord(model.outside.length)}</Badge>
              {model.outside.some((t) => t.decision === 'cancelled_pending') && <Badge tone="pending">ждут подтверждения отмены</Badge>}
            </>
          }
          aside={<span className="group__sub">решение об отмене — за лидом</span>}
        >
          {outside.length === 0 ? (
            <div className="group__empty">{filtered ? 'Нет задач под фильтр' : 'Все задачи помещаются в квартал'}</div>
          ) : (
            <OutsideTable rows={outside} selectedId={selectedId} onSelect={onSelect} />
          )}
        </Group>
        )}
        {model.sprints.map((s) => {
          const rows = s.rows.filter(match)
          const scope = team ? s.rows.filter((r) => r.team_id === team) : s.rows
          const planned = scope.filter((r) => r.decision !== 'done_actual')
          const done = scope.filter((r) => r.decision === 'done_actual')
          const sp = planned.reduce((a, r) => a + (r.step_points_sp ?? 0), 0)
          const riskCount = new Set(planned.filter((r) => riskById.has(r.task_id)).map((r) => r.task_id)).size
          const fixed = fixedSprints.has(s.sprint_no)
          return (
            <Group
              key={s.sprint_no}
              open={isOpen(s.sprint_no, fixed, rows.length)}
              onToggle={() => toggle(s.sprint_no, fixed, rows.length)}
              title={`Спринт ${s.sprint_no}`}
              sub={sprintWeeks(s.sprint_no)}
              chips={
                <>
                  {fixed ? <Badge tone="done">факт загружен · выполнено {done.length}</Badge> : <Badge plain>{filtered ? `${rows.length} из ${tasksWord(s.rows.length)}` : tasksWord(s.rows.length)}</Badge>}
                  {riskCount > 0 && <Badge plain>с одним носителем: {riskCount}</Badge>}
                </>
              }
              aside={fixed ? <span className="group__sub">закрыт</span> : <Meter value={sp} max={capacity} unit=" SP" label={team ? `Загрузка ${team}` : 'Story Points в спринте'} />}
            >
              {rows.length === 0 ? (
                <div className="group__empty">{filtered ? 'Нет задач под фильтр' : fixed ? 'Ни одна задача не отмечена выполненной' : 'В спринте нет задач'}</div>
              ) : (
                <TaskTable rows={rows} riskById={riskById} selectedId={selectedId} onSelect={onSelect} />
              )}
            </Group>
          )
        })}

        {model.outside.length === 0 && (
          <p className="muted" style={{ fontSize: 'var(--text-sm)', padding: '4px 4px 0' }}>
            Все задачи помещаются в квартал.
          </p>
        )}
      </div>
    </>
  )
}

/** Новые строки (после фильтра/пересчёта) проявляются; уже видимые не перерисовываются заново. */
function useEnterClass(ids: string[]) {
  const seen = useRef<Set<string> | null>(null)
  const key = ids.join('|')
  useEffect(() => {
    seen.current = new Set(key.split('|'))
  }, [key])
  return (id: string) => (seen.current && !seen.current.has(id) ? 'is-link row-enter' : 'is-link')
}

function rowKeys(e: React.KeyboardEvent, open: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    open()
  }
}

function TaskTable({ rows, riskById, selectedId, onSelect }: { rows: PlanRow[]; riskById: Map<string, RiskEntry>; selectedId: string | null; onSelect: (id: string) => void }) {
  const cls = useEnterClass(rows.map((r) => r.task_id))
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Ключ</th>
            <th>Задача</th>
            <th>Команда</th>
            <th className="num">SP в спринте</th>
            <th className="num col-optional">Часы (вся задача)</th>
            <th>Решение</th>
            <th className="col-optional">Причина</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const risk = t.decision !== 'done_actual' ? riskById.get(t.task_id) : undefined
            const reason = t.reason === 'разбита между спринтами' ? '' : t.reason
            return (
              <tr key={t.task_id} className={cls(t.task_id)} tabIndex={0} aria-selected={t.task_id === selectedId} data-decision={t.decision} onClick={() => onSelect(t.task_id)} onKeyDown={(e) => rowKeys(e, () => onSelect(t.task_id))}>
                <td className="table-key">{t.task_id}</td>
                <td className="cell-title">
                  {t.summary}
                  {(t.parts > 1 || risk) && (
                    <div className="cell-meta">
                      {t.parts > 1 && <span className="muted">часть {t.part} из {t.parts}</span>}
                      {risk && (
                        <span className="risk risk--quiet" title={risk.roles.map((r) => `${r.role}: только ${r.holder}`).join('\n')}>
                          <ShieldAlert aria-hidden /> один носитель: {risk.roles.map((r) => r.role).join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="nowrap">{t.team_id}</td>
                <td className="num tabular">{t.decision === 'done_actual' ? <span className="cell-muted">—</span> : fmtSp(t.step_points_sp)}</td>
                <td className="num tabular col-optional">{fmt(sumHours(t.role_hours))}</td>
                <td>
                  <DecisionBadge decision={t.decision} />
                </td>
                <td className="cell-reason col-optional">{reason || <span className="cell-muted">—</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function OutsideTable({ rows, selectedId, onSelect }: { rows: TaskSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const cls = useEnterClass(rows.map((r) => r.task_id))
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Ключ</th>
            <th>Задача</th>
            <th>Команда</th>
            <th className="num">Оценка SP</th>
            <th>Решение</th>
            <th>Почему не помещается</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.task_id} className={cls(n.task_id)} tabIndex={0} aria-selected={n.task_id === selectedId} data-decision={n.decision} onClick={() => onSelect(n.task_id)} onKeyDown={(e) => rowKeys(e, () => onSelect(n.task_id))}>
              <td className="table-key">{n.task_id}</td>
              <td className="cell-title">{n.summary || '—'}</td>
              <td className="nowrap">{n.team_id || '—'}</td>
              <td className="num tabular">{fmt(n.estimation_sp)}</td>
              <td>
                <DecisionBadge decision={n.decision} />
              </td>
              <td className="cell-reason">{n.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
