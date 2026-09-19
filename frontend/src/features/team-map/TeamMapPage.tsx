import { useMemo } from 'react'
import { useBusFactor, useCurrentPlanId, useEngineers, usePlan, useStarMap, useTasks } from '@/api/queries'
import { buildPlanModel } from '@/lib/planModel'
import { Panel } from '@/components/ui/Panel'
import { ErrorAlert, SkeletonRows } from '@/components/ui/States'
import { Tabs } from '@/components/ui/Tabs'
import { useParam } from '@/lib/useParam'
import { CompetenciesTab } from './CompetenciesTab'
import { PeopleTab } from './PeopleTab'
import { PersonPanelContent } from './PersonPanel'
import { TeamsTab } from './TeamsTab'
import { CompetencyPanelContent } from './star/CompetencyPanel'
import { StarMap } from './star/StarMap'

export function TeamMapPage() {
  const summary = useStarMap()
  const bus = useBusFactor()
  const plan = usePlan(useCurrentPlanId())
  const tasks = useTasks()
  // Сколько незакрытых задач текущего плана требуют роль: «команда|роль» и «company|роль» (роль в нижнем регистре)
  const roleDemand = useMemo(() => {
    const out = new Map<string, string[]>()
    if (!plan.data) return out
    for (const t of buildPlanModel(plan.data, tasks.data ?? []).tasks.values()) {
      if (t.decision === 'done_actual' || t.decision === 'cancelled') continue
      for (const role of Object.keys(t.role_hours)) {
        for (const key of [`company|${role.toLowerCase()}`, `${t.team_id}|${role.toLowerCase()}`]) out.set(key, [...(out.get(key) ?? []), t.task_id])
      }
    }
    return out
  }, [plan.data, tasks.data])
  const [view] = useParam('view')
  const [person, setPerson] = useParam('person')
  const [comp, setComp] = useParam('comp')
  const engineers = useEngineers({})
  const current = view ?? 'map'
  const openPerson = (id: string) => {
    setComp(null)
    setPerson(id)
  }
  const people = new Set(summary.data?.teams.flatMap((x) => x.engineers.map((e) => e.engineer_id)))
  // Критичные по онбордингу: Bus Factor 1 у компетенции, которая нужна задачам плана
  const risky = bus.data?.items.filter((i) => i.scope_type === 'company' && i.factor <= 1 && (roleDemand.get(`company|${i.key}`)?.length ?? 0) > 0).length

  return (
    <div className="page" data-panel={person || comp ? 'open' : 'closed'}>
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Звёздная карта</h1>
            <div className="page-head__sub">Кто в каких командах, какие компетенции держатся на одном человеке</div>
          </div>
        </div>

        <Tabs
          current={current}
          items={[
            { value: 'map', label: 'Карта' },
            { value: 'people', label: 'Люди', count: summary.data ? people.size : undefined },
            { value: 'teams', label: 'Команды и роли', count: summary.data?.teams.length },
            { value: 'competencies', label: 'Компетенции и Bus Factor', count: risky },
          ]}
        />

        {summary.error ? (
          <ErrorAlert error={summary.error} onRetry={() => summary.refetch()} />
        ) : !summary.data ? (
          <SkeletonRows rows={8} cols={6} />
        ) : current === 'map' ? (
          bus.error || engineers.error ? (
            <ErrorAlert error={bus.error ?? engineers.error} onRetry={() => (bus.error ? bus.refetch() : engineers.refetch())} />
          ) : !bus.data || !engineers.data ? (
            <div className="skeleton" style={{ height: 520, borderRadius: 'var(--r-lg)' }} />
          ) : (
            <StarMap engineers={engineers.data} busFactor={bus.data} roleDemand={roleDemand} />
          )
        ) : current === 'people' ? (
          <PeopleTab summary={summary.data} busFactor={bus.data} selected={person} onSelect={setPerson} />
        ) : current === 'teams' ? (
          <TeamsTab summary={summary.data} onSelect={setPerson} />
        ) : bus.error ? (
          <ErrorAlert error={bus.error} onRetry={() => bus.refetch()} />
        ) : !bus.data ? (
          <SkeletonRows rows={8} cols={4} />
        ) : (
          <CompetenciesTab report={bus.data} summary={summary.data} roleDemand={roleDemand} hasPlan={!!plan.data} onSelect={setPerson} />
        )}
      </div>

      <Panel
        contentKey={person ?? comp}
        onClose={() => {
          setPerson(null)
          setComp(null)
        }}
        eyebrow={person ? 'Инженер' : comp?.startsWith('role:') ? 'Роль' : 'Навык'}
        title={person ?? (comp ? capitalize(comp.slice(comp.indexOf(':') + 1)) : null)}
      >
        {person ? (
          <PersonPanelContent id={person} />
        ) : comp && bus.data && engineers.data ? (
          <CompetencyPanelContent comp={comp} busFactor={bus.data} engineers={engineers.data} roleDemand={roleDemand} onPerson={openPerson} />
        ) : null}
      </Panel>
    </div>
  )
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
