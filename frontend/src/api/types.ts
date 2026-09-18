// Типы ответов бэка. Источник: docs/api-contract.md + src/api/routes.py (openapi.json без схем ответов).

export type Decision = 'planned' | 'postponed' | 'cancelled' | 'cancelled_pending' | 'done_actual'

export interface PlanTask {
  task_id: string
  decision: Decision
  sprint_no: number | null
  reason: string
  step_points_sp: number | null
  summary: string
  parent_id: string | null
  estimation_sp: number
  estimated_hh: number
  planned_in_sprint: boolean
  team_id: string
  role_hours: Record<string, number>
}

export interface Explanation {
  task_id: string
  decision: Decision
  sprint_no: number | null
  reason: string
}

export interface Plan {
  plan_id: string
  parent_plan_id: string | null
  is_initial: boolean
  recomputed_after_sprint: number | null
  sprints: { sprint_no: number; tasks: PlanTask[] }[]
  not_planned: Explanation[]
}

export interface PlanVersion {
  plan_id: string
  is_initial: boolean
  parent_plan_id: string | null
  recomputed_after_sprint: number | null
  created_at: string
}

export interface GeneratePlanResponse {
  plan_id: string
  sprints: Record<string, string[]>
}

export interface SprintFact {
  sprint_no: number
  completed_sp: number
  completed_task_ids: string[]
  notes: string
}

export interface SprintFactInput {
  completed_sp: number
  completed_task_ids: string[]
  notes?: string
}

export interface FactResponse {
  status: 'accepted'
  plan_id: string
  sprint_no: number
  new_plan_id: string
}

export interface RecomputeResponse {
  status: 'recomputed'
  new_plan_id: string
  parent_plan_id: string
  after_sprint: number
}

export type WarningKind = 'deadline_overflow' | 'dependency_shift' | 'role_deficit' | 'composition_change'

export interface PlanWarning {
  kind: WarningKind
  message: string
  task_ids: string[]
}

export interface PlanDiff {
  moved: { task_id: string; from_sprint: number; to_sprint: number }[]
  postponed_now: string[]
}

export interface Metrics {
  quarter_completion_pct: number | null
  quarter_completion_is_forecast: boolean
  sprint_completion_pct: Record<string, number | null>
  sprint_completion_is_forecast: Record<string, boolean>
}

export interface Engineer {
  engineer_id: string
  team_id: string
  role: string
  grade: string
  skills_declared: string
  capacity_rate: number
}

export interface TeamOverview {
  team_id: string
  engineers: Pick<Engineer, 'engineer_id' | 'role' | 'grade' | 'capacity_rate'>[]
}

export interface TeamHistory {
  team_id: string
  snapshot_date: string
  velocity_achieved: number
  planned_sp: number
}

export interface TeamDetail {
  team_id: string
  members: Engineer[]
  capacity_sp_per_sprint: number
  sprint_history: TeamHistory[]
}

export interface EngineerProfile {
  engineer_id: string
  assignments: {
    team_id: string
    role: string
    grade: string
    skills_declared: string
    capacity_rate: number
    parttime: boolean
    hours_per_sprint: number
  }[]
  single_holder_alerts: string[]
}

export interface BusFactorItem {
  scope_type: 'company' | 'team'
  scope_id: string
  key: string
  holders: string[]
  factor: number
}

export interface BusFactorReport {
  items: BusFactorItem[]
  methodology: string
}

export interface StarMapSummary {
  teams: TeamOverview[]
  fte_distribution: Record<string, number>
  single_holder_competencies: BusFactorItem[]
}

/** GET /tasks — справочник задач (нужен, чтобы показать summary у задач вне плана). */
export interface TaskInfo {
  task_id: string
  parent_id: string | null
  team_id: string
  summary: string
  status: string
  estimation_sp: number
  estimated_hh: number
  role_hours: Record<string, number>
  /** Пары [blocking, blocked], где задача блокирующая (формат бэка) */
  blocks: [string, string][]
  blocked_by: { blocking_task_id: string }[]
}

export interface Dependency {
  blocking_task_id: string
  blocked_task_id: string
}

export type EngineerFilters = Partial<{
  team_id: string
  role: string
  grade: string
  skill: string
  min_rate: number
}>

// --- онбординг ---

export type JobStatus = 'uploaded' | 'mapping' | 'questions' | 'ready' | 'confirmed' | 'failed'

export interface ColumnGuess {
  column: string
  entity: string
  field: string
  confidence: 'high' | 'medium' | 'low'
}

export interface MappingQuestion {
  question: string
  options: string[]
  context_column: string
}

export interface UploadJob {
  job_id: string
  filename: string
  status: JobStatus
  column_guesses: ColumnGuess[]
  questions: MappingQuestion[]
  unmapped: string[]
  preview_counts: Record<string, number>
}

export interface ConfirmResponse {
  status: 'confirmed'
  counts: Record<string, number>
}
