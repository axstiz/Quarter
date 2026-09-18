import type { BusFactorReport } from '@/api/types'
import type { TaskSummary } from '@/lib/planModel'

export interface RiskEntry {
  task: TaskSummary
  roles: { role: string; holder: string }[]
}

/** Роль (в нижнем регистре) → носители по всей компании. */
export function companyRoleHolders(report: BusFactorReport | undefined): Map<string, string[]> {
  return new Map((report?.items ?? []).filter((i) => i.scope_type === 'company').map((i) => [i.key.toLowerCase(), i.holders]))
}

/**
 * Задачи плана (каждая один раз), зависящие от роли с единственным носителем в компании.
 * Отдельной ручки в API нет — считаем по role_hours задачи и /bus-factor.
 */
export function tasksAtRisk(tasks: Iterable<TaskSummary>, report: BusFactorReport | undefined): RiskEntry[] {
  const holders = companyRoleHolders(report)
  const out: RiskEntry[] = []
  for (const task of tasks) {
    if (task.decision === 'done_actual' || task.decision === 'cancelled') continue
    const roles = Object.keys(task.role_hours)
      .filter((r) => holders.get(r.toLowerCase())?.length === 1)
      .map((r) => ({ role: r, holder: holders.get(r.toLowerCase())![0] }))
    if (roles.length) out.push({ task, roles })
  }
  return out
}
