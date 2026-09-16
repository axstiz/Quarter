import { Info, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BusFactorReport } from '@/api/types'
import { Card } from '@/components/ui/Card'
import { SearchInput, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'

interface Props {
  report?: BusFactorReport
  loading: boolean
  teams: string[]
  onPickHolder: (engineerId: string) => void
}

export function BusFactorPanel({ report, loading, teams, onPickHolder }: Props) {
  const [scope, setScope] = useState<'company' | 'team'>('company')
  const [team, setTeam] = useState('')
  const [onlyRisk, setOnlyRisk] = useState(true)
  const [q, setQ] = useState('')

  const items = useMemo(() => {
    const scopeId = scope === 'company' ? 'company' : team || teams[0]
    return (report?.items ?? [])
      .filter((i) => i.scope_type === scope && i.scope_id === scopeId)
      .filter((i) => !onlyRisk || i.factor <= 1)
      .filter((i) => !q || i.key.includes(q.toLowerCase()))
      .sort((a, b) => a.factor - b.factor || a.key.localeCompare(b.key))
  }, [report, scope, team, teams, onlyRisk, q])

  const maxFactor = Math.max(3, ...items.map((i) => i.factor))

  return (
    <Card className="flex flex-col">
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="size-4 text-danger" /> Bus Factor
        </div>

        {/* Методику показываем всегда — требование спеки bus-factor */}
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Info className="size-3.5 text-accent" /> Методика расчёта
          </div>
          {loading ? <Skeleton className="mt-2 h-16" /> : <p className="mt-1 text-xs leading-relaxed text-muted">{report?.methodology}</p>}
          <p className="mt-2 text-xs">
            Область: <span className="font-semibold">{scope === 'company' ? 'вся компания' : `команда ${team || teams[0] || ''}`}</span>
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'company', label: 'Компания' },
              { value: 'team', label: 'Команда' },
            ]}
          />
          {scope === 'team' && (
            <Select value={team || teams[0] || ''} onChange={(e) => setTeam(e.target.value)} options={teams.map((t) => ({ value: t, label: t }))} className="w-36 [&_select]:h-8" />
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Компетенция или роль" className="flex-1 [&_input]:h-8" />
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} className="accent-[var(--danger)]" />
            только ≤ 1
          </label>
        </div>
      </div>

      <div className="scroll-thin mt-3 max-h-[520px] flex-1 overflow-y-auto border-t border-border">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Ничего не найдено</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((i) => (
              <li key={i.key} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] font-medium first-letter:uppercase">{i.key}</span>
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', i.factor <= 1 ? 'bg-danger-soft text-danger' : i.factor === 2 ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
                    {i.factor}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 rounded-full bg-surface-2">
                    <div className={cn('h-full rounded-full', i.factor <= 1 ? 'bg-danger' : i.factor === 2 ? 'bg-warn' : 'bg-ok')} style={{ width: `${(i.factor / maxFactor) * 100}%` }} />
                  </div>
                  <div className="flex gap-1">
                    {i.holders.slice(0, 3).map((h) => (
                      <button key={h} onClick={() => onPickHolder(h)} className="font-mono text-[11px] text-muted hover:text-accent">
                        {h}
                      </button>
                    ))}
                    {i.holders.length > 3 && <span className="text-[11px] text-subtle">+{i.holders.length - 3}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
