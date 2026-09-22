import { polygonHull } from 'd3-polygon'

type Pt = [number, number]

/**
 * Область команды: выпуклая оболочка вокруг звёзд с отступом (сумма Минковского с кругом),
 * сглаженная кривыми через середины рёбер. Работает и для команды из одного-двух человек.
 */
export function hullPath(points: Pt[], pad: number): Pt[] | null {
  if (!points.length) return null
  const samples: Pt[] = []
  const steps = 14
  for (const [x, y] of points) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      samples.push([x + Math.cos(a) * pad, y + Math.sin(a) * pad])
    }
  }
  return polygonHull(samples)
}

export function drawSmoothClosed(ctx: CanvasRenderingContext2D, poly: Pt[]) {
  const n = poly.length
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const start = mid(poly[n - 1], poly[0])
  ctx.beginPath()
  ctx.moveTo(start[0], start[1])
  for (let i = 0; i < n; i++) {
    const p = poly[i]
    const m = mid(p, poly[(i + 1) % n])
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1])
  }
  ctx.closePath()
}
