// Мок-бэкенд в памяти. Повторяет src/api/routes.py: те же статусы, тексты ошибок, форматы и хранение plan_items.
// Стартовое состояние = бэк после POST /data/import: данные есть, планов нет.
// Отличия от бэка — только там, где бэк расходится со спекой (помечено «спека:»), список — в frontend/README.md.
// Подключается только из src/api/client.ts при VITE_API_MOCKS=true. Удаление: rm -rf src/mocks + блок USE_MOCKS в client.ts.
import { ApiError } from '../api/client'
import type { EngineerProfile, Plan, PlanTask, TeamOverview, UploadJob } from '../api/types'
import { DATASET_COLUMN_GUESSES, DATASET_CONFIRM_COUNTS, DATASET_PREVIEW_COUNTS, DATASET_UNMAPPED, DEPENDENCIES, ENGINEERS, TASKS, TEAM_HISTORY } from './data/dataset'
import { computeBusFactor, computeMetrics, computeWarnings, generatePlan, recomputedPlan, SPRINTS, teamCapacitySp, type EnginePlan, type Item } from './engine'
import type { FactRow, ItemRow, MockJob, PlanRow } from './types'

const plans: PlanRow[] = []
let items: ItemRow[] = []
const facts: FactRow[] = []
const jobs = new Map<string, MockJob>()

// Бэк хранит данные в БД — мок сохраняет состояние между перезагрузками страницы.
// Сброс: открыть любую страницу с ?mock-reset
const STORAGE_KEY = 'mock-backend-v2'
function loadState() {
  try {
    if (new URLSearchParams(location.search).has('mock-reset')) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { plans: PlanRow[]; items: ItemRow[]; facts: FactRow[]; priorities: Record<string, number> }
    plans.push(...saved.plans)
    items = saved.items
    facts.push(...saved.facts)
    for (const t of TASKS) if (saved.priorities[t.task_id] !== undefined) t.priority = saved.priorities[t.task_id]
  } catch {
    /* хранилище недоступно или повреждено — начинаем с чистого состояния */
  }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ plans, items, facts, priorities: Object.fromEntries(TASKS.map((t) => [t.task_id, t.priority])) }))
  } catch {
    /* приватный режим — состояние живёт до перезагрузки */
  }
}
loadState()

const deps = (): [string, string][] => DEPENDENCIES.map((d) => [d.blocking_task_id, d.blocked_task_id])
const taskMap = () => new Map(TASKS.map((t) => [t.task_id, t]))
const uuid = () => crypto.randomUUID().replace(/-/g, '')
/** Формат created_at как у бэка: «YYYY-MM-DD HH:MM:SS» (str(datetime) без T и зоны) */
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

function planOrm(id: string): PlanRow {
  const p = plans.find((x) => x.plan_id === id)
  if (!p) throw new ApiError(404, `план ${id} не найден`)
  return p
}

/** routes._plan_from_orm: planned → спринты (только непустые), остальное → decisions */
function planFromRows(planId: string): EnginePlan {
  const bySprint = new Map<number, Item[]>()
  const decisions: Item[] = []
  for (const it of items.filter((i) => i.plan_id === planId)) {
    const item: Item = { task_id: it.task_id, decision: it.decision, sprint_no: it.sprint_no, reason: it.reason, step_points_sp: it.planned_sp }
    if (it.decision === 'planned') bySprint.set(it.sprint_no ?? 0, [...(bySprint.get(it.sprint_no ?? 0) ?? []), item])
    else decisions.push({ task_id: it.task_id, decision: it.decision, sprint_no: it.sprint_no, reason: it.reason, step_points_sp: null })
  }
  return { sprints: [...bySprint].sort(([a], [b]) => a - b).map(([sprint_no, list]) => ({ sprint_no, items: list })), decisions }
}

function chainIds(planId: string): string[] {
  const out: string[] = []
  let cur: PlanRow | undefined = plans.find((p) => p.plan_id === planId)
  while (cur && !out.includes(cur.plan_id)) {
    out.push(cur.plan_id)
    cur = cur.parent_plan_id ? plans.find((p) => p.plan_id === cur!.parent_plan_id) : undefined
  }
  return out
}

const chainFacts = (planId: string) => facts.filter((f) => chainIds(planId).includes(f.plan_id)).sort((a, b) => a.sprint_no - b.sprint_no)

function storePlan(planId: string, plan: EnginePlan) {
  const tm = taskMap()
  for (const s of plan.sprints)
    for (const it of s.items) items.push({ plan_id: planId, task_id: it.task_id, team_id: tm.get(it.task_id)?.team_id ?? '', decision: it.decision, sprint_no: it.sprint_no, reason: it.reason, planned_sp: it.step_points_sp })
  for (const d of plan.decisions) items.push({ plan_id: planId, task_id: d.task_id, team_id: tm.get(d.task_id)?.team_id ?? '', decision: d.decision, sprint_no: null, reason: d.reason, planned_sp: null })
}

/** routes._recompute_plan_version */
function recomputeVersion(planId: string, afterSprint: number): PlanRow {
  // спека: факты берём по всей цепочке версий (бэк — только текущей версии, и уже закрытые задачи планируются заново)
  const done = new Set(chainFacts(planId).flatMap((f) => f.completed_task_ids))
  for (const t of TASKS) if (t.status === 'Done') done.add(t.task_id)
  const row: PlanRow = { plan_id: uuid(), is_initial: false, parent_plan_id: planId, recomputed_after_sprint: afterSprint, created_at: nowStr() }
  plans.push(row)
  const current = items.filter((i) => i.plan_id === planId)
  const child = generatePlan(TASKS.filter((t) => !done.has(t.task_id) && t.status !== 'Done'), ENGINEERS, TEAM_HISTORY, deps(), Math.max(afterSprint, 0) + 1)
  for (const it of current) {
    // спека: сохраняем и ранее закрытые (done_actual) строки, чтобы история не терялась в цепочке
    if (done.has(it.task_id) && (it.decision === 'planned' || it.decision === 'done_actual'))
      items.push({ ...it, plan_id: row.plan_id, decision: 'done_actual', reason: 'выполнено по факту спринта' })
  }
  storePlan(row.plan_id, child)
  return row
}

type Handler = (params: string[], body: unknown, search: URLSearchParams) => unknown
const routes: [string, RegExp, Handler][] = []
const on = (method: string, pattern: string, h: Handler) => routes.push([method, new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), h])

// --- онбординг ---
const snapshot = ({ polls: _p, ...job }: MockJob): UploadJob => job

// Мок стартует в состоянии «после импорта»; повтор импорта планы не трогает (как бэк после fix-import-preserves-plans)
on('POST', '/data/import', () => ({ status: 'imported', counts: DATASET_CONFIRM_COUNTS }))

on('POST', '/data/upload', (_p, body) => {
  const file = body instanceof FormData ? (body.get('file') as File | null) : null
  const name = file?.name ?? 'upload'
  const suffix = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  if (!['.xlsx', '.csv', '.json'].includes(suffix)) throw new ApiError(422, `поддерживаются xlsx/csv/json, получен ${suffix}`)
  // Формат датасета организаторов бэк распознаёт шаблоном сразу (status=ready, вопросов нет).
  // Для других файлов показываем ветку с вопросом — так выглядит незнакомый формат.
  const known = suffix === '.xlsx'
  const job: MockJob = {
    job_id: uuid(),
    filename: name,
    status: known ? 'ready' : 'questions',
    column_guesses: known ? DATASET_COLUMN_GUESSES : DATASET_COLUMN_GUESSES.slice(0, 4),
    questions: known ? [] : [{ question: 'Колонка «estimate» — это Story Points или часы?', options: ['task.estimation_sp', 'task.estimated_hh', 'пропустить'], context_column: 'estimate' }],
    unmapped: known ? DATASET_UNMAPPED : ['estimate'],
    preview_counts: DATASET_PREVIEW_COUNTS,
    polls: 0,
  }
  jobs.set(job.job_id, job)
  return snapshot(job)
})
on('GET', '/data/jobs/:id', ([id]) => {
  const job = jobs.get(id)
  if (!job) throw new ApiError(404, 'job не найден')
  return snapshot(job)
})
on('POST', '/data/jobs/:id/answers', ([id], body) => {
  const job = jobs.get(id)
  if (!job) throw new ApiError(404, 'job не найден')
  const answers = (body as { answers?: Record<string, string> })?.answers ?? {}
  for (const [column, target] of Object.entries(answers)) {
    if (target === 'пропустить') continue
    const [entity, field] = target.split('.')
    job.column_guesses = [...job.column_guesses.filter((g) => g.column !== column), { column, entity, field, confidence: 'high' }]
    job.unmapped = job.unmapped.filter((c) => c !== column)
  }
  job.questions = []
  job.status = 'ready'
  return snapshot(job)
})
on('POST', '/data/jobs/:id/confirm', ([id]) => {
  const job = jobs.get(id)
  if (!job) throw new ApiError(404, 'job не найден')
  if (job.status !== 'ready') throw new ApiError(409, `job не готов (${job.status})`)
  job.status = 'confirmed'
  return { status: 'confirmed', counts: DATASET_CONFIRM_COUNTS }
})

// --- план ---
on('POST', '/plans/generate', () => {
  const plan = generatePlan(TASKS, ENGINEERS, TEAM_HISTORY, deps())
  const row: PlanRow = { plan_id: uuid(), is_initial: true, parent_plan_id: null, recomputed_after_sprint: null, created_at: nowStr() }
  plans.push(row)
  storePlan(row.plan_id, plan)
  return { __status: 201, plan_id: row.plan_id, sprints: Object.fromEntries(plan.sprints.map((s) => [String(s.sprint_no), s.items.map((i) => i.task_id).sort()])) }
})
on('GET', '/plans', () => plans.map((p) => ({ ...p })))
on('GET', '/plans/:id', ([id]): Plan => {
  const row = planOrm(id)
  const plan = planFromRows(id)
  const tm = taskMap()
  const withTask = (i: Item): PlanTask => {
    const t = tm.get(i.task_id)
    return {
      task_id: i.task_id, decision: i.decision, sprint_no: i.sprint_no, reason: i.reason, step_points_sp: i.step_points_sp,
      summary: t?.summary ?? '', parent_id: t?.parent_id ?? null, estimation_sp: t?.estimation_sp ?? 0, estimated_hh: t?.estimated_hh ?? 0,
      planned_in_sprint: t ? t.status !== 'Done' : false, team_id: t?.team_id ?? '', role_hours: t?.role_hours ?? {},
    }
  }
  return {
    plan_id: id, parent_plan_id: row.parent_plan_id, is_initial: row.is_initial, recomputed_after_sprint: row.recomputed_after_sprint,
    sprints: plan.sprints.map((s) => ({ sprint_no: s.sprint_no, tasks: s.items.map(withTask) })),
    not_planned: plan.decisions.map(({ task_id, decision, sprint_no, reason }) => ({ task_id, decision, sprint_no, reason })),
  }
})
on('GET', '/plans/:id/tasks/:tid/explanation', ([id, tid]) => {
  planOrm(id)
  const it = items.find((i) => i.plan_id === id && i.task_id === tid)
  if (!it) throw new ApiError(404, `задача ${tid} не найдена в плане ${id}`)
  return { task_id: tid, decision: it.decision, sprint_no: it.sprint_no, reason: it.reason, planned_sp: it.planned_sp }
})
on('GET', '/tasks', () =>
  [...TASKS].sort((a, b) => (a.task_id < b.task_id ? -1 : 1)).map(({ priority: _p, ...t }) => ({ ...t })),
)
on('GET', '/dependencies', () => DEPENDENCIES.map((d) => ({ ...d })))
on('PUT', '/tasks/:id/priority', ([id], body) => {
  const raw = (body as { priority?: unknown } | null)?.priority
  if (raw === undefined || raw === null) throw new ApiError(422, 'priority обязателен')
  const priority = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
  if (!Number.isInteger(priority)) throw new ApiError(422, 'priority — целое число')
  const t = TASKS.find((x) => x.task_id === id)
  if (!t) throw new ApiError(404, 'задача не найдена')
  t.priority = priority
  return { status: 'updated', task_id: id, priority }
})
on('POST', '/plans/:id/tasks/:tid/cancel-request', ([id, tid]) => {
  planOrm(id)
  const rows = items.filter((i) => i.plan_id === id && i.task_id === tid)
  if (!rows.length) throw new ApiError(404, 'задача не в плане')
  for (const r of rows) {
    if (r.decision === 'postponed') {
      r.decision = 'cancelled_pending'
      r.reason = (r.reason ?? '') + ' (кандидат на отмену — ресурс/роли недоступны)'
    }
  }
  return { status: 'pending_confirmation', task_id: tid }
})
on('POST', '/plans/:id/tasks/:tid/confirm-cancel', ([id, tid]) => {
  planOrm(id)
  const rows = items.filter((i) => i.plan_id === id && i.task_id === tid)
  if (!rows.length) throw new ApiError(404, 'задача не в плане')
  if (!rows.some((r) => r.decision === 'cancelled_pending')) throw new ApiError(409, 'нет отложенной отмены (cancel-request)')
  for (const r of rows) {
    if (r.decision !== 'cancelled_pending') continue
    // спека: решение становится cancelled (бэк меняет только текст причины, decision остаётся cancelled_pending)
    r.decision = 'cancelled'
    r.reason = r.reason ? r.reason.replace('(кандидат на отмену', '(отмена подтверждена: ') : 'отмена подтверждена лидом'
  }
  return { status: 'cancelled', task_id: tid }
})

// --- факт и пересчёт ---
on('POST', '/plans/:id/sprints/:n/facts', ([id, n], body) => {
  const sprintNo = Number(n)
  if (!(sprintNo >= 1 && sprintNo <= SPRINTS)) throw new ApiError(422, `sprint_no должен быть 1..${SPRINTS}`)
  // спека: повтор факта спринта запрещён в пределах цепочки версий (бэк проверяет только текущую версию)
  if (chainFacts(id).some((f) => f.sprint_no === sprintNo)) throw new ApiError(409, 'факт этого спринта уже загружен')
  const b = (body ?? {}) as { completed_sp?: number; completed_task_ids?: string[]; notes?: string }
  planOrm(id)
  facts.push({ plan_id: id, sprint_no: sprintNo, completed_sp: Number(b.completed_sp ?? 0), completed_task_ids: b.completed_task_ids ?? [], notes: b.notes ?? '' })
  const child = recomputeVersion(id, sprintNo)
  return { status: 'accepted', plan_id: id, sprint_no: sprintNo, new_plan_id: child.plan_id }
})
on('POST', '/plans/:id/recompute', ([id], _b, q) => {
  planOrm(id)
  const after = Number(q.get('after_sprint') ?? 0)
  if (!(Number.isInteger(after) && after >= 0 && after <= SPRINTS)) throw new ApiError(422, `after_sprint должна быть 0..${SPRINTS}`)
  const child = recomputeVersion(id, after)
  return { status: 'recomputed', new_plan_id: child.plan_id, parent_plan_id: id, after_sprint: after }
})
on('GET', '/plans/:id/facts', ([id]) =>
  chainFacts(id).map(({ sprint_no, completed_sp, completed_task_ids, notes }) => ({ sprint_no, completed_sp, completed_task_ids: [...completed_task_ids], notes })),
)
on('GET', '/plans/:id/warnings', ([id]) => {
  planOrm(id)
  const before = planFromRows(id)
  const done = new Set(facts.filter((f) => f.plan_id === id).flatMap((f) => f.completed_task_ids))
  return computeWarnings(before, recomputedPlan(before, done), done, taskMap(), deps(), ENGINEERS)
})
on('GET', '/plans/:id/diff', ([id]) => {
  planOrm(id)
  const before = planFromRows(id)
  const done = new Set(facts.filter((f) => f.plan_id === id).flatMap((f) => f.completed_task_ids))
  const after = recomputedPlan(before, done)
  const beforeOf = new Map(before.sprints.flatMap((s) => s.items.map((i) => [i.task_id, s.sprint_no] as const)))
  const afterOf = new Map(after.sprints.flatMap((s) => s.items.map((i) => [i.task_id, s.sprint_no] as const)))
  return {
    moved: [...afterOf].filter(([tid, n]) => beforeOf.has(tid) && n > beforeOf.get(tid)!).map(([tid, n]) => ({ task_id: tid, from_sprint: beforeOf.get(tid)!, to_sprint: n })),
    postponed_now: after.decisions.filter((d) => !beforeOf.has(d.task_id)).map((d) => d.task_id),
  }
})
on('GET', '/plans/:id/metrics', ([id]) => {
  planOrm(id)
  const chain = chainIds(id)
  const initialId = [...chain].reverse().find((pid) => plans.find((p) => p.plan_id === pid)?.is_initial) ?? chain.at(-1)!
  const initial = planFromRows(initialId)
  const plannedSp = new Map(initial.sprints.map((s) => [s.sprint_no, s.items.reduce((a, i) => a + (i.step_points_sp ?? 0), 0)]))
  // спека: факты по всей цепочке версий (бэк берёт только факты этой версии — у пересчитанного плана метрики пустые)
  const chainF = chainFacts(id)
  const tm = taskMap()
  return computeMetrics(
    initial.sprints.flatMap((s) => s.items.map((i) => ({ task_id: i.task_id, parent_id: tm.get(i.task_id)?.parent_id ?? null }))),
    new Set(chainF.flatMap((f) => f.completed_task_ids)),
    plannedSp,
    new Map(chainF.map((f) => [f.sprint_no, f.completed_sp])),
    chainF.length >= SPRINTS,
  )
})

// --- звёздная карта ---
function teamsOverview(): TeamOverview[] {
  const map = new Map<string, TeamOverview>()
  for (const e of ENGINEERS) {
    const t = map.get(e.team_id) ?? { team_id: e.team_id, engineers: [] }
    t.engineers.push({ engineer_id: e.engineer_id, role: e.role, grade: e.grade, capacity_rate: e.capacity_rate })
    map.set(e.team_id, t)
  }
  return [...map.values()]
}
on('GET', '/teams', () => teamsOverview())
on('GET', '/teams/:id', ([id]) => {
  const members = ENGINEERS.filter((e) => e.team_id === id)
  const hist = TEAM_HISTORY.filter((h) => h.team_id === id)
  if (!members.length && !hist.length) throw new ApiError(404, 'команда не найдена')
  return { team_id: id, members: members.map((m) => ({ ...m })), capacity_sp_per_sprint: teamCapacitySp(hist), sprint_history: hist.map((h) => ({ ...h })) }
})
on('GET', '/engineers', (_p, _b, q) =>
  ENGINEERS.filter(
    (e) =>
      (!q.get('team_id') || e.team_id === q.get('team_id')) &&
      (!q.get('role') || e.role.toLowerCase().includes(q.get('role')!.toLowerCase())) &&
      (!q.get('grade') || e.grade.toLowerCase() === q.get('grade')!.toLowerCase()) &&
      (q.get('min_rate') === null || e.capacity_rate >= Number(q.get('min_rate'))) &&
      (!q.get('skill') || e.skills_declared.toLowerCase().includes(q.get('skill')!.toLowerCase())),
  ).map((e) => ({ ...e })),
)
on('GET', '/engineers/:id', ([id]): EngineerProfile => {
  const entries = ENGINEERS.filter((e) => e.engineer_id === id)
  if (!entries.length) throw new ApiError(404, 'не найден')
  const myTeams = new Set(entries.map((e) => e.team_id))
  const singles = computeBusFactor(ENGINEERS).items.filter((i) => i.factor === 1 && myTeams.has(i.scope_id)).map((i) => i.key)
  return {
    engineer_id: id,
    assignments: entries.map((e) => ({
      team_id: e.team_id, role: e.role, grade: e.grade, skills_declared: e.skills_declared, capacity_rate: e.capacity_rate,
      parttime: e.capacity_rate < 1, hours_per_sprint: Math.round(80 * e.capacity_rate * 10) / 10,
    })),
    single_holder_alerts: [...new Set(singles)].sort(),
  }
})
on('GET', '/star-map/summary', () => {
  const fte: Record<string, number> = {}
  for (const e of ENGINEERS) fte[e.team_id] = (fte[e.team_id] ?? 0) + Math.min(e.capacity_rate, 1)
  return { teams: teamsOverview(), fte_distribution: fte, single_holder_competencies: computeBusFactor(ENGINEERS).items.filter((i) => i.factor === 1) }
})
on('GET', '/bus-factor', () => computeBusFactor(ENGINEERS))

export async function handleMock<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Задержка как у сети: интерфейс должен показывать состояния загрузки
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 200))
  const url = new URL(path, 'http://mock')
  for (const [m, re, h] of routes) {
    const match = m === method && url.pathname.match(re)
    if (match) {
      const result = h(match.slice(1).map(decodeURIComponent), body, url.searchParams) as Record<string, unknown>
      if (method !== 'GET') saveState()
      if (result && typeof result === 'object' && '__status' in result) delete result.__status
      return structuredClone(result) as T
    }
  }
  throw new ApiError(404, 'Not Found')
}

// для сверки мока с реальным бэком (scratch-скрипты), в приложении не используется
export const __mockState = { plans, facts, get items() { return items }, set items(v) { items = v } }
