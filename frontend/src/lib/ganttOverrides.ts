import type { PlanRow } from './planModel'

/**
 * Локальные переносы частей задач между спринтами (Гант и «Гант по ролям»
 * показывают одинаковую раскладку). Хранятся только при мок-бэкенде.
 */
export type Placement = Record<string, number>

export const partKey = (taskId: string, sprintNo: number) => `${taskId}:${sprintNo}`
export const cardKey = (taskId: string, row: PlanRow) => partKey(taskId, row.sprint_no!)
const keyFor = (planId: string) => `quarter-gantt-cards:${planId}`

export function loadPlacement(planId: string): Placement {
  try {
    return JSON.parse(localStorage.getItem(keyFor(planId)) ?? '{}') as Placement
  } catch {
    return {}
  }
}

export function persistPlacement(planId: string, value: Placement) {
  try {
    if (Object.keys(value).length) localStorage.setItem(keyFor(planId), JSON.stringify(value))
    else localStorage.removeItem(keyFor(planId))
  } catch {
    /* нет доступа к хранилищу — переносы работают до перезагрузки */
  }
}

/** Спринт, в котором часть задачи отображается (перенос приоритетнее плана). */
export const projectedSprint = (placement: Placement, taskId: string, row: PlanRow) =>
  placement[cardKey(taskId, row)] ?? row.sprint_no!
