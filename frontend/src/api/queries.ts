import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getWorkspaceId, setWorkspace, type AuthRole } from './auth'
import { api } from './endpoints'
import type { EngineerFilters, SprintFactInput } from './types'

export const keys = {
  plans: ['plans'] as const,
  plan: (id: string) => ['plan', id] as const,
  facts: (id: string) => ['plan', id, 'facts'] as const,
  warnings: (id: string) => ['plan', id, 'warnings'] as const,
  diff: (id: string) => ['plan', id, 'diff'] as const,
  metrics: (id: string) => ['plan', id, 'metrics'] as const,
  dependencies: ['dependencies'] as const,
  tasks: ['tasks'] as const,
  teams: ['teams'] as const,
  team: (id: string) => ['team', id] as const,
  engineers: (f: EngineerFilters) => ['engineers', f] as const,
  engineer: (id: string) => ['engineer', id] as const,
  starMap: ['star-map'] as const,
  busFactor: ['bus-factor'] as const,
  workspaces: ['workspaces'] as const,
  members: (wsId: string) => ['members', wsId] as const,
  permissions: ['permissions'] as const,
  audit: ['audit'] as const,
}

/** Список версий плана; последняя в цепочке — актуальная. */
export function usePlanVersions() {
  return useQuery({ queryKey: keys.plans, queryFn: api.listPlans })
}

/**
 * Какой план сейчас смотрим: `?plan=` из URL, иначе последняя версия.
 * `undefined` — ещё грузим, `null` — планов нет (нужно сгенерировать).
 */
export function useCurrentPlanId(): string | null | undefined {
  const [params] = useSearchParams()
  const versions = usePlanVersions()
  const fromUrl = params.get('plan')
  if (fromUrl) return fromUrl
  if (!versions.data) return undefined
  return versions.data.at(-1)?.plan_id ?? null
}

export function usePlan(planId: string | null | undefined) {
  return useQuery({
    queryKey: keys.plan(planId ?? ''),
    queryFn: () => api.getPlan(planId!),
    enabled: !!planId,
  })
}

export function useFacts(planId: string | null | undefined) {
  return useQuery({ queryKey: keys.facts(planId ?? ''), queryFn: () => api.listFacts(planId!), enabled: !!planId })
}

export function useWarnings(planId: string | null | undefined) {
  return useQuery({
    queryKey: keys.warnings(planId ?? ''),
    queryFn: () => api.getWarnings(planId!),
    enabled: !!planId,
  })
}

export function useDiff(planId: string | null | undefined) {
  return useQuery({ queryKey: keys.diff(planId ?? ''), queryFn: () => api.getDiff(planId!), enabled: !!planId })
}

export function useMetrics(planId: string | null | undefined) {
  return useQuery({
    queryKey: keys.metrics(planId ?? ''),
    queryFn: () => api.getMetrics(planId!),
    enabled: !!planId,
  })
}

export function useTasks() {
  return useQuery({ queryKey: keys.tasks, queryFn: api.listTasks, staleTime: 5 * 60_000 })
}

export function useDependencies() {
  return useQuery({ queryKey: keys.dependencies, queryFn: api.listDependencies })
}

export function useStarMap() {
  return useQuery({ queryKey: keys.starMap, queryFn: api.getStarMap })
}

export function useBusFactor() {
  return useQuery({ queryKey: keys.busFactor, queryFn: api.getBusFactor })
}

/** Советы и bus-risk строятся на конкретной версии плана — инвалидируются с ['plan'] цепочкой. */
export function usePlanBusRisk(planId: string | null | undefined) {
  return useQuery({ queryKey: ['plan', planId ?? '', 'bus-risk'], queryFn: () => api.getPlanBusRisk(planId!), enabled: !!planId })
}

export function useEngineers(filters: EngineerFilters) {
  return useQuery({
    queryKey: keys.engineers(filters),
    queryFn: () => api.listEngineers(filters),
    placeholderData: (prev) => prev,
  })
}

export function useEngineer(id: string | null) {
  return useQuery({ queryKey: keys.engineer(id ?? ''), queryFn: () => api.getEngineer(id!), enabled: !!id })
}

export function useTeam(id: string | null) {
  return useQuery({ queryKey: keys.team(id ?? ''), queryFn: () => api.getTeam(id!), enabled: !!id })
}

/** Детали нескольких команд (ёмкость SP/спринт) — для таблицы загрузки. */
export function useTeamDetails(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({ queryKey: keys.team(id), queryFn: () => api.getTeam(id) })),
  })
}

// --- мутации ---

/** Бэк на любой пересчёт создаёт новую версию плана — сбрасываем всё, что от плана зависит. */
function useInvalidatePlans() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.plans }),
      qc.invalidateQueries({ queryKey: ['plan'] }),
    ])
}

export function useGeneratePlan() {
  const invalidate = useInvalidatePlans()
  return useMutation({ mutationFn: api.generatePlan, onSuccess: invalidate })
}

export function useSubmitFact(planId: string) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: ({ sprintNo, body }: { sprintNo: number; body: SprintFactInput }) =>
      api.submitFact(planId, sprintNo, body),
    onSuccess: invalidate,
  })
}

export function useRecompute(planId: string) {
  const invalidate = useInvalidatePlans()
  return useMutation({ mutationFn: (afterSprint: number) => api.recompute(planId, afterSprint), onSuccess: invalidate })
}

/**
 * Оптимизация версии: POST создаёт новую версию (solver или эвристика),
 * затем дочитываем job — в тост нужны переносы людей и режим из отчёта.
 */
export function useOptimizePlan(planId: string) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: async () => {
      const started = await api.optimizePlan(planId)
      const job = await api.getOptimizeJob(started.job_id)
      return { started, job }
    },
    onSuccess: invalidate,
  })
}

export function useSetPriorities() {
  return useMutation({
    // Бэк принимает приоритет по одной задаче — шлём последовательно, чтобы не гонять БД параллельно.
    mutationFn: async ({ ids, onProgress }: { ids: string[]; onProgress?: (done: number) => void }) => {
      for (const [i, id] of ids.entries()) {
        await api.setPriority(id, i + 1)
        onProgress?.(i + 1)
      }
    },
  })
}

export function useCancelTask(planId: string) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: async ({ taskId, step }: { taskId: string; step: 'request' | 'confirm' }) =>
      step === 'request' ? api.cancelRequest(planId, taskId) : api.confirmCancel(planId, taskId),
    onSuccess: invalidate,
  })
}

// --- pin/unpin (016/020): переносы через бэк; сервер пересобирает план на той же версии ---

export function usePinTask(planId: string) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: ({ taskId, sprintNo }: { taskId: string; sprintNo: number }) =>
      api.pinTask(planId, taskId, { sprint_no: sprintNo }),
    onSuccess: invalidate,
  })
}

export function useUnpinTask(planId: string) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: (taskId: string) => api.unpinTask(planId, taskId),
    onSuccess: invalidate,
  })
}

/** «Сбросить переносы»: снять закрепления со всех pin-задач плана (по одной, чтобы не гонять БД параллельно). */
export function useUnpinAllTasks(planId: string) {
  const invalidate = useInvalidatePlans()
  return useMutation({
    mutationFn: async (taskIds: string[]) => {
      for (const id of taskIds) await api.unpinTask(planId, id)
    },
    onSuccess: invalidate,
  })
}

// --- workspaces (change 021) ---

export function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: api.listWorkspaces })
}

export function useCreateWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.createWorkspace(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.workspaces }),
  })
}

/**
 * Смена workspace (021 §1.2): обновить контекст сессии (заголовок X-Workspace-Id + роль
 * в контексте из membership) и сбросить все кэши запросов — данные чужого контекста
 * не должны притворяться состоянием нового. URL-state контента (?plan=, ?task=) сбрасывает вызывающая сторона.
 */
export function useSwitchWorkspace() {
  const qc = useQueryClient()
  return (id: string, role?: AuthRole) => {
    if (getWorkspaceId() === id) return
    setWorkspace(id, role)
    void qc.invalidateQueries()
  }
}

export function useRemoveMember(wsId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(wsId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.members(wsId) }),
  })
}

export function usePermissionsMatrix() {
  return useQuery({ queryKey: keys.permissions, queryFn: api.getPermissionsMatrix })
}

export function useUpdateRolePermission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ role, permission, enabled }: { role: string; permission: string; enabled: boolean }) =>
      api.updateRolePermission(role, permission, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.permissions }),
  })
}

export function useAuditLog() {
  return useQuery({ queryKey: keys.audit, queryFn: api.getAuditLog })
}
