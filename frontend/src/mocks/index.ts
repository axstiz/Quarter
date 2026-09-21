// Мок-бэкенд в памяти. Повторяет src/api/routes.py: те же статусы, тексты ошибок, форматы и хранение plan_items.
// Стартовое состояние = бэк после POST /data/import: данные есть, планов нет.
// Отличия от бэка — только там, где бэк расходится со спекой (помечено «спека:»), список — в frontend/README.md.
// Подключается только из src/api/client.ts при VITE_API_MOCKS=true. Удаление: rm -rf src/mocks + блок USE_MOCKS в client.ts.
import { ApiError } from '../api/client'
import { loadAuth } from '../api/auth'
import type { EngineerProfile, Plan, PlanTask, TeamOverview, UploadJob } from '../api/types'
import { DATASET_COLUMN_GUESSES, DATASET_CONFIRM_COUNTS, DATASET_PREVIEW_COUNTS, DATASET_UNMAPPED, DEPENDENCIES, ENGINEERS, TASKS, TEAM_HISTORY } from './data/dataset'
import { computeBusFactor, computeMetrics, computeWarnings, generatePlan, recomputedPlan, SPRINTS, teamCapacitySp, type EnginePlan, type Item } from './engine'
import type { FactRow, ItemRow, MockJob, PlanRow } from './types'

const plans: PlanRow[] = []
let items: ItemRow[] = []
const facts: FactRow[] = []
const jobs = new Map<string, MockJob>()

// --- workspaces (change 021): список, участники, права, аудит, изоляция данных по ws ---
interface WsState {
  imported: boolean
  /** Приоритеты не-default workspace (базовые — из шаблона TASKS) */
  priorities: Record<string, number> | null
}
const wsState = new Map<string, WsState>()
interface WsRow {
  id: string
  name: string
  created_by: string | null
}
const workspaces = new Map<string, WsRow>()
const memberships = new Map<string, Map<string, string>>() // wsId → userId → role
interface RoleOverrideRow {
  ws: string
  role: string
  permission: string
  enabled: boolean
}
const roleOverrides: RoleOverrideRow[] = []
interface AuditRow {
  id: number
  ws: string
  actor_id: string
  action: string
  target: string
  details: Record<string, unknown> | null
  created_at: string
}
const auditLog: AuditRow[] = []
let auditSeq = 1

const DEFAULT_MATRIX: Record<string, string[]> = {
  import_data: ['admin', 'editor'],
  crud_tasks: ['admin', 'editor'],
  crud_engineers: ['admin', 'editor'],
  edit_priority: ['admin', 'editor'],
  cancel_request: ['admin', 'editor'],
  confirm_cancel: ['admin'],
  sprint_facts: ['admin', 'editor'],
  recompute: ['admin', 'editor'],
  plans_generate: ['admin', 'editor'],
  plans_optimize: ['admin', 'editor'],
  plans_optimize_staffing: ['admin'],
  workspace_admin: ['admin'],
  members_admin: ['admin'],
}

const wsOf = (headers?: Record<string, string>) => headers?.['X-Workspace-Id']?.trim() || 'default'
/** Мок-пользователь: демо-входы дают userId=роли, email-вход — 'mock' (auth.ts) */
const mockUser = () => {
  const s = loadAuth()
  return { id: s?.userId || 'mock', role: s?.role || 'reader' }
}
const wsReady = (ws: string) => ws === 'default' || wsState.get(ws)?.imported
/** Задачи контекста: default — общий mutable-шаблон; в остальных — копии с приоритетами ws */
const tasksFor = (ws: string) => {
  if (ws === 'default') return TASKS
  const st = wsState.get(ws)
  return TASKS.map((t) => ({ ...t, priority: st?.priorities?.[t.task_id] ?? t.priority }))
}
const taskMapFor = (ws: string) => new Map(tasksFor(ws).map((t) => [t.task_id, t]))
const rowWs = (row: { workspace_id?: string }) => row.workspace_id ?? 'default'
const ensureWs = (ws: string) => {
  if (!workspaces.has(ws)) {
    workspaces.set(ws, { id: ws, name: ws === 'default' ? 'Default Workspace' : ws, created_by: null })
    memberships.set(ws, new Map())
  }
}
const roleInWs = (ws: string, userId: string) => {
  ensureWs(ws)
  const direct = memberships.get(ws)!.get(userId)
  if (direct) return direct
  return ws === 'default' ? mockUser().role : null
}
const addAudit = (ws: string, actor_id: string, action: string, target: string, details: Record<string, unknown> | null = null) => {
  auditLog.unshift({ id: auditSeq++, ws, actor_id, action, target, details, created_at: nowStr() })
}
/** Порт permissions.check_permission (роль admin всегда допущена) */
const hasPermission = (ws: string, role: string, permission: string) => {
  if (role === 'admin') return true
  const ov = roleOverrides.find((o) => o.ws === ws && o.role === role && o.permission === permission)
  if (ov) return ov.enabled
  return DEFAULT_MATRIX[permission]?.includes(role) ?? false
}
const requirePermission = (ws: string, permission: string) => {
  const user = mockUser()
  const role = roleInWs(ws, user.id)
  if (role === null) throw new ApiError(403, 'Нет доступа к этому workspace')
  if (!hasPermission(ws, role, permission)) throw new ApiError(403, `Требуется разрешение '${permission}'`)
  return { user, role }
}

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
    const saved = JSON.parse(raw) as {
      plans: PlanRow[]
      items: ItemRow[]
      facts: FactRow[]
      priorities: Record<string, number>
      workspaces?: WsRow[]
      memberships?: [string, [string, string][]][]
      wsState?: [string, WsState][]
      roleOverrides?: RoleOverrideRow[]
      auditLog?: AuditRow[]
    }
    plans.push(...saved.plans)
    items = saved.items
    facts.push(...saved.facts)
    for (const t of TASKS) if (saved.priorities[t.task_id] !== undefined) t.priority = saved.priorities[t.task_id]
    for (const w of saved.workspaces ?? []) workspaces.set(w.id, w)
    ensureWs('default')
    for (const [ws, list] of saved.memberships ?? []) memberships.set(ws, new Map(list))
    if (!memberships.has('default')) memberships.set('default', new Map())
    for (const [ws, st] of saved.wsState ?? []) wsState.set(ws, st)
    roleOverrides.push(...(saved.roleOverrides ?? []))
    auditLog.push(...(saved.auditLog ?? []))
    auditSeq = auditLog.reduce((m, a) => Math.max(m, a.id), 0) + 1
  } catch {
    /* хранилище недоступно или повреждено — начинаем с чистого состояния */
  }
}
function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        plans,
        items,
        facts,
        priorities: Object.fromEntries(TASKS.map((t) => [t.task_id, t.priority])),
        workspaces: [...workspaces.values()],
        memberships: [...memberships].map(([ws, list]) => [ws, [...list]] as [string, [string, string][]]),
        wsState: [...wsState],
        roleOverrides,
        auditLog: auditLog.slice(0, 200),
      }),
    )
  } catch {
    /* приватный режим — состояние живёт до перезагрузки */
  }
}
loadState()

const deps = (): [string, string][] => DEPENDENCIES.map((d) => [d.blocking_task_id, d.blocked_task_id])
const uuid = () => crypto.randomUUID().replace(/-/g, '')
/** Формат created_at как у бэка: «YYYY-MM-DD HH:MM:SS» (str(datetime) без T и зоны) */
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

function planOrm(id: string, ws: string): PlanRow {
  const p = plans.find((x) => x.plan_id === id && rowWs(x) === ws)
  if (!p) throw new ApiError(404, `план ${id} не найден`)
  return p
}

/** routes._plan_from_orm: planned → спринты (только непустые), остальное → decisions */
function planFromRows(planId: string, ws: string): EnginePlan {
  const bySprint = new Map<number, Item[]>()
  const decisions: Item[] = []
  for (const it of items.filter((i) => i.plan_id === planId && rowWs(i) === ws)) {
    const item: Item = { task_id: it.task_id, decision: it.decision, sprint_no: it.sprint_no, reason: it.reason, step_points_sp: it.planned_sp, pinned_sprint: it.pinned_sprint }
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

function storePlan(planId: string, plan: EnginePlan, ws: string) {
  const tm = taskMapFor(ws)
  for (const s of plan.sprints)
    for (const it of s.items) items.push({ plan_id: planId, workspace_id: ws, task_id: it.task_id, team_id: tm.get(it.task_id)?.team_id ?? '', decision: it.decision, sprint_no: it.sprint_no, reason: it.reason, planned_sp: it.step_points_sp })
  for (const d of plan.decisions) items.push({ plan_id: planId, workspace_id: ws, task_id: d.task_id, team_id: tm.get(d.task_id)?.team_id ?? '', decision: d.decision, sprint_no: null, reason: d.reason, planned_sp: null })
}

/** routes._recompute_plan_version */
function recomputeVersion(planId: string, afterSprint: number, ws: string): PlanRow {
  // спека: факты берём по всей цепочке версий (бэк — только текущей версии, и уже закрытые задачи планируются заново)
  const done = new Set(chainFacts(planId).flatMap((f) => f.completed_task_ids))
  for (const t of tasksFor(ws)) if (t.status === 'Done') done.add(t.task_id)
  const row: PlanRow = { plan_id: uuid(), is_initial: false, parent_plan_id: planId, recomputed_after_sprint: afterSprint, created_at: nowStr(), workspace_id: ws }
  plans.push(row)
  const current = items.filter((i) => i.plan_id === planId && rowWs(i) === ws)
  const child = generatePlan(tasksFor(ws).filter((t) => !done.has(t.task_id) && t.status !== 'Done'), ENGINEERS, TEAM_HISTORY, deps(), Math.max(afterSprint, 0) + 1)
  for (const it of current) {
    // спека: сохраняем и ранее закрытые (done_actual) строки, чтобы история не терялась в цепочке
    if (done.has(it.task_id) && (it.decision === 'planned' || it.decision === 'done_actual'))
      items.push({ ...it, plan_id: row.plan_id, decision: 'done_actual', reason: 'выполнено по факту спринта' })
  }
  storePlan(row.plan_id, child, ws)
  return row
}

type Handler = (params: string[], body: unknown, search: URLSearchParams, headers?: Record<string, string>) => unknown
const routes: [string, RegExp, Handler][] = []
const on = (method: string, pattern: string, h: Handler) => routes.push([method, new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), h])

// --- онбординг ---
const snapshot = ({ polls: _p, ...job }: MockJob): UploadJob => job

// Мок стартует в состоянии «после импорта»; повтор импорта планы не трогает (как бэк после fix-import-preserves-plans)
on('POST', '/data/import', (_p, _b, _q, headers) => {
  const ws = wsOf(headers)
  if (ws !== 'default') wsState.set(ws, { imported: true, priorities: wsState.get(ws)?.priorities ?? null })
  return { status: 'imported', counts: DATASET_CONFIRM_COUNTS }
})

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
on('POST', '/data/jobs/:id/confirm', ([id], _b, _q, headers) => {
  const job = jobs.get(id)
  if (!job) throw new ApiError(404, 'job не найден')
  if (job.status !== 'ready') throw new ApiError(409, `job не готов (${job.status})`)
  job.status = 'confirmed'
  const ws = wsOf(headers)
  if (ws !== 'default') wsState.set(ws, { imported: true, priorities: wsState.get(ws)?.priorities ?? null })
  return { status: 'confirmed', counts: DATASET_CONFIRM_COUNTS }
})

// --- план ---
on('POST', '/plans/generate', (_p, _b, _q, headers) => {
  const ws = wsOf(headers)
  if (!wsReady(ws)) throw new ApiError(400, 'нет данных в базе; сначала POST /api/v1/data/import')
  const plan = generatePlan(tasksFor(ws), ENGINEERS, TEAM_HISTORY, deps())
  const row: PlanRow = { plan_id: uuid(), is_initial: true, parent_plan_id: null, recomputed_after_sprint: null, created_at: nowStr(), workspace_id: ws }
  plans.push(row)
  storePlan(row.plan_id, plan, ws)
  return { __status: 201, plan_id: row.plan_id, sprints: Object.fromEntries(plan.sprints.map((s) => [String(s.sprint_no), s.items.map((i) => i.task_id).sort()])) }
})
on('GET', '/plans', (_p, _b, _q, headers) => {
  const ws = wsOf(headers)
  return plans.filter((p) => rowWs(p) === ws).map((p) => ({ ...p }))
})
on('GET', '/plans/:id', ([id], _b, _q, headers): Plan => {
  const ws = wsOf(headers)
  const row = planOrm(id, ws)
  const plan = planFromRows(id, ws)
  const tm = taskMapFor(ws)
  const withTask = (i: Item): PlanTask => {
    const t = tm.get(i.task_id)
    return {
      task_id: i.task_id, decision: i.decision, sprint_no: i.sprint_no, reason: i.reason, step_points_sp: i.step_points_sp,
      summary: t?.summary ?? '', parent_id: t?.parent_id ?? null, estimation_sp: t?.estimation_sp ?? 0, estimated_hh: t?.estimated_hh ?? 0,
      planned_in_sprint: t ? t.status !== 'Done' : false, team_id: t?.team_id ?? '', role_hours: t?.role_hours ?? {},
      pinned_sprint: i.pinned_sprint ?? null, pinned_engineer_id: null,
    }
  }
  return {
    plan_id: id, parent_plan_id: row.parent_plan_id, is_initial: row.is_initial, recomputed_after_sprint: row.recomputed_after_sprint,
    sprints: plan.sprints.map((s) => ({ sprint_no: s.sprint_no, tasks: s.items.map(withTask) })),
    not_planned: plan.decisions.map(({ task_id, decision, sprint_no, reason }) => ({ task_id, decision, sprint_no, reason })),
  }
})
on('GET', '/plans/:id/tasks/:tid/explanation', ([id, tid], _b, _q, headers) => {
  planOrm(id, wsOf(headers))
  const it = items.find((i) => i.plan_id === id && i.task_id === tid)
  if (!it) throw new ApiError(404, `задача ${tid} не найдена в плане ${id}`)
  return { task_id: tid, decision: it.decision, sprint_no: it.sprint_no, reason: it.reason, planned_sp: it.planned_sp }
})
on('GET', '/tasks', (_p, _b, _q, headers) => {
  const ws = wsOf(headers)
  if (!wsReady(ws)) return []
  return tasksFor(ws).sort((a, b) => (a.task_id < b.task_id ? -1 : 1)).map(({ priority: _p, ...t }) => ({ ...t }))
})
on('GET', '/dependencies', (_p, _b, _q, headers) => {
  if (!wsReady(wsOf(headers))) return []
  return DEPENDENCIES.map((d) => ({ ...d }))
})
on('PUT', '/tasks/:id/priority', ([id], body, _q, headers) => {
  const ws = wsOf(headers)
  const raw = (body as { priority?: unknown } | null)?.priority
  if (raw === undefined || raw === null) throw new ApiError(422, 'priority обязателен')
  const priority = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
  if (!Number.isInteger(priority)) throw new ApiError(422, 'priority — целое число')
  if (ws === 'default') {
    const t = TASKS.find((x) => x.task_id === id)
    if (!t) throw new ApiError(404, 'задача не найдена')
    t.priority = priority
  } else {
    if (!TASKS.some((x) => x.task_id === id)) throw new ApiError(404, 'задача не найдена')
    const st = wsState.get(ws)
    if (!st) throw new ApiError(400, 'нет данных в базе; сначала POST /api/v1/data/import')
    st.priorities = { ...(st.priorities ?? Object.fromEntries(TASKS.map((t) => [t.task_id, t.priority]))), [id]: priority }
  }
  return { status: 'updated', task_id: id, priority }
})
on('POST', '/plans/:id/tasks/:tid/cancel-request', ([id, tid], _b, _q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const rows = items.filter((i) => i.plan_id === id && rowWs(i) === ws && i.task_id === tid)
  if (!rows.length) throw new ApiError(404, 'задача не в плане')
  for (const r of rows) {
    if (r.decision === 'postponed') {
      r.decision = 'cancelled_pending'
      r.reason = (r.reason ?? '') + ' (кандидат на отмену — ресурс/роли недоступны)'
    }
  }
  return { status: 'pending_confirmation', task_id: tid }
})
on('POST', '/plans/:id/tasks/:tid/confirm-cancel', ([id, tid], _b, _q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const rows = items.filter((i) => i.plan_id === id && rowWs(i) === ws && i.task_id === tid)
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
on('POST', '/plans/:id/sprints/:n/facts', ([id, n], body, _q, headers) => {
  const ws = wsOf(headers)
  const sprintNo = Number(n)
  if (!(sprintNo >= 1 && sprintNo <= SPRINTS)) throw new ApiError(422, `sprint_no должен быть 1..${SPRINTS}`)
  // спека: повтор факта спринта запрещён в пределах цепочки версий (бэк проверяет только текущую версию)
  if (chainFacts(id).some((f) => f.sprint_no === sprintNo)) throw new ApiError(409, 'факт этого спринта уже загружен')
  const b = (body ?? {}) as { completed_sp?: number; completed_task_ids?: string[]; notes?: string }
  planOrm(id, ws)
  facts.push({ plan_id: id, sprint_no: sprintNo, completed_sp: Number(b.completed_sp ?? 0), completed_task_ids: b.completed_task_ids ?? [], notes: b.notes ?? '' })
  const child = recomputeVersion(id, sprintNo, ws)
  return { status: 'accepted', plan_id: id, sprint_no: sprintNo, new_plan_id: child.plan_id }
})
on('POST', '/plans/:id/recompute', ([id], _b, q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const after = Number(q.get('after_sprint') ?? 0)
  if (!(Number.isInteger(after) && after >= 0 && after <= SPRINTS)) throw new ApiError(422, `after_sprint должна быть 0..${SPRINTS}`)
  const child = recomputeVersion(id, after, ws)
  return { status: 'recomputed', new_plan_id: child.plan_id, parent_plan_id: id, after_sprint: after }
})
on('GET', '/plans/:id/facts', ([id], _b, _q, headers) => {
  planOrm(id, wsOf(headers))
  return chainFacts(id).map(({ sprint_no, completed_sp, completed_task_ids, notes }) => ({ sprint_no, completed_sp, completed_task_ids: [...completed_task_ids], notes }))
})
on('GET', '/plans/:id/warnings', ([id], _b, _q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const before = planFromRows(id, ws)
  const done = new Set(facts.filter((f) => f.plan_id === id).flatMap((f) => f.completed_task_ids))
  return computeWarnings(before, recomputedPlan(before, done), done, taskMapFor(ws), deps(), ENGINEERS)
})
on('GET', '/plans/:id/bus-risk', ([id], _b, _q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  // по формуле plan_bus_risk (bus_factor.py): часы роли с единственным носителем / без носителя
  const planned = items.filter((i) => i.plan_id === id && rowWs(i) === ws && i.decision === 'planned')
  const role_holders: Record<string, string[]> = {}
  for (const e of ENGINEERS) (role_holders[e.role.toLowerCase()] ??= []).push(e.engineer_id)
  const tasks = taskMapFor(ws)
  const rows = planned.flatMap((i) => {
    const task = tasks.get(i.task_id)
    if (!task) return []
    const at_risk: string[] = []
    const holders: Record<string, string[]> = {}
    for (const role of Object.keys(task.role_hours ?? {})) {
      const hs = role_holders[role.toLowerCase()] ?? []
      if (hs.length <= 1) {
        at_risk.push(role)
        holders[role] = hs
      }
    }
    return at_risk.length ? [{ task_id: task.task_id, summary: task.summary, sprint_no: i.sprint_no, at_risk_keys: at_risk, holders }] : []
  })
  return { total_at_risk: rows.length, tasks: rows }
})

// pin/unpin (016/020): как бэк — pin закрепляет задачу за спринтом и пересобирает план на той же версии.
// спека: бэк перегенерирует план planner'ом с учётом pins; мок — перегенерация + наложение закреплений
// (задача целиком переносится в закреплённый спринт, SP части суммируются в одну строку).
function rebuildPlanWithPins(planId: string, ws: string) {
  const pins = new Map(
    items.filter((i) => i.plan_id === planId && rowWs(i) === ws && i.pinned_sprint != null).map((i) => [i.task_id, i.pinned_sprint!]),
  )
  const done = new Set(chainFacts(planId).flatMap((f) => f.completed_task_ids))
  for (const t of tasksFor(ws)) if (t.status === 'Done') done.add(t.task_id)
  const child = generatePlan(tasksFor(ws).filter((t) => !done.has(t.task_id) && t.status !== 'Done'), ENGINEERS, TEAM_HISTORY, deps())
  // расхождение с бэком: done_actual-строки (факты) сохраняем, бэк при pin-пересборке их теряет
  items = items.filter((i) => i.plan_id !== planId || rowWs(i) !== ws || i.decision === 'done_actual')
  storePlan(planId, child, ws)
  for (const [tid, sprint] of [...pins].sort(([a], [b]) => a.localeCompare(b))) {
    const rows = items.filter((i) => i.plan_id === planId && i.task_id === tid && i.decision === 'planned')
    if (!rows.length) continue
    const [first, ...rest] = rows
    for (const r of rest) items.splice(items.indexOf(r), 1)
    first.sprint_no = sprint
    first.planned_sp = rows.reduce((a, r) => a + (r.planned_sp ?? 0), 0)
    first.reason = `закреплено за спринтом ${sprint} (pin)`
    first.pinned_sprint = sprint
  }
}

on('POST', '/plans/:id/tasks/:tid/pin', ([id, tid], body, _q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const sprint = (body as { sprint_no?: number } | undefined)?.sprint_no
  if (typeof sprint !== 'number' || sprint < 1 || sprint > 6) throw new ApiError(422, 'sprint_no обязателен (1..6)')
  const rows = items.filter((i) => i.plan_id === id && rowWs(i) === ws && i.task_id === tid)
  if (!rows.length) throw new ApiError(404, 'задача не в плане')
  // 409 как у бэка: зависимость от закреплённого блокера в том же/более позднем спринте
  const pinnedOf = new Map(
    items.filter((i) => i.plan_id === id && rowWs(i) === ws && i.pinned_sprint != null && i.task_id !== tid).map((i) => [i.task_id, i.pinned_sprint!]),
  )
  for (const [a, b] of deps()) {
    if (b !== tid) continue
    const bs = pinnedOf.get(a)
    if (bs && bs >= sprint) throw new ApiError(409, `Конфликт закрепления: задача ${tid} зависит от ${a}, которая закреплена на спринт ${bs} >= ${sprint}`)
  }
  for (const r of rows) r.pinned_sprint = sprint
  rebuildPlanWithPins(id, ws)
  return { status: 'pinned', plan_id: id, task_id: tid, sprint_no: sprint }
})
on('DELETE', '/plans/:id/tasks/:tid/pin', ([id, tid], _b, _q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const rows = items.filter((i) => i.plan_id === id && rowWs(i) === ws && i.task_id === tid)
  if (!rows.length) throw new ApiError(404, 'задача не в плане')
  for (const r of rows) r.pinned_sprint = null
  rebuildPlanWithPins(id, ws)
  return { status: 'unpinned', plan_id: id, task_id: tid }
})
on('GET', '/plans/:id/diff', ([id], _b, _q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const before = planFromRows(id, ws)
  const done = new Set(facts.filter((f) => f.plan_id === id).flatMap((f) => f.completed_task_ids))
  const after = recomputedPlan(before, done)
  const beforeOf = new Map(before.sprints.flatMap((s) => s.items.map((i) => [i.task_id, s.sprint_no] as const)))
  const afterOf = new Map(after.sprints.flatMap((s) => s.items.map((i) => [i.task_id, s.sprint_no] as const)))
  return {
    moved: [...afterOf].filter(([tid, n]) => beforeOf.has(tid) && n > beforeOf.get(tid)!).map(([tid, n]) => ({ task_id: tid, from_sprint: beforeOf.get(tid)!, to_sprint: n })),
    postponed_now: after.decisions.filter((d) => !beforeOf.has(d.task_id)).map((d) => d.task_id),
  }
})
on('GET', '/plans/:id/metrics', ([id], _b, _q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const chain = chainIds(id).filter((pid) => rowWs(plans.find((p) => p.plan_id === pid) ?? { workspace_id: ws }) === ws)
  const initialId = [...chain].reverse().find((pid) => plans.find((p) => p.plan_id === pid)?.is_initial) ?? chain.at(-1)!
  const initial = planFromRows(initialId, ws)
  const plannedSp = new Map(initial.sprints.map((s) => [s.sprint_no, s.items.reduce((a, i) => a + (i.step_points_sp ?? 0), 0)]))
  // спека: факты по всей цепочке версий (бэк берёт только факты этой версии — у пересчитанного плана метрики пустые)
  const chainF = chainFacts(id)
  const tm = taskMapFor(ws)
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
on('GET', '/teams', (_p, _b, _q, headers) => {
  if (!wsReady(wsOf(headers))) return []
  return teamsOverview()
})
on('GET', '/teams/:id', ([id], _b, _q, headers) => {
  if (!wsReady(wsOf(headers))) throw new ApiError(404, 'команда не найдена')
  const members = ENGINEERS.filter((e) => e.team_id === id)
  const hist = TEAM_HISTORY.filter((h) => h.team_id === id)
  if (!members.length && !hist.length) throw new ApiError(404, 'команда не найдена')
  return { team_id: id, members: members.map((m) => ({ ...m })), capacity_sp_per_sprint: teamCapacitySp(hist), sprint_history: hist.map((h) => ({ ...h })) }
})
on('GET', '/engineers', (_p, _b, q, headers) => {
  if (!wsReady(wsOf(headers))) return []
  return ENGINEERS.filter(
    (e) =>
      (!q.get('team_id') || e.team_id === q.get('team_id')) &&
      (!q.get('role') || e.role.toLowerCase().includes(q.get('role')!.toLowerCase())) &&
      (!q.get('grade') || e.grade.toLowerCase() === q.get('grade')!.toLowerCase()) &&
      (q.get('min_rate') === null || e.capacity_rate >= Number(q.get('min_rate'))) &&
      (!q.get('skill') || e.skills_declared.toLowerCase().includes(q.get('skill')!.toLowerCase())),
  ).map((e) => ({ ...e }))
})
on('GET', '/engineers/:id', ([id], _b, _q, headers): EngineerProfile => {
  if (!wsReady(wsOf(headers))) throw new ApiError(404, 'не найден')
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
on('GET', '/star-map/summary', (_p, _b, _q, headers) => {
  if (!wsReady(wsOf(headers))) return { teams: [], fte_distribution: {}, single_holder_competencies: [] }
  const fte: Record<string, number> = {}
  for (const e of ENGINEERS) fte[e.team_id] = (fte[e.team_id] ?? 0) + Math.min(e.capacity_rate, 1)
  return { teams: teamsOverview(), fte_distribution: fte, single_holder_competencies: computeBusFactor(ENGINEERS).items.filter((i) => i.factor === 1) }
})
on('GET', '/bus-factor', (_p, _b, _q, headers) => {
  if (!wsReady(wsOf(headers))) return { items: [], methodology: computeBusFactor(ENGINEERS).methodology }
  return computeBusFactor(ENGINEERS)
})

// --- workspaces (change 008, UI 021) ---
ensureWs('default')
on('GET', '/workspaces', (_p, _b, _q, headers) => {
  void headers
  const user = mockUser()
  const list = [...workspaces.values()]
    .filter((w) => w.id === 'default' || memberships.get(w.id)?.has(user.id))
    .map((w) => ({ id: w.id, name: w.name, created_by: w.created_by, role: roleInWs(w.id, user.id) ?? 'reader' }))
  return list
})
on('POST', '/workspaces', (_p, body) => {
  const name = (body as { name?: string } | undefined)?.name?.trim()
  if (!name) throw new ApiError(422, 'name обязателен')
  const user = mockUser()
  const id = `ws-${uuid().slice(0, 8)}`
  workspaces.set(id, { id, name, created_by: user.id })
  memberships.set(id, new Map([[user.id, 'admin']]))
  wsState.set(id, { imported: false, priorities: null })
  addAudit(id, user.id, 'create_workspace', `workspace:${id}`, { name })
  return { __status: 201, id, name, created_by: user.id }
})
on('GET', '/workspaces/:id/members', ([id], _b, _q, headers) => {
  const ws = wsOf(headers)
  const target = id === ws ? ws : id
  ensureWs(target)
  roleInWs(target, mockUser().id) // не-участник чужого ws → 403
  return [...(memberships.get(target) ?? [])].map(([user_id, role]) => ({ user_id, role }))
})
on('POST', '/workspaces/:id/members', ([id], body, _q, headers) => {
  const ws = wsOf(headers)
  const target = id === ws ? ws : id
  ensureWs(target)
  requirePermission(target, 'members_admin')
  const user_id = (body as { user_id?: string } | undefined)?.user_id?.trim()
  const role = (body as { role?: string } | undefined)?.role
  if (!user_id) throw new ApiError(422, 'user_id обязателен')
  const finalRole = ['admin', 'editor', 'reader'].includes(role ?? '') ? (role as string) : 'editor'
  const list = memberships.get(target)!
  if (list.has(user_id)) throw new ApiError(409, 'уже участник')
  list.set(user_id, finalRole)
  addAudit(target, mockUser().id, 'add_member', `user:${user_id}`, { role: finalRole })
  return { __status: 201, workspace_id: target, user_id, role: finalRole }
})
on('DELETE', '/workspaces/:id/members/:uid', ([id, uid], _b, _q, headers) => {
  const ws = wsOf(headers)
  const target = id === ws ? ws : id
  ensureWs(target)
  requirePermission(target, 'members_admin')
  const list = memberships.get(target)!
  if (!list.delete(uid)) throw new ApiError(404, 'Участник не найден')
  addAudit(target, mockUser().id, 'remove_member', `user:${uid}`)
  return { status: 'removed', user_id: uid }
})

// --- права и аудит (change 009, UI 021) ---
on('GET', '/permissions/matrix', (_p, _b, _q, headers) => {
  const ws = wsOf(headers)
  roleInWs(ws, mockUser().id)
  const roles = ['admin', 'editor', 'reader'] as const
  const matrix: Record<string, Record<string, boolean>> = {}
  for (const [perm] of Object.entries(DEFAULT_MATRIX)) {
    matrix[perm] = {}
    for (const r of roles) matrix[perm][r] = r === 'admin' ? true : hasPermission(ws, r, perm)
  }
  return { workspace_id: ws, matrix }
})
on('PATCH', '/permissions/roles/:role', ([role], body, _q, headers) => {
  const ws = wsOf(headers)
  requirePermission(ws, 'workspace_admin')
  if (role.toLowerCase() === 'admin') throw new ApiError(400, 'Права администратора неотчуждаемы')
  const { permission, enabled } = (body ?? {}) as { permission?: string; enabled?: boolean }
  if (!permission || !DEFAULT_MATRIX[permission]) throw new ApiError(422, `Неизвестное разрешение: ${permission}`)
  if (typeof enabled !== 'boolean') throw new ApiError(422, 'enabled обязателен (boolean)')
  const ov = roleOverrides.find((o) => o.ws === ws && o.role === role.toLowerCase() && o.permission === permission)
  if (ov) ov.enabled = enabled
  else roleOverrides.push({ ws, role: role.toLowerCase(), permission, enabled })
  addAudit(ws, mockUser().id, 'update_permission', `role:${role}:${permission}`, { enabled })
  return { workspace_id: ws, role, permission, enabled }
})
on('GET', '/permissions/audit', (_p, _b, _q, headers) => {
  const ws = wsOf(headers)
  roleInWs(ws, mockUser().id)
  return auditLog.filter((a) => a.ws === ws).map(({ id, actor_id, action, target, details, created_at }) => ({ id, actor_id, action, target, details, created_at }))
})

// --- AI-советник (change 015): fallback-советы из warnings/metrics (упрощённый порт) ---
on('GET', '/plans/:id/advice', ([id], _b, q, headers) => {
  const ws = wsOf(headers)
  planOrm(id, ws)
  const comment = (q.get('comment') ?? '').trim().slice(0, 500) || null
  const before = planFromRows(id, ws)
  const done = new Set(facts.filter((f) => f.plan_id === id).flatMap((f) => f.completed_task_ids))
  const warnings = computeWarnings(before, recomputedPlan(before, done), done, taskMapFor(ws), deps(), ENGINEERS)
  const advice: { kind: string; affected_task_ids: string[]; affected_engineers: string[]; message: string; numeric_basis: string; expected_effect: string }[] = []
  for (const w of warnings.filter((w) => ['deadline_overflow', 'dependency_shift'].includes(w.kind) && w.task_ids.length).slice(0, 3)) {
    advice.push({
      kind: 'task_move', affected_task_ids: w.task_ids.slice(0, 4), affected_engineers: [],
      message: `Риск [${w.kind}]: ${w.message}`, numeric_basis: `затронуто задач: ${w.task_ids.length}`,
      expected_effect: 'уменьшение риска сдвига цепочки зависимостей',
    })
  }
  advice.push({
    kind: 'sprint_priority', affected_task_ids: [], affected_engineers: [],
    message: 'Следующий спринт: приоритет — задачи заказчика и замыкание инициатив',
    numeric_basis: 'норма PI 80–100 %', expected_effect: 'удержание нормы PI 80–100 %',
  })
  if (comment) {
    advice.push({
      kind: 'sprint_priority', affected_task_ids: [], affected_engineers: [],
      message: `Контекст пользователя учтён одним комментарием: «${comment.slice(0, 200)}».`,
      numeric_basis: 'одноразовый контекст, не сохраняется', expected_effect: 'обстоятельства отнесены к решениям человека',
    })
  }
  return { mode: 'fallback', comment_considered: !!comment, advice }
})

export async function handleMock<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  // Задержка как у сети: интерфейс должен показывать состояния загрузки
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 200))
  const url = new URL(path, 'http://mock')
  for (const [m, re, h] of routes) {
    const match = m === method && url.pathname.match(re)
    if (match) {
      const result = h(match.slice(1).map(decodeURIComponent), body, url.searchParams, headers) as Record<string, unknown>
      if (method !== 'GET') saveState()
      if (result && typeof result === 'object' && '__status' in result) delete result.__status
      return structuredClone(result) as T
    }
  }
  throw new ApiError(404, 'Not Found')
}

// для сверки мока с реальным бэком (scratch-скрипты), в приложении не используется
export const __mockState = { plans, facts, get items() { return items }, set items(v) { items = v } }
