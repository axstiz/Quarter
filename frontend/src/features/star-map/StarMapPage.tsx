import { LayoutGrid, Network, Sparkles, Users } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useBusFactor, useEngineers, useStarMap } from '@/api/queries'
import type { EngineerFilters } from '@/api/types'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { fmt } from '@/lib/format'
import { BusFactorPanel } from './BusFactorPanel'
import { Constellation } from './Constellation'
import { EngineerDrawer } from './EngineerDrawer'
import { ROLE_LEGEND, roleFamily } from './roleColor'

export function StarMapPage() {
  const summary = useStarMap()
  const bus = useBusFactor()
  const [view, setView] = useState<'map' | 'list'>('map')
  const [selected, setSelected] = useState<string | null>(null)
  const [filters, setFilters] = useState<EngineerFilters>({})
  const deferred = useDeferredValue(filters)
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== '')
  const engineers = useEngineers(deferred)

  const teams = useMemo(() => summary.data?.teams.map((t) => t.team_id).sort() ?? [], [summary.data])
  const grades = useMemo(() => [...new Set(summary.data?.teams.flatMap((t) => t.engineers.map((e) => e.grade)))].filter(Boolean).sort(), [summary.data])
  // Единственный носитель роли — сильный сигнал (ореол), уникального навыка — слабый (кольцо)
  const { roleHolders, skillHolders } = useMemo(() => {
    const roles = new Set(summary.data?.teams.flatMap((t) => t.engineers.map((e) => e.role.toLowerCase())))
    const company = summary.data?.single_holder_competencies.filter((i) => i.scope_type === 'company') ?? []
    return {
      roleHolders: new Set(company.filter((i) => roles.has(i.key)).flatMap((i) => i.holders)),
      skillHolders: new Set(company.filter((i) => !roles.has(i.key)).flatMap((i) => i.holders)),
    }
  }, [summary.data])
  const highlighted = hasFilters && engineers.data ? new Set(engineers.data.map((e) => e.engineer_id)) : null
  const set = (k: keyof EngineerFilters, v: string) => setFilters((f) => ({ ...f, [k]: k === 'min_rate' ? (v ? Number(v) : undefined) : v || undefined }))

  const people = new Set(summary.data?.teams.flatMap((t) => t.engineers.map((e) => e.engineer_id)))
  const multiTeam = summary.data
    ? [...people].filter((id) => summary.data!.teams.filter((t) => t.engineers.some((e) => e.engineer_id === id)).length > 1).length
    : 0

  return (
    <>
      <PageHeader
        title="Звёздная карта"
        description="Состав команд, роли, компетенции и риски единственных носителей"
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'map', label: <><Network className="size-3.5" /> Карта</> },
              { value: 'list', label: <><LayoutGrid className="size-3.5" /> Команды</> },
            ]}
          />
        }
      >
        <Select value={filters.team_id ?? ''} onChange={(e) => set('team_id', e.target.value)} options={teams.map((t) => ({ value: t, label: t }))} placeholder="Все команды" className="w-40" />
        <Input value={filters.role ?? ''} onChange={(e) => set('role', e.target.value)} placeholder="Роль" className="w-36" />
        <Select value={filters.grade ?? ''} onChange={(e) => set('grade', e.target.value)} options={grades.map((g) => ({ value: g, label: g }))} placeholder="Любой грейд" className="w-36" />
        <Input value={filters.skill ?? ''} onChange={(e) => set('skill', e.target.value)} placeholder="Компетенция, напр. Kafka" className="w-48" />
        <Select
          value={filters.min_rate != null ? String(filters.min_rate) : ''}
          onChange={(e) => set('min_rate', e.target.value)}
          options={[
            { value: '0.5', label: 'ставка ≥ 0.5' },
            { value: '1', label: 'полная ставка' },
          ]}
          placeholder="Любая ставка"
          className="w-36"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            Сбросить
          </Button>
        )}
        {hasFilters && engineers.data && (
          <span className="text-xs text-muted sm:ml-auto">
            Найдено: <span className="font-semibold text-fg">{new Set(engineers.data.map((e) => e.engineer_id)).size}</span>
          </span>
        )}
      </PageHeader>

      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Команд" value={summary.data ? teams.length : null} />
            <Stat label="Инженеров" value={summary.data ? people.size : null} />
            <Stat label="В нескольких командах" value={summary.data ? multiTeam : null} />
            <Stat label="Единственные носители ролей" value={summary.data ? roleHolders.size : null} tone="danger" />
          </div>

          <Card className="overflow-hidden">
            {summary.isError ? (
              <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
            ) : summary.isLoading ? (
              <Skeleton className="m-4 aspect-[900/660] rounded-xl" />
            ) : !summary.data?.teams.length ? (
              <EmptyState icon={<Users className="size-6" />} title="Нет инженеров" description="Загрузите профили инженеров через импорт данных." />
            ) : view === 'map' ? (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-2.5 text-xs text-muted">
                  {ROLE_LEGEND.map((l) => (
                    <span key={l.label} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-full" style={{ background: l.color }} />
                      {l.label}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5 sm:ml-auto">
                    <span className="size-2.5 rounded-full bg-danger/40 ring-2 ring-danger" /> единственный носитель роли
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full ring-1 ring-danger/60 ring-offset-1 ring-offset-surface" /> уникальный навык
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-0 w-4 border-t border-dashed border-accent" /> 2 команды
                  </span>
                </div>
                <Constellation
                  teams={summary.data.teams}
                  fte={summary.data.fte_distribution}
                  highlighted={highlighted}
                  roleHolders={roleHolders}
                  skillHolders={skillHolders}
                  selected={selected}
                  onSelect={setSelected}
                />
              </>
            ) : (
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {summary.data.teams.map((t) => (
                  <div key={t.team_id} className="rounded-xl border border-border">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                      <span className="text-sm font-semibold">{t.team_id}</span>
                      <span className="text-xs text-muted">{fmt(summary.data!.fte_distribution[t.team_id])} FTE</span>
                    </div>
                    <ul className="divide-y divide-border">
                      {t.engineers.map((e) => (
                        <li key={e.engineer_id}>
                          <button
                            onClick={() => setSelected(e.engineer_id)}
                            className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2', highlighted && !highlighted.has(e.engineer_id) && 'opacity-35')}
                          >
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: roleFamily(e.role).color }} />
                            <span className="font-mono text-xs">{e.engineer_id}</span>
                            <span className="min-w-0 flex-1 truncate text-[13px]">{e.role}</span>
                            {roleHolders.has(e.engineer_id) && <Sparkles className="size-3.5 text-danger" />}
                            <span className="text-xs text-subtle">{e.grade}</span>
                            <span className={cn('w-8 text-right text-xs tabular-nums', e.capacity_rate < 1 ? 'font-semibold text-accent' : 'text-muted')}>{e.capacity_rate}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <BusFactorPanel report={bus.data} loading={bus.isLoading} teams={teams} onPickHolder={setSelected} />
      </div>

      <EngineerDrawer id={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | null; tone?: 'danger' }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs text-muted">{label}</p>
      {value == null ? <Skeleton className="mt-1.5 h-6 w-10" /> : <p className={cn('mt-0.5 text-xl font-semibold tabular-nums', tone === 'danger' && value > 0 && 'text-danger')}>{value}</p>}
    </Card>
  )
}
