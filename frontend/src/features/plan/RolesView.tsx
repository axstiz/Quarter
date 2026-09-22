import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useEngineers, usePinTask, useTeamDetails, useUnpinAllTasks, useUnpinTask } from '@/api/queries'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SearchInput, Select } from '@/components/ui/Field'
import { Meter } from '@/components/ui/Meter'
import { ErrorAlert, errorHint, errorTitle, SkeletonRows } from '@/components/ui/States'
import { fmt, plural, sprintWeeks } from '@/lib/format'
import { buildRoleModel, type RoleChip, type RoleLane } from '@/lib/roleModel'
import { SPRINT_NUMBERS, type PlanModel } from '@/lib/planModel'
import { useParam } from '@/lib/useParam'

interface Props {
  model: PlanModel
  planId: string
  fixedSprints: Set<number>
  readOnly: boolean
  selectedId: string | null
  onSelect: (taskId: string) => void
}

interface DragState {
  chip: RoleChip
  hours: number
  originX: number
  originY: number
  x: number
  y: number
  target: number | null
  valid: boolean
}

interface HoverCard {
  chip: RoleChip
  role: string
  summary: string
  x: number
  y: number
}

const chipId = (chip: RoleChip) => `${chip.taskId}:${chip.sprintNo}:${chip.part}`

export function RolesView({ model, planId, fixedSprints, readOnly, selectedId, onSelect }: Props) {
  const [team, setTeam] = useParam('team')
  const [q, setQ] = useParam('q')
  const engineers = useEngineers({})
  const pin = usePinTask(planId)
  const unpin = useUnpinTask(planId)
  const unpinAll = useUnpinAllTasks(planId)

  // Закрепления приходят из плана (pinned_sprint у план-айтемов) — сервер пересобирает план после pin
  const [drag, setDrag] = useState<DragState | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const [lastMove, setLastMove] = useState<{ chip: RoleChip; from: number; target: number } | null>(null)
  const [failedPins, setFailedPins] = useState<string[]>([])
  const suppressClick = useRef<string | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [openCarriers, setOpenCarriers] = useState<string[]>([])
  const [hover, setHover] = useState<HoverCard | null>(null)

  const roleModel = useMemo(() => buildRoleModel(model, engineers.data ?? []), [model, engineers.data])
  const pinnedIds = useMemo(
    () =>
      [...new Set([...model.tasks.values()].flatMap((t) => t.rows.filter((r) => r.pinned_sprint != null).map((r) => r.task_id)))].sort(),
    [model],
  )
  const busy = pin.isPending || unpin.isPending || unpinAll.isPending

  const query = (q ?? '').trim().toLowerCase()
  const filtered = !!(team || query)
  const matchesTask = (taskId: string) =>
    !query || taskId.toLowerCase().includes(query) || (model.tasks.get(taskId)?.summary ?? '').toLowerCase().includes(query)

  const teamDetails = useTeamDetails(roleModel.teams.map((bucket) => bucket.teamId))
  const capacityByTeam = new Map(roleModel.teams.map((bucket, index) => [bucket.teamId, teamDetails[index].data?.capacity_sp_per_sprint]))

  // Мини-статистика команды по спринтам: SP задач команды (без выполненных по факту) в показываемом спринте
  // change 049: SP атрибутируется команде-исполнителю каждой части (row.team_id), не первой части задачи
  const teamStats = useMemo(() => {
    const map = new Map<string, Map<number, { sp: number; count: number }>>()
    for (const s of model.sprints) {
      for (const row of s.rows) {
        const rowTeam = row.team_id || model.tasks.get(row.task_id)?.team_id
        if (!rowTeam || row.sprint_no == null) continue
        const bySprint = map.get(rowTeam) ?? new Map<number, { sp: number; count: number }>()
        const cur = bySprint.get(row.sprint_no) ?? { sp: 0, count: 0 }
        bySprint.set(row.sprint_no, {
          sp: cur.sp + (row.decision !== 'done_actual' ? (row.step_points_sp ?? 0) : 0),
          count: cur.count + 1,
        })
        map.set(rowTeam, bySprint)
      }
    }
    return map
  }, [model])

  const laneChips = (lane: RoleLane) => SPRINT_NUMBERS.flatMap((n) => lane.cells.get(n)?.chips ?? [])
  const visibleTeams = roleModel.teams
    .filter((bucket) => !team || bucket.teamId === team)
    .map((bucket) => ({ ...bucket, lanes: bucket.lanes.filter((lane) => !query || laneChips(lane).some((chip) => matchesTask(chip.taskId))) }))
    .filter((bucket) => bucket.lanes.length > 0 || !filtered)

  const showCard = (chip: RoleChip, lane: RoleLane) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (drag) { setHover(null); return }
    const rect = event.currentTarget.getBoundingClientRect()
    setHover({
      chip,
      role: lane.role,
      summary: model.tasks.get(chip.taskId)?.summary ?? '',
      x: Math.min(rect.left, window.innerWidth - 352),
      y: rect.top - 8,
    })
  }

  // --- переносы через бэк-pin (016/020): drag → POST pin, сервер пересобирает план ---

  const canEdit = !readOnly

  /** Отказ сервера помним по части задачи: отказ одной части не блокирует перенос другой. */
  const pinKey = (chip: RoleChip, target: number) => `${chip.taskId}:${chip.sprintNo}:${target}`

  /** Целевой спринт валиден: внутри квартала, не зафиксирован фактом, и сервер его не отклонял (409). */
  const validTarget = (chip: RoleChip, target: number): boolean =>
    SPRINT_NUMBERS.includes(target) && !fixedSprints.has(target) && !failedPins.includes(pinKey(chip, target))

  const invalidReason = (chip: RoleChip, target: number | null): string => {
    if (target == null || !SPRINT_NUMBERS.includes(target)) return 'Вне квартала'
    if (fixedSprints.has(target)) return 'Спринт закрыт по факту'
    if (failedPins.includes(pinKey(chip, target))) return 'сервер отклонил этот перенос, цель заблокирована'
    return 'Перенос недоступен'
  }

  const pickUp = (chip: RoleChip, hours: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    setHover(null)
    if (!canEdit || busy || chip.decision === 'done_actual' || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setFeedback(null)
    setLastMove(null)
    setDrag({ chip, hours, originX: event.clientX, originY: event.clientY, x: event.clientX, y: event.clientY, target: null, valid: false })
  }

  const dragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const target = Number(document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-sprint-cell]')?.dataset.sprintCell) || null
    setDrag({ ...drag, x: event.clientX, y: event.clientY, target, valid: target != null && validTarget(drag.chip, target) })
  }

  const drop = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag
    if (!current) return
    setDrag(null)
    const moved = Math.abs(event.clientX - current.originX) + Math.abs(event.clientY - current.originY) >= 6
    if (!moved) return
    const target = current.target
    if (target == null) return
    if (!current.valid || !validTarget(current.chip, target)) {
      setFeedback({ text: `${current.chip.taskId}: ${invalidReason(current.chip, target)}`, error: true })
      return
    }
    if (target === current.chip.sprintNo) return
    suppressClick.current = chipId(current.chip)
    setLastMove({ chip: current.chip, from: current.chip.sprintNo, target })
    const label = current.chip.parts > 1 ? `${current.chip.taskId} (часть из спринта ${current.chip.sprintNo})` : current.chip.taskId
    setFeedback({ text: `${label} · перенос в спринт ${target}…` })
    pin.mutate(
      { taskId: current.chip.taskId, sprintNo: target, fromSprintNo: current.chip.sprintNo },
      {
        // change 047: сервер переносит только часть из исходного спринта — остальные части на местах
        onSuccess: () => setFeedback({ text: `${label} перенесена в спринт ${target}` }),
        onError: (e) => {
          // 409 (конфликт ёмкости/зависимости) и прочие ошибки: без повторов на ту же цель
          setFailedPins((before) => [...before, pinKey(current.chip, target)])
          setLastMove(null)
          setFeedback({ text: `${current.chip.taskId}: ${errorTitle(e)}${errorHint(e) ? ` — ${errorHint(e)}` : ''}`, error: true })
        },
      },
    )
  }

  const revert = () => {
    if (!lastMove) return
    const move = lastMove
    setLastMove(null)
    unpin.mutate(move.chip.taskId, {
      // change 038: снимаем optimistic слой — чип возвращается к серверной раскладке
      onSuccess: () => setFeedback({ text: `${move.chip.taskId} возвращено: закрепление снято` }),
      onError: (e) => setFeedback({ text: `${move.chip.taskId}: ${errorTitle(e)}`, error: true }),
    })
  }

  const reset = () => {
    unpinAll.mutate(pinnedIds, {
      onSuccess: () => {
        setFailedPins([])
        setFeedback({ text: 'Раскладка сброшена: закрепления сняты' })
        setLastMove(null)
      },
      onError: (e) => setFeedback({ text: `${errorTitle(e)}${errorHint(e) ? ` — ${errorHint(e)}` : ''}`, error: true }),
    })
  }

  return (
    <>
      <div className="toolbar" role="search">
        <SearchInput placeholder="Задача или название" value={q ?? ''} onChange={(event) => setQ(event.target.value)} style={{ width: 220 }} aria-label="Поиск задач" />
        <Select
          aria-label="Команда"
          value={team ?? ''}
          onChange={(event) => setTeam(event.target.value)}
          options={[{ value: '', label: 'Все команды' }, ...roleModel.teams.map((bucket) => ({ value: bucket.teamId, label: bucket.teamId }))]}
        />
        <div className="toolbar__end">
          {filtered && <Button size="sm" variant="ghost" onClick={() => { setTeam(null); setQ(null) }}>Сбросить фильтры</Button>}
          {!readOnly && pinnedIds.length > 0 && (
            <Button size="sm" variant="secondary" icon={<RotateCcw />} loading={unpinAll.isPending} onClick={reset}>
              Сбросить закрепления · {pinnedIds.length}
            </Button>
          )}
        </div>
      </div>

      <div className="gantt-section-head">
        <div>
          <h2>Роли по спринтам</h2>
          <span>задачи ролей и носители · раскладка синхронна с «Диаграммой Ганта»</span>
        </div>
        <div className="gantt-feedback" data-error={feedback?.error || undefined}>
          <span role="status" aria-live="polite">{drag ? 'Отпустите на колонке спринта' : feedback?.text ?? (readOnly ? 'Версия плана только для чтения' : 'Перетащите чип — часть задачи из этой ячейки переедет в другой спринт')}</span>
          {lastMove && feedback && !drag && <button type="button" onClick={revert}>Вернуть</button>}
        </div>
      </div>

      {engineers.isLoading ? (
        <SkeletonRows rows={7} cols={4} />
      ) : engineers.error ? (
        <ErrorAlert error={engineers.error} onRetry={() => engineers.refetch()} />
      ) : (
        <div className="gantt-scroll" role="region" aria-label="Роли по спринтам: носители, загрузка и задачи ролей" tabIndex={0}>
          <div className="gantt">
            <div className="gantt__head">
              <div className="gantt__corner">Команды и роли</div>
              {SPRINT_NUMBERS.map((number) => (
                <div key={number} className="roles__head-cell">
                  <b>{fixedSprints.has(number) && <span title="Спринт с фактом"><Check aria-hidden /></span>}Спринт {number}</b>
                  <small>{sprintWeeks(number)}</small>
                </div>
              ))}
            </div>
            {visibleTeams.map((bucket) => {
              const bySprint = teamStats.get(bucket.teamId)
              const capacity = capacityByTeam.get(bucket.teamId)
              const isOpen = !collapsed.includes(bucket.teamId)
              return (
                <section className="gantt__group" key={bucket.teamId}>
                  <div className="gantt__team-row">
                    <button
                      type="button"
                      className="gantt__team-toggle"
                      aria-expanded={isOpen}
                      onClick={() => setCollapsed((before) => before.includes(bucket.teamId) ? before.filter((id) => id !== bucket.teamId) : [...before, bucket.teamId])}
                    >
                      <ChevronDown aria-hidden className="gantt__team-chevron" />
                      <span className="gantt__team-label"><strong>{bucket.teamId}</strong><small>{bucket.lanes.length} {plural(bucket.lanes.length, 'роль', 'роли', 'ролей')}</small></span>
                    </button>
                    {SPRINT_NUMBERS.map((number) => {
                      const stat = bySprint?.get(number)
                      const over = capacity != null && (stat?.sp ?? 0) > capacity
                      return (
                        <div className="gantt__team-cell" key={number} title={`${bucket.teamId}, спринт ${number}: ${fmt(stat?.sp ?? 0)} SP${capacity == null ? '' : ` из ${fmt(capacity)} SP доступно`}`}>
                          <span>{fmt(stat?.sp ?? 0)}{capacity == null ? '' : ` / ${fmt(capacity)}`} SP</span>
                          {capacity != null && capacity > 0 && <i aria-hidden style={{ width: `${Math.min(100, (stat?.sp ?? 0) / capacity * 100)}%` }} data-over={over || undefined} />}
                        </div>
                      )
                    })}
                  </div>
                  {isOpen && bucket.lanes.map((lane) => {
                    const carriersOpen = openCarriers.includes(lane.id)
                    return (
                      <div className="roles__lane" key={lane.id} data-selected={laneChips(lane).some((chip) => chip.taskId === selectedId) || undefined}>
                        <div className="roles__who">
                          <span className="roles__role">{lane.role}</span>
                          {lane.companyWideGap && <Badge tone="over">носителей нет во всей компании · виртуальный держатель</Badge>}
                          <button
                            type="button"
                            className="roles__carriers-toggle"
                            aria-expanded={carriersOpen}
                            onClick={() => setOpenCarriers((before) => before.includes(lane.id) ? before.filter((id) => id !== lane.id) : [...before, lane.id])}
                          >
                            {lane.carriers.length
                              ? `${lane.carriers.length} ${plural(lane.carriers.length, 'носитель', 'носителя', 'носителей')} · лимит ${fmt(lane.limitHours)} ч`
                              : 'носителей в команде нет'}
                          </button>
                          {carriersOpen && (
                            <span className="roles__carriers-list">
                              {lane.carriers.map((carrier) => (
                                <span key={carrier.engineerId}>{carrier.engineerId} · {carrier.grade} · {carrier.rate} ставки</span>
                              ))}
                            </span>
                          )}
                        </div>
                        <div className="roles__track">
                          {SPRINT_NUMBERS.map((number) => {
                            const cell = lane.cells.get(number)
                            const over = cell && lane.limitHours > 0 && cell.placed > lane.limitHours + 1e-9
                            const chips = cell?.chips.filter((chip) => !query || matchesTask(chip.taskId)) ?? []
                            const isTarget = drag?.valid && drag.target === number
                            const isInvalid = drag && !drag.valid && drag.target === number
                            return (
                              <div className="roles__cell" key={number} data-sprint-cell={number} data-over={over || undefined} data-target={isTarget || undefined} data-invalid={isInvalid || undefined}>
                                {chips.map((chip) => (
                                  <button
                                    key={`${chip.taskId}:${chip.sprintNo}:${chip.part}`}
                                    type="button"
                                    className="roles__chip"
                                    data-done={chip.decision === 'done_actual' || undefined}
                                    data-loan={chip.loan || undefined}
                                    data-dragging={drag?.chip.taskId === chip.taskId && drag.chip.sprintNo === chip.sprintNo && drag.chip.part === chip.part || undefined}
                                    aria-label={`${chip.taskId}, ${lane.role}, ${fmt(chip.hours)} ч${chip.loan ? `, заём из команды ${chip.taskTeamId}` : ''}${!readOnly && chip.decision !== 'done_actual' ? '. Перетащить в другой спринт' : ''}`}
                                    onPointerDown={pickUp(chip, chip.hours)}
                                    onPointerMove={dragMove}
                                    onPointerUp={drop}
                                    onPointerCancel={() => setDrag(null)}
                                    onClick={() => { if (suppressClick.current === chipId(chip)) { suppressClick.current = null; return } onSelect(chip.taskId) }}
                                    onMouseEnter={showCard(chip, lane)}
                                    onMouseLeave={() => setHover(null)}
                                  >
                                    <span className="roles__chip-id">{chip.taskId}</span>
                                    <small>{fmt(chip.hours)} ч{chip.parts > 1 ? ` · ${chip.part}/${chip.parts}` : ''}</small>
                                  </button>
                                ))}
                                {!query && cell?.deficitHours ? <span className="roles__gap">+{fmt(cell.deficitHours)} ч — некому</span> : null}
                                {lane.limitHours > 0 && (
                                  <Meter value={cell?.placed ?? 0} max={lane.limitHours} unit=" ч" label={`Загрузка роли: ${fmt(cell?.placed ?? 0)} из ${fmt(lane.limitHours)} ч`} />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </section>
              )
            })}
            <p className="people__note">
              Часы в ячейке — потребность задач спринта в этой роли; лимит — Σ (80 ч × ставка носителей). Задача без носителей роли
              в своей команде уходит команде с наибольшим свободным лимитом (пунктир — заём); если носителей роли нет во всей компании,
              в команде задачи красная метка — «виртуальный держатель». Перетаскивание переносит часть задачи из этой ячейки
              в другой спринт и закрепляет её там: SP и часы всех ролей этой части едут вместе с ней, остальные части задачи
              остаются на своих спринтах. Меняется спринт части, не носитель роли; раскладка совпадает с «Диаграммой Ганта».
              «Вернуть» снимает закрепление задачи целиком.
            </p>
          </div>
        </div>
      )}

      {drag && createPortal(
        <div className="roles__ghost" style={{ transform: `translate(${drag.x + 10}px, ${drag.y + 12}px)` }} aria-hidden>
          <span className="roles__chip-id">{drag.chip.taskId}</span>
          <small>{fmt(drag.hours)} ч</small>
        </div>,
        document.body,
      )}
      {hover && !drag && createPortal(
        <div className="people__card" style={{ left: hover.x, top: hover.y, transform: 'translateY(-100%)' }} role="tooltip">
          <div className="people__card-title">{hover.chip.taskId}{hover.chip.parts > 1 ? ` · часть ${hover.chip.part} из ${hover.chip.parts}` : ''}</div>
          {hover.summary && <div className="people__card-row">{hover.summary}</div>}
          <div className="people__card-row"><span>Роль:</span><b>{hover.role}</b><span>·</span><b>{fmt(hover.chip.hours)} ч</b></div>
          <div className="people__card-row">
            {hover.chip.decision === 'done_actual' ? 'Выполнено по факту' : 'Запланировано'}
            {hover.chip.loan && ` · заём из команды ${hover.chip.taskTeamId}`}
          </div>
            <div className="people__card-hint">Нажмите, чтобы открыть карточку задачи{!readOnly && hover.chip.decision !== 'done_actual' ? '; перетащите — перенести эту часть в другой спринт' : ''}</div>
        </div>,
        document.body,
      )}
    </>
  )
}
