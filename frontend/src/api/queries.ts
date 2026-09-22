import { useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getWorkspaceId, setWorkspace } from './auth'
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

/** change 035: датасет загружен в current workspace? (короткий staleTime, инвализация после confirm) */
export function useDatasetLoaded() {
  return useQuery({
    queryKey: ['dataset-status', getWorkspaceId()],
    queryFn: api.datasetStatus,
    staleTime: 10_000,
  })
}

export function useDependencies() {
  return useQuery({ queryKey: keys.dependencies, queryFn: api.listDependencies })
}

export function useStarMap() {
  return useQuery({ queryKey: keys.starMap, queryFn: api.getStarMap })
}

/** change 043: совет — глобальный react-query state per planId (не слетает при переключении вкладок).
 * Manual refetch по кнопке; кэш и статус запроса переживают размонтирование панели. */
export function useAdvice(planId: string) {
  return useQuery({
    queryKey: ['advice', planId],
    queryFn: ({ queryKey: [, id] }) => api.getAdvice(id as string),
    enabled: false,
    staleTime: Infinity,
  })
}

/** change 043: история советов по версии плана. */
export function useAdviceHistory(planId: string) {
  return useQuery({
    queryKey: ['advice-history', planId],
    queryFn: () => api.getAdviceHistory(planId),
    staleTime: 15_000,
  })
}

export function useBusFactor() {
  return useQuery({ queryKey: keys.busFactor, queryFn: api.getBusFactor })
}

/** Советы и bus-risk строятся на конкретной версии плана — инвалидируются с ['plan'] цепочкой. */
export function usePlanBusRisk(planId: string | null | undefined) {
  return useQuery({ queryKey: ['plan', planId ?? '', 'bus-risk'], queryFn: () => api.getPlanBusRisk(planId!), enabled: !!planId })
}

/** Прогноз bus factor по плановой загрузке (change 023) — тоже привязан к версии плана. */
export function useBusForecast(planId: string | null | undefined) {
  return useQuery({ queryKey: ['plan', planId ?? '', 'bus-forecast'], queryFn: () => api.getBusForecast(planId!), enabled: !!planId })
}

export function useEngineers(filters: EngineerFilters) {
  return useQuery({
    queryKey: keys.engineers(filters),
    queryFn: () => api.listEngineers(filters),
    placeholderData: (prev) => prev,
  })
}

/** Список команд с участниками — для редактора данных (Команды). */
export function useTeams() {
  return useQuery({ queryKey: keys.teams, queryFn: api.listTeams })
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
      qc.invalidateQueries({ queryKey: ['dataset-status'] }),
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
  return useMutation({ mutationFn: (afterSprint?: number) => api.recompute(planId, afterSprint ?? 0), onSuccess: invalidate })
}

/**
 * Оптимизация версии: POST создаёт новую версию (solver или эвристика),
 * change 031: job из очереди опрашивается до терминального статуса
 * (ready|failed) с интервалом 2 c — кнопка остаётся busy весь solve.
 */
const OPTIMIZE_POLL_MS = 2000
const OPTIMIZE_POLL_LIMIT_MS = 3_120_000 // 52 мин > arq job_timeout 300 с — сторож для вечного pollа

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function useOptimizePlan(planId: string) {
  const invalidate = useInvalidatePlans()
  const [pollStatus, setPollStatus] = useState<'queued' | 'solving' | 'ready' | 'failed' | null>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      const started = await api.optimizePlan(planId)
      setPollStatus('queued')
      const deadline = Date.now() + OPTIMIZE_POLL_LIMIT_MS
      let job = await api.getOptimizeJob(started.job_id)
      while (job.status !== 'ready' && job.status !== 'failed') {
        if (Date.now() > deadline) {
          throw new Error('Solver не уложился в бюджет ожидания — проверьте статус задачи позже (GET /plans/optimize/{job_id})')
        }
        await sleep(OPTIMIZE_POLL_MS)
        job = await api.getOptimizeJob(started.job_id)
        setPollStatus(job.status)
      }
      return { started, job }
    },
    onSettled: () => setPollStatus(null),
    onSuccess: invalidate,
  })
  return { ...mutation, pollStatus }
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
    mutationFn: ({ taskId, sprintNo, fromSprintNo }: { taskId: string; sprintNo: number; fromSprintNo?: number }) =>
      api.pinTask(planId, taskId, { sprint_no: sprintNo, from_sprint_no: fromSprintNo }),
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
 * Смена workspace (021 §1.2): обновить контекст сессии (заголовок X-Workspace-Id)
 * и сбросить все кэши запросов — данные чужого контекста не должны притворяться
 * состоянием нового. URL-state контента (?plan=, ?task=) сбрасывает вызывающая сторона.
 */
export function useSwitchWorkspace() {
  const qc = useQueryClient()
  return (id: string) => {
    if (getWorkspaceId() === id) return
    setWorkspace(id)
    void qc.invalidateQueries()
  }
}
