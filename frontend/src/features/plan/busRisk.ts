import type { BusFactorReport, PlanTask } from '@/api/types'

export interface RiskEntry {
  task: PlanTask
  competencies: { key: string; holder: string }[]
}

/**
 * Задачи плана под угрозой Bus Factor.
 * Отдельной ручки нет: сопоставляем роли из role_hours задачи с ролями company-scope,
 * у которых factor ≤ 1. Когда бэк отдаст готовый список — заменить этот расчёт.
 */
export function tasksAtRisk(tasks: PlanTask[], report: BusFactorReport | undefined): RiskEntry[] {
  if (!report) return []
  const single = new Map(
    report.items.filter((i) => i.scope_type === 'company' && i.factor <= 1).map((i) => [i.key.toLowerCase(), i.holders[0] ?? '—']),
  )
  const out: RiskEntry[] = []
  for (const task of tasks) {
    if (task.decision === 'done_actual' || task.decision === 'cancelled') continue
    const competencies = Object.keys(task.role_hours)
      .filter((role) => single.has(role.toLowerCase()))
      .map((role) => ({ key: role, holder: single.get(role.toLowerCase())! }))
    if (competencies.length) out.push({ task, competencies })
  }
  return out
}
