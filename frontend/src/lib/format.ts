const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export const fmt = (n: number | null | undefined) => (n == null ? '—' : nf.format(n))
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${nf.format(n)}%`)

/** Спринт N = недели 2N-1..2N квартала. */
export const sprintWeeks = (n: number) => `нед. ${2 * n - 1}–${2 * n}`

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id)

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
