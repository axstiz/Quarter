import { ArrowDown, ArrowUp, ChevronDown, RotateCcw, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { USE_MOCKS } from '@/api/client'
import { Badge, DecisionBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox, SearchInput, Select } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { useTeamDetails } from '@/api/queries'
import { fmt, plural, sprintWeeks } from '@/lib/format'
import { DECISION_LABEL } from '@/lib/labels'
import { formatSprints, SPRINT_NUMBERS, type PlanModel, type PlanRow, type TaskSummary } from '@/lib/planModel'
import { cardKey as baseCardKey, loadPlacement, persistPlacement, projectedSprint, type Placement } from '@/lib/ganttOverrides'
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
const cardKey = (task: TaskSummary, row: PlanRow) => baseCardKey(task.task_id, row)
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

export function GanttView({ model, planId, fixedSprints, readOnly, risks, selectedId, onSelect }: Props) {
  const [team, setTeam] = useParam('team')
  const [decision, setDecision] = useParam('decision')
  const [q, setQ] = useParam('q')
  const [onlyRisk, setOnlyRisk] = useParam('risk')
  const [sprintParam, setSprintParam] = useParam('sprint')
  const [placement, setPlacement] = useState<Placement>(() => USE_MOCKS ? loadPlacement(planId) : {})
  const [taskOrder, setTaskOrder] = useState<TaskOrder>(() => USE_MOCKS ? loadOrder(planId) : {})
  const [collapsedTeams, setCollapsedTeams] = useState<string[]>([])
  const sprintNumber = Number(sprintParam)
  const selectedSprint = SPRINT_NUMBERS.includes(sprintNumber) ? sprintNumber : null
  const [moveId, setMoveId] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ key: string; id: string; from: number; target: number; originX: number; dx: number } | null>(null)
  const [flight, setFlight] = useState<{ key: string; id: string; target: number; dx: number } | null>(null)
  const [arrived, setArrived] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const [lastMove, setLastMove] = useState<{ key: string; id: string; from: number; target: number } | null>(null)
  const moveTimer = useRef<number | null>(null)
  const suppressClick = useRef<string | null>(null)
  const openSprint = (number: number) => { setMoveId(null); setSprintParam(String(number)) }
  const closeSprint = () => setSprintParam(null)
  const openTask = (id: string) => { closeSprint(); onSelect(id) }
  useEffect(() => () => {
    if (moveTimer.current !== null) window.clearTimeout(moveTimer.current)
  }, [])
  useEffect(() => {
    if (moveTimer.current !== null) window.clearTimeout(moveTimer.current)
    setPlacement(USE_MOCKS ? loadPlacement(planId) : {})
    setTaskOrder(USE_MOCKS ? loadOrder(planId) : {})
    setCollapsedTeams([])
    setDrag(null)
    setFlight(null)
    setArrived(null)
    setLastMove(null)
    setFeedback(null)
  }, [planId])
  const riskById = useMemo(() => new Map(risks.map((risk) => [risk.task.task_id, risk])), [risks])
  const teams = useMemo(() => [...new Set([...model.tasks.values()].map((task) => task.team_id).filter(Boolean))].sort(), [model])
  const teamDetails = useTeamDetails(teams)
  const capacityByTeam = new Map(teamDetails.map((result, index) => [teams[index], result.data]))
  const canEdit = USE_MOCKS && !readOnly
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
  const changed = Object.keys(placement).length
  const orderChanged = Object.keys(taskOrder).length

  const movable = (task: TaskSummary, row: PlanRow) => canEdit && row.decision === 'planned' && !fixedSprints.has(projected(task, row))
  const validTarget = (task: TaskSummary, row: PlanRow, target: number) =>
    SPRINT_NUMBERS.includes(target) && !fixedSprints.has(target) &&
    !task.rows.some((other) => other !== row && projected(task, other) === target)
  const invalidReason = (task: TaskSummary, row: PlanRow, target: number) => {
    if (!SPRINT_NUMBERS.includes(target)) return 'Вне квартала'
    if (fixedSprints.has(target)) return 'Спринт закрыт по факту'
    if (task.rows.some((other) => other !== row && projected(task, other) === target)) return 'Здесь уже есть карточка этой задачи'
    return 'Перенос недоступен'
  }
  const showFeedback = (text: string, error = false) => {
    setFeedback({ text, error })
  }
  const move = (task: TaskSummary, row: PlanRow, target: number, releaseDx = 0) => {
    if (!movable(task, row) || flight || target === projected(task, row)) return
    if (!validTarget(task, row, target)) {
      showFeedback(`${task.task_id}: ${invalidReason(task, row, target)}`, true)
      return
    }

    // Двигается только выбранная часть задачи; остальные остаются в своих спринтах.
    setArrived(null)
    setLastMove(null)
    const from = projected(task, row)
    const key = cardKey(task, row)
    setFlight({ key, id: task.task_id, target, dx: releaseDx })
    setFeedback({ text: `${task.task_id} · часть ${row.part} → спринт ${target}` })
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    moveTimer.current = window.setTimeout(() => {
      const next = { ...placement }
      if (target === row.sprint_no) delete next[key]
      else next[key] = target
      setPlacement(next)
      persistPlacement(planId, next)
      setMoveId(null)
      setFlight(null)
      setArrived(key)
      setLastMove({ key, id: task.task_id, from, target })
      showFeedback(`${task.task_id} · часть ${row.part} теперь в спринте ${target}`)
    }, reducedMotion ? 0 : 360)
  }
  const reset = () => { setPlacement({}); persistPlacement(planId, {}); setFeedback({ text: 'Раскладка сброшена' }); setLastMove(null); setArrived(null) }

  return (
    <>
      <div className="toolbar" role="search">
        <SearchInput placeholder="Ключ или название" value={q ?? ''} onChange={(event) => setQ(event.target.value)} style={{ width: 220 }} aria-label="Поиск задач" />
        <Select aria-label="Команда" value={team ?? ''} onChange={(event) => setTeam(event.target.value)} options={[{ value: '', label: 'Все команды' }, ...teams.map((value) => ({ value, label: value }))]} />
        <Select aria-label="Решение" value={decision ?? ''} onChange={(event) => setDecision(event.target.value)} options={[{ value: '', label: 'Любое решение' }, ...Object.entries(DECISION_LABEL).map(([value, label]) => ({ value, label }))]} />
        <Checkbox label="Риск Bus Factor" checked={!!onlyRisk} onChange={(event) => setOnlyRisk(event.target.checked ? '1' : null)} />
        <div className="toolbar__end">
          {filtered && <Button size="sm" variant="ghost" onClick={() => { setTeam(null); setDecision(null); setQ(null); setOnlyRisk(null) }}>Сбросить фильтры</Button>}
          {canEdit && orderChanged > 0 && <Button size="sm" variant="ghost" disabled={!!flight} onClick={() => { setTaskOrder({}); persistOrder(planId, {}) }}>Сбросить порядок</Button>}
          {canEdit && changed > 0 && <Button size="sm" variant="secondary" icon={<RotateCcw />} disabled={!!flight} onClick={reset}>Сбросить переносы · {changed}</Button>}
        </div>
      </div>

      <div className="gantt-section-head">
        <div><h2>Диаграмма Ганта</h2><span>{countLabel(visible.length)} · 6 спринтов квартала</span></div>
        <div className="gantt-feedback" data-error={feedback?.error || undefined}>
          <span role="status" aria-live="polite">{drag ? (() => { const task = model.tasks.get(drag.id)!; const row = task.rows.find((item) => cardKey(task, item) === drag.key)!; return SPRINT_NUMBERS.includes(drag.target) ? `Часть ${row.part} из ${row.parts} → спринт ${drag.target}${validTarget(task, row, drag.target) ? ' · отпустите' : ` · ${invalidReason(task, row, drag.target)}`}` : 'Отпустите карточку внутри шкалы спринтов' })() : feedback?.text ?? 'Нажмите заголовок спринта для подробностей'}</span>
          {lastMove && feedback && !drag && <button type="button" onClick={() => openSprint(lastMove.target)}>Открыть спринт {lastMove.target}</button>}
          {lastMove && feedback && !drag && <button type="button" onClick={() => { const task = model.tasks.get(lastMove.id); const row = task?.rows.find((item) => cardKey(task, item) === lastMove.key); if (task && row) move(task, row, lastMove.from) }}>Вернуть</button>}
        </div>
      </div>
      <div className="gantt-scroll" role="region" aria-label="Диаграмма задач всего квартала" tabIndex={0}>
        <div className="gantt">
          <div className="gantt__head">
            <div className="gantt__corner">Команды и задачи</div>
            {SPRINT_NUMBERS.map((number) => <button key={number} type="button" className="gantt__head-cell" data-target={(drag?.target === number || flight?.target === number || lastMove?.target === number) || undefined} aria-expanded={selectedSprint === number} aria-label={`Открыть спринт ${number}, ${sprintWeeks(number)} от начала квартала`} onClick={() => openSprint(number)}><b>Спринт {number}</b><small>{sprintWeeks(number)}</small></button>)}
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
            {!collapsedTeams.includes(group.id) && group.items.map((task) => {
            const picked = task.rows.find((row) => cardKey(task, row) === moveId)
            const preview = drag?.id === task.task_id ? drag : flight?.id === task.task_id ? flight : null
            const previewRow = preview ? task.rows.find((row) => cardKey(task, row) === preview.key) : null
            const previewTarget = preview?.target
            return <div className="gantt__row" key={task.task_id} data-gantt-row={task.task_id} data-picker={!!picked || undefined} data-selected={selectedId === task.task_id || undefined}>
              <div className="gantt__task">
                <button className="gantt__task-main" type="button" title={task.summary} onClick={() => openTask(task.task_id)} aria-label={`Открыть задачу ${task.task_id}: ${task.summary}`}>
                  <span className="gantt__task-key">{task.task_id}</span><span className="gantt__task-title">{task.summary}</span>
                </button>
                <div className="gantt__task-meta"><DecisionBadge decision={task.decision} />
                  {riskById.has(task.task_id) && task.decision !== 'done_actual' && <span title="Риск Bus Factor"><ShieldAlert aria-label="Риск Bus Factor" /></span>}
                </div>
                {picked && <div className="gantt__picker" role="group" aria-label={`Перенос части ${picked.part} задачи ${task.task_id}`}><span>Часть {picked.part} из {picked.parts} · {fmtSp(picked.step_points_sp)} SP</span>
                  <Select aria-label={`Спринт назначения для ${task.task_id}, часть ${picked.part}`} value={String(projected(task, picked))} onChange={(event) => move(task, picked, Number(event.target.value))}
                    options={SPRINT_NUMBERS.filter((number) => validTarget(task, picked, number)).map((number) => ({ value: String(number), label: `Спринт ${number}` }))} />
                </div>}
              </div>
              <div className="gantt__track" aria-label={`${task.task_id}: спринты ${formatSprints(task.rows.map((row) => projected(task, row)))}`}>
                {SPRINT_NUMBERS.map((number) => <span key={number} className="gantt__cell" style={{ gridColumn: number }} aria-hidden />)}
                {preview && previewRow && previewTarget !== undefined && SPRINT_NUMBERS.includes(previewTarget) && previewTarget !== projected(task, previewRow) && <span className="gantt__ghost" data-invalid={!validTarget(task, previewRow, previewTarget) || undefined} data-flight={flight?.key === preview.key || undefined} style={{ gridColumn: previewTarget, gridRow: 1 }} aria-hidden><span className="gantt__bar-id">{task.task_id}</span><span className="gantt__bar-detail"><span>{previewRow.parts > 1 ? `Часть ${previewRow.part}` : `Спринт ${previewTarget}`}</span><small>{validTarget(task, previewRow, previewTarget) ? `${fmtSp(previewRow.step_points_sp)} SP` : 'нельзя'}</small></span></span>}
                {task.rows.map((row) => {
                  const number = projected(task, row)
                  const key = cardKey(task, row)
                  return <button key={key} type="button" className="gantt__bar" data-done={row.decision === 'done_actual' || undefined} data-dragging={drag?.key === key || undefined} data-arrived={arrived === key || undefined}
                    disabled={!movable(task, row) || !!flight} data-flying={flight?.key === key || undefined}
                    style={{ gridColumn: number, gridRow: 1, transform: flight?.key === key ? `translateX(${flight.dx}px)` : drag?.key === key ? `translateX(${drag.dx}px)` : undefined }}
                    title={`${task.task_id} · спринт ${number}${task.rows.length > 1 ? ` · часть ${row.part} из ${row.parts}` : ''} · ${row.decision === 'done_actual' ? 'факт' : `${fmtSp(row.step_points_sp)} SP — объём работы в этом спринте`}`}
                    aria-label={`${task.task_id}, спринт ${number}${task.rows.length > 1 ? `, часть ${row.part} из ${row.parts}` : ''}. ${movable(task, row) ? 'Перетащить или нажать для переноса этой части' : 'Перенос недоступен'}`}
                    onPointerDown={(event) => {
                      if (!movable(task, row) || (event.pointerType === 'mouse' && event.button !== 0)) return
                      event.currentTarget.setPointerCapture(event.pointerId)
                      setDrag({ key, id: task.task_id, from: number, target: number, originX: event.clientX, dx: 0 })
                    }}
                    onPointerMove={(event) => { if (drag?.key === key) setDrag({ ...drag, target: pointerSprint(event), dx: event.clientX - drag.originX }) }}
                    onPointerUp={(event) => {
                      if (drag?.key !== key) return
                      const target = pointerSprint(event)
                      setDrag(null)
                      if (Math.abs(event.clientX - drag.originX) >= 6) { suppressClick.current = key; move(task, row, target, event.clientX - drag.originX) }
                    }} onPointerCancel={() => setDrag(null)} onClick={() => { if (suppressClick.current === key) { suppressClick.current = null; return } setMoveId(moveId === key ? null : key) }}>
                    <span className="gantt__bar-id">{task.task_id}</span><span className="gantt__bar-detail"><span>{task.rows.length > 1 ? `Часть ${row.part}` : `Спринт ${number}`}</span><small>{row.decision === 'done_actual' ? 'факт' : `${fmtSp(row.step_points_sp)} SP`}</small></span>
                  </button>
                })}
              </div>
            </div>
          })}</div>) : <p className="gantt__empty">{filtered ? 'По фильтрам нет задач.' : 'В квартале нет задач.'}</p>}
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
                  {canEdit && !filtered && items.length > 1 && <span className="gantt__order-actions"><button type="button" aria-label={`Поднять ${task.task_id} выше`} title="Поднять задачу выше" disabled={index === 0} onClick={() => moveInGroup({ ...group, items }, index, -1)}><ArrowUp aria-hidden /></button><button type="button" aria-label={`Опустить ${task.task_id} ниже`} title="Опустить задачу ниже" disabled={index === items.length - 1} onClick={() => moveInGroup({ ...group, items }, index, 1)}><ArrowDown aria-hidden /></button></span>}
                </li>
              })}</ol>
            </section>
          })}
          {canEdit && <p className="gantt-detail__note">Стрелки меняют порядок на экране. Для изменения приоритета расчёта используйте вкладку «Приоритеты».</p>}
        </div>}
      </Panel>
    </>
  )
}

function pointerSprint(event: PointerEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.parentElement!.getBoundingClientRect()
  return Math.floor((event.clientX - rect.left) / (rect.width / 6)) + 1
}
