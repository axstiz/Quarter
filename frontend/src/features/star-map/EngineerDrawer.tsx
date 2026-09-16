import { AlertTriangle, Clock } from 'lucide-react'
import { useEngineer } from '@/api/queries'
import { Badge } from '@/components/ui/Badge'
import { Drawer } from '@/components/ui/Overlay'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'
import { fmt } from '@/lib/format'
import { roleFamily } from './roleColor'

export function EngineerDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const profile = useEngineer(id)
  if (!id) return null
  const p = profile.data
  const main = p?.assignments[0]
  const alerts = new Set(p?.single_holder_alerts.map((a) => a.toLowerCase()))
  const skills = main?.skills_declared.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  const totalHours = p?.assignments.reduce((s, a) => s + a.hours_per_sprint, 0) ?? 0

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: main ? roleFamily(main.role).color : 'var(--subtle)' }}>
            {id.slice(-2)}
          </span>
          <span>
            <span className="block font-mono text-sm">{id}</span>
            {main && <span className="block text-xs font-normal text-muted">{main.role} · {main.grade}</span>}
          </span>
        </span>
      }
    >
      {profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      ) : !p ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-subtle uppercase">
              Занятость
              <span className="flex items-center gap-1 font-normal tracking-normal normal-case">
                <Clock className="size-3" /> до {fmt(totalHours)} ч / спринт
              </span>
            </h3>
            <ul className="space-y-2">
              {p.assignments.map((a) => (
                <li key={a.team_id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{a.team_id}</span>
                    {a.parttime && <Badge tone="accent">частичная занятость</Badge>}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                    <span>ставка {a.capacity_rate}</span>
                    <span>·</span>
                    <span>{fmt(a.hours_per_sprint)} из 80 ч</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(a.hours_per_sprint / 80) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {p.single_holder_alerts.length > 0 && (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-danger">
                <AlertTriangle className="size-4" /> Единственный носитель
              </p>
              <p className="mt-1 text-[13px]">Уход сотрудника оставит команду без: {p.single_holder_alerts.join(', ')}</p>
            </div>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">Заявленные компетенции</h3>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <Badge key={s} tone={alerts.has(s.toLowerCase()) ? 'danger' : 'neutral'} className="text-[12px]">
                  {s}
                </Badge>
              ))}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  )
}
