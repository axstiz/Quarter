import { motion } from 'motion/react'
import { useState } from 'react'
import { CalendarX2, CheckCircle2, GitFork, Shuffle, UserMinus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDiff, useWarnings } from '@/api/queries'
import type { WarningKind } from '@/api/types'
import { ErrorAlert, SkeletonRows } from '@/components/ui/States'
import { WARNING_LABEL } from '@/lib/labels'
import { stagger } from '@/lib/motion'

const KINDS: { kind: WarningKind; icon: typeof CalendarX2 }[] = [
  { kind: 'deadline_overflow', icon: CalendarX2 },
  { kind: 'dependency_shift', icon: GitFork },
  { kind: 'role_deficit', icon: UserMinus },
  { kind: 'composition_change', icon: Shuffle },
]

/** Что изменилось после факта. Бэк считает warnings/diff на версии, в которую загружен факт (родитель текущей). */
export function ChangesReport({ factPlanId, sprintNo, fresh, onHide }: { factPlanId: string; sprintNo: number; fresh?: boolean; onHide?: () => void }) {
  const warnings = useWarnings(factPlanId)
  const diff = useDiff(factPlanId)
  const taskLink = (id: string) => (
    <Link key={id} to={`/plan?task=${id}`} className="badge badge--plain" style={{ textDecoration: 'none' }}>
      <span className="mono">{id}</span>
    </Link>
  )

  return (
    <section className="section">
      <div className="section__head">
        <h2>{fresh ? `Итоги: факт спринта ${sprintNo} загружен, план пересчитан` : `Изменения после факта спринта ${sprintNo}`}</h2>
        {onHide ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onHide}>
            <span className="btn__label">Скрыть итоги</span>
          </button>
        ) : (
          <span className="section__hint">4 проверки рисков и сдвиги задач</span>
        )}
      </div>

      {warnings.error ? (
        <ErrorAlert error={warnings.error} onRetry={() => warnings.refetch()} />
      ) : warnings.isLoading ? (
        <SkeletonRows rows={4} cols={3} />
      ) : (
        <div className="block">
          {KINDS.map(({ kind, icon }, i) => (
            <WarningRow key={kind} kind={kind} icon={icon} index={i} items={warnings.data?.filter((w) => w.kind === kind) ?? []} taskLink={taskLink} />
          ))}
        </div>
      )}

      <div className="section__head" style={{ marginTop: 'var(--s-5)' }}>
        <h3>Сдвиги задач</h3>
        {diff.data && (
          <span className="section__hint tabular">
            перенесено {diff.data.moved.length} · выпало из квартала {diff.data.postponed_now.length}
          </span>
        )}
      </div>
      {diff.error ? (
        <ErrorAlert error={diff.error} onRetry={() => diff.refetch()} />
      ) : diff.isLoading ? (
        <SkeletonRows rows={3} cols={3} />
      ) : !diff.data || (diff.data.moved.length === 0 && diff.data.postponed_now.length === 0) ? (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          Задачи не сдвинулись.
        </p>
      ) : (
        <div className="block">
          {groupMoves(diff.data).map((g, i) => (
            <motion.div key={g.label} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: stagger(i) }} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, auto) minmax(0, 1fr)', gap: 12, padding: '10px 16px', borderTop: i ? '1px solid var(--rule)' : 0, alignItems: 'baseline' }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: g.tone, whiteSpace: 'nowrap' }}>
                {g.label} <span className="muted tabular">· {g.ids.length}</span>
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{g.ids.map(taskLink)}</div>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  )
}

const PREVIEW = 3

/**
 * Одна проверка. Бэк присылает дефицит ролей отдельным сообщением на каждую пару «роль × команда» (десятки штук) —
 * показываем число, первые сообщения и раскрытие остальных, задачи без повторов.
 */
function WarningRow({ kind, icon: Icon, index, items, taskLink }: { kind: WarningKind; icon: typeof CalendarX2; index: number; items: { message: string; task_ids: string[] }[]; taskLink: (id: string) => React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const hit = items.length > 0
  const ids = [...new Set(items.flatMap((w) => w.task_ids))]
  // сообщение об изменении состава приходит с питоновскими списками — формулируем сами
  const messages = kind === 'composition_change' ? [`Изменилось положение ${ids.length} задач относительно версии до факта`] : [...new Set(items.map((w) => w.message))]
  const shown = expanded ? messages : messages.slice(0, PREVIEW)
  const shownIds = expanded ? ids : ids.slice(0, 12)
  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateY(6px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', transition: stagger(index) }}
      style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: 12, padding: '12px 16px', borderTop: index ? '1px solid var(--rule)' : 0 }}
      data-warning={hit ? kind : undefined}
    >
      {hit ? <Icon aria-hidden style={{ width: 18, height: 18, color: 'var(--over)', marginTop: 1 }} /> : <CheckCircle2 aria-hidden style={{ width: 18, height: 18, color: 'var(--done)', marginTop: 1 }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{WARNING_LABEL[kind]}</span>
          {hit && messages.length > 1 && <span className="badge badge--plain" data-tone="over">{messages.length}</span>}
        </div>
        {!hit ? (
          <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>Не обнаружено</div>
        ) : (
          <ul className="list-plain" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', marginTop: 2 }}>
            {shown.map((m) => (
              <li key={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</li>
            ))}
          </ul>
        )}
        {ids.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>{shownIds.map(taskLink)}</div>}
        {(messages.length > PREVIEW || ids.length > 12) && (
          <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 4, marginLeft: -8 }} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            <span className="btn__label">{expanded ? 'Свернуть' : `Показать все: ${messages.length > PREVIEW ? `${messages.length} сообщений` : `${ids.length} задач`}`}</span>
          </button>
        )}
      </div>
    </motion.div>
  )
}

/** 23 строки «было → стало» читаются хуже, чем 5 групп «Спринт 1 → 2: задачи» */
function groupMoves(diff: { moved: { task_id: string; from_sprint: number; to_sprint: number }[]; postponed_now: string[] }) {
  const map = new Map<string, { label: string; tone: string; ids: string[]; order: number }>()
  for (const m of diff.moved) {
    const key = `${m.from_sprint}-${m.to_sprint}`
    const g = map.get(key) ?? { label: `Спринт ${m.from_sprint} → ${m.to_sprint}`, tone: 'var(--shift)', ids: [], order: m.from_sprint * 10 + m.to_sprint }
    g.ids.push(m.task_id)
    map.set(key, g)
  }
  const groups = [...map.values()].sort((a, b) => a.order - b.order)
  if (diff.postponed_now.length) groups.unshift({ label: 'Выпали из квартала', tone: 'var(--over)', ids: diff.postponed_now, order: -1 })
  return groups
}
