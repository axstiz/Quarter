import { ArrowDown, ArrowUp, GripVertical, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRecompute, useSetPriorities } from '@/api/queries'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Overlay'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'

export interface PriorityItem {
  task_id: string
  summary: string
  team_id: string
  sprint_no: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  planId: string
  items: PriorityItem[]
  onRecomputed: () => void
}

/** Приоритеты выставляет человек: drag-n-drop или стрелки, затем пересчёт. */
export function PriorityDrawer({ open, onClose, planId, items, onRecomputed }: Props) {
  const [order, setOrder] = useState(items)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const setPriorities = useSetPriorities()
  const recompute = useRecompute(planId)
  const toast = useToast()

  useEffect(() => {
    if (open) setOrder(items)
  }, [open, items])

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return
    setOrder((o) => {
      const next = [...o]
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x)
      return next
    })
  }

  const dirty = order.some((o, i) => o.task_id !== items[i]?.task_id)

  const save = async () => {
    try {
      await setPriorities.mutateAsync(order.map((o) => o.task_id))
      await recompute.mutateAsync()
      toast({ tone: 'ok', title: 'Приоритеты сохранены', description: 'План пересчитан — создана новая версия.' })
      onRecomputed()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Не удалось сохранить', description: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Приоритеты задач"
      description="Выше — раньше. Перетащите карточки или используйте стрелки; после сохранения план пересчитается."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOrder(items)} disabled={!dirty}>
            Сбросить
          </Button>
          <Button variant="primary" onClick={save} disabled={!dirty} loading={setPriorities.isPending || recompute.isPending}>
            Сохранить и пересчитать
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-start gap-2 rounded-xl bg-accent-soft p-3 text-xs text-accent">
        <Sparkles className="mt-px size-3.5 shrink-0" />
        <span>AI-советник по порядку появится позже (нет ручки в API) — решение всегда за лидом.</span>
      </div>
      <ol className="space-y-1.5">
        {order.map((item, i) => (
          <li
            key={item.task_id}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragIdx !== null && dragIdx !== i) {
                move(dragIdx, i)
                setDragIdx(i)
              }
            }}
            onDragEnd={() => setDragIdx(null)}
            className={cn(
              'group flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-2 transition',
              dragIdx === i ? 'border-accent opacity-60 shadow-pop' : 'hover:border-accent/30',
            )}
          >
            <GripVertical className="size-4 shrink-0 cursor-grab text-subtle" />
            <span className="w-6 text-right text-xs font-semibold text-subtle tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-muted">{item.task_id}</span>
                <span className="text-[11px] text-subtle">· {item.team_id}</span>
                <span className="ml-auto text-[11px] text-subtle">{item.sprint_no ? `S${item.sprint_no}` : 'вне'}</span>
              </div>
              <p className="truncate text-[13px] font-medium">{item.summary}</p>
            </div>
            <div className="flex flex-col opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
              <button className="rounded p-0.5 text-subtle hover:text-fg" onClick={() => move(i, i - 1)} aria-label="Выше">
                <ArrowUp className="size-3.5" />
              </button>
              <button className="rounded p-0.5 text-subtle hover:text-fg" onClick={() => move(i, i + 1)} aria-label="Ниже">
                <ArrowDown className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </Drawer>
  )
}
