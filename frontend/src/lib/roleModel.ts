import type { Decision, Engineer } from '@/api/types'
import type { PlanModel, PlanRow } from './planModel'
import { SPRINT_NUMBERS } from './planModel'

/**
 * Гант по ролям: агрегаты (команда × роль × спринт) без назначений конкретным людям.
 * Часы ролей частей задач (в раскладке плана; переносы приходят пересборкой плана
 * через pin) ложатся целиком на носителей роли: сначала своя команда задачи, при её
 * отсутствии — команда с наибольшим свободным лимитом носителей (кросс-командный заём).
 * Если носителей роли нет ни в одной команде — явный дефицит в команде задачи
 * (виртуальный держатель). Лимит роли в команде = Σ (80 ч × capacity_rate) по её носителям.
 */

export interface RoleChip {
  taskId: string
  /** Спринт части по плану */
  sprintNo: number
  part: number
  parts: number
  hours: number
  decision: Decision
  /** Часы у задачи другой команды (кросс-командный заём) */
  loan: boolean
  taskTeamId: string
}

export interface RoleCell {
  placed: number
  chips: RoleChip[]
  /** Не распределено: носителей роли нет во всей компании */
  deficitHours: number
  deficitTaskIds: string[]
}

export interface RoleLane {
  id: string
  teamId: string
  /** Название роли (как пришло в данных) */
  role: string
  carriers: { engineerId: string; grade: string; rate: number }[]
  limitHours: number
  /** Носителей роли нет ни в одной команде */
  companyWideGap: boolean
  cells: Map<number, RoleCell>
}

export interface TeamBucket {
  teamId: string
  lanes: RoleLane[]
}

export interface RoleModel {
  teams: TeamBucket[]
}

const EPS = 0.05
const normRole = (role: string) => role.trim().toLowerCase()

interface Demand {
  taskTeamId: string
  taskId: string
  /** Спринт части по плану (кроме done_actual с sprint_no из факта) */
  rowSprint: number
  part: number
  parts: number
  stepPointsSp: number | null
  decision: Decision
  roleDisplay: string
  norm: string
  hours: number
}

function rowsByShownSprint(model: PlanModel): Map<number, PlanRow[]> {
  const map = new Map<number, PlanRow[]>(SPRINT_NUMBERS.map((n) => [n, [] as PlanRow[]]))
  for (const s of model.sprints) {
    for (const row of s.rows) {
      if (row.sprint_no == null) continue
      map.get(row.sprint_no)?.push(row)
    }
  }
  return map
}

export function buildRoleModel(model: PlanModel, engineers: Engineer[]): RoleModel {
  const map = rowsByShownSprint(model)
  interface Pool {
    role: string
    norm: string
    byTeam: Map<string, { engineerId: string; grade: string; rate: number }[]>
  }
  const pools = new Map<string, Pool>()
  for (const e of engineers) {
    const norm = normRole(e.role)
    const pool = pools.get(norm) ?? { role: e.role, norm, byTeam: new Map() }
    const list = pool.byTeam.get(e.team_id) ?? []
    list.push({ engineerId: e.engineer_id, grade: e.grade, rate: e.capacity_rate })
    pool.byTeam.set(e.team_id, list)
    pools.set(norm, pool)
  }

  const lanes = new Map<string, RoleLane>()
  const laneOf = (teamId: string, pool: Pool): RoleLane => {
    const id = `${teamId}::${pool.norm}`
    let lane = lanes.get(id)
    if (!lane) {
      const carriers = pool.byTeam.get(teamId) ?? []
      lane = {
        id,
        teamId,
        role: pool.role,
        carriers,
        limitHours: carriers.reduce((sum, c) => sum + 80 * c.rate, 0),
        companyWideGap: false,
        cells: new Map(),
      }
      lanes.set(id, lane)
    }
    return lane
  }
  const cellOf = (lane: RoleLane, sprint: number): RoleCell => {
    let cell = lane.cells.get(sprint)
    if (!cell) {
      cell = { placed: 0, chips: [], deficitHours: 0, deficitTaskIds: [] }
      lane.cells.set(sprint, cell)
    }
    return cell
  }

  for (const sprint of SPRINT_NUMBERS) {
    const demands: Demand[] = []
    for (const row of map.get(sprint) ?? []) {
      const task = model.tasks.get(row.task_id)
      if (!task) continue
      const share = row.parts > 1 && task.estimation_sp > 0 ? (row.step_points_sp ?? 0) / task.estimation_sp : 1
      for (const [role, hours] of Object.entries(row.role_hours)) {
        const value = hours * share
        if (value >= EPS) {
          demands.push({
            taskTeamId: task.team_id, taskId: row.task_id,
            rowSprint: row.sprint_no ?? sprint, part: row.part, parts: row.parts,
            stepPointsSp: row.step_points_sp, decision: row.decision,
            roleDisplay: role, norm: normRole(role), hours: value,
          })
        }
      }
    }
    demands.sort(
      (a, b) => a.taskTeamId.localeCompare(b.taskTeamId) || a.taskId.localeCompare(b.taskId) || a.part - b.part || a.roleDisplay.localeCompare(b.roleDisplay),
    )
    for (const demand of demands) {
      const ownPool = pools.get(demand.norm)
      const addChip = (lane: RoleLane, loan: boolean) => {
        const cell = cellOf(lane, sprint)
        cell.placed += demand.hours
        cell.chips.push({
          taskId: demand.taskId, sprintNo: demand.rowSprint, part: demand.part, parts: demand.parts,
          hours: demand.hours, decision: demand.decision, loan, taskTeamId: demand.taskTeamId,
        })
        cell.chips.sort((a, b) => a.taskId.localeCompare(b.taskId))
      }
      if (ownPool && ownPool.byTeam.get(demand.taskTeamId)?.length) {
        addChip(laneOf(demand.taskTeamId, ownPool), false)
        continue
      }
      if (ownPool?.byTeam.size) {
        // заём: команда с наибольшим свободным лимитом этой роли (детерминированно)
        const candidates = [...ownPool.byTeam.keys()]
          .filter((teamId) => teamId !== demand.taskTeamId)
          .map((teamId) => {
            const lane = laneOf(teamId, ownPool)
            return { lane, free: lane.limitHours - cellOf(lane, sprint).placed }
          })
        candidates.sort((a, b) => b.free - a.free || a.lane.teamId.localeCompare(b.lane.teamId))
        addChip(candidates[0].lane, true)
        continue
      }
      // носителей роли нет ни в одной команде — дефицит в команде задачи
      const lane = laneOf(demand.taskTeamId, { role: demand.roleDisplay, norm: demand.norm, byTeam: new Map() })
      lane.companyWideGap = true
      const cell = cellOf(lane, sprint)
      cell.deficitHours += demand.hours
      if (!cell.deficitTaskIds.includes(demand.taskId)) cell.deficitTaskIds.push(demand.taskId)
    }
  }

  const teamIds = new Set([...lanes.values()].map((lane) => lane.teamId).filter(Boolean))
  const teams: TeamBucket[] = [...teamIds].sort().map((teamId) => ({
    teamId,
    lanes: [...lanes.values()]
      .filter((lane) => lane.teamId === teamId)
      .sort((a, b) => normRole(a.role).localeCompare(normRole(b.role)) || a.role.localeCompare(b.role)),
  }))
  return { teams }
}
