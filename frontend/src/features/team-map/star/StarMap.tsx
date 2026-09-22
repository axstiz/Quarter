import { Maximize2, Minus, Plus, Search } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { BusFactorReport, Engineer } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Checkbox, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { t } from '@/lib/motion'
import { useParam } from '@/lib/useParam'
import { buildStarGraph, personId, type StarGraph } from './model'
import { layoutStarGraph } from './layout'
import { readMapColors } from './palette'
import { StarMapCanvas, type Lens, type StarMapHandle } from './StarMapCanvas'

const LENSES: { value: Lens; label: string; hint: string }[] = [
  { value: 'teams', label: 'Команды', hint: 'Люди и их команды' },
  { value: 'roles', label: 'Роли', hint: 'Кто закрывает роль, размер — задачи плана' },
  { value: 'skills', label: 'Навыки', hint: 'Заявленные компетенции' },
]

interface Props {
  engineers: Engineer[]
  busFactor: BusFactorReport
  roleDemand: Map<string, string[]>
}

/** Параметр ?comp= → id узла: «role:backend» → «c:role:backend». */
export const compParamToNode = (v: string) => `c:${v}`

export function StarMap({ engineers, busFactor, roleDemand }: Props) {
  const [lensParam, setLens] = useParam('lens')
  const [risks, setRisks] = useParam('risks')
  const [focusTeam, setFocusTeam] = useParam('focus')
  const [person, setPerson] = useParam('person')
  const [comp, setComp] = useParam('comp')
  const lens = (LENSES.some((l) => l.value === lensParam) ? lensParam : 'roles') as Lens
  const mapRef = useRef<StarMapHandle>(null)

  // Граф и укладка считаются один раз на данные (ForceAtlas2 детерминирован — карта не «прыгает» между заходами)
  const wide = useMediaQuery('(min-width: 721px)')
  const graph = useMemo(() => {
    const g = buildStarGraph({ engineers, busFactor, roleDemand })
    layoutStarGraph(g, wide ? 1.5 : 0.75)
    return g
  }, [engineers, busFactor, roleDemand, wide])

  const teamMeta = useMemo(() => {
    const m = new Map<string, { people: number; fte: number }>()
    for (const e of engineers) {
      const cur = m.get(e.team_id) ?? { people: 0, fte: 0 }
      m.set(e.team_id, { people: cur.people + 1, fte: Math.round((cur.fte + e.capacity_rate) * 10) / 10 })
    }
    return m
  }, [engineers])
  const teams = [...teamMeta.keys()].sort()

  const selected = person ? personId(person) : comp ? compParamToNode(comp) : null
  const select = (node: string | null) => {
    if (!node) {
      setPerson(null)
      setComp(null)
      return
    }
    if (node.startsWith('p:')) {
      setComp(null)
      setPerson(node.slice(2))
    } else {
      setPerson(null)
      setComp(node.slice(2))
    }
  }

  const choose = (node: string) => {
    const a = graph.getNodeAttributes(node)
    // навык не виден в линзе «Роли» — переключаем линзу, иначе поиск «ничего не показал»
    if (a.kind === 'skill' && lens !== 'skills') setLens('skills')
    if (a.kind === 'role' && lens !== 'roles') setLens('roles')
    if (risks && (a.kind === 'role' || a.kind === 'skill') && (a.factor ?? 2) > 1) setRisks(null)
    select(node)
    requestAnimationFrame(() => mapRef.current?.focusNode(node))
  }

  const changeTeam = (team: string) => {
    setFocusTeam(team || null)
    mapRef.current?.focusTeam(team || null)
  }

  const counts = useMemo(() => {
    let people = 0, roles = 0, skills = 0, riskRoles = 0, riskSkills = 0
    graph.forEachNode((_, a) => {
      if (a.kind === 'person') people++
      if (a.kind === 'role') { roles++; if ((a.factor ?? 2) <= 1) riskRoles++ }
      if (a.kind === 'skill') { skills++; if ((a.factor ?? 2) <= 1) riskSkills++ }
    })
    return { people, roles, skills, riskRoles, riskSkills }
  }, [graph])

  const riskCount = lens === 'roles' ? counts.riskRoles : lens === 'skills' ? counts.riskSkills : null
  const summary = `Звёздная карта: ${counts.people} инженеров в ${teams.length} командах, ${counts.roles} ролей и ${counts.skills} навыков; на одном человеке держатся ${counts.riskRoles} ролей и ${counts.riskSkills} навыков. Те же данные — во вкладках «Люди» и «Компетенции и Bus Factor».`

  return (
    <div className="starmap">
      <div className="toolbar starmap__toolbar">
        <Segmented label="Что показать на карте" value={lens} onChange={(v) => setLens(v === 'roles' ? null : v)} items={LENSES} />
        <NodeSearch graph={graph} onChoose={choose} />
        <Select aria-label="Фокус на команде" size="sm" value={focusTeam ?? ''} onChange={(e) => changeTeam(e.target.value)} options={[{ value: '', label: 'Все команды' }, ...teams.map((x) => ({ value: x, label: `Команда ${x}` }))]} />
        {lens !== 'teams' && (
          <Checkbox label={`Только Bus Factor 1${riskCount != null ? ` · ${riskCount}` : ''}`} checked={!!risks} onChange={(e) => setRisks(e.target.checked ? '1' : null)} />
        )}
      </div>

      <div className="starmap__stage" role="img" aria-label={summary}>
        <StarMapCanvas ref={mapRef} graph={graph} teamMeta={teamMeta} onSelect={select} state={{ lens, riskOnly: !!risks && lens !== 'teams', focusTeam, selected }} />

        <div className="starmap__zoom" role="group" aria-label="Масштаб">
          <Button size="sm" iconOnly icon={<Plus aria-hidden />} aria-label="Приблизить" title="Приблизить" onClick={() => mapRef.current?.zoomIn()} />
          <Button size="sm" iconOnly icon={<Minus aria-hidden />} aria-label="Отдалить" title="Отдалить" onClick={() => mapRef.current?.zoomOut()} />
          <Button size="sm" iconOnly icon={<Maximize2 aria-hidden />} aria-label="Показать всю карту" title="Показать всю карту" onClick={() => { changeTeam(''); mapRef.current?.fit() }} />
        </div>

        <Legend lens={lens} defaultOpen={false} />
      </div>
    </div>
  )
}

/** Поиск по карте — комбобокс: ↑↓ выбор, Enter — перелететь к звезде, Esc — очистить. */
function NodeSearch({ graph, onChoose }: { graph: StarGraph; onChoose: (node: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    const out: { node: string; label: string; kind: string; meta: string; rank: number }[] = []
    graph.forEachNode((node, a) => {
      if (a.kind === 'anchor') return
      const label = a.label.toLowerCase()
      const pos = label.indexOf(query)
      if (pos < 0) return
      const kind = a.kind === 'person' ? 'Инженер' : a.kind === 'role' ? 'Роль' : 'Навык'
      const meta = a.kind === 'person' ? `${a.role} · ${a.teams!.join(' + ')}` : `носителей: ${a.holders!.length}`
      out.push({ node, label: a.label, kind, meta, rank: (pos === 0 ? 0 : 10) + (a.kind === 'skill' ? 2 : a.kind === 'role' ? 1 : 0) })
    })
    return out.sort((x, y) => x.rank - y.rank || x.label.localeCompare(y.label)).slice(0, 8)
  }, [graph, q])

  useEffect(() => setActive(0), [q])

  const pick = (i: number) => {
    const r = results[i]
    if (!r) return
    onChoose(r.node)
    setQ(r.label)
    setOpen(false)
  }

  const expanded = open && q.trim().length > 0
  return (
    <div className="starmap__search">
      <span className="input-wrap">
        <Search aria-hidden />
        <input
          className="input"
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && results[active] ? `${listId}-${active}` : undefined}
          aria-label="Найти на карте"
          placeholder="Инженер, роль или навык"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((i) => Math.min(i + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(active)
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
      </span>
      {expanded && (
        <motion.ul id={listId} role="listbox" className="starmap__results" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={t.fast}>
          {results.length === 0 ? (
            <li className="starmap__result starmap__result--empty">Ничего не найдено</li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.node}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="starmap__result"
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(i)
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={r.kind === 'Инженер' ? 'mono' : undefined}>{r.label}</span>
                <span className="starmap__result-meta">
                  {r.kind} · {r.meta}
                </span>
              </li>
            ))
          )}
        </motion.ul>
      )}
    </div>
  )
}

function Legend({ lens, defaultOpen }: { lens: Lens; defaultOpen: boolean }) {
  // цвета легенды — те же, что у канваса, и следуют за темой
  useThemeKey()
  const colors = readMapColors()
  const lg = (color: string) => ({ '--lg-c': color }) as CSSProperties
  return (
    <details className="starmap__legend" open={defaultOpen || undefined}>
      <summary>Как читать</summary>
      <ul>
        <li>
          <i className="lg lg--person" /> инженер, полная ставка
        </li>
        <li>
          <i className="lg lg--part" /> частичная ставка
        </li>
        {lens === 'roles' && (
          <li>
            <i className="lg lg--role" style={lg(colors.role)} /> роль · размер — задачи плана
          </li>
        )}
        {lens === 'skills' && (
          <li>
            <i className="lg lg--skill" style={lg(colors.skill)} /> навык · размер — носители
          </li>
        )}
        {lens !== 'skills' && (
          <li>
            <i className="lg lg--risk" style={lg(colors.risk)} /> {lens === 'roles' ? 'роль на одном человеке' : 'единственный носитель роли'}
          </li>
        )}
        <li>
          <i className="lg lg--bridge" /> работает и во второй команде
        </li>
        <li>
          <i className="lg lg--hull" /> команда
        </li>
      </ul>
      <p>Наведите — связи, нажмите — подробности. Колесо — масштаб.</p>
    </details>
  )
}

/** Меняется при смене темы (атрибут data-theme или системная) — перерисовка потребителя. */
function useThemeKey() {
  return useSyncExternalStore(
    (cb) => {
      const mo = new MutationObserver(cb)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      const mq = matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', cb)
      return () => { mo.disconnect(); mq.removeEventListener('change', cb) }
    },
    () => `${document.documentElement.dataset.theme ?? ''}:${matchMedia('(prefers-color-scheme: dark)').matches}`,
  )
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
  )
}
