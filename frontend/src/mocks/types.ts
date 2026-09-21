import type { Decision, TaskInfo, UploadJob } from '../api/types'

/** Задача как в GET /tasks + priority из БД (в ответах API не отдаётся). */
export interface MockTask extends TaskInfo {
  priority: number
}

/** Строка plan_items (как в БД бэкенда). workspace_id — изоляция по workspace (change 021); отсутствие = default. */
export interface ItemRow {
  plan_id: string
  workspace_id?: string
  task_id: string
  team_id: string
  decision: Decision
  sprint_no: number | null
  reason: string
  planned_sp: number | null
  /** pin (016): закрепление задачи за спринтом/носителем */
  pinned_sprint?: number | null
  pinned_engineer_id?: string | null
}

export interface PlanRow {
  plan_id: string
  workspace_id?: string
  is_initial: boolean
  parent_plan_id: string | null
  recomputed_after_sprint: number | null
  created_at: string
}

export interface FactRow {
  plan_id: string
  sprint_no: number
  completed_sp: number
  completed_task_ids: string[]
  notes: string
}

export type MockJob = UploadJob & { polls: number }
