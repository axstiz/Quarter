import { request, requestRoot, query } from './client'
import type {
  AdviceReport,
  BusFactorReport,
  BusForecast,
  PlanBusRisk,
  ConfirmResponse,
  Dependency,
  Engineer,
  EngineerFilters,
  EngineerProfile,
  FactResponse,
  GeneratePlanResponse,
  Metrics,
  OptimizeJob,
  OptimizeStartResponse,
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
  WorkspaceInfo,
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
  /** pin/unpin (016): закрепление задачи за спринтом/носителем; бэк валидирует конфликт ёмкости (409) */
  pinTask: (planId: string, taskId: string, body: { sprint_no: number; engineer_id?: string }) =>
    request<{ status: string }>('POST', `/plans/${planId}/tasks/${taskId}/pin`, body),
  unpinTask: (planId: string, taskId: string) =>
    request<{ status: string }>('DELETE', `/plans/${planId}/tasks/${taskId}/pin`),
  listTasks: () => request<TaskInfo[]>('GET', '/tasks'),
  listDependencies: () => request<Dependency[]>('GET', '/dependencies'),

  // Редактор данных (change 019): CRUD поверх существующих записей
  createTask: (t: { task_id: string; team_id?: string; summary?: string; status?: string; estimation_sp?: number; estimated_hh?: number }) =>
    request<{ status: string }>('POST', '/tasks', t),
  updateTask: (taskId: string, patch: Partial<{ team_id: string; summary: string; status: string; estimation_sp: number; estimated_hh: number }>) =>
    request<{ status: string }>('PUT', `/tasks/${taskId}`, patch),
  deleteTask: (taskId: string) => request<{ status: string }>('DELETE', `/tasks/${taskId}`),
  /** Замена набора роль → часы (нулевые отбрасываются бэком); правка делает записи ручными. */
  setTaskRoleHours: (taskId: string, roleHours: Record<string, number>) =>
    request<{ status: string; role_hours: Record<string, number> }>('PUT', `/tasks/${taskId}/role-hours`, { role_hours: roleHours }),
  createEngineer: (e: { engineer_id: string; team_id: string; role: string; grade?: string; skills_declared?: string; capacity_rate?: number }) =>
    request<{ status: string }>('POST', '/engineers', e),
  updateEngineer: (engineerId: string, patch: Partial<{ team_id: string; role: string; grade: string; skills_declared: string; capacity_rate: number }>) =>
    request<{ status: string }>('PUT', `/engineers/${engineerId}`, patch),
  deleteEngineer: (engineerId: string) => request<{ status: string }>('DELETE', `/engineers/${engineerId}`),
  createTeam: (existingTeamId: string, name?: string) =>
    request<{ status: string }>('POST', '/teams', { team_id: existingTeamId, name }),
  updateTeam: (teamId: string, name: string) => request<{ status: string }>('PUT', `/teams/${teamId}`, { name }),
  deleteTeam: (teamId: string) => request<{ status: string }>('DELETE', `/teams/${teamId}`),
  createDependency: (d: { blocking_task_id: string; blocked_task_id: string; dependency_type?: string }) =>
    request<{ status: string }>('POST', '/dependencies', d),
  updateDependency: (blockingTaskId: string, blockedTaskId: string, dependencyType: string) =>
    request<{ status: string }>('PUT', `/dependencies?blocking_task_id=${encodeURIComponent(blockingTaskId)}&blocked_task_id=${encodeURIComponent(blockedTaskId)}`, { dependency_type: dependencyType }),
  deleteDependency: (blockingTaskId: string, blockedTaskId: string) =>
    request<{ status: string }>('DELETE', `/dependencies?blocking_task_id=${encodeURIComponent(blockingTaskId)}&blocked_task_id=${encodeURIComponent(blockedTaskId)}`),

  // Стр. 2 — факт и пересчёт
  submitFact: (planId: string, sprintNo: number, body: SprintFactInput) =>
    request<FactResponse>('POST', `/plans/${planId}/sprints/${sprintNo}/facts`, body),
  /** after_sprint — последний спринт с фактом: пересчитываются спринты после него (по умолчанию бэк берёт 0 = весь квартал) */
  recompute: (planId: string, afterSprint: number) => request<RecomputeResponse>('POST', `/plans/${planId}/recompute?after_sprint=${afterSprint}`),
  /** Оптимизация текущей версии плана: solver Timefold, при недоступности сайдкара — эвристика (режим в ответе). */
  optimizePlan: (planId: string) => request<OptimizeStartResponse>('POST', '/plans/optimize', { plan_id: planId }),
  getOptimizeJob: (jobId: string) => request<OptimizeJob>('GET', `/plans/optimize/${jobId}`),
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
  getPlanBusRisk: (planId: string) => request<PlanBusRisk>('GET', `/plans/${planId}/bus-risk`),
  /** Прогноз bus factor по плановой загрузке (change 023): assignments версии плана. */
  getBusForecast: (planId: string) => request<BusForecast>('GET', `/plans/${planId}/bus-forecast`),

  // Стр. 4 — метрики
  getMetrics: (planId: string) => request<Metrics>('GET', `/plans/${planId}/metrics`),

  // Стр. 5 — рабочие пространства (changes 008/009, UI 021); роутеры на корне бэка — без /api/v1
  // (участники/матрица прав на UI не выводятся — change 024; бэк-ручки сохранены для 023)
  listWorkspaces: () => requestRoot<WorkspaceInfo[]>('GET', '/workspaces'),
  createWorkspace: (name: string) => requestRoot<{ id: string; name: string }>('POST', '/workspaces', { name }),

  // AI-советник (change 015): одноразовый прогон, comment — контекст прогона (не сохраняется)
  getAdvice: (planId: string, comment?: string) =>
    request<AdviceReport>('GET', `/plans/${planId}/advice${comment ? `?comment=${encodeURIComponent(comment)}` : ''}`),
}
