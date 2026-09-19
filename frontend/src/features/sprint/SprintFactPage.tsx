import { motion } from 'motion/react'
import { CheckCircle2, ClipboardCheck, Lock, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCurrentPlanId, useFacts, usePlan, usePlanVersions, useRecompute, useSubmitFact, useTasks } from '@/api/queries'
import type { PlanRow } from '@/lib/planModel'
import { buildPlanModel } from '@/lib/planModel'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Meter } from '@/components/ui/Meter'
import { Empty, ErrorAlert, errorHint, errorTitle, SkeletonRows } from '@/components/ui/States'
import { fmt, plural, sprintWeeks } from '@/lib/format'
import { t } from '@/lib/motion'
import { useParam } from '@/lib/useParam'
import { ChangesReport } from './ChangesReport'

export function SprintFactPage() {
  const planId = useCurrentPlanId()
  const versions = usePlanVersions()
  const plan = usePlan(planId)
  const facts = useFacts(planId)
  const tasks = useTasks()
  const model = useMemo(() => (plan.data ? buildPlanModel(plan.data, tasks.data ?? []) : null), [plan.data, tasks.data])
  const recompute = useRecompute(planId ?? '')
  const [, setPlanParam] = useParam('plan')
  const [sprintParam, setSprintParam] = useParam('sprint')
  const [resultParam, setResultParam] = useParam('result')

  const latestId = versions.data?.at(-1)?.plan_id
  const readOnly = !!planId && !!latestId && planId !== latestId
  const factBySprint = useMemo(() => new Map(facts.data?.map((f) => [f.sprint_no, f])), [facts.data])
  const nextOpen = [1, 2, 3, 4, 5, 6].find((n) => !factBySprint.has(n))
  const sprintNo = Number(sprintParam) || nextOpen || 6

  // Отчёт об изменениях имеет смысл только для версии, созданной загрузкой факта:
  // номер «после спринта» вырос относительно родителя и факт этого спринта есть в цепочке
  const current = versions.data?.find((v) => v.plan_id === planId)
  const parent = versions.data?.find((v) => v.plan_id === current?.parent_plan_id)
  const reportSprint =
    current?.parent_plan_id && current.recomputed_after_sprint && current.recomputed_after_sprint !== (parent?.recomputed_after_sprint ?? 0) && factBySprint.has(current.recomputed_after_sprint)
      ? current.recomputed_after_sprint
      : null

  if (planId === null) {
    return (
      <div className="content">
        <Empty
          icon={<ClipboardCheck />}
          title="Нет плана"
          text="Факт спринта загружается в построенный план."
          actions={
            <Link to="/plan" className="btn btn--primary" style={{ textDecoration: 'none' }}>
              <span className="btn__label">К плану квартала</span>
            </Link>
          }
        />
      </div>
    )
  }

  const onRecompute = () =>
    recompute.mutate(Math.max(0, ...(facts.data ?? []).map((f) => f.sprint_no)), {
      onSuccess: () => {
        setPlanParam(null)
        toast.success('План пересчитан', { description: 'Создана новая версия плана.' })
      },
      onError: (e) => toast.error(errorTitle(e), { description: errorHint(e) }),
    })

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Факт спринта</h1>
          <div className="page-head__sub">Раз в две недели: отметьте выполненное — оставшиеся спринты пересчитаются</div>
        </div>
        <div className="page-head__actions">
          <Select
            aria-label="Спринт"
            value={String(sprintNo)}
            onChange={(e) => setSprintParam(e.target.value)}
            options={[1, 2, 3, 4, 5, 6].map((n) => ({
              value: String(n),
              label: `Спринт ${n} · ${factBySprint.has(n) ? 'факт загружен' : n === nextOpen ? 'следующий' : sprintWeeks(n)}`,
            }))}
          />
          <Button icon={<RefreshCw />} loading={recompute.isPending} disabled={readOnly} onClick={onRecompute} title="Пересчитать оставшиеся спринты без нового факта, например после смены приоритетов">
            Пересчитать
          </Button>
        </div>
      </div>

      {plan.error ? (
        <ErrorAlert error={plan.error} onRetry={() => plan.refetch()} />
      ) : !plan.data || !model || facts.isLoading || tasks.isLoading ? (
        <SkeletonRows rows={6} cols={5} />
      ) : (
        <>
          {/* Сразу после загрузки факта пользователь должен увидеть результат, а не пустую форму следующего спринта */}
          {resultParam && reportSprint && plan.data.parent_plan_id && (
            <ChangesReport fresh onHide={() => setResultParam(null)} factPlanId={plan.data.parent_plan_id} sprintNo={reportSprint} />
          )}
          {factBySprint.has(sprintNo) ? (
            <LoadedFact fact={factBySprint.get(sprintNo)!} />
          ) : readOnly ? (
            <div className="callout" data-tone="shift">
              <div className="callout__title">Старая версия плана</div>
              <p>Факт загружается только в актуальную версию.</p>
            </div>
          ) : (
            <FactForm
              key={`${planId}-${sprintNo}`}
              planId={planId!}
              sprintNo={sprintNo}
              tasks={model.sprints.find((s) => s.sprint_no === sprintNo)?.rows.filter((r) => r.decision === 'planned') ?? []}
              isNext={sprintNo === nextOpen}
              onDone={() => {
                setPlanParam(null)
                setSprintParam(null)
                setResultParam('1')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          )}

          {!resultParam && reportSprint && plan.data.parent_plan_id && (
            <ChangesReport factPlanId={plan.data.parent_plan_id} sprintNo={reportSprint} />
          )}
        </>
      )}
    </div>
  )
}

function LoadedFact({ fact }: { fact: { sprint_no: number; completed_sp: number; completed_task_ids: string[]; notes: string } }) {
  return (
    <motion.div className="block" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: t.base }}>
      <div className="block__head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lock aria-hidden style={{ width: 16, height: 16, color: 'var(--done)' }} /> Факт спринта {fact.sprint_no} загружен
        </h2>
        <span className="section__hint">повторная загрузка недоступна</span>
      </div>
      <div className="block__body">
        <dl className="fields">
          <dt>Выполнено SP</dt>
          <dd className="tabular">{fmt(fact.completed_sp)}</dd>
          <dt>Задачи</dt>
          <dd className="mono">{fact.completed_task_ids.join(', ') || '—'}</dd>
          {fact.notes && (
            <>
              <dt>Комментарий</dt>
              <dd>{fact.notes}</dd>
            </>
          )}
        </dl>
      </div>
    </motion.div>
  )
}

interface FormProps {
  planId: string
  sprintNo: number
  tasks: PlanRow[]
  isNext: boolean
  onDone: () => void
}

function FactForm({ planId, sprintNo, tasks, isNext, onDone }: FormProps) {
  const submit = useSubmitFact(planId)
  const rows = tasks.filter((x) => x.decision !== 'cancelled')
  const [done, setDone] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const plannedSp = rows.reduce((a, x) => a + (x.step_points_sp ?? 0), 0)
  const doneSp = rows.filter((x) => done.has(x.task_id)).reduce((a, x) => a + (x.step_points_sp ?? 0), 0)
  const notDone = rows.filter((x) => !done.has(x.task_id))

  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // mutateAsync, а не mutate(..., { onSuccess }): после пересчёта план меняется и форма размонтируется,
  // колбэки mutate на размонтированном компоненте не вызываются — пропали бы тост и переход к следующему спринту
  const send = async () => {
    try {
      await submit.mutateAsync({ sprintNo, body: { completed_sp: doneSp, completed_task_ids: [...done], notes } })
      setConfirmOpen(false)
      onDone()
      toast.success(`Факт спринта ${sprintNo} загружен, план пересчитан`)
    } catch (e) {
      setConfirmOpen(false)
      toast.error(errorTitle(e), { description: errorHint(e) })
    }
  }

  return (
    <div className="block">
      <div className="block__head">
        <div>
          <h2>Что выполнено в спринте {sprintNo}</h2>
          {!isNext && <div className="section__hint">Предыдущие спринты ещё без факта — обычно факт загружают по порядку</div>}
          {rows.some((x) => x.parts > 1) && <div className="section__hint">Задача, разбитая между спринтами, отмечается выполненной целиком</div>}
        </div>
        <Meter value={doneSp} max={plannedSp || undefined} unit=" SP" label="Выполнено из запланированного" />
      </div>

      {rows.length === 0 ? (
        <div className="block__body muted">В спринте нет задач. Можно загрузить пустой факт, чтобы зафиксировать спринт.</div>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    aria-label="Отметить все"
                    style={{ accentColor: 'var(--plan)', width: 16, height: 16 }}
                    checked={done.size === rows.length}
                    ref={(el) => {
                      if (el) el.indeterminate = done.size > 0 && done.size < rows.length
                    }}
                    onChange={(e) => setDone(e.target.checked ? new Set(rows.map((x) => x.task_id)) : new Set())}
                  />
                </th>
                <th>Ключ</th>
                <th>Задача</th>
                <th>Команда</th>
                <th className="num">SP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.task_id} className="is-link" aria-selected={done.has(x.task_id)} onClick={() => toggle(x.task_id)}>
                  <td>
                    <input
                      type="checkbox"
                      style={{ accentColor: 'var(--plan)', width: 16, height: 16 }}
                      checked={done.has(x.task_id)}
                      onChange={() => toggle(x.task_id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${x.task_id} выполнена`}
                    />
                  </td>
                  <td className="table-key">{x.task_id}</td>
                  <td className="cell-title">
                    {x.summary}
                    {x.parts > 1 && <div className="cell-meta muted">часть {x.part} из {x.parts}</div>}
                  </td>
                  <td className="nowrap">{x.team_id}</td>
                  <td className="num tabular">{fmt(x.step_points_sp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="block__body">
        <Field label="Комментарий" hint="Необязательно: что помешало, что взяли сверх плана">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      {/* Действие всегда на виду: панель прилипает к низу экрана, пока таблица длиннее окна */}
      <div className="fact-bar">
        <span className="tabular">
          Отмечено <b>{done.size}</b> из {rows.length} · <b>{fmt(doneSp)}</b> из {fmt(plannedSp)} SP
        </span>
        <Button variant="primary" icon={<CheckCircle2 />} onClick={() => setConfirmOpen(true)}>
          Загрузить факт
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Загрузить факт спринта ${sprintNo}?`}
        description="Изменить факт после загрузки нельзя."
        confirmLabel={done.size === 0 && rows.length > 0 ? 'Да, ничего не выполнено' : 'Загрузить и пересчитать'}
        tone={done.size === 0 && rows.length > 0 ? 'danger' : 'primary'}
        loading={submit.isPending}
        onConfirm={send}
      >
        {done.size === 0 && rows.length > 0 && (
          <div className="callout" data-tone="over" style={{ marginBottom: 'var(--s-3)' }}>
            <div className="callout__title">Не отмечено ни одной задачи</div>
            <p>Все {rows.length} {plural(rows.length, 'задача', 'задачи', 'задач')} спринта вернутся в планирование. Если вы просто забыли отметить выполненное — нажмите «Отмена».</p>
          </div>
        )}
        <ul className="list-plain">
          <li>
            Выполнено: <strong className="tabular">{done.size}</strong> {plural(done.size, 'задача', 'задачи', 'задач')}, {fmt(doneSp)} из {fmt(plannedSp)} SP.
          </li>
          <li>
            Вернутся в планирование: <strong className="tabular">{notDone.length}</strong>
            {notDone.length > 0 && <span className="mono muted"> ({notDone.map((x) => x.task_id).join(', ')})</span>}.
          </li>
          <li>{sprintNo < 6 ? `Спринты ${sprintNo + 1}–6 будут пересчитаны, появится новая версия плана.` : 'Квартал будет закрыт по факту.'}</li>
        </ul>
      </ConfirmDialog>
    </div>
  )
}
