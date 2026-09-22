import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { ArrowDown, ArrowUp, ArrowUpToLine, GripVertical } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useFacts, useRecompute, useSetPriorities } from '@/api/queries'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Field'
import { errorHint, errorTitle } from '@/components/ui/States'
import { t } from '@/lib/motion'
import { formatSprints, type PlanModel } from '@/lib/planModel'
import { useParam } from '@/lib/useParam'

interface Item {
  task_id: string
  summary: string
  team_id: string
  where: string
}

/** Ранжированный список: выше — раньше в плане. Перетаскивание или кнопки, затем одно действие «Сохранить». */
export function PriorityView({ model, planId, readOnly }: { model: PlanModel; planId: string; readOnly: boolean }) {
  // API не отдаёт priority — исходный порядок берём из раскладки: по первому спринту задачи, затем «вне квартала»
  const initial: Item[] = useMemo(() => {
    const open = [...model.tasks.values()].filter((x) => x.decision !== 'done_actual' && x.decision !== 'cancelled')
    return open
      .sort((a, b) => (a.sprints[0] ?? 99) - (b.sprints[0] ?? 99))
      .map((x) => ({ task_id: x.task_id, summary: x.summary, team_id: x.team_id, where: x.sprints.length ? `спринт ${formatSprints(x.sprints)}` : 'вне квартала' }))
  }, [model])

  const [order, setOrder] = useState(initial)
  const [saved, setSaved] = useState(0)
  const [query, setQuery] = useState('')
  const [, setPlanParam] = useParam('plan')
  const facts = useFacts(planId)
  const save = useSetPriorities()
  const recompute = useRecompute(planId)
  useEffect(() => setOrder(initial), [initial])

  const initialIndex = useMemo(() => new Map(initial.map((x, i) => [x.task_id, i])), [initial])
  const changed = order.filter((x, i) => initialIndex.get(x.task_id) !== i).length
  const busy = save.isPending || recompute.isPending
  const q = query.trim().toLowerCase()
  const visible = (x: Item) => !q || x.task_id.toLowerCase().includes(q) || x.summary.toLowerCase().includes(q) || x.team_id.toLowerCase().includes(q)
  // Перетаскивание только без поиска: при частичном списке позиция «между» неоднозначна
  const dragDisabled = readOnly || busy || !!q

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return
    setOrder((prev) => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const onSave = async () => {
    try {
      setSaved(0)
      await save.mutateAsync({ ids: order.map((o) => o.task_id), onProgress: setSaved })
      const lastFact = Math.max(0, ...(facts.data ?? []).map((f) => f.sprint_no))
      await recompute.mutateAsync(lastFact)
      setPlanParam(null)
      toast.success('Приоритеты сохранены', { description: lastFact ? `Спринты ${lastFact + 1}–6 пересчитаны — открыта новая версия.` : 'План пересчитан — открыта новая версия.' })
    } catch (e) {
      toast.error(errorTitle(e), { description: errorHint(e) })
    }
  }

  return (
    <>
      <div className="toolbar" style={{ minHeight: 32 }}>
        <SearchInput placeholder="Найти задачу в списке" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 240 }} aria-label="Поиск в приоритетах" />
        <AnimatePresence mode="wait" initial={false}>
          {readOnly ? (
            <motion.span key="ro" className="muted" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: t.fast }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
              Приоритеты меняются только в актуальной версии плана.
            </motion.span>
          ) : changed > 0 ? (
            <motion.div key="dirty" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} initial={{ opacity: 0, transform: 'translateY(-4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', transition: t.base }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
              <span className="tabular">Изменено позиций: {changed}</span>
              <Button variant="primary" size="sm" loading={busy} onClick={onSave}>
                {save.isPending ? `Сохраняем ${saved} из ${order.length}` : recompute.isPending ? 'Пересчитываем план' : 'Сохранить и пересчитать'}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOrder(initial)}>
                Отменить
              </Button>
            </motion.div>
          ) : (
            <motion.span key="hint" className="muted" style={{ fontSize: 'var(--text-sm)' }} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: t.fast }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
              {q ? 'Поиск: стрелки работают, перетаскивание — после очистки поиска.' : 'Выше — раньше в плане. Перетащите за ручку или используйте стрелки.'}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <Reorder.Group as="ol" axis="y" values={order} onReorder={dragDisabled ? () => {} : setOrder} className="rank block" style={{ overflow: 'hidden' }}>
        {order.map((item, i) =>
          visible(item) ? (
            <RankItem key={item.task_id} item={item} index={i} total={order.length} moved={initialIndex.get(item.task_id) !== i} disabled={readOnly || busy} dragDisabled={dragDisabled} onMove={move} />
          ) : null,
        )}
      </Reorder.Group>
    </>
  )
}

function RankItem({ item, index, total, moved, disabled, dragDisabled, onMove }: { item: Item; index: number; total: number; moved: boolean; disabled: boolean; dragDisabled: boolean; onMove: (from: number, to: number) => void }) {
  const controls = useDragControls()
  const [dragging, setDragging] = useState(false)
  return (
    <Reorder.Item as="li" value={item} className="rank__item" data-dragging={dragging || undefined} data-moved={moved || undefined} dragListener={false} dragControls={controls} onDragStart={() => setDragging(true)} onDragEnd={() => setDragging(false)} layout="position" transition={t.layout}>
      <button type="button" className="rank__handle" aria-label={`Перетащить ${item.task_id}`} disabled={dragDisabled} onPointerDown={(e) => !dragDisabled && controls.start(e)}>
        <GripVertical aria-hidden />
      </button>
      <span className="rank__pos">{index + 1}</span>
      <span className="rank__main">
        <span className="rank__title">
          <span className="table-key">{item.task_id}</span> {item.summary}
        </span>
        <span className="rank__meta">
          {item.team_id} · сейчас {item.where}
        </span>
      </span>
      <span className="rank__actions">
        <Button size="sm" variant="ghost" iconOnly icon={<ArrowUpToLine />} aria-label={`${item.task_id} в начало`} disabled={disabled || index === 0} onClick={() => onMove(index, 0)} />
        <Button size="sm" variant="ghost" iconOnly icon={<ArrowUp />} aria-label={`${item.task_id} выше`} disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)} />
        <Button size="sm" variant="ghost" iconOnly icon={<ArrowDown />} aria-label={`${item.task_id} ниже`} disabled={disabled || index === total - 1} onClick={() => onMove(index, index + 1)} />
      </span>
    </Reorder.Item>
  )
}
