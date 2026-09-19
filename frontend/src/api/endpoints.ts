import { query, request } from './client'
import type {
  BusFactorReport,
  ConfirmResponse,
  Dependency,
  Engineer,
  EngineerFilters,
  EngineerProfile,
  FactResponse,
  GeneratePlanResponse,
  Metrics,
  Plan,
  PlanDiff,
  PlanVersion,
  PlanWarning,
  RecomputeResponse,
  SprintFact,
  SprintFactInput,
  StarMapSummary,
  TaskInfo,
  TeamDetail,
  TeamOverview,
  UploadJob,
} from './types'

export const api = {
  // Стр. 0.1 — загрузка данных
  /** Путь А: встроенный датасет организаторов одной кнопкой, без сопоставления колонок */
  importDemo: () => request<{ status: string; counts: Record<string, number> }>('POST', '/data/import'),
  uploadFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadJob>('POST', '/data/upload', form)
  },
  getJob: (jobId: string) => request<UploadJob>('GET', `/data/jobs/${jobId}`),
  answerJob: (jobId: string, answers: Record<string, string>) =>
    request<UploadJob>('POST', `/data/jobs/${jobId}/answers`, { answers }),
  confirmJob: (jobId: string) => request<ConfirmResponse>('POST', `/data/jobs/${jobId}/confirm`),

  // Стр. 1 — план
  listPlans: () => request<PlanVersion[]>('GET', '/plans'),
  getPlan: (planId: string) => request<Plan>('GET', `/plans/${planId}`),
  generatePlan: () => request<GeneratePlanResponse>('POST', '/plans/generate'),
  setPriority: (taskId: string, priority: number) =>
    request<{ status: string }>('PUT', `/tasks/${taskId}/priority`, { priority }),
  cancelRequest: (planId: string, taskId: string) =>
    request<{ status: string }>('POST', `/plans/${planId}/tasks/${taskId}/cancel-request`),
  confirmCancel: (planId: string, taskId: string) =>
    request<{ status: string }>('POST', `/plans/${planId}/tasks/${taskId}/confirm-cancel`),
  listTasks: () => request<TaskInfo[]>('GET', '/tasks'),
  listDependencies: () => request<Dependency[]>('GET', '/dependencies'),

  // Стр. 2 — факт и пересчёт
  submitFact: (planId: string, sprintNo: number, body: SprintFactInput) =>
    request<FactResponse>('POST', `/plans/${planId}/sprints/${sprintNo}/facts`, body),
  /** after_sprint — последний спринт с фактом: пересчитываются спринты после него (по умолчанию бэк берёт 0 = весь квартал) */
  recompute: (planId: string, afterSprint: number) => request<RecomputeResponse>('POST', `/plans/${planId}/recompute?after_sprint=${afterSprint}`),
  listFacts: (planId: string) => request<SprintFact[]>('GET', `/plans/${planId}/facts`),
  getWarnings: (planId: string) => request<PlanWarning[]>('GET', `/plans/${planId}/warnings`),
  getDiff: (planId: string) => request<PlanDiff>('GET', `/plans/${planId}/diff`),

  // Стр. 3 — звёздная карта
  listTeams: () => request<TeamOverview[]>('GET', '/teams'),
  getTeam: (teamId: string) => request<TeamDetail>('GET', `/teams/${teamId}`),
  listEngineers: (f: EngineerFilters = {}) => request<Engineer[]>('GET', `/engineers${query(f)}`),
  getEngineer: (id: string) => request<EngineerProfile>('GET', `/engineers/${id}`),
  getStarMap: () => request<StarMapSummary>('GET', '/star-map/summary'),
  getBusFactor: () => request<BusFactorReport>('GET', '/bus-factor'),

  // Стр. 4 — метрики
  getMetrics: (planId: string) => request<Metrics>('GET', `/plans/${planId}/metrics`),
}
