import { Check, ChevronDown } from 'lucide-react'
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { USE_MOCKS } from '@/api/client'
import { useEngineers, useTeamDetails } from '@/api/queries'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SearchInput, Select } from '@/components/ui/Field'
import { Meter } from '@/components/ui/Meter'
import { ErrorAlert, SkeletonRows } from '@/components/ui/States'
import { fmt, plural, sprintWeeks } from '@/lib/format'
import { loadPlacement, projectedSprint } from '@/lib/ganttOverrides'
import { buildRoleModel, type RoleChip, type RoleLane } from '@/lib/roleModel'
import { SPRINT_NUMBERS, type PlanModel } from '@/lib/planModel'
import { useParam } from '@/lib/useParam'

interface Props {
  model: PlanModel
  planId: string
  fixedSprints: Set<number>
  selectedId: string | null
  onSelect: (taskId: string) => void
}

interface HoverCard {
  chip: RoleChip
  role: string
  summary: string
  x: number
  y: number
}

const countLabel = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`

export function RolesView({ model, planId, fixedSprints, selectedId, onSelect }: Props) {
  const [team, setTeam] = useParam('team')
  const [q, setQ] = useParam('q')
  const engineers = useEngineers({})

  // Раскладка Ганта — единый источник размещений для обоих видов
  const placement = useMemo(() => (USE_MOCKS ? loadPlacement(planId) : {}), [planId])
  const roleModel = useMemo(() => buildRoleModel(model, engineers.data ?? [], placement), [model, engineers.data, placement])

  const [collapsed, setCollapsed] = useState<string[]>([])
  const [openCarriers, setOpenCarriers] = useState<string[]>([])
  const [hover, setHover] = useState<HoverCard | null>(null)

  const query = (q ?? '').trim().toLowerCase()
  const filtered = !!(team || query)
  const matchesTask = (taskId: string) =>
    !query || taskId.toLowerCase().includes(query) || (model.tasks.get(taskId)?.summary ?? '').toLowerCase().includes(query)

  const teamDetails = useTeamDetails(roleModel.teams.map((bucket) => bucket.teamId))
  const capacityByTeam = new Map(roleModel.teams.map((bucket, index) => [bucket.teamId, teamDetails[index].data?.capacity_sp_per_sprint]))

  // Мини-статистика команды по спринтам: SP задач команды (без выполненных по факту) в показываемом спринте
  const teamStats = useMemo(() => {
    const map = new Map<string, Map<number, { sp: number; count: number }>>()
    for (const s of model.sprints) {
      for (const row of s.rows) {
        const task = model.tasks.get(row.task_id)
        if (!task || row.sprint_no == null) continue
        const target = projectedSprint(placement, task.task_id, row)
        const bySprint = map.get(task.team_id) ?? new Map<number, { sp: number; count: number }>()
        const cur = bySprint.get(target) ?? { sp: 0, count: 0 }
        bySprint.set(target, {
          sp: cur.sp + (row.decision !== 'done_actual' ? (row.step_points_sp ?? 0) : 0),
          count: cur.count + 1,
        })
        map.set(task.team_id, bySprint)
      }
    }
    return map
  }, [model, placement])

  const laneChips = (lane: RoleLane) => SPRINT_NUMBERS.flatMap((n) => lane.cells.get(n)?.chips ?? [])
  const visibleTeams = roleModel.teams
    .filter((bucket) => !team || bucket.teamId === team)
    .map((bucket) => ({ ...bucket, lanes: bucket.lanes.filter((lane) => !query || laneChips(lane).some((chip) => matchesTask(chip.taskId))) }))
    .filter((bucket) => bucket.lanes.length > 0 || !filtered)

  const showCard = (chip: RoleChip, lane: RoleLane) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHover({
      chip,
      role: lane.role,
      summary: model.tasks.get(chip.taskId)?.summary ?? '',
      x: Math.min(rect.left, window.innerWidth - 352),
      y: rect.top - 8,
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
        </div>
      </div>

      <div className="gantt-section-head">
        <div>
          <h2>Гант по ролям</h2>
          <span>задачи ролей по спринтам · раскладка синхронна с «Диаграммой Ганта»</span>
        </div>
      </div>

      {engineers.isLoading ? (
        <SkeletonRows rows={7} cols={4} />
      ) : engineers.error ? (
        <ErrorAlert error={engineers.error} onRetry={() => engineers.refetch()} />
      ) : (
        <div className="gantt-scroll" role="region" aria-label="Гант по ролям: роли, их носители и задачи по спринтам" tabIndex={0}>
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
                      <span className="gantt__team-label"><strong>{bucket.teamId}</strong><small>{countLabel(bucket.lanes.length)}</small></span>
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
                            return (
                              <div className="roles__cell" key={number} data-over={over || undefined}>
                                {chips.map((chip) => (
                                  <button
                                    key={`${chip.taskId}:${chip.part}`}
                                    type="button"
                                    className="roles__chip"
                                    data-done={chip.decision === 'done_actual' || undefined}
                                    data-loan={chip.loan || undefined}
                                    aria-label={`${chip.taskId}, ${lane.role}, ${fmt(chip.hours)} ч${chip.loan ? `, заём из команды ${chip.taskTeamId}` : ''}`}
                                    onClick={() => onSelect(chip.taskId)}
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
          </div>
        </div>
      )}

      <p className="people__note">
        Часы в ячейке — потребность задач спринта в этой роли; лимит — Σ (80 ч × ставка носителей). Задача без носителей роли
        в своей команде уходит команде с наибольшим свободным лимитом (пунктир — заём); если носителей роли нет во всей компании,
        в команде задачи красная метка — «виртуальный держатель». Спринты совпадают с «Диаграммой Ганта» (включая ручные переносы).
      </p>

      {hover && createPortal(
        <div className="people__card" style={{ left: hover.x, top: hover.y, transform: 'translateY(-100%)' }} role="tooltip">
          <div className="people__card-title">{hover.chip.taskId}{hover.chip.parts > 1 ? ` · часть ${hover.chip.part} из ${hover.chip.parts}` : ''}</div>
          {hover.summary && <div className="people__card-row">{hover.summary}</div>}
          <div className="people__card-row"><span>Роль:</span><b>{hover.role}</b><span>·</span><b>{fmt(hover.chip.hours)} ч</b></div>
          <div className="people__card-row">
            {hover.chip.decision === 'done_actual' ? 'Выполнено по факту' : 'Запланировано'}
            {hover.chip.loan && ` · заём из команды ${hover.chip.taskTeamId}`}
          </div>
          <div className="people__card-hint">Нажмите, чтобы открыть карточку задачи</div>
        </div>,
        document.body,
      )}
    </>
  )
}
