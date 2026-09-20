import { motion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'
import { CalendarX2, CheckCircle2, CornerDownRight, GitFork, Shuffle, UserMinus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDiff, useFacts, usePlan, useTasks, useWarnings } from '@/api/queries'
import type { PlanDiff, PlanWarning, TaskInfo, WarningKind } from '@/api/types'
import { ErrorAlert, SkeletonRows } from '@/components/ui/States'
import { fmt, plural } from '@/lib/format'
import { warningLabel } from '@/lib/labels'
import { stagger } from '@/lib/motion'

/** Уровни алертов из онбординга (§4): красный — срыв квартала, жёлтый — каскадный сдвиг, оранжевый — дефицит ресурса. */
const KINDS: { kind: WarningKind; icon: typeof CalendarX2; tone: 'over' | 'shift' | 'pending' | 'plan'; level: string }[] = [
  { kind: 'deadline_overflow', icon: CalendarX2, tone: 'over', level: 'Критический' },
  { kind: 'dependency_shift', icon: GitFork, tone: 'shift', level: 'Каскадный сдвиг' },
  { kind: 'role_deficit', icon: UserMinus, tone: 'pending', level: 'Дефицит ресурса' },
  { kind: 'grade_deficit', icon: UserMinus, tone: 'pending', level: 'Дефицит грейда' },
  { kind: 'composition_change', icon: Shuffle, tone: 'plan', level: 'Изменение плана' },
]

const TaskLink = ({ id }: { id: string }) => (
  <Link to={`/plan?task=${id}`} className="badge badge--plain task-link">
    <span className="mono">{id}</span>
  </Link>
)

/** Что изменилось после факта. Бэк считает warnings/diff на версии, в которую загружен факт (родитель текущей). */
export function ChangesReport({ factPlanId, sprintNo, fresh, onHide }: { factPlanId: string; sprintNo: number; fresh?: boolean; onHide?: () => void }) {
  const warnings = useWarnings(factPlanId)
  const diff = useDiff(factPlanId)

  return (
    <section className="section">
      <div className="section__head">
        <h2>{fresh ? `Итоги: факт спринта ${sprintNo} загружен, план пересчитан` : `Изменения после факта спринта ${sprintNo}`}</h2>
        {onHide ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onHide}>
            <span className="btn__label">Скрыть итоги</span>
          </button>
        ) : (
          <span className="section__hint">причины → следствия, 4 проверки рисков</span>
        )}
      </div>

      {warnings.error || diff.error ? (
        <ErrorAlert error={warnings.error ?? diff.error} onRetry={() => { warnings.refetch(); diff.refetch() }} />
      ) : warnings.isLoading || diff.isLoading || !warnings.data || !diff.data ? (
        <SkeletonRows rows={4} cols={3} />
      ) : (
        <>
          <CauseChain factPlanId={factPlanId} sprintNo={sprintNo} diff={diff.data} warnings={warnings.data} />
          <div className="block">
            {KINDS.map((k, i) => (
              <WarningRow key={k.kind} {...k} index={i} items={warnings.data.filter((w) => w.kind === k.kind)} diff={diff.data} />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Связь «факт → следствие» (ТЗ §2): какие невыполненные задачи спринта что сдвинули по зависимостям
 * и что из-за этого вышло за квартал. Считается на фронте из факта, графа зависимостей и diff версий.
 */
function CauseChain({ factPlanId, sprintNo, diff, warnings }: { factPlanId: string; sprintNo: number; diff: PlanDiff; warnings: PlanWarning[] }) {
  const plan = usePlan(factPlanId)
  const facts = useFacts(factPlanId)
  const tasks = useTasks()
  const [expanded, setExpanded] = useState(false)

  const chains = useMemo(() => {
    const fact = facts.data?.find((f) => f.sprint_no === sprintNo)
    const rows = plan.data?.sprints.find((s) => s.sprint_no === sprintNo)?.tasks.filter((t) => t.decision === 'planned') ?? []
    if (!fact || !tasks.data) return null
    const done = new Set(fact.completed_task_ids)
    const moved = new Map(diff.moved.map((m) => [m.task_id, m]))
    const overflow = new Set([...warnings.filter((w) => w.kind === 'deadline_overflow').flatMap((w) => w.task_ids), ...diff.postponed_now])
    const dependents = blockedBy(tasks.data)

    const notDone = new Map<string, number>()
    for (const r of rows) if (!done.has(r.task_id)) notDone.set(r.task_id, (notDone.get(r.task_id) ?? 0) + (r.step_points_sp ?? 0))

    return [...notDone].map(([id, sp]) => {
      // все задачи, до которых доходит сдвиг по графу зависимостей
      const seen = new Set<string>()
      const queue = [id]
      while (queue.length) for (const next of dependents.get(queue.shift()!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next) }
      const effects = [...seen].filter((x) => moved.has(x) || overflow.has(x)).map((x) => ({ id: x, move: moved.get(x), out: overflow.has(x) }))
      return { id, sp, self: moved.get(id), selfOut: overflow.has(id), effects }
    }).sort((a, b) => b.effects.length - a.effects.length || Number(b.selfOut) - Number(a.selfOut) || b.sp - a.sp)
  }, [facts.data, plan.data, tasks.data, diff, warnings, sprintNo])

  if (!chains) return <SkeletonRows rows={2} cols={3} />
  const planned = plan.data?.sprints.find((s) => s.sprint_no === sprintNo)?.tasks.filter((t) => t.decision === 'planned').reduce((a, t) => a + (t.step_points_sp ?? 0), 0) ?? 0
  const missedSp = chains.reduce((a, c) => a + c.sp, 0)
  const shifted = new Set(chains.flatMap((c) => c.effects.map((e) => e.id)))
  const out = new Set(chains.flatMap((c) => [...(c.selfOut ? [c.id] : []), ...c.effects.filter((e) => e.out).map((e) => e.id)]))
  const shown = expanded ? chains : chains.slice(0, 5)

  return (
    <div className="block cause">
      <div className="block__head">
        <h3>Что к этому привело</h3>
        <span className="section__hint tabular">
          {chains.length
            ? `не выполнено ${chains.length} ${plural(chains.length, 'задача', 'задачи', 'задач')} (${fmt(missedSp)} из ${fmt(planned)} SP) → по зависимостям сдвинулось ${shifted.size} · за квартал ${out.size}`
            : 'все задачи спринта выполнены'}
        </span>
      </div>
      {chains.length > 0 && (
        <ul className="cause__list">
          {shown.map((c, i) => (
            <motion.li key={c.id} className="cause__item" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: stagger(i) }}>
              <div className="cause__root">
                <TaskLink id={c.id} />
                <span>не выполнена в спринте {sprintNo} · {fmt(c.sp)} SP</span>
                {c.self && <span className="cause__move">сама: спринт {c.self.from_sprint} → {c.self.to_sprint}</span>}
                {c.selfOut && <span className="cause__out">за кварталом</span>}
              </div>
              {c.effects.map((e) => (
                <div key={e.id} className="cause__effect">
                  <CornerDownRight aria-hidden />
                  <TaskLink id={e.id} />
                  {e.move && <span className="cause__move">спринт {e.move.from_sprint} → {e.move.to_sprint}</span>}
                  {e.out && <span className="cause__out">за кварталом</span>}
                </div>
              ))}
            </motion.li>
          ))}
        </ul>
      )}
      {chains.length > 5 && (
        <div className="block__body" style={{ paddingTop: 0 }}>
          <button type="button" className="btn btn--ghost btn--sm" style={{ marginLeft: -8 }} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            <span className="btn__label">{expanded ? 'Свернуть' : `Показать все ${chains.length}`}</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** blocking → задачи, которые от неё зависят */
function blockedBy(tasks: TaskInfo[]) {
  const map = new Map<string, string[]>()
  for (const t of tasks) for (const b of t.blocked_by ?? []) map.set(b.blocking_task_id, [...(map.get(b.blocking_task_id) ?? []), t.task_id])
  return map
}

const PREVIEW = 3
const DEFICIT = /роли (.+?) в команде (.+?) на спринт (\d+): нужно ([\d.,]+) ч, доступно ([\d.,]+) ч/i
const num = (s: string) => Number(s.replace(',', '.'))

/** Одна проверка, окрашенная по уровню алерта. Дефицит ролей бэк присылает на каждую пару «роль × команда» — сводим в таблицу. */
function WarningRow({ kind, icon: Icon, tone, level, index, items, diff }: { kind: WarningKind; icon: typeof CalendarX2; tone: string; level: string; index: number; items: PlanWarning[]; diff: PlanDiff }) {
  const [expanded, setExpanded] = useState(false)
  const hit = items.length > 0
  const ids = [...new Set(items.flatMap((w) => w.task_ids))]
  const deficits = kind === 'role_deficit' ? items.map((w) => w.message.match(DEFICIT)).filter((m): m is RegExpMatchArray => !!m) : []
  const asTable = deficits.length > 0 && deficits.length === items.length

  let body: ReactNode
  if (!hit) body = <div className="muted">Не обнаружено</div>
  else if (kind === 'composition_change') body = <MovesSummary diff={diff} />
  else if (asTable) {
    const rows = deficits
      .map((m) => ({ role: m[1], team: m[2], need: num(m[4]), have: num(m[5]) }))
      .sort((a, b) => b.need - b.have - (a.need - a.have))
    const visible = expanded ? rows : rows.slice(0, 5)
    body = (
      <table className="table table--compact deficit">
        <thead>
          <tr><th>Роль</th><th>Команда</th><th className="num">Нужно, ч</th><th className="num">Доступно, ч</th><th className="num">Не хватает</th></tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={`${r.role}|${r.team}`}>
              <td>{r.role}</td><td className="nowrap">{r.team}</td>
              <td className="num tabular">{fmt(r.need)}</td><td className="num tabular">{fmt(r.have)}</td>
              <td className="num tabular" data-over="true">{fmt(r.need - r.have)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  } else {
    const messages = [...new Set(items.map((w) => w.message))]
    body = (
      <ul className="list-plain">
        {(expanded ? messages : messages.slice(0, PREVIEW)).map((m) => <li key={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</li>)}
      </ul>
    )
  }
  const more = asTable ? deficits.length > 5 : kind !== 'composition_change' && (new Set(items.map((w) => w.message)).size > PREVIEW || ids.length > 12)

  return (
    <motion.div
      className="warn"
      data-tone={hit ? tone : 'none'}
      initial={{ opacity: 0, transform: 'translateY(6px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', transition: stagger(index) }}
    >
      {hit ? <Icon aria-hidden className="warn__icon" /> : <CheckCircle2 aria-hidden className="warn__icon" />}
      <div style={{ minWidth: 0 }}>
        <div className="warn__title">
          <span>{warningLabel(kind)}</span>
          {hit && <span className="warn__level">{level}{items.length > 1 ? ` · ${items.length}` : ''}</span>}
        </div>
        <div className="warn__body">{body}</div>
        {hit && kind !== 'composition_change' && ids.length > 0 && (
          <div className="warn__tasks">{(expanded ? ids : ids.slice(0, 12)).map((id) => <TaskLink key={id} id={id} />)}{!expanded && ids.length > 12 && <span className="muted">ещё {ids.length - 12}</span>}</div>
        )}
        {more && (
          <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 4, marginLeft: -8 }} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            <span className="btn__label">{expanded ? 'Свернуть' : 'Показать все'}</span>
          </button>
        )}
      </div>
    </motion.div>
  )
}

/** Изменения состава: группы «Спринт X → Y» вместо двух десятков строк «было → стало». */
function MovesSummary({ diff }: { diff: PlanDiff }) {
  const groups = new Map<string, { label: string; ids: string[]; order: number; out?: boolean }>()
  for (const m of diff.moved) {
    const key = `${m.from_sprint}-${m.to_sprint}`
    const g = groups.get(key) ?? { label: `Спринт ${m.from_sprint} → ${m.to_sprint}`, ids: [], order: m.from_sprint * 10 + m.to_sprint }
    g.ids.push(m.task_id)
    groups.set(key, g)
  }
  const list = [...groups.values()].sort((a, b) => a.order - b.order)
  if (diff.postponed_now.length) list.unshift({ label: 'Выпали из квартала', ids: diff.postponed_now, order: -1, out: true })
  if (!list.length) return <div className="muted">Задачи не сдвинулись</div>
  return (
    <div className="moves">
      {list.map((g) => (
        <div key={g.label} className="moves__row">
          <span className="moves__label" data-out={g.out || undefined}>{g.label} <span className="muted tabular">· {g.ids.length}</span></span>
          <div className="warn__tasks">{g.ids.map((id) => <TaskLink key={id} id={id} />)}</div>
        </div>
      ))}
    </div>
  )
}
