import type { BusFactorItem, Explanation, PlanDiff, PlanTask, PlanWarning, SprintFact, UploadJob } from '../api/types'

export interface MockTask {
  task_id: string
  parent_id: string | null
  team_id: string
  summary: string
  status: 'ToDo' | 'InProgress' | 'Done' | string
  priority: number
  estimation_sp: number
  estimated_hh: number
  spent_time: number
  customer_flag: boolean
  role_hours: Record<string, number>
}

export type MockPlanItem = Pick<PlanTask, 'task_id' | 'decision' | 'sprint_no' | 'reason' | 'step_points_sp'>

export interface MockPlan {
  plan_id: string
  parent_plan_id: string | null
  is_initial: boolean
  recomputed_after_sprint: number | null
  created_at: string
  items: MockPlanItem[]
  not_planned: Explanation[]
}

export interface MockState {
  plans: MockPlan[]
  /** Факты хранятся на той версии плана, в которую их загрузили (как на бэке). */
  facts: Record<string, SprintFact[]>
  /** warnings/diff считаются для версии, в которую загрузили факт. */
  warnings: Record<string, PlanWarning[]>
  diffs: Record<string, PlanDiff>
  jobs: Record<string, UploadJob & { polls: number }>
}

export type { BusFactorItem }
