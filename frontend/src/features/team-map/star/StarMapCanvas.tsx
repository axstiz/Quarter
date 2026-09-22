import { createNodeBorderProgram } from '@sigma/node-border'
import { useReducedMotion } from 'motion/react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Sigma from 'sigma'
import { animateNodes } from 'sigma/utils'
import type { NodeDisplayData, PartialButFor } from 'sigma/types'
import { drawSmoothClosed, hullPath } from './hulls'
import type { StarGraph, StarNode } from './model'
import { readMapColors, type MapColors } from './palette'

export type Lens = 'teams' | 'roles' | 'skills'

export interface MapState {
  lens: Lens
  riskOnly: boolean
  focusTeam: string | null
  selected: string | null
}

export interface StarMapHandle {
  focusNode: (node: string) => void
  focusTeam: (team: string | null) => void
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
}

interface Props {
  graph: StarGraph
  state: MapState
  teamMeta: Map<string, { people: number; fte: number }>
  onSelect: (node: string | null) => void
}

type HoverInfo = { node: string; x: number; y: number } | null

// Первое появление карты — «созвездия» собираются из центров команд. Один раз за сессию: частое действие не анимируем.
let introPlayed = false

const LABEL_FONT = 'Onest, system-ui, sans-serif'

export const StarMapCanvas = forwardRef<StarMapHandle, Props>(function StarMapCanvas({ graph, state, teamMeta, onSelect }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const stateRef = useRef(state)
  const hoverRef = useRef<string | null>(null)
  const colorsRef = useRef<MapColors>(readMapColors())
  const teamMetaRef = useRef(teamMeta)
  const onSelectRef = useRef(onSelect)
  const [hover, setHover] = useState<HoverInfo>(null)
  const reduce = useReducedMotion()
  const duration = reduce ? 0 : 420

  stateRef.current = state
  teamMetaRef.current = teamMeta
  onSelectRef.current = onSelect

  // --- создание sigma: один раз на граф ---
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const c = () => colorsRef.current
    // кэш объявлен до new Sigma: конструктор сразу вызывает редьюсеры
    const cache = new Map<string, Set<string> | null>()

    const drawLabel = (ctx: CanvasRenderingContext2D, data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>, settings: { labelSize: number; labelFont: string; labelWeight: string }) => {
      if (!data.label) return
      const size = settings.labelSize
      ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`
      const x = data.x + data.size + 4
      const y = data.y + size / 3
      // обводка цветом поверхности: подпись читается поверх рёбер и соседних звёзд
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.strokeStyle = c().surface
      ctx.strokeText(data.label, x, y)
      ctx.fillStyle = c().ink2
      ctx.fillText(data.label, x, y)
    }

    const drawHover = (ctx: CanvasRenderingContext2D, data: PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>, settings: { labelSize: number; labelFont: string; labelWeight: string }) => {
      // ореол вокруг звезды + подпись на плашке
      ctx.beginPath()
      ctx.arc(data.x, data.y, data.size + 5, 0, Math.PI * 2)
      ctx.fillStyle = c().accentSoft
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = c().accent
      ctx.stroke()
      if (!data.label) return
      const size = settings.labelSize + 1
      ctx.font = `600 ${size}px ${settings.labelFont}`
      const w = ctx.measureText(data.label).width
      const x = data.x + data.size + 8
      const h = size + 10
      const y = data.y - h / 2
      ctx.beginPath()
      ctx.roundRect(x, y, w + 14, h, 6)
      ctx.fillStyle = c().surface
      ctx.shadowColor = c().labelShadow
      ctx.shadowBlur = 12
      ctx.fill()
      ctx.shadowBlur = 0
      ctx.lineWidth = 1
      ctx.strokeStyle = c().ruleStrong
      ctx.stroke()
      ctx.fillStyle = c().ink
      ctx.fillText(data.label, x + 7, data.y + size / 3)
    }

    const StarProgram = createNodeBorderProgram({
      borders: [
        { size: { attribute: 'borderSize', defaultValue: 0 }, color: { attribute: 'borderColor' } },
        { size: { fill: true }, color: { attribute: 'color' } },
      ],
      drawLabel: drawLabel as never,
      drawHover: drawHover as never,
    })

    const intro = !introPlayed && !reduce
    const targets: Record<string, { x: number; y: number }> = {}
    if (intro) {
      graph.forEachNode((n, a) => {
        targets[n] = { x: a.x, y: a.y }
        if (a.kind === 'anchor') return
        const anchors = graph.neighbors(n).filter((m) => m.startsWith('a:'))
        const src = anchors.length ? graph.getNodeAttributes(anchors[0]) : { x: 0, y: 0 }
        graph.mergeNodeAttributes(n, { x: src.x, y: src.y })
      })
    }

    const sigma = new Sigma(graph as never, container, {
      defaultNodeType: 'star',
      nodeProgramClasses: { star: StarProgram },
      labelFont: LABEL_FONT,
      labelSize: 11,
      labelWeight: '500',
      labelDensity: 0.6,
      labelGridCellSize: 110,
      labelRenderedSizeThreshold: 3,
      zIndex: true,
      minCameraRatio: 0.12,
      maxCameraRatio: 2.2,
      stagePadding: 48,
      hideEdgesOnMove: false,
      renderEdgeLabels: false,
      nodeReducer: (node, data) => nodeStyle(node, data as StarNode),
      edgeReducer: (edge, data) => edgeStyle(edge, data as { kind: string }),
    })
    sigmaRef.current = sigma
    // для e2e-проверок: координаты звёзд на экране
    if (import.meta.env.DEV) (window as unknown as { __starmap?: Sigma }).__starmap = sigma

    // --- стиль узлов и рёбер от состояния (редьюсеры не меняют граф) ---
    // Кэш множеств на текущее состояние: редьюсер вызывается на каждый узел, пересчитывать соседей каждый раз дорого
    function neighborhood(node: string | null) {
      if (!node || !graph.hasNode(node)) return null
      const k = 'n:' + node
      if (!cache.has(k)) cache.set(k, new Set([node, ...graph.neighbors(node).filter((n) => !n.startsWith('a:'))]))
      return cache.get(k)!
    }
    function teamSet(team: string | null) {
      if (!team) return null
      const k = 't:' + team
      if (!cache.has(k)) {
        const people = graph.filterNodes((_, a) => a.kind === 'person' && !!a.teams?.includes(team))
        const set = new Set(people)
        for (const p of people) for (const n of graph.neighbors(p)) if (!n.startsWith('a:')) set.add(n)
        cache.set(k, set)
      }
      return cache.get(k)!
    }

    function visibleKind(a: StarNode): boolean {
      const { lens, riskOnly } = stateRef.current
      if (a.kind === 'anchor') return false
      if (a.kind === 'role' && lens !== 'roles') return false
      if (a.kind === 'skill' && lens !== 'skills') return false
      if (riskOnly && (a.kind === 'role' || a.kind === 'skill') && (a.factor ?? 2) > 1) return false
      return true
    }

    function nodeStyle(node: string, a: StarNode): Partial<NodeDisplayData> & Record<string, unknown> {
      const col = c()
      if (!visibleKind(a)) return { ...a, hidden: true }
      const { selected, focusTeam, riskOnly } = stateRef.current
      const focus = neighborhood(hoverRef.current) ?? neighborhood(selected)
      const team = teamSet(focusTeam)
      const res: Record<string, unknown> = { x: a.x, y: a.y, size: a.size, label: a.label, zIndex: 1 }

      if (a.kind === 'person') {
        // в линзе навыков кольцо «единственный носитель роли» не объяснено легендой и спорит с навыками — не показываем
        const risky = stateRef.current.lens !== 'skills' && (a.soleRoles?.length ?? 0) > 0
        const partial = (a.rate ?? 1) < 1
        res.color = partial ? col.surface : col.ink2
        res.borderColor = risky ? col.risk : col.ink2
        res.borderSize = risky ? (partial ? 0.42 : 0.3) : partial ? 0.34 : 0
        if (riskOnly && !risky) Object.assign(res, dim(col))
      } else {
        // Кольцо риска — только у ролей: у навыков Bus Factor 1 почти везде (заявляют по одному), красное везде = сигнала нет
        const risky = a.kind === 'role' && (a.factor ?? 2) <= 1
        res.color = a.kind === 'role' ? col.role : col.skill
        res.borderColor = col.risk
        res.borderSize = risky ? 0.34 : 0
        res.zIndex = 2
        // подписи всегда — только у ролей, на которые опирается много задач плана; остальные — по плотности
        if (a.kind === 'role' && (a.demand?.length ?? 0) >= 3) res.forceLabel = true
      }

      if (team && !team.has(node)) Object.assign(res, dim(col))
      if (focus) {
        if (focus.has(node)) {
          res.forceLabel = true
          res.zIndex = 3
          if (node === hoverRef.current || node === selected) res.highlighted = true
        } else Object.assign(res, dim(col))
      }
      return res
    }

    function dim(col: MapColors) {
      return { color: col.dimNode, borderColor: col.dimNode, label: '', forceLabel: false, zIndex: 0 }
    }

    function edgeStyle(edge: string, data: { kind: string }): Partial<{ hidden: boolean; color: string; size: number; zIndex: number }> {
      const col = c()
      if (data.kind === 'anchor') return { hidden: true }
      const [s, t] = graph.extremities(edge)
      if (!visibleKind(graph.getNodeAttributes(s)) || !visibleKind(graph.getNodeAttributes(t))) return { hidden: true }
      const { selected, focusTeam } = stateRef.current
      const focusNode = hoverRef.current ?? selected
      if (focusNode && graph.hasNode(focusNode)) {
        return s === focusNode || t === focusNode ? { color: col.accent, size: 1.6, zIndex: 2 } : { hidden: true }
      }
      if (focusTeam) {
        const inTeam = (n: string) => !!graph.getNodeAttribute(n, 'teams')?.includes(focusTeam)
        return inTeam(s) || inTeam(t) ? { color: col.edge, size: 0.8 } : { color: col.dimEdge, size: 0.5 }
      }
      return { color: col.edge, size: 0.7 }
    }

    // --- слой областей команд под рёбрами ---
    const hullCanvas = sigma.createCanvas('team-hulls', { beforeLayer: 'edges' })
    const hullCtx = hullCanvas.getContext('2d')!
    // подписи команд — над подписями звёзд, чтобы название созвездия ничто не перекрывало
    const teamLabelCanvas = sigma.createCanvas('team-labels', { afterLayer: 'labels' })
    const labelCtx = teamLabelCanvas.getContext('2d')!
    const drawHulls = () => {
      const { width, height } = sigma.getDimensions()
      const dpr = window.devicePixelRatio || 1
      for (const [cv, ctx] of [[hullCanvas, hullCtx], [teamLabelCanvas, labelCtx]] as const) {
        if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(height * dpr)) {
          cv.width = Math.round(width * dpr)
          cv.height = Math.round(height * dpr)
          cv.style.width = `${width}px`
          cv.style.height = `${height}px`
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, width, height)
      }
      const col = c()
      const ratio = sigma.getCamera().getState().ratio
      const pad = Math.max(16, Math.min(36, 22 / Math.sqrt(ratio)))
      const { focusTeam } = stateRef.current
      const hulls = new Map<string, [number, number][]>()
      const labels: { team: string; x: number; y: number; focused: boolean; faded: boolean }[] = []
      graph.forEachNode((anchor, a) => {
        if (a.kind !== 'anchor') return
        const team = a.team!
        const pts: [number, number][] = []
        graph.forEachNeighbor(anchor, (_n, na) => {
          // область — по основным участникам; совместители тянутся к ней пунктиром, иначе области расползаются
          if (na.kind !== 'person' || na.teams![0] !== team) return
          const p = sigma.graphToViewport({ x: na.x, y: na.y })
          pts.push([p.x, p.y])
        })
        const poly = hullPath(pts, pad)
        if (!poly) return
        hulls.set(team, poly)
        const focused = focusTeam === team
        const faded = !!focusTeam && !focused
        hullCtx.globalAlpha = faded ? 0.45 : 1
        drawSmoothClosed(hullCtx, poly)
        hullCtx.fillStyle = focused ? col.hullFillFocus : col.hullFill
        hullCtx.fill()
        hullCtx.lineWidth = focused ? 1.5 : 1
        hullCtx.setLineDash(focused ? [] : [4, 4])
        hullCtx.strokeStyle = focused ? col.accent : col.hullStroke
        hullCtx.stroke()
        hullCtx.setLineDash([])
        const minY = Math.min(...poly.map((p) => p[1]))
        const xs = poly.map((p) => p[0])
        labels.push({ team, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: minY, focused, faded })
        hullCtx.textAlign = 'start'
        hullCtx.globalAlpha = 1
      })
      // совместители: пунктир от человека до ближайшей точки области второй команды
      hullCtx.setLineDash([3, 4])
      hullCtx.lineWidth = 1.25
      graph.forEachNode((node, a) => {
        if (a.kind !== 'person' || a.teams!.length < 2) return
        const d = sigma.getNodeDisplayData(node)
        if (!d || d.hidden) return
        const from = sigma.framedGraphToViewport({ x: d.x, y: d.y })
        for (const team of a.teams!.slice(1)) {
          const poly = hulls.get(team)
          if (!poly) continue
          const to = poly.reduce((m, p) => (Math.hypot(p[0] - from.x, p[1] - from.y) < Math.hypot(m[0] - from.x, m[1] - from.y) ? p : m), poly[0])
          const faded = !!focusTeam && focusTeam !== team && focusTeam !== a.teams![0]
          hullCtx.globalAlpha = faded ? 0.35 : 1
          hullCtx.beginPath()
          hullCtx.moveTo(from.x, from.y)
          hullCtx.lineTo(to[0], to[1])
          hullCtx.strokeStyle = col.ink4
          hullCtx.stroke()
        }
      })
      hullCtx.setLineDash([])
      // подписи созвездий — последними, поверх пунктиров
      labelCtx.textAlign = 'center'
      labelCtx.lineWidth = 3
      labelCtx.strokeStyle = col.surface
      for (const l of labels) {
        const meta = teamMetaRef.current.get(l.team)
        labelCtx.globalAlpha = l.faded ? 0.45 : 1
        labelCtx.font = `600 12px ${LABEL_FONT}`
        labelCtx.strokeText(l.team, l.x, l.y - 18)
        labelCtx.fillStyle = l.focused ? col.accent : col.ink
        labelCtx.fillText(l.team, l.x, l.y - 18)
        if (meta) {
          const sub = `${meta.people} чел · ${String(meta.fte).replace('.', ',')} FTE`
          labelCtx.font = `400 11px ${LABEL_FONT}`
          labelCtx.strokeText(sub, l.x, l.y - 5)
          labelCtx.fillStyle = col.ink3
          labelCtx.fillText(sub, l.x, l.y - 5)
        }
      }
      hullCtx.textAlign = 'start'
      hullCtx.globalAlpha = 1
    }
    sigma.on('afterRender', drawHulls)

    // --- взаимодействие ---
    const showHover = (node: string) => {
      const d = sigma.getNodeDisplayData(node)
      if (!d) return
      const p = sigma.framedGraphToViewport({ x: d.x, y: d.y })
      setHover({ node, x: p.x, y: p.y })
    }
    sigma.on('enterNode', ({ node }) => {
      hoverRef.current = node
      container.style.cursor = 'pointer'
      showHover(node)
      sigma.refresh({ skipIndexation: true })
    })
    sigma.on('leaveNode', () => {
      hoverRef.current = null
      container.style.cursor = ''
      setHover(null)
      sigma.refresh({ skipIndexation: true })
    })
    sigma.on('clickNode', ({ node }) => onSelectRef.current(node))
    sigma.on('clickStage', () => onSelectRef.current(null))
    sigma.getCamera().on('updated', () => {
      if (hoverRef.current) showHover(hoverRef.current)
    })

    // --- тема и размеры ---
    const applyTheme = () => {
      colorsRef.current = readMapColors()
      sigma.refresh({ skipIndexation: true })
    }
    const mo = new MutationObserver(applyTheme)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', applyTheme)
    const ro = new ResizeObserver(() => {
      sigma.resize()
      sigma.refresh({ skipIndexation: true })
    })
    ro.observe(container)

    let stopAnim: (() => void) | undefined
    if (intro) {
      introPlayed = true
      stopAnim = animateNodes(graph as never, targets, { duration: 900, easing: 'cubicOut' })
    }

    return () => {
      stopAnim?.()
      if (intro) graph.forEachNode((n) => targets[n] && graph.mergeNodeAttributes(n, targets[n]))
      mo.disconnect()
      mq.removeEventListener('change', applyTheme)
      ro.disconnect()
      sigma.kill()
      sigmaRef.current = null
    }
    // граф пересоздаётся только при смене данных
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  // --- смена состояния: перерисовка без переиндексации ---
  useEffect(() => {
    sigmaRef.current?.refresh({ skipIndexation: true })
  }, [state.lens, state.riskOnly, state.focusTeam, state.selected])

  // Масштаб считаем от цели, а не от промежуточного кадра: быстрые повторные клики складываются
  const zoomTarget = useRef<number | null>(null)
  const zoomBy = (factor: number) => {
    const camera = sigmaRef.current?.getCamera()
    if (!camera) return
    const base = camera.isAnimated() && zoomTarget.current != null ? zoomTarget.current : camera.getState().ratio
    const ratio = Math.min(2.2, Math.max(0.12, base * factor))
    zoomTarget.current = ratio
    camera.animate({ ratio }, { duration: reduce ? 0 : 200, easing: 'quadraticOut' })
  }

  const cameraTo = (x: number, y: number, ratio: number) => sigmaRef.current?.getCamera().animate({ x, y, ratio }, { duration, easing: 'cubicInOut' })

  useImperativeHandle(ref, () => ({
    focusNode: (node) => {
      const d = sigmaRef.current?.getNodeDisplayData(node)
      if (!d) return
      const ratio = Math.min(sigmaRef.current!.getCamera().getState().ratio, 0.55)
      cameraTo(d.x, d.y, ratio)
    },
    focusTeam: (team) => {
      const sigma = sigmaRef.current
      if (!sigma) return
      if (!team) {
        cameraTo(0.5, 0.5, 1)
        return
      }
      const pts = graph.filterNodes((_, a) => a.kind === 'person' && !!a.teams?.includes(team)).map((n) => sigma.getNodeDisplayData(n)!).filter(Boolean)
      if (!pts.length) return
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      cameraTo((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, Math.min(1, Math.max(0.45, extent * 3.2)))
    },
    zoomIn: () => zoomBy(1 / 1.5),
    zoomOut: () => zoomBy(1.5),
    fit: () => cameraTo(0.5, 0.5, 1),
  }))

  return (
    <div className="starmap__canvas" ref={containerRef}>
      {hover && <HoverCard graph={graph} info={hover} bounds={{ w: containerRef.current?.clientWidth ?? Infinity, h: containerRef.current?.clientHeight ?? Infinity }} />}
    </div>
  )
})

/** Карточка при наведении. Дублирует данные панели — никогда не единственный источник информации. */
function HoverCard({ graph, info, bounds }: { graph: StarGraph; info: NonNullable<HoverInfo>; bounds: { w: number; h: number } }) {
  if (!graph.hasNode(info.node)) return null
  const a = graph.getNodeAttributes(info.node)
  // У края холста карточка открывается в другую сторону от курсора — не обрезается
  const flipX = info.x + 16 + 280 > bounds.w
  const flipY = info.y + 12 + 130 > bounds.h
  const x = Math.round(flipX ? info.x - 16 : info.x + 16)
  const y = Math.round(flipY ? info.y - 12 : info.y + 12)
  return (
    <div className="starmap__tip" style={{ transform: `translate(${x}px, ${y}px) translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})` }} role="tooltip">
      {a.kind === 'person' ? (
        <>
          <div className="starmap__tip-title">
            <span className="mono">{a.label}</span> · {a.role}
          </div>
          <div className="starmap__tip-row">
            {a.grade} · {a.teams!.join(' + ')}
            {(a.rate ?? 1) < 1 ? ` · ставка ${String(a.rate).replace('.', ',')}` : ''}
          </div>
          {!!a.soleRoles?.length && <div className="starmap__tip-risk">Единственный носитель: {a.soleRoles.join(', ')}</div>}
          <div className="starmap__tip-hint">Нажмите — профиль</div>
        </>
      ) : (
        <>
          <div className="starmap__tip-title">{a.label}</div>
          <div className="starmap__tip-row">
            {a.kind === 'role' ? 'Роль' : 'Навык'} · носителей: {a.holders!.length}
            {a.kind === 'role' && ` · задач плана: ${a.demand!.length}`}
          </div>
          {(a.factor ?? 2) <= 1 && <div className="starmap__tip-risk">Bus Factor 1 — держится на {a.holders![0]}</div>}
          <div className="starmap__tip-hint">Нажмите — подробности</div>
        </>
      )}
    </div>
  )
}
