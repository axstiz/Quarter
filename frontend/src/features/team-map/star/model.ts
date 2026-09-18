import Graph from 'graphology'
import type { BusFactorReport, Engineer } from '@/api/types'

export type NodeKind = 'person' | 'role' | 'skill' | 'anchor'

export interface StarNode {
  kind: NodeKind
  label: string
  x: number
  y: number
  size: number
  /** person */
  teams?: string[]
  role?: string
  grade?: string
  rate?: number
  soleRoles?: string[]
  /** role | skill */
  key?: string
  holders?: string[]
  factor?: number
  demand?: string[]
  /** anchor */
  team?: string
}

export interface StarEdge {
  kind: 'competency' | 'anchor'
  weight: number
}

export type StarGraph = Graph<StarNode, StarEdge>

export const personId = (id: string) => `p:${id}`
export const competencyId = (kind: 'role' | 'skill', key: string) => `c:${kind}:${key}`
export const anchorId = (team: string) => `a:${team}`

interface Input {
  engineers: Engineer[]
  busFactor: BusFactorReport
  /** «company|роль» → задачи плана, которым нужна роль */
  roleDemand: Map<string, string[]>
}

/**
 * Граф звёздной карты: инженеры (один узел на человека, даже если он в двух командах),
 * роли и навыки (company-scope Bus Factor), скрытые якоря команд для укладки.
 */
export function buildStarGraph({ engineers, busFactor, roleDemand }: Input): StarGraph {
  const graph: StarGraph = new Graph({ type: 'undirected', multi: false })

  const people = new Map<string, Engineer[]>()
  for (const e of engineers) people.set(e.engineer_id, [...(people.get(e.engineer_id) ?? []), e])
  const roleKeys = new Set(engineers.map((e) => e.role.toLowerCase()))
  const company = busFactor.items.filter((i) => i.scope_type === 'company')
  const soleRolesOf = new Map<string, string[]>()
  for (const i of company) if (i.factor === 1 && roleKeys.has(i.key)) soleRolesOf.set(i.holders[0], [...(soleRolesOf.get(i.holders[0]) ?? []), i.key])

  const teams = [...new Set(engineers.map((e) => e.team_id))].sort()
  for (const team of teams) graph.addNode(anchorId(team), { kind: 'anchor', label: team, team, x: 0, y: 0, size: 0 })

  for (const [id, unsorted] of people) {
    // основная команда — с большей ставкой: по ней человек стоит на карте
    const rows = [...unsorted].sort((a, b) => b.capacity_rate - a.capacity_rate || a.team_id.localeCompare(b.team_id))
    const rate = Math.min(rows.reduce((a, r) => a + r.capacity_rate, 0), 1)
    graph.addNode(personId(id), {
      kind: 'person',
      label: id,
      teams: rows.map((r) => r.team_id),
      role: rows[0].role,
      grade: rows[0].grade,
      rate,
      soleRoles: soleRolesOf.get(id) ?? [],
      x: 0,
      y: 0,
      size: 5 + 3 * rate,
    })
    for (const r of rows) graph.addEdge(personId(id), anchorId(r.team_id), { kind: 'anchor', weight: r.capacity_rate >= 1 ? 3 : 2 })
  }

  for (const item of company) {
    const kind = roleKeys.has(item.key) ? 'role' : 'skill'
    const demand = kind === 'role' ? (roleDemand.get(`company|${item.key}`) ?? []) : []
    const node = competencyId(kind, item.key)
    graph.addNode(node, {
      kind,
      key: item.key,
      label: item.key.charAt(0).toUpperCase() + item.key.slice(1),
      holders: item.holders,
      factor: item.factor,
      demand,
      x: 0,
      y: 0,
      // роль: размер по числу задач плана (влияние на план); навык: по числу носителей
      size: kind === 'role' ? 6 + 2.4 * Math.sqrt(demand.length) : 3.5 + 1.4 * Math.sqrt(item.holders.length),
    })
    for (const h of item.holders) if (graph.hasNode(personId(h))) graph.addEdge(node, personId(h), { kind: 'competency', weight: 0.4 })
  }
  return graph
}
