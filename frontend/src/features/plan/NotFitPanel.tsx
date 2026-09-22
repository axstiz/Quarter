import type { ReactNode } from 'react'
import { DecisionBadge } from '@/components/ui/Badge'
import { fmt } from '@/lib/format'
import { formatSprints, isPartial, type PlanModel, type TaskSummary } from '@/lib/planModel'

/** «Не влезают»: задачи вне квартала (кроме отменённых) и задачи, влезшие частично. Строка открывает карточку задачи. */
export function NotFitPanelContent({ model, onSelect }: { model: PlanModel; onSelect: (taskId: string) => void }) {
  const outside = model.outside.filter((t) => t.decision !== 'cancelled')
  const partial = [...model.tasks.values()].filter((t) => t.sprints.length && t.decision !== 'done_actual' && isPartial(t))

  return (
    <>
      <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
        Вне квартала — задачи, для которых планировщик не нашёл места в 6 спринтах. Частично — начаты в квартале, остаток SP уходит за 12-ю неделю.
      </p>
      <Section title="Вне квартала" items={outside} empty="Все задачи попали в квартал." onSelect={onSelect}
        meta={(t) => <DecisionBadge decision={t.decision} />}
        detail={(t) => t.reason}
        spLabel="SP"
        sp={(t) => t.estimation_sp} />
      <Section title="Влезли частично" items={partial} empty="Частичных задач нет." onSelect={onSelect}
        meta={(t) => <span className="muted nowrap">спринты {formatSprints(t.sprints)}</span>}
        detail={(t) => `всего ${fmt(t.estimation_sp)} SP`}
        spLabel="Остаток SP"
        sp={(t) => Math.max(0, t.estimation_sp - t.plannedSp)} />
    </>
  )
}

function Section({ title, items, empty, meta, detail, spLabel, sp, onSelect }: {
  title: string
  items: TaskSummary[]
  empty: string
  meta: (t: TaskSummary) => ReactNode
  detail: (t: TaskSummary) => string
  spLabel: string
  sp: (t: TaskSummary) => number
  onSelect: (taskId: string) => void
}) {
  return (
    <section style={{ marginTop: 'var(--s-4)' }}>
      <h3 style={{ fontSize: 'var(--text-md)', marginBottom: 'var(--s-2)' }}>
        {title} <span className="muted tabular">· {items.length}</span>
      </h3>
      {items.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>Задача</th>
              <th>Команда</th>
              <th className="num">{spLabel}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.task_id} className="is-link" tabIndex={0} onClick={() => onSelect(t.task_id)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(t.task_id) }}>
                <td className="cell-title">
                  <span className="table-key">{t.task_id}</span> {t.summary}
                  <div className="cell-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {meta(t)}
                    {detail(t) && <span className="muted">{detail(t)}</span>}
                  </div>
                </td>
                <td className="nowrap">{t.team_id}</td>
                <td className="num tabular">{fmt(sp(t))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>{empty}</p>
      )}
    </section>
  )
}
