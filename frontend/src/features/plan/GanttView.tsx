import { ArrowDown, ArrowUp, ChevronDown, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { USE_MOCKS } from '@/api/client'
import { Badge, DecisionBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox, SearchInput, Select } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { useTeamDetails } from '@/api/queries'
import { fmt, plural, sprintWeeks } from '@/lib/format'
import { DECISION_LABEL } from '@/lib/labels'
import { SPRINT_NUMBERS, type PlanModel, type PlanRow, type TaskSummary, formatSprints } from '@/lib/planModel'
import { cardKey, loadPlacement, projectedSprint } from '@/lib/ganttOverrides'
import { useParam } from '@/lib/useParam'
import type { RiskEntry } from './busRisk'

interface Props {
  model: PlanModel
  planId: string
  fixedSprints: Set<number>
  readOnly: boolean
  risks: RiskEntry[]
  selectedId: string | null
  onSelect: (taskId: string) => void
}

type TaskOrder = Record<string, string[]>
const orderKeyFor = (planId: string) => `quarter-gantt-order:${planId}`
const countLabel = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`
const fmtSp = (value: number | null) => value !== null && value >= 0 && value < 0.05 ? '<0,1' : fmt(value)

function loadOrder(planId: string): TaskOrder {
  try { return JSON.parse(localStorage.getItem(orderKeyFor(planId)) ?? '{}') as TaskOrder }
  catch { return {} }
}

function persistOrder(planId: string, value: TaskOrder) {
  try {
    if (Object.keys(value).length) localStorage.setItem(orderKeyFor(planId), JSON.stringify(value))
    else localStorage.removeItem(orderKeyFor(planId))
  }
  catch { /* При недоступном хранилище работает состояние вкладки. */ }
}

/** Гант по задачам: причины, решения, карточки, порядок в спринт-панели. Редактор раскладки — в «Ролях по спринтам». */
export function GanttView({ model, planId, risks, selectedId, onSelect }: Props) {
  const [team, setTeam] = useParam('team')
  const [decision, setDecision] = useParam('decision')
  const [q, setQ] = useParam('q')
  const [onlyRisk, setOnlyRisk] = useParam('risk')
  const [sprintParam, setSprintParam] = useParam('sprint')
  // Раскладка делается в «Ролях по спринтам»; здесь её только отображаем
  const placement = useMemo(() => (USE_MOCKS ? loadPlacement(planId) : {}), [planId])
  const [taskOrder, setTaskOrder] = useState<TaskOrder>(() => USE_MOCKS ? loadOrder(planId) : {})
  const [collapsedTeams, setCollapsedTeams] = useState<string[]>([])
  const sprintNumber = Number(sprintParam)
  const selectedSprint = SPRINT_NUMBERS.includes(sprintNumber) ? sprintNumber : null
  const openSprint = (number: number) => setSprintParam(String(number))
  const closeSprint = () => setSprintParam(null)
  const openTask = (id: string) => { closeSprint(); onSelect(id) }
  useEffect(() => {
    if (!USE_MOCKS) return
    setTaskOrder(loadOrder(planId))
    setCollapsedTeams([])
  }, [planId])
  const riskById = useMemo(() => new Map(risks.map((risk) => [risk.task.task_id, risk])), [risks])
  const teams = useMemo(() => [...new Set([...model.tasks.values()].map((task) => task.team_id).filter(Boolean))].sort(), [model])
  const teamDetails = useTeamDetails(teams)
  const capacityByTeam = new Map(teamDetails.map((result, index) => [teams[index], result.data]))
  const query = (q ?? '').trim().toLowerCase()
  const filtered = !!(team || decision || query || onlyRisk)
  const tasks = [...model.tasks.values()].filter((task) => task.sprints.length)
  const projected = (task: TaskSummary, row: PlanRow) => projectedSprint(placement, task.task_id, row)
  const occupies = (task: TaskSummary, n: number) => task.rows.some((row) => projected(task, row) === n)
  const matches = (task: TaskSummary) =>
    (!team || task.team_id === team) && (!decision || task.decision === decision) &&
    (!onlyRisk || riskById.has(task.task_id)) &&
    (!query || `${task.task_id} ${task.summary}`.toLowerCase().includes(query))
  const visible = tasks.filter(matches)
  const groups = teams.map((id) => {
    const items = visible.filter((task) => task.team_id === id).sort((a, b) => Math.min(...a.rows.map((row) => projected(a, row))) - Math.min(...b.rows.map((row) => projected(b, row))) || a.task_id.localeCompare(b.task_id))
    return { id, items, detail: capacityByTeam.get(id) }
  }).filter((group) => group.items.length)
  const moveInGroup = (group: { id: string; items: TaskSummary[] }, index: number, direction: -1 | 1) => {
    const next = group.items.map((task) => task.task_id)
    const other = index + direction
    if (other < 0 || other >= next.length) return
    ;[next[index], next[other]] = [next[other], next[index]]
    const value = { ...taskOrder, [`${selectedSprint}:${group.id}`]: next }
    setTaskOrder(value)
    persistOrder(planId, value)
  }
  const activeCount = selectedSprint ? visible.filter((task) => occupies(task, selectedSprint)).length : 0
  const outside = model.outside.filter(matches)
  const orderChanged = Object.keys(taskOrder).length

  return (
    <>
      <div className="toolbar" role="search">
        <SearchInput placeholder="Ключ или название" value={q ?? ''} onChange={(event) => setQ(event.target.value)} style={{ width: 220 }} aria-label="Поиск задач" />
        <Select aria-label="Команда" value={team ?? ''} onChange={(event) => setTeam(event.target.value)} options={[{ value: '', label: 'Все команды' }, ...teams.map((value) => ({ value, label: value }))]} />
        <Select aria-label="Решение" value={decision ?? ''} onChange={(event) => setDecision(event.target.value)} options={[{ value: '', label: 'Любое решение' }, ...Object.entries(DECISION_LABEL).map(([value, label]) => ({ value, label }))]} />
        <Checkbox label="Риск Bus Factor" checked={!!onlyRisk} onChange={(event) => setOnlyRisk(event.target.checked ? '1' : null)} />
        <div className="toolbar__end">
          {filtered && <Button size="sm" variant="ghost" onClick={() => { setTeam(null); setDecision(null); setQ(null); setOnlyRisk(null) }}>Сбросить фильтры</Button>}
          {orderChanged > 0 && <Button size="sm" variant="ghost" onClick={() => { setTaskOrder({}); persistOrder(planId, {}) }}>Сбросить порядок</Button>}
        </div>
      </div>

      <div className="gantt-section-head">
        <div><h2>Диаграмма Ганта</h2><span>{countLabel(visible.length)} · 6 спринтов квартала · причины решений в карточках задач</span></div>
        <div className="gantt-feedback">
          <span role="status" aria-live="polite">Ручные переносы задач — во вкладке «Роли по спринтам»</span>
        </div>
      </div>
      <div className="gantt-scroll" role="region" aria-label="Диаграмма задач всего квартала" tabIndex={0}>
        <div className="gantt">
          <div className="gantt__head">
            <div className="gantt__corner">Команды и задачи</div>
            {SPRINT_NUMBERS.map((number) => <button key={number} type="button" className="gantt__head-cell" aria-expanded={selectedSprint === number} aria-label={`Открыть спринт ${number}, ${sprintWeeks(number)} от начала квартала`} onClick={() => openSprint(number)}><b>Спринт {number}</b><small>{sprintWeeks(number)}</small></button>)}
          </div>
          {groups.length ? groups.map((group) => <div className="gantt__group" key={group.id}>
            <div className="gantt__team-row">
              <button type="button" className="gantt__team-toggle" aria-expanded={!collapsedTeams.includes(group.id)} onClick={() => setCollapsedTeams((before) => before.includes(group.id) ? before.filter((id) => id !== group.id) : [...before, group.id])}>
                <ChevronDown aria-hidden className="gantt__team-chevron" />
                <span className="gantt__team-label"><strong>{group.id}</strong><small>{countLabel(group.items.length)} · {group.detail?.members.length == null ? 'состав загружается' : `${group.detail.members.length} ${plural(group.detail.members.length, 'человек', 'человека', 'человек')}`}</small></span>
              </button>
              {SPRINT_NUMBERS.map((number) => {
                const points = tasks.filter((task) => task.team_id === group.id).flatMap((task) => task.rows.filter((row) => projected(task, row) === number && row.decision !== 'done_actual').map((row) => row.step_points_sp ?? 0)).reduce((sum, value) => sum + value, 0)
                const capacity = group.detail?.capacity_sp_per_sprint
                return <div className="gantt__team-cell" key={number} title={`${group.id}, спринт ${number}: ${fmt(points)} SP${capacity == null ? '' : ` из ${fmt(capacity)} SP доступно`}`}>
                  <span>{fmt(points)}{capacity == null ? '' : ` / ${fmt(capacity)}`} SP</span>
                  {capacity != null && capacity > 0 && <i aria-hidden style={{ width: `${Math.min(100, points / capacity * 100)}%` }} data-over={points > capacity || undefined} />}
                </div>
              })}
            </div>
            {!collapsedTeams.includes(group.id) && group.items.map((task) => (
              <div className="gantt__row" key={task.task_id} data-gantt-row={task.task_id} data-selected={selectedId === task.task_id || undefined}>
                <div className="gantt__task">
                  <button className="gantt__task-main" type="button" title={task.summary} onClick={() => openTask(task.task_id)} aria-label={`Открыть задачу ${task.task_id}: ${task.summary}`}>
                    <span className="gantt__task-key">{task.task_id}</span><span className="gantt__task-title">{task.summary}</span>
                  </button>
                  <div className="gantt__task-meta"><DecisionBadge decision={task.decision} />
                    {riskById.has(task.task_id) && task.decision !== 'done_actual' && <span title="Риск Bus Factor"><ShieldAlert aria-label="Риск Bus Factor" /></span>}
                  </div>
                </div>
                <div className="gantt__track" aria-label={`${task.task_id}: спринты ${formatSprints(task.rows.map((row) => projected(task, row)))}`}>
                  {SPRINT_NUMBERS.map((number) => <span key={number} className="gantt__cell" style={{ gridColumn: number }} aria-hidden />)}
                  {task.rows.map((row) => {
                    const number = projected(task, row)
                    const key = cardKey(task.task_id, row)
                    return <button key={key} type="button" className="gantt__bar" data-done={row.decision === 'done_actual' || undefined}
                      style={{ gridColumn: number, gridRow: 1 }}
                      title={`${task.task_id} · спринт ${number}${task.rows.length > 1 ? ` · часть ${row.part} из ${row.parts}` : ''} · ${row.decision === 'done_actual' ? 'факт' : `${fmtSp(row.step_points_sp)} SP — объём работы в этом спринте`}`}
                      aria-label={`${task.task_id}, спринт ${number}${task.rows.length > 1 ? `, часть ${row.part} из ${row.parts}` : ''}. Открыть карточку задачи`}
                      onClick={() => openTask(task.task_id)}>
                      <span className="gantt__bar-id">{task.task_id}</span><span className="gantt__bar-detail"><span>{task.rows.length > 1 ? `Часть ${row.part}` : `Спринт ${number}`}</span><small>{row.decision === 'done_actual' ? 'факт' : `${fmtSp(row.step_points_sp)} SP`}</small></span>
                    </button>
                  })}
                </div>
              </div>
            ))}</div>) : <p className="gantt__empty">{filtered ? 'По фильтрам нет задач.' : 'В квартале нет задач.'}</p>}
        </div>
      </div>

      {outside.length > 0 && <div className="gantt-outside"><div className="gantt-outside__head"><strong>Вне квартала</strong><Badge plain>{countLabel(outside.length)}</Badge></div>
        {outside.map((task) => <button key={task.task_id} type="button" className="gantt-outside__item" onClick={() => openTask(task.task_id)}><span className="gantt__task-key">{task.task_id}</span><span>{task.summary}</span><DecisionBadge decision={task.decision} /><small>{task.reason}</small></button>)}
      </div>}

      <Panel contentKey={selectedSprint ? `sprint:${selectedSprint}` : null} onClose={closeSprint} eyebrow={selectedSprint ? `Квартал · ${sprintWeeks(selectedSprint)}` : undefined} title={selectedSprint ? `Спринт ${selectedSprint}` : undefined}>
        {selectedSprint && <div className="gantt-detail">
          <div className="gantt-detail__summary"><strong>{countLabel(activeCount)}</strong><span>Задачи сгруппированы по командам. SP — оценка работы в спринте.</span></div>
          {groups.map((group) => {
            const savedOrder = taskOrder[`${selectedSprint}:${group.id}`] ?? []
            const items = group.items.filter((task) => occupies(task, selectedSprint)).sort((a, b) => {
              const ai = savedOrder.indexOf(a.task_id)
              const bi = savedOrder.indexOf(b.task_id)
              if (ai !== -1 || bi !== -1) return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi)
              return a.task_id.localeCompare(b.task_id)
            })
            if (!items.length) return null
            const points = items.flatMap((task) => task.rows.filter((row) => projected(task, row) === selectedSprint && row.decision !== 'done_actual').map((row) => row.step_points_sp ?? 0)).reduce((sum, value) => sum + value, 0)
            const capacity = group.detail?.capacity_sp_per_sprint
            return <section className="gantt-detail__team" key={group.id}>
              <div className="gantt-detail__team-head"><strong>{group.id}</strong><span>{countLabel(items.length)} · {group.detail?.members.length == null ? 'состав загружается' : `${group.detail.members.length} ${plural(group.detail.members.length, 'человек', 'человека', 'человек')}`}</span><small>{fmt(points)}{capacity == null ? '' : ` / ${fmt(capacity)}`} SP · {capacity == null ? 'запланировано' : 'запланировано / доступно'}</small></div>
              <ol className="gantt-detail__tasks">{items.map((task, index) => {
                const row = task.rows.find((item) => projected(task, item) === selectedSprint)!
                return <li key={task.task_id} className="gantt-detail__task">
                  <span className="gantt-detail__order">{index + 1}</span>
                  <button type="button" className="gantt-detail__task-link" onClick={() => openTask(task.task_id)}><strong>{task.task_id}</strong><span>{task.summary}</span></button>
                  <span className="gantt-detail__allocation">{row.parts > 1 ? `Часть ${row.part} из ${row.parts}` : 'Вся задача'} · {row.decision === 'done_actual' ? 'факт' : `${fmtSp(row.step_points_sp)} SP`}</span>
                  {items.length > 1 && <span className="gantt__order-actions"><button type="button" aria-label={`Поднять ${task.task_id} выше`} title="Поднять задачу выше" disabled={index === 0} onClick={() => moveInGroup({ ...group, items }, index, -1)}><ArrowUp aria-hidden /></button><button type="button" aria-label={`Опустить ${task.task_id} ниже`} title="Опустить задачу ниже" disabled={index === items.length - 1} onClick={() => moveInGroup({ ...group, items }, index, 1)}><ArrowDown aria-hidden /></button></span>}
                </li>
              })}</ol>
            </section>
          })}
          <p className="gantt-detail__note">Стрелки меняют порядок внутри спринта (локально). Для приоритета расчёта используйте вкладку «Приоритеты», для переносов — «Роли по спринтам».</p>
        </div>}
      </Panel>
    </>
  )
}
