// Упрощённый жадный планировщик для мок-режима. Не копия бэка — только правдоподобные данные для UI.
import type { BusFactorReport, Explanation, PlanWarning } from '../api/types'
import { DEPENDENCIES, ENGINEERS, TEAM_HISTORY, TASKS } from './data/dataset'
import type { MockPlan, MockPlanItem } from './types'

const SPRINTS = 6

function teamCapacitySp(teamId: string): number {
  const hist = TEAM_HISTORY.filter((h) => h.team_id === teamId)
  if (!hist.length) return 8
  const avg = hist.reduce((s, h) => s + h.velocity_achieved, 0) / hist.length
  return Math.round(avg * 0.8 * 10) / 10
}

function roleHoursPool(): Record<string, number> {
  const pool: Record<string, number> = {}
  // Инженер в двух командах встречается дважды — ставки складываются, но не больше 80 ч.
  const byEngineer = new Map<string, { role: string; rate: number }>()
  for (const e of ENGINEERS) {
    const prev = byEngineer.get(e.engineer_id + e.role)
    byEngineer.set(e.engineer_id + e.role, { role: e.role, rate: Math.min(1, (prev?.rate ?? 0) + e.capacity_rate) })
  }
  for (const { role, rate } of byEngineer.values()) {
    const key = role.toLowerCase()
    pool[key] = (pool[key] ?? 0) + 80 * rate
  }
  return pool
}

function remainingSp(t: (typeof TASKS)[number]): number {
  if (t.status !== 'InProgress' || !t.estimated_hh) return t.estimation_sp
  const left = Math.max(t.estimated_hh - t.spent_time, t.estimated_hh * 0.15)
  return Math.round((t.estimation_sp * left) / t.estimated_hh * 10) / 10
}

interface PlanInput {
  /** Спринты ≤ fixedUntil берутся из base без изменений. */
  fixedUntil: number
  base?: MockPlan
  doneTaskIds?: Set<string>
}

export function buildPlan({ fixedUntil, base, doneTaskIds = new Set() }: PlanInput): Omit<MockPlan, 'plan_id' | 'parent_plan_id' | 'is_initial' | 'recomputed_after_sprint' | 'created_at'> {
  const items: MockPlanItem[] = []
  const sprintOf = new Map<string, number>()

  for (const it of base?.items ?? []) {
    if (it.sprint_no && it.sprint_no <= fixedUntil && it.decision !== 'cancelled') {
      const done = doneTaskIds.has(it.task_id)
      if (!done && it.sprint_no === fixedUntil) continue // не сделали — вернётся в пул
      items.push(done ? { ...it, decision: 'done_actual', reason: 'Выполнена по факту спринта' } : it)
      sprintOf.set(it.task_id, it.sprint_no)
    }
  }
  const cancelled = new Set(
    [...(base?.items ?? []), ...(base?.not_planned ?? [])].filter((i) => i.decision === 'cancelled').map((i) => i.task_id),
  )

  const prevSprint = new Map(base?.items.map((i) => [i.task_id, i.sprint_no]) ?? [])
  const teamLeft = new Map<string, number[]>()
  const roleLeft: Record<string, number>[] = Array.from({ length: SPRINTS + 1 }, roleHoursPool)
  const pool = TASKS.filter((t) => t.status !== 'Done' && !sprintOf.has(t.task_id) && !cancelled.has(t.task_id)).sort(
    (a, b) => a.priority - b.priority,
  )
  const notPlanned: Explanation[] = []

  // Несколько проходов, чтобы зависимые задачи успели встать после блокирующих.
  for (let pass = 0; pass < 3; pass++) {
    for (const t of pool) {
      if (sprintOf.has(t.task_id)) continue
      const sp = remainingSp(t)
      const caps = teamLeft.get(t.team_id) ?? Array(SPRINTS + 1).fill(teamCapacitySp(t.team_id))
      teamLeft.set(t.team_id, caps)

      const blockers = DEPENDENCIES.filter((d) => d.blocked_task_id === t.task_id).map((d) => d.blocking_task_id)
      const pendingBlocker = blockers.find((b) => !sprintOf.has(b) && !TASKS.find((x) => x.task_id === b && x.status === 'Done'))
      if (pendingBlocker && pass < 2) continue
      const minSprint = Math.max(fixedUntil + 1, ...blockers.map((b) => (sprintOf.get(b) ?? 0) + 1))

      let placed = false
      let lastReason = ''
      for (let s = minSprint; s <= SPRINTS; s++) {
        if (caps[s] < sp && caps[s] < teamCapacitySp(t.team_id) * 0.5) {
          lastReason = `не хватает ресурса команды ${t.team_id} (SP)`
          continue
        }
        // Мок: часы ролей не режут план жёстко (иначе почти всё выпадает) — только отмечаем причину.
        const tight = Object.entries(t.role_hours).find(([role, h]) => (roleLeft[s][role.toLowerCase()] ?? 0) < h)
        if (tight) lastReason = lastReason || `часов роли «${tight[0]}» впритык`
        caps[s] -= sp
        for (const [role, h] of Object.entries(t.role_hours)) roleLeft[s][role.toLowerCase()] = (roleLeft[s][role.toLowerCase()] ?? 0) - h
        sprintOf.set(t.task_id, s)

        const was = prevSprint.get(t.task_id)
        const moved = was != null && s > was
        const overdue = t.status === 'InProgress' && t.spent_time >= t.estimated_hh
        items.push({
          task_id: t.task_id,
          sprint_no: s,
          step_points_sp: sp,
          decision: moved ? 'postponed' : 'planned',
          reason: moved
            ? `Перенесена из спринта ${was}: ${lastReason || 'сдвиг после факта предыдущего спринта'}`
            : overdue
              ? 'Включена: остаток просроченной задачи (overdue)'
              : s > minSprint
                ? `Включена в спринт ${s}: ${lastReason}`
                : pendingBlocker || blockers.length
                  ? 'Включена после завершения блокирующих задач'
                  : '',
        })
        placed = true
        break
      }
      if (!placed && pass === 2) {
        const blockerReason = pendingBlocker ? `блокирующая задача ${pendingBlocker} не попала в квартал` : lastReason
        notPlanned.push({
          task_id: t.task_id,
          sprint_no: null,
          decision: 'postponed',
          reason: `Не будет взята в квартал: ${blockerReason || 'не хватает ресурса до спринта 6'}`,
        })
      }
    }
  }

  // Сохраняем подтверждённые отмены и запросы на отмену.
  for (const np of base?.not_planned ?? []) {
    if (np.decision === 'cancelled') notPlanned.push(np)
    const same = notPlanned.find((x) => x.task_id === np.task_id)
    if (same && np.decision === 'cancelled_pending') same.decision = 'cancelled_pending'
  }

  return { items: items.sort((a, b) => (a.sprint_no ?? 0) - (b.sprint_no ?? 0)), not_planned: notPlanned }
}

export function computeWarnings(before: MockPlan, after: MockPlan, sprintNo: number): PlanWarning[] {
  const out: PlanWarning[] = []
  const beforeSprint = new Map(before.items.map((i) => [i.task_id, i.sprint_no ?? 0]))
  const moved = after.items.filter((i) => (i.sprint_no ?? 0) > (beforeSprint.get(i.task_id) ?? 99))
  const movedIds = new Set(moved.map((m) => m.task_id))

  const chain = DEPENDENCIES.filter((d) => movedIds.has(d.blocking_task_id))
  if (chain.length) {
    out.push({
      kind: 'dependency_shift',
      message: 'Сдвиг цепочки зависимых задач из-за невыполнения блокирующих',
      task_ids: [...new Set(chain.flatMap((d) => [d.blocking_task_id, d.blocked_task_id]))],
    })
  }
  const dropped = after.not_planned.filter((n) => before.items.some((i) => i.task_id === n.task_id))
  if (dropped.length) {
    out.push({
      kind: 'deadline_overflow',
      message: 'Прогнозная дата завершения выходит за пределы квартала',
      task_ids: dropped.map((d) => d.task_id),
    })
  }
  const nextSprint = sprintNo + 1
  const need: Record<string, number> = {}
  for (const it of after.items.filter((i) => i.sprint_no === nextSprint)) {
    const t = TASKS.find((x) => x.task_id === it.task_id)
    for (const [r, h] of Object.entries(t?.role_hours ?? {})) need[r] = (need[r] ?? 0) + h
  }
  const pool = roleHoursPool()
  const deficit = Object.entries(need).filter(([r, h]) => h > (pool[r.toLowerCase()] ?? 0) * 0.85)
  if (deficit.length) {
    out.push({
      kind: 'role_deficit',
      message: `Дефицит ролей на спринт ${nextSprint}: ${deficit.map(([r, h]) => `${r} — нужно ${Math.round(h)} ч`).join(', ')}`,
      task_ids: after.items
        .filter((i) => i.sprint_no === nextSprint && Object.keys(TASKS.find((t) => t.task_id === i.task_id)?.role_hours ?? {}).some((r) => deficit.some(([d]) => d === r)))
        .map((i) => i.task_id),
    })
  }
  if (moved.length || dropped.length) {
    out.push({
      kind: 'composition_change',
      message: `Состав плана изменился: перенесено ${moved.length}, выпало из квартала ${dropped.length}`,
      task_ids: [...movedIds, ...dropped.map((d) => d.task_id)],
    })
  }
  return out
}

export const METHODOLOGY =
  'Bus Factor = число носителей компетенции (роли или заявленного навыка) в области расчёта ' +
  '(компания или команда); инженер, работающий в двух командах по 0.5 ставки, считается носителем ' +
  'в обеих. Риск отмечается при factor ≤ 1. Расчёт по профилям engineers_profiles; грейд не ' +
  'влияет. Ограничение методики: навыки заявлены декларативно и проверяются по строке ' +
  'skills_declared (без учёта уровня владения).'

export function computeBusFactor(): BusFactorReport {
  const buckets = new Map<string, { scope_type: 'company' | 'team'; scope_id: string; key: string; holders: Set<string> }>()
  const add = (scope_type: 'company' | 'team', scope_id: string, key: string, id: string) => {
    const k = `${scope_type}|${scope_id}|${key}`
    const b = buckets.get(k) ?? { scope_type, scope_id, key, holders: new Set<string>() }
    b.holders.add(id)
    buckets.set(k, b)
  }
  for (const e of ENGINEERS) {
    const keys = [e.role.toLowerCase(), ...e.skills_declared.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]
    for (const key of keys) {
      add('company', 'company', key, e.engineer_id)
      add('team', e.team_id, key, e.engineer_id)
    }
  }
  return {
    methodology: METHODOLOGY,
    items: [...buckets.values()].map((b) => ({
      scope_type: b.scope_type,
      scope_id: b.scope_id,
      key: b.key,
      holders: [...b.holders].sort(),
      factor: b.holders.size,
    })),
  }
}
