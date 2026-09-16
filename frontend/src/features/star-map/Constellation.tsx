import { useMemo, useState } from 'react'
import type { TeamOverview } from '@/api/types'
import { cn } from '@/lib/cn'
import { fmt } from '@/lib/format'
import { roleFamily } from './roleColor'

interface Props {
  teams: TeamOverview[]
  fte: Record<string, number>
  /** null — фильтр не задан, подсвечены все. */
  highlighted: Set<string> | null
  roleHolders: Set<string>
  skillHolders: Set<string>
  selected: string | null
  onSelect: (engineerId: string) => void
}

const W = 900
const H = 660

/**
 * Звёздная карта: команда — созвездие, инженер — звезда.
 * Размер звезды = ставка, цвет = семейство роли; ореол — единственный носитель роли, тонкое кольцо — уникальный навык.
 * Инженер в нескольких командах рисуется в каждой и соединён пунктиром.
 */
export function Constellation({ teams, fte, highlighted, roleHolders, skillHolders, selected, onSelect }: Props) {
  const [hover, setHover] = useState<{ id: string; x: number; y: number; label: string } | null>(null)

  const layout = useMemo(() => {
    const cx = W / 2
    const cy = H / 2
    const n = teams.length
    const nodes: { id: string; team: string; x: number; y: number; r: number; color: string; role: string; grade: string; rate: number }[] = []
    const centers = teams.map((t, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(angle) * (n > 1 ? W * 0.32 : 0)
      const y = cy + 12 + Math.sin(angle) * (n > 1 ? H * 0.29 : 0)
      const ring = 34 + t.engineers.length * 4.2
      t.engineers.forEach((e, j) => {
        // Спираль, чтобы большие команды не слипались в одно кольцо
        const a = j * 2.399963 // золотой угол
        const rr = ring * Math.sqrt((j + 0.6) / t.engineers.length)
        nodes.push({
          id: e.engineer_id,
          team: t.team_id,
          x: x + Math.cos(a) * rr,
          y: y + Math.sin(a) * rr,
          r: 4 + 5 * Math.min(e.capacity_rate, 1),
          color: roleFamily(e.role).color,
          role: e.role,
          grade: e.grade,
          rate: e.capacity_rate,
        })
      })
      return { team: t.team_id, x, y, ring, count: t.engineers.length }
    })
    const byId = new Map<string, typeof nodes>()
    for (const node of nodes) byId.set(node.id, [...(byId.get(node.id) ?? []), node])
    const bridges = [...byId.values()].filter((list) => list.length > 1)
    return { nodes, centers, bridges }
  }, [teams])

  const dim = (id: string) => highlighted !== null && !highlighted.has(id)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full select-none" role="img" aria-label="Звёздная карта команд">
        <defs>
          <radialGradient id="sky" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.07" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <rect width={W} height={H} fill="url(#sky)" />

        {layout.centers.map((c) => (
          <g key={c.team}>
            <circle cx={c.x} cy={c.y} r={c.ring + 16} fill="var(--surface)" stroke="var(--border)" strokeDasharray="2 5" />
            <text x={c.x} y={c.y - c.ring - 24} textAnchor="middle" className="fill-[var(--fg)] text-[13px] font-semibold">
              {c.team}
            </text>
            <text x={c.x} y={c.y - c.ring - 10} textAnchor="middle" className="fill-[var(--subtle)] text-[11px]">
              {c.count} чел · {fmt(fte[c.team] ?? 0)} FTE
            </text>
          </g>
        ))}

        {layout.bridges.map((list) =>
          list.slice(1).map((n, i) => (
            <line
              key={`${n.id}-${i}`}
              x1={list[0].x}
              y1={list[0].y}
              x2={n.x}
              y2={n.y}
              stroke="var(--accent)"
              strokeWidth={1.2}
              strokeDasharray="4 4"
              opacity={dim(n.id) ? 0.12 : 0.55}
            />
          )),
        )}

        {layout.nodes.map((n, i) => {
          const roleSingle = roleHolders.has(n.id)
          const skillSingle = !roleSingle && skillHolders.has(n.id)
          const isSel = selected === n.id
          const faded = dim(n.id)
          return (
            <g
              key={`${n.id}-${n.team}-${i}`}
              transform={`translate(${n.x} ${n.y})`}
              className="cursor-pointer"
              opacity={faded ? 0.18 : 1}
              onClick={() => onSelect(n.id)}
              onMouseEnter={() => setHover({ id: n.id, x: n.x, y: n.y, label: `${n.id} · ${n.role} · ${n.grade} · ${n.rate} ст.` })}
              onMouseLeave={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${n.id}, ${n.role}`}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(n.id)}
            >
              {roleSingle && <circle r={n.r + 7} fill="var(--danger)" opacity={0.5} filter="url(#glow)" />}
              {roleSingle && <circle r={n.r + 3.5} fill="none" stroke="var(--danger)" strokeWidth={1.8} />}
              {skillSingle && <circle r={n.r + 3} fill="none" stroke="var(--danger)" strokeWidth={1} strokeOpacity={0.45} />}
              <circle r={n.r} fill={n.color} stroke={isSel ? 'var(--fg)' : 'var(--surface)'} strokeWidth={isSel ? 2.5 : 1.5} />
              {n.rate < 1 && <circle r={n.r * 0.4} fill="var(--surface)" />}
            </g>
          )
        })}
      </svg>

      {hover && (
        <div
          className={cn('pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-fg px-2 py-1 text-xs whitespace-nowrap text-bg shadow-pop')}
          style={{ left: `${(hover.x / W) * 100}%`, top: `calc(${(hover.y / H) * 100}% - 12px)` }}
        >
          {hover.label}
        </div>
      )}
    </div>
  )
}
