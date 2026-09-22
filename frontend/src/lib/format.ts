const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export const fmt = (n: number | null | undefined) => (n == null ? '—' : nf.format(n))
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${nf.format(n)}%`)

/** Спринт N занимает недели 2N-1..2N квартала. */
export const sprintWeeks = (n: number) => `нед. ${2 * n - 1}–${2 * n}`

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** Бэк отдаёт «YYYY-MM-DD HH:MM:SS» (без T) — Safari такую строку не парсит, приводим к ISO */
export const formatDateTime = (value: string) =>
  new Date(value.includes('T') ? value : value.replace(' ', 'T')).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export const sumHours = (roleHours: Record<string, number>) => Object.values(roleHours).reduce((s, h) => s + h, 0)
