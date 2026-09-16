import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
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
  return useMutation({ mutationFn: () => api.recompute(planId), onSuccess: invalidate })
}

export function useSetPriorities() {
  return useMutation({
    // Бэк принимает приоритет по одной задаче — шлём последовательно, чтобы не гонять БД параллельно.
    mutationFn: async (orderedTaskIds: string[]) => {
      for (const [i, id] of orderedTaskIds.entries()) await api.setPriority(id, i + 1)
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
