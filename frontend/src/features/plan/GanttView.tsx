import { ArrowRight, Check, ChevronDown, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { USE_MOCKS } from '@/api/client'
import { useTeamDetails } from '@/api/queries'
import { DecisionBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox, SearchInput, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { fmt, plural, sprintWeeks } from '@/lib/format'
import { DECISION_LABEL } from '@/lib/labels'
import { SPRINT_NUMBERS, isPartial, type PlanModel, type TaskSummary, formatSprints } from '@/lib/planModel'
import { loadPlacement, projectedSprint } from '@/lib/ganttOverrides'
import { useParam } from '@/lib/useParam'
import type { PlanBusRisk } from '@/api/types'

interface Props {
  model: PlanModel
  planId: string
  planRisk: PlanBusRisk | undefined
  /** Задача → спринт, в факте которого она отмечена выполненной (выполненная задача закрывается целиком) */
  factSprintOf: Map<string, number>
  selectedId: string | null
  onSelect: (taskId: string) => void
}

type GroupBy = 'initiative' | 'team'
const NO_INITIATIVE = '—'
const countLabel = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`
const fmtSp = (value: number | null) => (value !== null && value >= 0 && value < 0.05 ? '<0,1' : fmt(value))
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)

/** Итог по инициативе: сколько её задач попало в квартал целиком, частично и не попало. */
function initiativeStatus(items: TaskSummary[]) {
  const done = items.filter((x) => x.decision === 'done_actual').length
  const partial = items.filter((x) => x.sprints.length && isPartial(x)).length
  const inPlan = items.filter((x) => x.sprints.length).length
  const total = items.length
  const parts = (full: number) => [done && `${done} выполнено`, full && `${full} успеют`, partial && `${partial} не успеют целиком`, inPlan < total && `${total - inPlan} вне квартала`].filter(Boolean).join(' · ')
  if (done === total) return { mark: '✓', tone: 'done', text: 'инициатива выполнена' }
  if (inPlan === total && !partial) return { mark: '✓', tone: 'plan', text: `успеет в квартал · ${parts(inPlan - done)}` }
  if (!inPlan) return { mark: '✕', tone: 'over', text: 'не попала в квартал' }
  return { mark: '◐', tone: 'shift', text: `под угрозой · ${parts(inPlan - partial - done)}` }
}

/**
 * Диаграмма Ганта квартала (спека ui, «План как диаграмма Ганта»): одна полоса на задачу от первого до последнего
 * спринта размещения, части — сегменты полосы с долями SP; не попавшее в квартал — в колонке справа от шкалы с причиной.
 * Строки группируются по инициативам (метрика квартала считается по ним) или по командам.
 */
export function GanttView({ model, planId, planRisk, factSprintOf, selectedId, onSelect }: Props) {
  const [groupParam, setGroupParam] = useParam('group')
  const [team, setTeam] = useParam('team')
  const [decision, setDecision] = useParam('decision')
  const [q, setQ] = useParam('q')
  const [onlyRisk, setOnlyRisk] = useParam('risk')
  const groupBy: GroupBy = groupParam === 'team' ? 'team' : 'initiative'
  // Ручная раскладка делается в «Ролях по спринтам»; здесь её только отображаем
  const placement = useMemo(() => (USE_MOCKS ? loadPlacement(planId) : {}), [planId])
  const [collapsed, setCollapsed] = useState<string[]>([])

  // задачи плана с единственным носителем роли — из ручки GET /plans/{id}/bus-risk (020-гейта)
  const riskById = useMemo(() => new Set((planRisk?.tasks ?? []).map((t) => t.task_id)), [planRisk])
  const all = [...model.tasks.values()]
  const teams = [...new Set(all.map((task) => task.team_id).filter(Boolean))].sort()
  const teamDetails = useTeamDetails(teams)
  const capacityByTeam = new Map(teamDetails.map((result, index) => [teams[index], result.data]))

  // Выполненная часть стоит в спринте, где загружен факт: задача закрывается целиком, будущие спринты она не занимает
  const sprintOfRow = (task: TaskSummary, row: TaskSummary['rows'][number]) =>
    row.decision === 'done_actual' ? (factSprintOf.get(task.task_id) ?? projectedSprint(placement, task.task_id, row)) : projectedSprint(placement, task.task_id, row)
  const sprintsOf = (task: TaskSummary) => [...new Set(task.rows.map((row) => sprintOfRow(task, row)))].sort((a, b) => a - b)
  const spIn = (task: TaskSummary, n: number) => sum(task.rows.filter((row) => projectedSprint(placement, task.task_id, row) === n && row.decision !== 'done_actual').map((row) => row.step_points_sp ?? 0))

  const query = (q ?? '').trim().toLowerCase()
  const filtered = !!(team || decision || query || onlyRisk)
  const matches = (task: TaskSummary) =>
    (!team || task.team_id === team) &&
    (!decision || task.decision === decision) &&
    (!onlyRisk || riskById.has(task.task_id)) &&
    (!query || `${task.task_id} ${task.summary} ${task.parent_id ?? ''}`.toLowerCase().includes(query))

  const keyOf = (task: TaskSummary) => (groupBy === 'team' ? task.team_id : (task.parent_id ?? NO_INITIATIVE))
  const firstSprint = (task: TaskSummary) => sprintsOf(task)[0] ?? 99
  const groups = [...new Set(all.map(keyOf))]
    .map((id) => {
      const members = all.filter((task) => keyOf(task) === id)
      const items = members.filter(matches).sort((a, b) => firstSprint(a) - firstSprint(b) || a.task_id.localeCompare(b.task_id))
      return { id, members, items, start: Math.min(...members.map(firstSprint)) }
    })
    .filter((group) => group.items.length)
    .sort((a, b) => (groupBy === 'team' ? a.id.localeCompare(b.id) : a.start - b.start || a.id.localeCompare(b.id)))

  const visibleCount = sum(groups.map((group) => group.items.length))
  const toggleGroup = (id: string) => setCollapsed((before) => (before.includes(id) ? before.filter((x) => x !== id) : [...before, id]))

  return (
    <>
      <div className="toolbar" role="search">
        <Segmented
          label="Группировка строк"
          value={groupBy}
          onChange={(value) => { setGroupParam(value === 'initiative' ? null : value); setCollapsed([]) }}
          items={[
            { value: 'initiative', label: 'Инициативы', hint: 'Метрика квартала считается по инициативам' },
            { value: 'team', label: 'Команды', hint: 'Ёмкость команды в SP по спринтам' },
          ]}
        />
        <SearchInput placeholder="Задача или инициатива" value={q ?? ''} onChange={(event) => setQ(event.target.value)} style={{ width: 220 }} aria-label="Поиск задач" />
        <Select aria-label="Команда" value={team ?? ''} onChange={(event) => setTeam(event.target.value)} options={[{ value: '', label: 'Все команды' }, ...teams.map((value) => ({ value, label: value }))]} />
        <Select aria-label="Решение" value={decision ?? ''} onChange={(event) => setDecision(event.target.value)} options={[{ value: '', label: 'Любое решение' }, ...Object.entries(DECISION_LABEL).map(([value, label]) => ({ value, label }))]} />
        <Checkbox label="Риск Bus Factor" checked={!!onlyRisk} onChange={(event) => setOnlyRisk(event.target.checked ? '1' : null)} />
        {filtered && (
          <div className="toolbar__end">
            <Button size="sm" variant="ghost" onClick={() => { setTeam(null); setDecision(null); setQ(null); setOnlyRisk(null) }}>Сбросить фильтры</Button>
          </div>
        )}
      </div>

      <div className="gantt-section-head">
        <div>
          <h2>Диаграмма Ганта</h2>
          <span>{countLabel(visibleCount)} · полоса — спринты, в которые над задачей работают</span>
        </div>
        <ul className="gantt-legend" aria-label="Обозначения">
          <li><i className="gantt-legend__bar" /> работа в спринте, SP</li>
          <li><i className="gantt-legend__bar" data-done="true" /> выполнена (факт)</li>
          <li><i className="gantt-legend__gap" /> пауза между частями</li>
          <li><ArrowRight aria-hidden /> не успеет — остаток после квартала</li>
        </ul>
      </div>

      <div className="gantt-scroll" role="region" aria-label="Диаграмма Ганта квартала" tabIndex={0}>
        <div className="gantt gantt--timeline">
          <div className="gantt__head">
            <div className="gantt__corner">{groupBy === 'team' ? 'Команды и задачи' : 'Инициативы и задачи'}</div>
            {SPRINT_NUMBERS.map((number) => (
              <div key={number} className="gantt__head-cell"><b>Спринт {number}</b><small>{sprintWeeks(number)}</small></div>
            ))}
            <div className="gantt__head-cell gantt__head-cell--out"><b>Вне квартала</b><small>после нед. 12</small></div>
          </div>

          {groups.length ? groups.map((group) => {
            const open = !collapsed.includes(group.id)
            const status = groupBy === 'initiative' ? initiativeStatus(group.members) : null
            const capacity = groupBy === 'team' ? capacityByTeam.get(group.id)?.capacity_sp_per_sprint : undefined
            const outCount = group.items.filter((task) => !task.sprints.length || isPartial(task)).length
            return (
              <div className="gantt__group" key={group.id}>
                <div className="gantt__team-row">
                  <button type="button" className="gantt__team-toggle" aria-expanded={open} onClick={() => toggleGroup(group.id)}>
                    <ChevronDown aria-hidden className="gantt__team-chevron" />
                    <span className="gantt__team-label">
                      <strong>{group.id === NO_INITIATIVE ? 'Без инициативы' : group.id}</strong>
                      <small>
                        {status ? <span data-tone={status.tone} className="gantt__status">{status.mark} {status.text}</span> : countLabel(group.items.length)}
                      </small>
                    </span>
                  </button>
                  {SPRINT_NUMBERS.map((number) => {
                    // В строке инициативы суммы SP без ёмкости ничего не сообщают — показываем их только по командам
                    if (groupBy === 'initiative') return <div className="gantt__team-cell" key={number} />
                    const points = sum(group.members.map((task) => spIn(task, number)))
                    const over = capacity != null && points > capacity + 1e-9
                    return (
                      <div className="gantt__team-cell" key={number} data-over={over || undefined} title={capacity == null ? `Спринт ${number}: ${fmt(points)} SP` : `${group.id}, спринт ${number}: ${fmt(points)} из ${fmt(capacity)} SP ёмкости`}>
                        <span>{points ? `${fmtSp(points)}${capacity == null ? '' : ` / ${fmt(capacity)}`} SP` : capacity == null ? '' : `0 / ${fmt(capacity)} SP`}</span>
                        {capacity != null && capacity > 0 && <i aria-hidden style={{ width: `${Math.min(100, (points / capacity) * 100)}%` }} data-over={over || undefined} />}
                      </div>
                    )
                  })}
                  <div className="gantt__team-cell gantt__team-cell--out">{outCount ? `${outCount} не успеют целиком` : ''}</div>
                </div>

                {open && group.items.map((task) => {
                  const sprints = sprintsOf(task)
                  const partial = sprints.length > 0 && isPartial(task)
                  const risk = riskById.has(task.task_id) && task.decision !== 'done_actual'
                  return (
                    <div className="gantt__row" key={task.task_id} data-selected={selectedId === task.task_id || undefined}>
                      <div className="gantt__task">
                        <button className="gantt__task-main" type="button" title={task.summary} onClick={() => onSelect(task.task_id)}>
                          <span className="gantt__task-key">{task.task_id}</span>
                          <span className="gantt__task-title">{task.summary}</span>
                        </button>
                        <div className="gantt__task-meta">
                          {task.decision !== 'planned' && <DecisionBadge decision={task.decision} />}
                          {groupBy === 'initiative' ? <span>{task.team_id}</span> : task.parent_id && <span className="mono">{task.parent_id}</span>}
                          {risk && <span className="gantt__risk" title="Риск Bus Factor: роль задачи держится на одном человеке"><ShieldAlert aria-label="Риск Bus Factor" /></span>}
                        </div>
                      </div>

                      <div className="gantt__track" aria-hidden={!sprints.length}>
                        {SPRINT_NUMBERS.map((number) => <span key={number} className="gantt__cell" style={{ gridColumn: number }} />)}
                        {sprints.length > 0 && (
                          <Bar
                            task={task}
                            sprints={sprints}
                            partial={partial}
                            spIn={(n) => spIn(task, n)}
                            doneIn={(n) => task.rows.some((row) => sprintOfRow(task, row) === n && row.decision === 'done_actual')}
                            onOpen={() => onSelect(task.task_id)}
                          />
                        )}
                      </div>

                      <div className="gantt__out">
                        {!sprints.length ? (
                          <button type="button" className="gantt__out-reason" onClick={() => onSelect(task.task_id)} title={task.reason}>
                            {task.reason || DECISION_LABEL[task.decision]}
                          </button>
                        ) : partial ? (
                          <span className="gantt__out-partial"><ArrowRight aria-hidden /> остаток {fmtSp(Math.max(0, task.estimation_sp - task.plannedSp))} SP</span>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          }) : <p className="gantt__empty">{filtered ? 'По фильтрам нет задач.' : 'В квартале нет задач.'}</p>}
        </div>
      </div>
    </>
  )
}

/** Одна полоса через спринты задачи: сегмент на каждую часть с долей SP, пропущенные спринты — пунктирный разрыв. */
function Bar({ task, sprints, partial, spIn, doneIn, onOpen }: { task: TaskSummary; sprints: number[]; partial: boolean; spIn: (n: number) => number; doneIn: (n: number) => boolean; onOpen: () => void }) {
  const from = sprints[0]
  const to = sprints.at(-1)!
  const span = SPRINT_NUMBERS.filter((n) => n >= from && n <= to)
  const allDone = sprints.every(doneIn)
  const label = `${task.task_id}: спринты ${formatSprints(sprints)}${partial ? ', выполнится частично' : ''}. ${sprints.map((n) => `спринт ${n} — ${doneIn(n) ? 'факт' : `${fmtSp(spIn(n))} SP`}`).join('; ')}. Открыть карточку`
  return (
    <button
      type="button"
      className="gantt__bar"
      data-done={allDone || undefined}
      data-partial={partial || undefined}
      style={{ gridColumn: `${from} / ${to + 1}`, gridTemplateColumns: `repeat(${span.length}, minmax(0, 1fr))` }}
      title={label}
      aria-label={label}
      onClick={onOpen}
    >
      {span.map((n) =>
        sprints.includes(n) ? (
          <span key={n} className="gantt__seg" data-done={doneIn(n) || undefined}>
            {doneIn(n) ? <><Check aria-hidden /> выполнена</> : `${fmtSp(spIn(n))} SP`}
          </span>
        ) : (
          <span key={n} className="gantt__seg gantt__seg--gap" />
        ),
      )}
    </button>
  )
}
