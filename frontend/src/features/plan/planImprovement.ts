import type { OptimizeJob } from '@/api/types'

/**
 * change 041: сводка improvement после optimize — по реальным цифрам отчёта
 * (σ SP по спринтам, перегрузы по командным лимитам, режим и причина деградации).
 */
export function buildImprovementSummary(job: OptimizeJob): string | null {
  const report = job.report
  if (!report) return null

  const lines: string[] = [`Режим: ${report.mode === 'solver' ? 'solver Timefold' : 'эвристика'}.`]

  const stdBefore = stdDevOfRecord(report.before?.sprint_sp)
  const stdAfter = stdDevOfRecord(report.after?.sprint_sp)
  if (stdBefore !== null && stdAfter !== null) {
    lines.push(`SP по спринтам: σ ${round1(stdBefore)} → ${round1(stdAfter)}.`)
  }

  const overSprints = report.split_by_team_role?.after?.filter((r) => !r.within_norm) ?? []
  if (overSprints.length > 0) {
    lines.push(`Командных ролей с потребностью выше своих носителей (закрывается займом): ${overSprints.length}.`)
  }

  if (report.degradation_reason) {
    lines.push(`Деградация: ${report.degradation_reason}.`)
  }

  return lines.join(' ')
}

function stdDevOfRecord(rec: Record<string, number> | undefined): number | null {
  if (!rec) return null
  const vals = Object.values(rec)
  if (vals.length < 2) return null
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length
  return Math.sqrt(vals.reduce((acc, x) => acc + (x - mean) ** 2, 0) / vals.length)
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
