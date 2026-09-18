// Порт логики бэкенда (src/services/*.py) для мок-режима. Держать в синхроне с Python-версией:
// planner.py → generatePlan, capacity.py → teamCapacitySp, dependencies.py → topoOrder/findCycle,
// routes.py::_recomputed_plan → recomputedPlan, replanner.py → computeWarnings,
// metrics.py::compute_metrics_initiatives → computeMetrics, bus_factor.py → computeBusFactor.
import type { BusFactorItem, BusFactorReport, Decision, Engineer, Metrics, PlanWarning, TeamHistory } from '../api/types'
import { BUS_FACTOR_METHODOLOGY } from './data/dataset'
import type { MockTask } from './types'

export const SPRINTS = 6
const HOURS_FULL = 80
const CAPACITY_FACTOR = 0.8

export interface Item {
  task_id: string
  decision: Decision
  sprint_no: number | null
  reason: string
  step_points_sp: number | null
}

export interface EnginePlan {
  sprints: { sprint_no: number; items: Item[] }[]
  decisions: Item[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
const rl = (role: string) => role.toLowerCase().replace(/[\s/-]+/g, '')

export function engineerSprintLimit(rate: number): number {
  const r = Math.max(rate || 1, 0.05)
  return r >= 1 ? HOURS_FULL * r : 40 * (r / 0.5)
}

export function teamCapacitySp(history: TeamHistory[]): number {
  const v = history.map((h) => h.velocity_achieved).filter((x) => x > 0)
  if (!v.length) return 0
  return round2((v.reduce((a, b) => a + b, 0) / v.length) * CAPACITY_FACTOR)
}

export function topoOrder(tasks: string[], deps: [string, string][]): string[] | null {
  const indeg = new Map(tasks.map((t) => [t, 0]))
  const adj = new Map<string, string[]>(tasks.map((t) => [t, []]))
  for (const [a, b] of deps) {
    if (indeg.has(a) && indeg.has(b)) {
      adj.get(a)!.push(b)
      indeg.set(b, indeg.get(b)! + 1)
    }
  }
  const queue = [...indeg].filter(([, d]) => d === 0).map(([t]) => t).sort()
  const order: string[] = []
  while (queue.length) {
    const node = queue.shift()!
    order.push(node)
    for (const nxt of adj.get(node)!) {
      indeg.set(nxt, indeg.get(nxt)! - 1)
      if (indeg.get(nxt) === 0) {
        queue.push(nxt)
        queue.sort()
      }
    }
  }
  return order.length === tasks.length ? order : null
}

export function findCycle(deps: [string, string][], tasks: string[]): string[] {
  const graph = new Map<string, string[]>(tasks.map((t) => [t, []]))
  for (const [a, b] of deps) if (graph.has(a) && graph.has(b)) graph.get(a)!.push(b)
  const visited = new Set<string>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const dfs = (node: string): string[] | null => {
    visited.add(node)
    stack.push(node)
    onStack.add(node)
    for (const nxt of graph.get(node)!) {
      if (onStack.has(nxt)) return [...stack.slice(stack.indexOf(nxt)), nxt]
      if (!visited.has(nxt)) {
        const res = dfs(nxt)
        if (res) return res
      }
    }
    onStack.delete(node)
    stack.pop()
    return null
  }
  for (const t of tasks) {
    if (!visited.has(t)) {
      const res = dfs(t)
      if (res) return res
    }
  }
  return []
}

/** Порт planner.generate_plan: SP-гейт по команде, часы ролей по инженерам, разбиение задач между спринтами. */
export function generatePlan(tasks: MockTask[], engineers: Engineer[], history: TeamHistory[], deps: [string, string][], firstFree = 1): EnginePlan {
  const taskById = new Map(tasks.map((t) => [t.task_id, t]))
  const inCycle = new Set(findCycle(deps, [...taskById.keys()]))

  const engLimits = new Map<string, number>()
  const engRoles = new Map<string, Set<string>>()
  for (const e of engineers) {
    engLimits.set(e.engineer_id, engineerSprintLimit(e.capacity_rate))
    if (!engRoles.has(e.engineer_id)) engRoles.set(e.engineer_id, new Set())
    engRoles.get(e.engineer_id)!.add(rl(e.role))
  }
  const allRoles = new Set(tasks.flatMap((t) => Object.keys(t.role_hours).map(rl)))
  const holderRoles = new Set([...engRoles.values()].flatMap((s) => [...s]))
  ;[...allRoles].filter((r) => !holderRoles.has(r)).sort().forEach((role, idx) => {
    const vid = `VIRTUAL-PM-${idx}`
    engLimits.set(vid, HOURS_FULL)
    engRoles.set(vid, new Set([role]))
  })

  const todo = tasks.filter((t) => t.status !== 'Done' && !inCycle.has(t.task_id))
  const todoSorted = [...todo].sort((a, b) => a.priority - b.priority || (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0))
  let order = topoOrder(todoSorted.map((t) => t.task_id), deps)
  if (order === null) order = todoSorted.map((t) => t.task_id)
  else {
    const seq = new Map(todoSorted.map((t, i) => [t.task_id, i]))
    order = [...order].sort((a, b) => (seq.get(a) ?? todoSorted.length) - (seq.get(b) ?? todoSorted.length))
  }

  const blockedBy = new Map<string, string[]>()
  for (const [a, b] of deps) if (taskById.has(b)) blockedBy.set(b, [...(blockedBy.get(b) ?? []), a])

  const historyByTeam = new Map<string, TeamHistory[]>()
  for (const h of history) historyByTeam.set(h.team_id, [...(historyByTeam.get(h.team_id) ?? []), h])

  const range = Array.from({ length: SPRINTS - firstFree + 1 }, (_, i) => firstFree + i)
  let engUsed = new Map<number, Map<string, number>>(range.map((n) => [n, new Map()]))
  let spLeft = new Map<number, Map<string, number>>()
  for (const n of range) spLeft.set(n, new Map([...historyByTeam].map(([team, h]) => [team, teamCapacitySp(h)])))
  for (const team of new Set(tasks.map((t) => t.team_id))) {
    if (!historyByTeam.has(team)) for (const n of range) spLeft.get(n)!.set(team, 0)
  }

  const assignedEnd = new Map<string, number>()
  const plan: EnginePlan = { sprints: range.map((n) => ({ sprint_no: n, items: [] })), decisions: [] }
  const sprintOf = (n: number) => plan.sprints[n - firstFree]

  const putHours = (role: string, hours: number, sprint: number) => {
    const used = engUsed.get(sprint)!
    const holders = [...engRoles].filter(([, roles]) => roles.has(role)).map(([id]) => id)
    // стабильная сортировка, как sorted(..., reverse=True) в Python
    holders.sort((a, b) => engLimits.get(b)! - (used.get(b) ?? 0) - (engLimits.get(a)! - (used.get(a) ?? 0)))
    let placed = 0
    for (const id of holders) {
      if (placed >= hours) break
      const free = engLimits.get(id)! - (used.get(id) ?? 0)
      if (free <= 0) continue
      const put = Math.min(hours - placed, free)
      used.set(id, (used.get(id) ?? 0) + put)
      placed += put
    }
    return placed
  }

  let remaining = [...order]
  let passes = 0
  const attempted = new Set<string>()
  while (remaining.length && passes <= SPRINTS * 10) {
    passes++
    let progress = false
    const still: string[] = []
    for (const taskId of remaining) {
      if (attempted.has(taskId)) continue
      attempted.add(taskId)
      const task = taskById.get(taskId)!
      const team = task.team_id
      const blockers = blockedBy.get(taskId) ?? []
      if (blockers.some((b) => inCycle.has(b))) {
        still.push(taskId)
        continue
      }
      if (blockers.some((b) => taskById.has(b) && !assignedEnd.has(b))) {
        still.push(taskId)
        continue
      }
      const earliest = Math.max(firstFree, ...blockers.filter((b) => assignedEnd.has(b)).map((b) => assignedEnd.get(b)! + 1))

      // load_world на бэке отдаёт spent_time = 0 → InProgress планируется полным объёмом
      const effSp = task.estimation_sp
      const overdue = false

      const hoursTotal = Object.values(task.role_hours).reduce((a, b) => a + b, 0)
      const hoursLeft = new Map(Object.entries(task.role_hours).map(([r, h]) => [rl(r), h || 0]))
      const hoursOnly = hoursTotal > 0

      let first: number | null = null
      let last: number | null = null
      let spToPlace = effSp
      let placedTotal = 0
      let ok = false
      const snapSp = new Map([...spLeft].map(([n, m]) => [n, new Map(m)]))
      const snapEng = new Map([...engUsed].map(([n, m]) => [n, new Map(m)]))

      for (let sprint = earliest; sprint <= SPRINTS; sprint++) {
        const leftSp = spLeft.get(sprint)?.get(team) ?? 0
        if (leftSp <= 0) continue
        if (spToPlace <= 0.01) {
          ok = true
          break
        }
        let placedHh = 0
        let putSp: number
        if (hoursOnly) {
          for (const [role, need] of hoursLeft) {
            if (need <= 0) continue
            const got = putHours(role, need, sprint)
            placedHh += got
            hoursLeft.set(role, need - got)
          }
          if (placedHh <= 0) continue
          const share = placedHh / hoursTotal
          putSp = spToPlace > 0 ? Math.min(leftSp, round2(spToPlace * share)) : 0
        } else {
          putSp = Math.min(leftSp, spToPlace)
        }
        spLeft.get(sprint)!.set(team, leftSp - putSp)
        spToPlace = round2(spToPlace - putSp)
        placedTotal += placedHh
        sprintOf(sprint).items.push({
          task_id: taskId,
          decision: 'planned',
          sprint_no: sprint,
          reason: first !== null && first < sprint ? 'разбита между спринтами' : overdue && first === null ? 'просрочена (overdue)' : '',
          step_points_sp: putSp,
        })
        if (first === null) first = sprint
        last = sprint
        if (hoursOnly && [...hoursLeft.values()].every((v) => v <= 0.01)) {
          ok = true
          break
        }
        if (!hoursOnly && spToPlace <= 0.01) {
          ok = true
          break
        }
      }

      if (ok && first !== null && last !== null) {
        assignedEnd.set(taskId, last)
        progress = true
        continue
      }
      if (first !== null && placedTotal > 0) {
        assignedEnd.set(taskId, last!)
        const item = sprintOf(first).items.find((i) => i.task_id === taskId)
        if (item) {
          const suffix = 'выполнится частично (остаток — за пределами квартала)'
          item.reason = item.reason ? `${item.reason}; ${suffix}` : suffix
        }
        progress = true
        continue
      }
      if (first !== null) {
        spLeft = snapSp
        engUsed = snapEng
        for (const s of plan.sprints) s.items = s.items.filter((i) => i.task_id !== taskId)
      }
      still.push(taskId)
    }
    remaining = still
    if (!progress) break
  }

  for (const taskId of remaining) {
    const blockers = blockedBy.get(taskId) ?? []
    const missing = blockers.filter((b) => taskById.has(b) && !assignedEnd.has(b))
    const reason = blockers.some((b) => inCycle.has(b))
      ? 'блокируется циклической зависимостью'
      : missing.length
        ? `не помещается: зависит от незапланированной ${missing.slice(0, 3).join(', ')}`
        : 'не влезла в ресурс/SP/роли до конца квартала — кандидат на отмену'
    plan.decisions.push({ task_id: taskId, decision: 'postponed', sprint_no: null, reason, step_points_sp: null })
  }
  return plan
}

/** Порт routes._recomputed_plan: виртуальный план после факта (для warnings/diff). */
export function recomputedPlan(before: EnginePlan, done: Set<string>): EnginePlan {
  const after: EnginePlan = { sprints: [], decisions: [] }
  const bucket = (n: number) => {
    let b = after.sprints.find((s) => s.sprint_no === n)
    if (!b) {
      b = { sprint_no: n, items: [] }
      after.sprints.push(b)
    }
    return b
  }
  for (const s of before.sprints) {
    for (const item of s.items) {
      if (done.has(item.task_id)) {
        bucket(item.sprint_no ?? 0).items.push({ ...item, decision: 'done_actual', reason: 'выполнено по факту спринта' })
        continue
      }
      const next = (item.sprint_no ?? 0) + 1
      if (next > SPRINTS) {
        after.decisions.push({ task_id: item.task_id, decision: 'postponed', sprint_no: null, reason: 'выполнение выходит за пределы квартала', step_points_sp: null })
        continue
      }
      bucket(next).items.push({ ...item, decision: 'planned', sprint_no: next, reason: 'не выполнено в плановом спринте, сдвигается' })
    }
  }
  after.sprints.sort((a, b) => a.sprint_no - b.sprint_no)
  return after
}

/** Порт replanner.compute_warnings. */
export function computeWarnings(before: EnginePlan, after: EnginePlan, done: Set<string>, taskMap: Map<string, MockTask>, deps: [string, string][], engineers: Engineer[]): PlanWarning[] {
  const warnings: PlanWarning[] = []
  const depsByBlocking = new Map<string, string[]>()
  for (const [a, b] of deps) depsByBlocking.set(a, [...(depsByBlocking.get(a) ?? []), b])
  const uniqSorted = (xs: string[]) => [...new Set(xs)].sort()

  const last = new Map<string, number>()
  for (const s of after.sprints) for (const i of s.items) last.set(i.task_id, s.sprint_no)
  if (after.decisions.length) {
    const latest = Math.max(0, ...last.values())
    const postponed = after.decisions.filter((d) => d.decision === 'postponed').map((d) => d.task_id)
    if (postponed.length && latest >= SPRINTS) {
      warnings.push({ kind: 'deadline_overflow', message: 'выполнение по прогнозу выходит за пределы квартала; под угрозой сдвиг всего плана', task_ids: uniqSorted(postponed) })
    }
  }

  const posBefore = new Map<string, number>()
  for (const s of before.sprints) for (const i of s.items) posBefore.set(i.task_id, s.sprint_no)
  const movedLater = new Set<string>()
  for (const [id, n] of last) {
    const pos = posBefore.get(id)
    if (pos && n > pos) movedLater.add(id)
  }
  if (movedLater.size) {
    const chained = new Set([...movedLater].filter((id) => depsByBlocking.has(id)))
    for (const id of movedLater) if ((depsByBlocking.get(id) ?? []).some((b) => movedLater.has(b))) chained.add(id)
    if (chained.size) warnings.push({ kind: 'dependency_shift', message: 'сдвиг цепочки зависимых задач из-за невыполнения блокирующих', task_ids: [...chained].sort() })
  }

  const itemsBySprint = new Map<number, Item[]>()
  for (const s of after.sprints) itemsBySprint.set(s.sprint_no, [...(itemsBySprint.get(s.sprint_no) ?? []), ...s.items])
  const undone = [...itemsBySprint].filter(([, items]) => !items.every((i) => done.has(i.task_id))).map(([n]) => n)
  if (undone.length) {
    const next = Math.min(...undone)
    const byTeam = new Map<string, Map<string, number>>()
    for (const item of itemsBySprint.get(next)!) {
      const task = taskMap.get(item.task_id)
      if (!task) continue
      const m = byTeam.get(task.team_id) ?? new Map()
      for (const [role, h] of Object.entries(task.role_hours)) m.set(role, (m.get(role) ?? 0) + h)
      byTeam.set(task.team_id, m)
    }
    const engHours = new Map<string, number>()
    for (const e of engineers) {
      const key = `${e.team_id}|${e.role}`
      engHours.set(key, (engHours.get(key) ?? 0) + (e.capacity_rate >= 1 ? 80 * e.capacity_rate : (40 * e.capacity_rate) / 0.5))
    }
    for (const [team, need] of byTeam) {
      for (const [role, hours] of need) {
        const available = engHours.get(`${team}|${role}`) ?? 0
        if (hours > available) {
          warnings.push({
            kind: 'role_deficit',
            message: `дефицит роли ${role} в команде ${team} на спринт ${next}: нужно ${Math.round(hours)} ч, доступно ${Math.round(available)} ч`,
            task_ids: itemsBySprint.get(next)!.filter((i) => taskMap.get(i.task_id)?.team_id === team).map((i) => i.task_id).sort(),
          })
        }
      }
    }
  }

  const ids = (p: EnginePlan) => new Set([...p.sprints.flatMap((s) => s.items.map((i) => i.task_id)), ...p.decisions.map((d) => d.task_id)])
  const beforeIds = ids(before)
  const afterIds = ids(after)
  const added = [...afterIds].filter((x) => !beforeIds.has(x)).sort()
  const removed = [...beforeIds].filter((x) => !afterIds.has(x)).sort()
  if (added.length || removed.length || movedLater.size) {
    const pyList = (xs: string[]) => `[${xs.map((x) => `'${x}'`).join(', ')}]`
    warnings.push({
      kind: 'composition_change',
      message: 'состав плана изменился: ' + (added.length ? `+${pyList(added)} ` : '') + (removed.length ? `-${pyList(removed)}` : ''),
      task_ids: uniqSorted([...added, ...removed, ...movedLater]),
    })
  }
  return warnings
}

/** Порт metrics.compute_metrics_initiatives. */
export function computeMetrics(initialItems: { task_id: string; parent_id: string | null }[], done: Set<string>, plannedSp: Map<number, number>, doneSp: Map<number, number>, quarterFinished: boolean): Metrics {
  const byParent = new Map<string, Set<string>>()
  for (const i of initialItems) {
    const parent = i.parent_id || i.task_id || '?'
    byParent.set(parent, (byParent.get(parent) ?? new Set()).add(i.task_id))
  }
  const doneCount = [...byParent.values()].filter((s) => s.size && [...s].every((id) => done.has(id))).length
  const pct: Metrics['sprint_completion_pct'] = {}
  const forecast: Metrics['sprint_completion_is_forecast'] = {}
  for (let n = 1; n <= SPRINTS; n++) {
    const planned = plannedSp.get(n)
    const actual = doneSp.get(n)
    if (planned && planned > 0 && actual !== undefined) {
      pct[n] = Math.round((actual / planned) * 1000) / 10
      forecast[n] = false
    } else {
      pct[n] = null
      forecast[n] = true
    }
  }
  return {
    quarter_completion_pct: byParent.size ? Math.round((doneCount / byParent.size) * 1000) / 10 : null,
    quarter_completion_is_forecast: !quarterFinished,
    sprint_completion_pct: pct,
    sprint_completion_is_forecast: forecast,
  }
}

/** Порт bus_factor.compute_bus_factor. */
export function computeBusFactor(engineers: Engineer[]): BusFactorReport {
  const items: BusFactorItem[] = []
  const byRole = new Map<string, Set<string>>()
  const byRoleTeam = new Map<string, Set<string>>()
  const bySkill = new Map<string, Set<string>>()
  const bySkillTeam = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, k: string, id: string) => m.set(k, (m.get(k) ?? new Set()).add(id))
  for (const e of engineers) {
    const role = e.role.toLowerCase()
    add(byRole, role, e.engineer_id)
    add(byRoleTeam, `${e.team_id} ${role}`, e.engineer_id)
    for (const s of e.skills_declared.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      add(bySkill, s, e.engineer_id)
      add(bySkillTeam, `${e.team_id} ${s}`, e.engineer_id)
    }
  }
  for (const [byScope, byTeam] of [
    [byRole, byRoleTeam],
    [bySkill, bySkillTeam],
  ] as const) {
    for (const [key, holders] of byScope) items.push({ scope_type: 'company', scope_id: 'company', key, holders: [...holders].sort(), factor: holders.size })
    for (const [k, holders] of byTeam) {
      const [team, key] = k.split(' ')
      items.push({ scope_type: 'team', scope_id: team, key, holders: [...holders].sort(), factor: holders.size })
    }
  }
  return { items, methodology: BUS_FACTOR_METHODOLOGY }
}
