import type { Decision, Explanation, Plan, PlanTask, TaskInfo } from '@/api/types'

export const SPRINT_NUMBERS = [1, 2, 3, 4, 5, 6]

/** Строка плана в спринте. Задача может занимать несколько спринтов — тогда у неё несколько частей. */
export interface PlanRow extends PlanTask {
  part: number
  parts: number
}

export interface TaskSummary {
  task_id: string
  summary: string
  team_id: string
  parent_id: string | null
  estimation_sp: number
  estimated_hh: number
  role_hours: Record<string, number>
  /** Итоговое решение по задаче в этой версии плана */
  decision: Decision
  /** Самая содержательная причина из всех частей */
  reason: string
  sprints: number[]
  plannedSp: number
  rows: PlanRow[]
}

export interface PlanModel {
  /** Всегда 6 спринтов, выполненные задачи — в своих спринтах */
  sprints: { sprint_no: number; rows: PlanRow[] }[]
  /** Не помещаются в квартал: перенесены за квартал, ждут отмены, отменены */
  outside: TaskSummary[]
  tasks: Map<string, TaskSummary>
}

/**
 * Приводит ответ GET /plans/{id} к виду для экранов. Особенности бэка:
 * - одна задача может стоять в нескольких спринтах (разбиение по SP/часам);
 * - выполненные по факту задачи приходят в not_planned с decision=done_actual и sprint_no;
 * - в sprints только спринты, где есть запланированные задачи.
 */
export function buildPlanModel(plan: Plan, tasksInfo: TaskInfo[]): PlanModel {
  const info = new Map(tasksInfo.map((t) => [t.task_id, t]))
  const bySprint = new Map<number, PlanTask[]>(SPRINT_NUMBERS.map((n) => [n, []]))

  for (const s of plan.sprints) bySprint.get(s.sprint_no)?.push(...s.tasks)

  const fromInfo = (e: Explanation): PlanTask => {
    const t = info.get(e.task_id)
    return {
      task_id: e.task_id, decision: e.decision, sprint_no: e.sprint_no, reason: e.reason, step_points_sp: null,
      summary: t?.summary ?? '', parent_id: t?.parent_id ?? null, estimation_sp: t?.estimation_sp ?? 0, estimated_hh: t?.estimated_hh ?? 0,
      planned_in_sprint: false, team_id: t?.team_id ?? '', role_hours: t?.role_hours ?? {},
    }
  }

  const outsideExpl = new Map<string, Explanation>()
  for (const e of plan.not_planned) {
    if (e.decision === 'done_actual' && e.sprint_no) {
      const list = bySprint.get(e.sprint_no)
      if (list && !list.some((x) => x.task_id === e.task_id)) list.push(fromInfo(e))
    } else if (e.decision !== 'done_actual') {
      outsideExpl.set(e.task_id, e)
    }
  }

  // одна строка на (задача × спринт): оптимизатор может положить две части задачи в один спринт
  for (const n of SPRINT_NUMBERS) bySprint.set(n, mergeSameTask(bySprint.get(n)!))

  // нумерация частей задачи по спринтам
  const partsOf = new Map<string, number[]>()
  for (const n of SPRINT_NUMBERS) for (const t of bySprint.get(n)!) partsOf.set(t.task_id, [...(partsOf.get(t.task_id) ?? []), n])

  const sprints = SPRINT_NUMBERS.map((n) => ({
    sprint_no: n,
    rows: bySprint.get(n)!.map((t) => {
      const list = partsOf.get(t.task_id)!
      return { ...t, part: list.indexOf(n) + 1, parts: list.length }
    }),
  }))

  const tasks = new Map<string, TaskSummary>()
  for (const s of sprints) {
    for (const r of s.rows) {
      const cur = tasks.get(r.task_id)
      if (cur) {
        cur.rows.push(r)
        cur.sprints.push(s.sprint_no)
        cur.plannedSp += r.step_points_sp ?? 0
        if (!cur.reason && r.reason) cur.reason = r.reason
      } else {
        tasks.set(r.task_id, {
          task_id: r.task_id, summary: r.summary, team_id: r.team_id, parent_id: r.parent_id, estimation_sp: r.estimation_sp,
          estimated_hh: r.estimated_hh, role_hours: r.role_hours, decision: r.decision, reason: r.reason,
          sprints: [s.sprint_no], plannedSp: r.step_points_sp ?? 0, rows: [r],
        })
      }
    }
  }
  for (const t of tasks.values()) {
    t.decision = t.rows.every((r) => r.decision === 'done_actual') ? 'done_actual' : t.rows.find((r) => r.decision !== 'done_actual')!.decision
    // «разбита между спринтами» — служебная пометка части, для задачи в целом неинформативна
    const meaningful = t.rows.map((r) => r.reason).find((x) => x && x !== 'разбита между спринтами')
    t.reason = meaningful ?? ''
  }

  const outside: TaskSummary[] = []
  for (const e of outsideExpl.values()) {
    const base = fromInfo(e)
    const summary: TaskSummary = {
      task_id: e.task_id, summary: base.summary, team_id: base.team_id, parent_id: base.parent_id, estimation_sp: base.estimation_sp,
      estimated_hh: base.estimated_hh, role_hours: base.role_hours, decision: e.decision, reason: e.reason, sprints: [], plannedSp: 0, rows: [],
    }
    if (!tasks.has(e.task_id)) tasks.set(e.task_id, summary)
    outside.push(summary)
  }

  return { sprints, outside, tasks }
}

/** Схлопывает строки одной задачи внутри спринта: SP суммируются, факт побеждает, причина — первая непустая. */
function mergeSameTask(rows: PlanTask[]): PlanTask[] {
  const byTask = new Map<string, PlanTask>()
  for (const r of rows) {
    const cur = byTask.get(r.task_id)
    if (!cur) { byTask.set(r.task_id, { ...r }); continue }
    if (r.step_points_sp != null) cur.step_points_sp = (cur.step_points_sp ?? 0) + r.step_points_sp
    if (r.decision === 'done_actual') cur.decision = 'done_actual'
    if (!cur.reason && r.reason) cur.reason = r.reason
    if (cur.pinned_sprint == null && r.pinned_sprint != null) cur.pinned_sprint = r.pinned_sprint
  }
  return [...byTask.values()]
}

/** Задача влезла в квартал не целиком: остаток за 12-й неделей (причина от планировщика). */
export const isPartial = (task: TaskSummary) => [task.reason, ...task.rows.map((r) => r.reason)].some((r) => r?.includes('частично'))

/** «1», «1–2», «2, 4» */
export function formatSprints(list: number[]) {
  if (!list.length) return '—'
  const sorted = [...list].sort((a, b) => a - b)
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1)
  return contiguous && sorted.length > 1 ? `${sorted[0]}–${sorted.at(-1)}` : sorted.join(', ')
}
