import type { StarGraph } from './model'

/**
 * Укладка «созвездий» — детерминированная, без физики:
 * 1. Команды — непересекающиеся круги по кольцу, размер от числа людей; команды с общими людьми — соседи.
 * 2. Люди — «подсолнух» внутри круга своей команды; совместители — на краю, обращённом к второй команде.
 * 3. Роли и навыки — у центра своих носителей, но всегда вне кругов команд: «звёзды между созвездиями».
 * 4. Раздвигание наложений.
 * Одинаковые данные → одинаковая карта при каждом открытии (пользователь запоминает, где что).
 */

const S = 16 // шаг между людьми в единицах графа
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

type P = { x: number; y: number }

function orderTeams(teams: string[], members: Map<string, string[]>, shared: (a: string, b: string) => number): string[] {
  const size = (t: string) => members.get(t)!.length
  const order = [[...teams].sort((a, b) => size(b) - size(a) || a.localeCompare(b))[0]]
  const rest = new Set(teams.filter((t) => t !== order[0]))
  while (rest.size) {
    const last = order.at(-1)!
    const next = [...rest].sort((a, b) => shared(last, b) - shared(last, a) || size(b) - size(a) || a.localeCompare(b))[0]
    order.push(next)
    rest.delete(next)
  }
  return order
}

/** aspect — во сколько раз кольцо шире, чем выше: под пропорции холста */
export function layoutStarGraph(graph: StarGraph, ASPECT = 1.5) {
  const people = graph.filterNodes((_, a) => a.kind === 'person')
  const members = new Map<string, string[]>()
  graph.forEachNode((_, a) => {
    if (a.kind === 'anchor') members.set(a.team!, [])
  })
  for (const p of people) for (const t of graph.getNodeAttribute(p, 'teams')!) members.get(t)?.push(p)
  const pairs = new Map<string, number>()
  for (const p of people) {
    const ts = [...graph.getNodeAttribute(p, 'teams')!].sort()
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) pairs.set(`${ts[i]}|${ts[j]}`, (pairs.get(`${ts[i]}|${ts[j]}`) ?? 0) + 1)
  }
  const shared = (a: string, b: string) => pairs.get([a, b].sort().join('|')) ?? 0

  // 1. круги команд по кольцу; угол каждой команды пропорционален её диаметру
  const teams = orderTeams([...members.keys()], members, shared)
  const radius = new Map(teams.map((t) => [t, S * 1.25 * Math.sqrt(members.get(t)!.length) + S * 0.8]))
  const gap = S * 4.5
  const total = teams.reduce((s, t) => s + 2 * radius.get(t)! + gap, 0)
  const maxR = Math.max(...radius.values())
  const R = teams.length === 1 ? 0 : Math.max(total / (2 * Math.PI), maxR + gap)
  const center = new Map<string, P>()
  let acc = 0
  for (const t of teams) {
    const share = (2 * radius.get(t)! + gap) / total
    const angle = Math.PI / 2 + (acc + share / 2) * Math.PI * 2
    acc += share
    // кольцо вытянуто по горизонтали: карта живёт в широком холсте, круг оставлял бы пустыми бока
    const c = { x: Math.cos(angle) * R * ASPECT, y: Math.sin(angle) * R }
    center.set(t, c)
    graph.mergeNodeAttributes(`a:${t}`, c)
  }

  // 2. люди: основная команда — с большей ставкой
  const primary = (p: string) => graph.getNodeAttribute(p, 'teams')![0]
  const pos = new Map<string, P>()
  for (const t of teams) {
    const c = center.get(t)!
    const own = members.get(t)!.filter((p) => primary(p) === t)
    const solo = own.filter((p) => graph.getNodeAttribute(p, 'teams')!.length === 1).sort()
    solo.forEach((p, k) => {
      const r = S * 1.25 * Math.sqrt(k + 0.5)
      pos.set(p, { x: c.x + Math.cos(k * GOLDEN) * r, y: c.y + Math.sin(k * GOLDEN) * r })
    })
    own
      .filter((p) => !solo.includes(p))
      .sort()
      .forEach((p, k) => {
        const other = center.get(graph.getNodeAttribute(p, 'teams')![1])!
        const edge = radius.get(t)! - S * 0.4
        // несколько совместителей в одну сторону — веером вдоль края
        const spread = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.28
        const base = Math.atan2(other.y - c.y, other.x - c.x) + spread
        pos.set(p, { x: c.x + Math.cos(base) * edge, y: c.y + Math.sin(base) * edge })
      })
  }
  relax(pos, S * 1.35, 80, (p, q) => {
    // люди остаются внутри своего круга
    const t = primary(p)
    const c = center.get(t)!
    const lim = radius.get(t)! - S * 0.3
    const d = Math.hypot(q.x - c.x, q.y - c.y)
    if (d > lim) {
      q.x = c.x + ((q.x - c.x) / d) * lim
      q.y = c.y + ((q.y - c.y) / d) * lim
    }
  })
  for (const [p, q] of pos) graph.mergeNodeAttributes(p, q)

  // 3. компетенции — отдельно роли и навыки (в одной линзе видны только одни)
  for (const kind of ['role', 'skill'] as const) {
    const comps = graph.filterNodes((_, a) => a.kind === kind).sort()
    const cpos = new Map<string, P>()
    const perTeam = new Map<string, number>()
    for (const n of comps) {
      const holders = graph.neighbors(n).filter((m) => m.startsWith('p:'))
      if (!holders.length) {
        cpos.set(n, { x: 0, y: 0 })
        continue
      }
      const hs = holders.map((h) => pos.get(h)!)
      const cx = hs.reduce((s, h) => s + h.x, 0) / hs.length
      const cy = hs.reduce((s, h) => s + h.y, 0) / hs.length
      const hTeams = new Set(holders.map(primary))
      if (hTeams.size === 1) {
        // компетенция одной команды — на орбите снаружи её круга, веером; сектор над кругом оставляем под подпись команды
        const t = [...hTeams][0]
        const c = center.get(t)!
        const k = perTeam.get(t) ?? 0
        perTeam.set(t, k + 1)
        let a = (R ? Math.atan2(c.y, c.x / ASPECT) : -Math.PI / 2) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.42
        const up = Math.PI / 2
        const diff = Math.atan2(Math.sin(a - up), Math.cos(a - up))
        if (Math.abs(diff) < 0.55) a = up + Math.sign(diff || 1) * 0.55
        const orbit = radius.get(t)! + S * (1.4 + 0.5 * Math.floor(k / 12))
        cpos.set(n, { x: c.x + Math.cos(a) * orbit, y: c.y + Math.sin(a) * orbit })
      } else cpos.set(n, { x: cx, y: cy })
    }
    relax(cpos, kind === 'role' ? S * 1.25 : S * 1.05, 160, (_, q) => {
      for (const t of teams) {
        const c = center.get(t)!
        const lim = radius.get(t)! + S * 0.9
        const d = Math.hypot(q.x - c.x, q.y - c.y)
        if (d < lim) {
          const ux = d ? (q.x - c.x) / d : 0
          const uy = d ? (q.y - c.y) / d : 1
          q.x = c.x + ux * lim
          q.y = c.y + uy * lim
        }
        // место под подписью команды (над кругом; в sigma ось y смотрит вверх).
        // Прямоугольник шире слева: подпись звезды идёт вправо от неё и наезжала бы на название команды
        const lx = c.x
        const ly = c.y + radius.get(t)! + S * 1.2
        if (q.x > lx - S * 9 && q.x < lx + S * 3.5 && q.y > ly - S * 1.1 && q.y < ly + S * 1.4) q.y = ly + S * 1.4
      }
    })
    for (const [n, q] of cpos) graph.mergeNodeAttributes(n, q)
  }
}

/** Раздвигает точки ближе minDist друг к другу; constrain — ограничение после каждого шага. */
function relax(pos: Map<string, P>, minDist: number, iterations: number, constrain: (id: string, p: P) => void) {
  const ids = [...pos.keys()]
  for (let it = 0; it < iterations; it++) {
    let moved = false
    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i])!
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j])!
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= minDist) continue
        if (d < 1e-6) {
          // детерминированное направление для совпавших точек
          dx = Math.cos(i + j)
          dy = Math.sin(i + j)
          d = 1
        }
        const push = (minDist - d) / 2
        a.x -= (dx / d) * push
        a.y -= (dy / d) * push
        b.x += (dx / d) * push
        b.y += (dy / d) * push
        moved = true
      }
    }
    for (const id of ids) constrain(id, pos.get(id)!)
    if (!moved) break
  }
}
