import { ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card } from '@/components/ui/Card'
import { Drawer } from '@/components/ui/Overlay'
import { Skeleton } from '@/components/ui/Skeleton'
import { plural } from '@/lib/format'
import type { RiskEntry } from './busRisk'

export function BusRiskWidget({ risks, loading, onOpenTask }: { risks: RiskEntry[]; loading: boolean; onOpenTask: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [params] = useSearchParams()

  if (loading) return <Skeleton className="h-[92px] rounded-xl" />

  const byCompetency = new Map<string, { holder: string; tasks: string[] }>()
  for (const r of risks)
    for (const c of r.competencies) {
      const entry = byCompetency.get(c.key) ?? { holder: c.holder, tasks: [] }
      entry.tasks.push(r.task.task_id)
      byCompetency.set(c.key, entry)
    }

  if (!risks.length) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <ShieldCheck className="size-5 text-ok" />
        <div className="text-sm">
          <p className="font-semibold">Bus-риск не обнаружен</p>
          <p className="text-xs text-muted">Задачи плана не зависят от единственных носителей</p>
        </div>
      </Card>
    )
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="group w-full text-left">
        <Card className="flex h-full items-start gap-3 p-4 transition group-hover:border-danger/40 group-hover:shadow-pop">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger">
            <ShieldAlert className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {risks.length} {plural(risks.length, 'задача зависит', 'задачи зависят', 'задач зависят')} от единственного носителя
            </p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {risks.slice(0, 3).map((r) => r.task.task_id).join(', ')}
              {risks.length > 3 && ` и ещё ${risks.length - 3}`}
            </p>
          </div>
          <ChevronRight className="size-4 self-center text-subtle transition group-hover:translate-x-0.5" />
        </Card>
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Уязвимости плана"
        description="Компетенции с Bus Factor ≤ 1 и задачи, которые окажутся под угрозой при уходе носителя."
        footer={
          <Link to={`/star-map${params.get('plan') ? `?plan=${params.get('plan')}` : ''}`} className="text-sm font-semibold text-accent hover:underline">
            Полный расчёт на звёздной карте →
          </Link>
        }
      >
        <ul className="space-y-3">
          {[...byCompetency].map(([key, { holder, tasks }]) => (
            <li key={key} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{key}</span>
                <span className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">BF = 1</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Носитель: <span className="font-mono">{holder}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tasks.map((id) => (
                  <button
                    key={id}
                    onClick={() => {
                      setOpen(false)
                      onOpenTask(id)
                    }}
                    className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] hover:border-accent hover:text-accent"
                  >
                    {id}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Drawer>
    </>
  )
}
