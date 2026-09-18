/**
 * Цвета карты берутся из токенов темы. Команды цветом НЕ кодируются: 6 категориальных цветов
 * не проходят проверку различимости (validate_palette: all-pairs CVD ΔE 1.6–3.2, normal 10.6–12.9 < 15).
 * Команду обозначает подписанная область. Цвет несёт только смысл: роль / навык (2 слота, all-pairs PASS),
 * риск — статусный critical, выделение — акцент интерфейса.
 */
export interface MapColors {
  surface: string
  ink: string
  ink2: string
  ink3: string
  ink4: string
  rule: string
  ruleStrong: string
  accent: string
  accentSoft: string
  role: string
  skill: string
  risk: string
  hullFill: string
  hullFillFocus: string
  hullStroke: string
  dimNode: string
  dimEdge: string
  edge: string
}

export function readMapColors(): MapColors {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  const dark = (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'
  return {
    surface: v('--sheet'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    ink4: v('--ink-4'),
    rule: v('--rule'),
    ruleStrong: v('--rule-strong'),
    accent: v('--plan'),
    accentSoft: v('--plan-soft'),
    // слоты 1 и 3 референсной палитры dataviz (проверены попарно в обеих темах)
    role: dark ? '#3987e5' : '#2a78d6',
    skill: dark ? '#199e70' : '#1baf7a',
    risk: '#d03b3b',
    hullFill: dark ? 'rgba(255,255,255,0.035)' : 'rgba(22,24,29,0.035)',
    hullFillFocus: dark ? 'rgba(109,149,245,0.10)' : 'rgba(43,95,217,0.07)',
    hullStroke: dark ? 'rgba(255,255,255,0.10)' : 'rgba(22,24,29,0.10)',
    dimNode: dark ? '#2a2e37' : '#dfe1e5',
    // рёбра WebGL — непрозрачными цветами: полупрозрачные смешиваются неровно и «светятся» в тёмной теме
    dimEdge: dark ? '#1d2025' : '#f1f2f4',
    edge: dark ? '#353a44' : '#d9dce1',
  }
}
