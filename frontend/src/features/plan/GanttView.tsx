import { RotateCcw, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { USE_MOCKS } from '@/api/client'
import { Badge, DecisionBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox, SearchInput, Select } from '@/components/ui/Field'
import { fmt, plural, sprintWeeks } from '@/lib/format'
import { DECISION_LABEL } from '@/lib/labels'
import { formatSprints, SPRINT_NUMBERS, type PlanModel, type PlanRow, type TaskSummary } from '@/lib/planModel'
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

type Placement = Record<string, number>
const keyFor = (planId: string) => `quarter-gantt-cards:${planId}`
const cardKey = (task: TaskSummary, row: PlanRow) => `${task.task_id}:${row.sprint_no}`
const countLabel = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`
const fmtSp = (value: number | null) => value !== null && value >= 0 && value < 0.05 ? '<0,1' : fmt(value)

function loadPlacement(planId: string): Placement {
  try { return JSON.parse(localStorage.getItem(keyFor(planId)) ?? '{}') as Placement }
  catch { return {} }
}

function persist(planId: string, value: Placement) {
  try {
    if (Object.keys(value).length) localStorage.setItem(keyFor(planId), JSON.stringify(value))
    else localStorage.removeItem(keyFor(planId))
  } catch { /* При недоступном хранилище работает состояние вкладки. */ }
}

export function GanttView({ model, planId, fixedSprints, readOnly, risks, selectedId, onSelect }: Props) {
  const [team, setTeam] = useParam('team')
  const [decision, setDecision] = useParam('decision')
  const [q, setQ] = useParam('q')
  const [onlyRisk, setOnlyRisk] = useParam('risk')
  const [sprintParam, setSprintParam] = useParam('sprint')
  const [placement, setPlacement] = useState<Placement>(() => USE_MOCKS ? loadPlacement(planId) : {})
  const sprintNumber = Number(sprintParam)
  const sprint = SPRINT_NUMBERS.includes(sprintNumber) ? sprintNumber : SPRINT_NUMBERS.find((n) => !fixedSprints.has(n)) ?? 6
  const [moveId, setMoveId] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ key: string; id: string; from: number; target: number; originX: number; dx: number } | null>(null)
  const [flight, setFlight] = useState<{ key: string; id: string; target: number; dx: number } | null>(null)
  const [arrived, setArrived] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const [lastMove, setLastMove] = useState<{ key: string; id: string; from: number; target: number } | null>(null)
  const moveTimer = useRef<number | null>(null)
  const suppressClick = useRef<string | null>(null)
  const setSprint = (number: number) => { setFeedback(null); setLastMove(null); setArrived(null); setMoveId(null); setSprintParam(String(number)) }
  useEffect(() => () => {
    if (moveTimer.current !== null) window.clearTimeout(moveTimer.current)
  }, [])
  useEffect(() => {
    if (moveTimer.current !== null) window.clearTimeout(moveTimer.current)
    setPlacement(USE_MOCKS ? loadPlacement(planId) : {})
    setDrag(null)
    setFlight(null)
    setArrived(null)
    setLastMove(null)
    setFeedback(null)
  }, [planId])
  const riskById = useMemo(() => new Map(risks.map((risk) => [risk.task.task_id, risk])), [risks])
  const teams = useMemo(() => [...new Set([...model.tasks.values()].map((task) => task.team_id).filter(Boolean))].sort(), [model])
  const canEdit = USE_MOCKS && !readOnly
  const query = (q ?? '').trim().toLowerCase()
  const filtered = !!(team || decision || query || onlyRisk)
  const tasks = [...model.tasks.values()].filter((task) => task.sprints.length)
  const projected = (task: TaskSummary, row: PlanRow) => placement[cardKey(task, row)] ?? row.sprint_no!
  const occupies = (task: TaskSummary, n: number) => task.rows.some((row) => projected(task, row) === n)
  const matches = (task: TaskSummary) =>
    (!team || task.team_id === team) && (!decision || task.decision === decision) &&
    (!onlyRisk || riskById.has(task.task_id)) &&
    (!query || `${task.task_id} ${task.summary}`.toLowerCase().includes(query))
  const visible = tasks.filter((task) => (occupies(task, sprint) || lastMove?.id === task.task_id) && matches(task))
    .sort((a, b) => Math.min(...a.sprints) - Math.min(...b.sprints) || a.task_id.localeCompare(b.task_id))
  const activeCount = tasks.filter((task) => occupies(task, sprint) && matches(task)).length
  const outside = model.outside.filter(matches)
  const changed = Object.keys(placement).length

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
      persist(planId, next)
      setMoveId(null)
      setFlight(null)
      setArrived(key)
      setLastMove({ key, id: task.task_id, from, target })
      showFeedback(`${task.task_id} · часть ${row.part} теперь в спринте ${target}`)
    }, reducedMotion ? 0 : 360)
  }
  const reset = () => { setPlacement({}); persist(planId, {}); setFeedback({ text: 'Раскладка сброшена' }); setLastMove(null); setArrived(null) }

  return (
    <>
      <div className="toolbar" role="search">
        <SearchInput placeholder="Ключ или название" value={q ?? ''} onChange={(event) => setQ(event.target.value)} style={{ width: 220 }} aria-label="Поиск задач" />
        <Select aria-label="Команда" value={team ?? ''} onChange={(event) => setTeam(event.target.value)} options={[{ value: '', label: 'Все команды' }, ...teams.map((value) => ({ value, label: value }))]} />
        <Select aria-label="Решение" value={decision ?? ''} onChange={(event) => setDecision(event.target.value)} options={[{ value: '', label: 'Любое решение' }, ...Object.entries(DECISION_LABEL).map(([value, label]) => ({ value, label }))]} />
        <Checkbox label="Риск Bus Factor" checked={!!onlyRisk} onChange={(event) => setOnlyRisk(event.target.checked ? '1' : null)} />
        <div className="toolbar__end">
          {filtered && <Button size="sm" variant="ghost" onClick={() => { setTeam(null); setDecision(null); setQ(null); setOnlyRisk(null) }}>Сбросить фильтры</Button>}
          {canEdit && changed > 0 && <Button size="sm" variant="secondary" icon={<RotateCcw />} disabled={!!flight} onClick={reset}>Сбросить переносы · {changed}</Button>}
        </div>
      </div>

      <div className="gantt-quarter">
        <div className="gantt-quarter__title"><strong>Квартал</strong><span>12 недель · 6 спринтов</span></div>
        <div className="gantt-quarter__sprints" role="group" aria-label="Выберите спринт">
          {SPRINT_NUMBERS.map((number) => {
            const active = tasks.filter((task) => occupies(task, number) && (!team || task.team_id === team))
            const sp = active.flatMap((task) => task.rows.filter((row) => projected(task, row) === number && row.decision !== 'done_actual').map((row) => row.step_points_sp ?? 0)).reduce((sum, value) => sum + value, 0)
            return (
              <button key={number} type="button" className="gantt-quarter__sprint" aria-pressed={number === sprint} data-target={(drag?.target === number || flight?.target === number) || undefined} aria-label={`Спринт ${number}: ${countLabel(active.length)}, ${fmt(sp)} SP`} disabled={!!flight} onClick={() => setSprint(number)}>
                <span className="gantt-quarter__sprint-top"><b>Спринт {number}</b><small>{sprintWeeks(number)}</small></span>
                <span className="gantt-quarter__sprint-bottom"><span>{countLabel(active.length)}</span><b>{fmt(sp)} SP</b></span>
                {fixedSprints.has(number) && <span className="gantt-quarter__fixed">факт</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="gantt-section-head">
        <div><h2>Спринт {sprint}</h2><span>{sprintWeeks(sprint)} · {filtered ? `${activeCount} найдено` : countLabel(activeCount)}</span></div>
        <div className="gantt-feedback" data-error={feedback?.error || undefined}>
          <span role="status" aria-live="polite">{drag ? (() => { const task = model.tasks.get(drag.id)!; const row = task.rows.find((item) => cardKey(task, item) === drag.key)!; return SPRINT_NUMBERS.includes(drag.target) ? `Часть ${row.part} из ${row.parts} → спринт ${drag.target}${validTarget(task, row, drag.target) ? ' · отпустите' : ` · ${invalidReason(task, row, drag.target)}`}` : 'Отпустите карточку внутри шкалы спринтов' })() : feedback?.text ?? (canEdit ? 'Перетащите карточку в другой спринт или нажмите на неё' : '')}</span>
          {lastMove && feedback && !drag && <button type="button" onClick={() => { const task = model.tasks.get(lastMove.id); const row = task?.rows.find((item) => cardKey(task, item) === lastMove.key); if (task && row) move(task, row, lastMove.from) }}>Вернуть</button>}
        </div>
      </div>

      <div className="gantt-guide"><span className="gantt-guide__current"><i aria-hidden /> Голубая колонка — выбранный спринт.</span><span>Задача может занимать несколько спринтов — тогда у неё несколько карточек <strong>«Часть 1», «Часть 2»</strong>.</span><span><strong>SP (Story Points)</strong> — оценка работы в части.</span><span>Переносится только выбранная карточка.</span></div>
      <div className="gantt-scroll" role="region" aria-label={`Диаграмма задач спринта ${sprint}`} tabIndex={0}>
        <div className="gantt">
          <div className="gantt__head">
            <div className="gantt__corner">Задача и её части</div>
            {SPRINT_NUMBERS.map((number) => <div key={number} className="gantt__head-cell" data-current={number === sprint || undefined} data-target={(drag?.target === number || flight?.target === number) || undefined}><b>{number}</b><span>{sprintWeeks(number)}</span></div>)}
          </div>
          {visible.length ? visible.map((task) => {
            const picked = task.rows.find((row) => cardKey(task, row) === moveId)
            const preview = drag?.id === task.task_id ? drag : flight?.id === task.task_id ? flight : null
            const previewRow = preview ? task.rows.find((row) => cardKey(task, row) === preview.key) : null
            const previewTarget = preview?.target
            return <div className="gantt__row" key={`${sprint}-${task.task_id}`} data-gantt-row={task.task_id} data-picker={!!picked || undefined} data-selected={selectedId === task.task_id || undefined}>
              <div className="gantt__task">
                <button className="gantt__task-main" type="button" title={task.summary} onClick={() => onSelect(task.task_id)} aria-label={`Открыть задачу ${task.task_id}: ${task.summary}`}>
                  <span className="gantt__task-key">{task.task_id}</span><span className="gantt__task-title">{task.summary}</span>
                </button>
                <div className="gantt__task-meta"><span>{task.team_id}</span>{lastMove?.id === task.task_id && !occupies(task, sprint) ? <span className="gantt__moved-out">Часть → спринт {lastMove.target}</span> : <DecisionBadge decision={task.decision} />}
                  {riskById.has(task.task_id) && task.decision !== 'done_actual' && <span title="Риск Bus Factor"><ShieldAlert aria-label="Риск Bus Factor" /></span>}
                </div>
                {picked && <div className="gantt__picker" role="group" aria-label={`Перенос части ${picked.part} задачи ${task.task_id}`}><span>Часть {picked.part} из {picked.parts} · {fmtSp(picked.step_points_sp)} SP</span>
                  <Select aria-label={`Спринт назначения для ${task.task_id}, часть ${picked.part}`} value={String(projected(task, picked))} onChange={(event) => move(task, picked, Number(event.target.value))}
                    options={SPRINT_NUMBERS.filter((number) => validTarget(task, picked, number)).map((number) => ({ value: String(number), label: `Спринт ${number}` }))} />
                </div>}
              </div>
              <div className="gantt__track" aria-label={`${task.task_id}: спринты ${formatSprints(task.rows.map((row) => projected(task, row)))}`}>
                {SPRINT_NUMBERS.map((number) => <span key={number} className="gantt__cell" style={{ gridColumn: number }} data-current={number === sprint || undefined} aria-hidden />)}
                {preview && previewRow && previewTarget !== undefined && SPRINT_NUMBERS.includes(previewTarget) && previewTarget !== projected(task, previewRow) && <span className="gantt__ghost" data-invalid={!validTarget(task, previewRow, previewTarget) || undefined} data-flight={flight?.key === preview.key || undefined} style={{ gridColumn: previewTarget, gridRow: 1 }} aria-hidden><span>{previewRow.parts > 1 ? `Часть ${previewRow.part}` : task.task_id}</span><small>{validTarget(task, previewRow, previewTarget) ? `${fmtSp(previewRow.step_points_sp)} SP` : 'нельзя'}</small></span>}
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
                    <span>{task.rows.length > 1 ? `Часть ${row.part}` : task.task_id}</span><small>{row.decision === 'done_actual' ? 'факт' : `${fmtSp(row.step_points_sp)} SP`}</small>
                  </button>
                })}
              </div>
            </div>
          }) : <p className="gantt__empty">{filtered ? 'Нет задач под фильтр в этом спринте.' : 'В этом спринте нет задач.'}</p>}
        </div>
      </div>

      {outside.length > 0 && <div className="gantt-outside"><div className="gantt-outside__head"><strong>Вне квартала</strong><Badge plain>{countLabel(outside.length)}</Badge></div>
        {outside.map((task) => <button key={task.task_id} type="button" className="gantt-outside__item" onClick={() => onSelect(task.task_id)}><span className="gantt__task-key">{task.task_id}</span><span>{task.summary}</span><DecisionBadge decision={task.decision} /><small>{task.reason}</small></button>)}
      </div>}
    </>
  )
}

function pointerSprint(event: PointerEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.parentElement!.getBoundingClientRect()
  return Math.floor((event.clientX - rect.left) / (rect.width / 6)) + 1
}
