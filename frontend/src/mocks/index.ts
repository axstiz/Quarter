// Мок-бэкенд в памяти. Подключается только из src/api/client.ts при VITE_API_MOCKS=true.
// Удаление моков: rm -rf src/mocks + убрать блок USE_MOCKS в client.ts.
import { ApiError } from '../api/client'
import type { EngineerProfile, Metrics, Plan, PlanTask, StarMapSummary, TeamDetail, TeamOverview, UploadJob } from '../api/types'
import { DEPENDENCIES, ENGINEERS, TASKS, TEAM_HISTORY } from './data/dataset'
import { buildPlan, computeBusFactor, computeWarnings } from './planner'
import type { MockPlan, MockState } from './types'

const state: MockState = { plans: [], facts: {}, warnings: {}, diffs: {}, jobs: {} }
let seq = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`

function createPlan(parent: MockPlan | null, afterSprint: number, doneIds = new Set<string>()): MockPlan {
  const built = buildPlan({ fixedUntil: afterSprint, base: parent ?? undefined, doneTaskIds: doneIds })
  const plan: MockPlan = {
    plan_id: newId('plan'),
    parent_plan_id: parent?.plan_id ?? null,
    is_initial: !parent,
    recomputed_after_sprint: parent ? afterSprint : null,
    created_at: new Date().toISOString(),
    ...built,
  }
  state.plans.push(plan)
  return plan
}

// Стартовое состояние демо: данные загружены, первичный план построен.
createPlan(null, 0)

function findPlan(id: string): MockPlan {
  const p = state.plans.find((x) => x.plan_id === id)
  if (!p) throw new ApiError(404, `план ${id} не найден`)
  return p
}

function chainFacts(planId: string) {
  const out = []
  let cur: MockPlan | undefined = findPlan(planId)
  while (cur) {
    out.push(...(state.facts[cur.plan_id] ?? []))
    cur = cur.parent_plan_id ? state.plans.find((p) => p.plan_id === cur!.parent_plan_id) : undefined
  }
  return out.sort((a, b) => a.sprint_no - b.sprint_no)
}

function initialOf(plan: MockPlan): MockPlan {
  let cur = plan
  while (cur.parent_plan_id) cur = findPlan(cur.parent_plan_id)
  return cur
}

function planView(p: MockPlan): Plan {
  const withTask = (i: MockPlan['items'][number]): PlanTask => {
    const t = TASKS.find((x) => x.task_id === i.task_id)!
    return {
      ...i,
      summary: t.summary,
      parent_id: t.parent_id,
      estimation_sp: t.estimation_sp,
      estimated_hh: t.estimated_hh,
      planned_in_sprint: t.status !== 'Done',
      team_id: t.team_id,
      role_hours: t.role_hours,
    }
  }
  return {
    plan_id: p.plan_id,
    parent_plan_id: p.parent_plan_id,
    is_initial: p.is_initial,
    recomputed_after_sprint: p.recomputed_after_sprint,
    sprints: [1, 2, 3, 4, 5, 6].map((n) => ({
      sprint_no: n,
      tasks: p.items.filter((i) => i.sprint_no === n).map(withTask),
    })),
    not_planned: p.not_planned,
  }
}

function teamsOverview(): TeamOverview[] {
  const map = new Map<string, TeamOverview>()
  for (const e of ENGINEERS) {
    const t = map.get(e.team_id) ?? { team_id: e.team_id, engineers: [] }
    t.engineers.push({ engineer_id: e.engineer_id, role: e.role, grade: e.grade, capacity_rate: e.capacity_rate })
    map.set(e.team_id, t)
  }
  return [...map.values()]
}

function metrics(plan: MockPlan): Metrics {
  const initial = initialOf(plan)
  const facts = chainFacts(plan.plan_id)
  const done = new Set(facts.flatMap((f) => f.completed_task_ids))
  const sprintPct: Metrics['sprint_completion_pct'] = {}
  const sprintForecast: Metrics['sprint_completion_is_forecast'] = {}
  for (let n = 1; n <= 6; n++) {
    const planned = initial.items.filter((i) => i.sprint_no === n).reduce((s, i) => s + (i.step_points_sp ?? 0), 0)
    const fact = facts.find((f) => f.sprint_no === n)
    sprintPct[n] = fact && planned ? Math.round((fact.completed_sp / planned) * 1000) / 10 : null
    sprintForecast[n] = !fact
  }
  const initiatives = new Map<string, string[]>()
  for (const i of initial.items) {
    const parent = TASKS.find((t) => t.task_id === i.task_id)?.parent_id ?? i.task_id
    initiatives.set(parent, [...(initiatives.get(parent) ?? []), i.task_id])
  }
  const completed = [...initiatives.values()].filter((ids) => ids.every((id) => done.has(id))).length
  return {
    quarter_completion_pct: initiatives.size ? Math.round((completed / initiatives.size) * 1000) / 10 : null,
    quarter_completion_is_forecast: facts.length < 6,
    sprint_completion_pct: sprintPct,
    sprint_completion_is_forecast: sprintForecast,
  }
}

function jobSnapshot(job: MockState['jobs'][string]): UploadJob {
  const { polls: _polls, ...rest } = job
  return rest
}

type Handler = (params: string[], body: unknown, search: URLSearchParams) => unknown
const routes: [string, RegExp, Handler][] = []
const on = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), h])

// --- онбординг ---
on('POST', '/data/upload', (_p, body) => {
  const file = body instanceof FormData ? (body.get('file') as File | null) : null
  const name = file?.name ?? 'dataset.xlsx'
  if (!/\.(xlsx|csv|json)$/i.test(name)) throw new ApiError(422, `поддерживаются xlsx/csv/json, получен ${name.split('.').pop()}`)
  const job = {
    job_id: newId('job'),
    filename: name,
    status: 'mapping' as const,
    column_guesses: [],
    questions: [],
    unmapped: [],
    preview_counts: {},
    polls: 0,
  }
  state.jobs[job.job_id] = job
  return jobSnapshot(job)
})
on('GET', '/data/jobs/:id', ([id]) => {
  const job = state.jobs[id]
  if (!job) throw new ApiError(404, 'job не найден')
  job.polls++
  if (job.status === 'mapping' && job.polls >= 3) {
    job.column_guesses = [
      { column: 'task_id', entity: 'task', field: 'task_id', confidence: 'high' },
      { column: 'summary', entity: 'task', field: 'summary', confidence: 'high' },
      { column: 'team_id', entity: 'task', field: 'team_id', confidence: 'high' },
      { column: 'Оценка', entity: 'task', field: 'estimation_sp', confidence: 'low' },
      { column: 'engineer_id', entity: 'engineer', field: 'engineer_id', confidence: 'high' },
      { column: 'role', entity: 'engineer', field: 'role', confidence: 'medium' },
      { column: 'capacity_rate', entity: 'engineer', field: 'capacity_rate', confidence: 'high' },
    ]
    job.unmapped = ['Комментарий']
    job.questions = [
      {
        question: 'Колонка «Оценка» — это Story Points или часы?',
        options: ['task.estimation_sp', 'task.estimated_hh', 'пропустить'],
        context_column: 'Оценка',
      },
    ]
    job.preview_counts = { task: TASKS.length, engineer: ENGINEERS.length, dependency: DEPENDENCIES.length, team_history: TEAM_HISTORY.length }
    job.status = 'questions'
  }
  return jobSnapshot(job)
})
on('POST', '/data/jobs/:id/answers', ([id], body) => {
  const job = state.jobs[id]
  if (!job) throw new ApiError(404, 'job не найден')
  const answers = (body as { answers: Record<string, string> }).answers
  job.column_guesses = job.column_guesses.map((g) =>
    answers[g.column] && answers[g.column] !== 'пропустить'
      ? { ...g, field: answers[g.column].split('.')[1], confidence: 'high' }
      : g,
  )
  job.questions = []
  job.status = 'ready'
  return jobSnapshot(job)
})
on('POST', '/data/jobs/:id/confirm', ([id]) => {
  const job = state.jobs[id]
  if (!job) throw new ApiError(404, 'job не найден')
  if (job.status !== 'ready') throw new ApiError(409, `job не готов (${job.status})`)
  job.status = 'confirmed'
  return {
    status: 'confirmed',
    counts: { tasks: TASKS.length, engineers: ENGINEERS.length, dependencies: DEPENDENCIES.length, team_history: TEAM_HISTORY.length },
  }
})

// --- план ---
on('GET', '/plans', () =>
  state.plans.map(({ plan_id, is_initial, parent_plan_id, recomputed_after_sprint, created_at }) => ({
    plan_id, is_initial, parent_plan_id, recomputed_after_sprint, created_at,
  })),
)
on('POST', '/plans/generate', () => {
  const p = createPlan(null, 0)
  const sprints: Record<string, string[]> = {}
  for (const i of p.items) (sprints[String(i.sprint_no)] ??= []).push(i.task_id)
  return { plan_id: p.plan_id, sprints }
})
on('GET', '/plans/:id', ([id]) => planView(findPlan(id)))
on('GET', '/dependencies', () => DEPENDENCIES)
on('GET', '/tasks', () =>
  TASKS.map(({ task_id, parent_id, team_id, summary, status, estimation_sp, estimated_hh, role_hours }) => ({
    task_id, parent_id, team_id, summary, status, estimation_sp, estimated_hh, role_hours,
  })),
)
on('PUT', '/tasks/:id/priority', ([id], body) => {
  const t = TASKS.find((x) => x.task_id === id)
  if (!t) throw new ApiError(404, 'задача не найдена')
  const priority = (body as { priority?: number })?.priority
  if (!Number.isInteger(priority)) throw new ApiError(422, 'priority — целое число')
  t.priority = priority!
  return { status: 'updated', task_id: id, priority }
})
on('POST', '/plans/:id/tasks/:tid/cancel-request', ([id, tid]) => {
  const p = findPlan(id)
  const item = [...p.items, ...p.not_planned].find((i) => i.task_id === tid)
  if (!item) throw new ApiError(404, 'задача не в плане')
  item.decision = 'cancelled_pending'
  return { status: 'pending_confirmation', task_id: tid }
})
on('POST', '/plans/:id/tasks/:tid/confirm-cancel', ([id, tid]) => {
  const p = findPlan(id)
  const item = [...p.items, ...p.not_planned].find((i) => i.task_id === tid)
  if (!item) throw new ApiError(404, 'задача не в плане')
  if (item.decision !== 'cancelled_pending') throw new ApiError(409, 'нет отложенной отмены (cancel-request)')
  item.decision = 'cancelled'
  item.reason = `Отменена лидом. ${item.reason}`
  return { status: 'cancelled', task_id: tid }
})

// --- факт и пересчёт ---
on('POST', '/plans/:id/sprints/:n/facts', ([id, n], body) => {
  const sprintNo = Number(n)
  if (!(sprintNo >= 1 && sprintNo <= 6)) throw new ApiError(422, 'sprint_no должен быть 1..6')
  const plan = findPlan(id)
  if (chainFacts(id).some((f) => f.sprint_no === sprintNo)) throw new ApiError(409, 'факт этого спринта уже загружен')
  const b = body as { completed_sp?: number; completed_task_ids?: string[]; notes?: string }
  const fact = { sprint_no: sprintNo, completed_sp: b.completed_sp ?? 0, completed_task_ids: b.completed_task_ids ?? [], notes: b.notes ?? '' }
  ;(state.facts[id] ??= []).push(fact)

  const done = new Set(chainFacts(id).flatMap((f) => f.completed_task_ids))
  const next = createPlan(plan, sprintNo, done)
  state.warnings[id] = computeWarnings(plan, next, sprintNo)
  const before = new Map(plan.items.map((i) => [i.task_id, i.sprint_no ?? 0]))
  state.diffs[id] = {
    moved: next.items
      .filter((i) => (i.sprint_no ?? 0) > (before.get(i.task_id) ?? 99))
      .map((i) => ({ task_id: i.task_id, from_sprint: before.get(i.task_id)!, to_sprint: i.sprint_no! })),
    postponed_now: next.not_planned.filter((x) => before.has(x.task_id)).map((x) => x.task_id),
  }
  return { status: 'accepted', plan_id: id, sprint_no: sprintNo, new_plan_id: next.plan_id }
})
on('POST', '/plans/:id/recompute', ([id]) => {
  const plan = findPlan(id)
  const facts = chainFacts(id)
  const after = facts.at(-1)?.sprint_no ?? 0
  const next = createPlan(plan, after, new Set(facts.flatMap((f) => f.completed_task_ids)))
  return { status: 'recomputed', new_plan_id: next.plan_id, parent_plan_id: id, after_sprint: after }
})
on('GET', '/plans/:id/facts', ([id]) => chainFacts(id))
on('GET', '/plans/:id/warnings', ([id]) => (findPlan(id), state.warnings[id] ?? []))
on('GET', '/plans/:id/diff', ([id]) => (findPlan(id), state.diffs[id] ?? { moved: [], postponed_now: [] }))
on('GET', '/plans/:id/metrics', ([id]) => metrics(findPlan(id)))

// --- звёздная карта ---
on('GET', '/teams', () => teamsOverview())
on('GET', '/teams/:id', ([id]): TeamDetail => {
  const members = ENGINEERS.filter((e) => e.team_id === id)
  const hist = TEAM_HISTORY.filter((h) => h.team_id === id)
  if (!members.length && !hist.length) throw new ApiError(404, 'команда не найдена')
  const avg = hist.reduce((s, h) => s + h.velocity_achieved, 0) / (hist.length || 1)
  return { team_id: id, members, capacity_sp_per_sprint: Math.round(avg * 0.8 * 10) / 10, sprint_history: hist }
})
on('GET', '/engineers', (_p, _b, q) =>
  ENGINEERS.filter(
    (e) =>
      (!q.get('team_id') || e.team_id === q.get('team_id')) &&
      (!q.get('role') || e.role.toLowerCase().includes(q.get('role')!.toLowerCase())) &&
      (!q.get('grade') || e.grade.toLowerCase() === q.get('grade')!.toLowerCase()) &&
      (!q.get('skill') || e.skills_declared.toLowerCase().includes(q.get('skill')!.toLowerCase())) &&
      (!q.get('min_rate') || e.capacity_rate >= Number(q.get('min_rate'))),
  ),
)
on('GET', '/engineers/:id', ([id]): EngineerProfile => {
  const entries = ENGINEERS.filter((e) => e.engineer_id === id)
  if (!entries.length) throw new ApiError(404, 'не найден')
  const teams = new Set(entries.map((e) => e.team_id))
  const singles = computeBusFactor().items.filter((i) => i.factor === 1 && teams.has(i.scope_id) && i.holders.includes(id))
  return {
    engineer_id: id,
    assignments: entries.map((e) => ({
      team_id: e.team_id,
      role: e.role,
      grade: e.grade,
      skills_declared: e.skills_declared,
      capacity_rate: e.capacity_rate,
      parttime: e.capacity_rate < 1,
      hours_per_sprint: Math.round(80 * e.capacity_rate * 10) / 10,
    })),
    single_holder_alerts: [...new Set(singles.map((s) => s.key))].sort(),
  }
})
on('GET', '/star-map/summary', (): StarMapSummary => {
  const fte: Record<string, number> = {}
  for (const e of ENGINEERS) fte[e.team_id] = (fte[e.team_id] ?? 0) + Math.min(e.capacity_rate, 1)
  return {
    teams: teamsOverview(),
    fte_distribution: fte,
    single_holder_competencies: computeBusFactor().items.filter((i) => i.factor === 1),
  }
})
on('GET', '/bus-factor', () => computeBusFactor())

export async function handleMock<T>(method: string, path: string, body?: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 180 + Math.random() * 320))
  const url = new URL(path, 'http://mock')
  for (const [m, re, h] of routes) {
    const match = m === method && url.pathname.match(re)
    if (match) {
      const result = h(match.slice(1).map(decodeURIComponent), body, url.searchParams)
      // Отдаём копию, чтобы UI не мутировал состояние мока.
      return structuredClone(result) as T
    }
  }
  throw new ApiError(404, `мок не реализован: ${method} ${url.pathname}`)
}
