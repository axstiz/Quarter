import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/api/endpoints'
import { getWorkspaceId } from '@/api/auth'
import { useDependencies, useEngineers, useTasks, useTeams } from '@/api/queries'
import { Badge } from '@/components/ui/Badge'
import type { Dependency } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { ErrorAlert, errorHint, errorTitle, SkeletonRows } from '@/components/ui/States'
import { Tabs } from '@/components/ui/Tabs'
import { useParam } from '@/lib/useParam'

/** Типы ячеек: text / number / cap0.5 (ставка) / fixed (не редактируется). */
type ColType = 'text' | 'number' | 'rate' | 'id'

const markDataEdited = () => {
  try {
    localStorage.setItem(`quarter-data-edited:${getWorkspaceId()}`, new Date().toISOString())
  } catch { /* приватный режим — баннер не всплывёт до следующего маркера */ }
}

function EditableCell({ value, type, validate, onCommit }: {
  value: string
  type: ColType
  validate?: (raw: string) => string | null
  onCommit: (raw: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  const start = () => {
    setDraft(value)
    setError(null)
    setEditing(true)
  }
  const commit = async () => {
    const text = draft.trim()
    if (text === value) { setEditing(false); return }
    const vErr = validate?.(text)
    if (vErr) { setError(vErr); return }
    try {
      await onCommit(text)
      setEditing(false)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)) // значение сохраняется до исправления
    }
  }

  if (type === 'id') return <span className="mono">{value}</span>
  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        className="editable-cell"
        title="Кликните, чтобы править"
        onClick={start}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), start())}
        style={{ cursor: 'pointer', minHeight: 24, display: 'inline-block', minWidth: 40, borderBottom: error ? '1px dashed var(--over)' : undefined }}
      >
        {value === '' ? <span className="muted">—</span> : value}
        {error && <span className="muted" style={{ color: 'var(--over)', fontSize: 'var(--text-2xs)' }}> {error}</span>}
      </span>
    )
  }
  return (
    <input
      autoFocus
      aria-label="Правка ячейки"
      inputMode={type === 'number' || type === 'rate' ? 'decimal' : 'text'}
      className="input"
      style={{ width: '100%', padding: '2px 6px', borderColor: error ? 'var(--over)' : undefined }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { void commit(); setEditing(false) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur() }
        if (e.key === 'Escape') { setEditing(false); setError(null) }
      }}
    />
  )
}

function DeleteCell({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  // подтверждение через глобальный modal проще на уровне таблицы; тут — двойной щелчок на кнопке
  return (
    <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Удалить «${label}»? История планов не пострадает.`)) { void onConfirm() } }}>
      ✕
    </Button>
  )
}

/** Страница «Данные» (change 019): редактор загруженного датасета таблицами —
 * в-place правки, создание/удаление, часы по ролям, бэк-CRUD делает записи ручными. */
export function DataPage() {
  const [tab] = useParam('tab')
  const [row] = useParam('row') // подсветка строки при переходе из карточки задачи/профиля
  const current = tab ?? 'tasks'
  const tasksQuery = useTasks()
  const depsQuery = useDependencies()
  const engineersQuery = useEngineers({})
  const teamsQuery = useTeams()
  const qc = useQueryClient()

  const invalidate = () => {
    qc.invalidateQueries()
    markDataEdited()
  }

  return (
    <div className="page">
      <div className="content" style={{ maxWidth: 1100 }}>
        <div className="page-head">
          <div>
            <h1>Данные</h1>
            <div className="page-head__sub">
              правки датасета таблицей — записи становятся ручными, повторный импорт их не затирает;
              после правок постройте план заново
            </div>
          </div>
        </div>
        <Tabs
          current={tab ?? 'tasks'}
          param="tab"
          items={[
            { value: 'tasks', label: 'Задачи', count: tasksQuery.data?.length },
            { value: 'people', label: 'Люди', count: engineersQuery.data?.length },
            { value: 'teams', label: 'Команды', count: teamsQuery.data?.length },
            { value: 'deps', label: 'Зависимости', count: depsQuery.data?.length },
          ]}
        />
        {current === 'tasks' && <TasksTable highlight={row} invalidate={invalidate} />}
        {current === 'people' && <PeopleTable highlight={row} invalidate={invalidate} />}
        {current === 'teams' && <TeamsTable invalidate={invalidate} />}
        {current === 'deps' && <DependenciesTable invalidate={invalidate} />}
      </div>
    </div>
  )
}

/* --- Задачи --------------------------------------------------------------- */

const STATUS_OPTIONS = ['ToDo', 'InProgress', 'Done']

function TasksTable({ highlight, invalidate }: { highlight?: string | null; invalidate: () => void }) {
  const tasksQuery = useTasks()
  const roles = useCompanyRoles()
  const [openRoleHours, setOpenRoleHours] = useState<string | null>(null)

  return tasksQuery.error ? (
    <ErrorAlert error={tasksQuery.error} onRetry={() => tasksQuery.refetch()} />
  ) : tasksQuery.isLoading ? (
    <SkeletonRows rows={8} cols={6} />
  ) : (
    <>
      <table className="table table--compact">
      <thead>
        <tr>
          <th>task_id</th>
          <th>Название</th>
          <th>Команда</th>
          <th>Статус</th>
          <th>SP</th>
          <th>Часы</th>
          <th>Часы ролей</th>
          <th aria-label="Удаление" />
        </tr>
      </thead>
      <tbody>
        {(tasksQuery.data ?? []).map((t) => (
          <tr key={t.task_id} style={highlight === t.task_id ? { outline: '2px solid var(--plan)', outlineOffset: '-2px', background: 'color-mix(in srgb, var(--plan) 8%, transparent)' } : undefined}>
            <td className="mono">{t.task_id}</td>
            <td>
              <EditableCell
                value={t.summary}
                type="text"
                onCommit={(v) => api.updateTask(t.task_id, { summary: v }).then(invalidate)}
              />
            </td>
            <td>
              <EditableCell
                value={t.team_id}
                type="text"
                validate={(v) => (roles.teams.includes(v) ? null : 'такой команды нет (например Team-A) — сначала создайте во вкладке «Команды»')}
                onCommit={(v) => api.updateTask(t.task_id, { team_id: v }).then(invalidate)}
              />
            </td>
            <td>
              <EditableCell
                value={t.status}
                type="text"
                validate={(v) => (STATUS_OPTIONS.includes(v) ? null : `статус: ${STATUS_OPTIONS.join(' / ')}`)}
                onCommit={(v) => api.updateTask(t.task_id, { status: v }).then(invalidate)}
              />
            </td>
            <td className="num tabular">
              <EditableCell
                value={String(t.estimation_sp)}
                type="number"
                validate={nonNegative}
                onCommit={(v) => api.updateTask(t.task_id, { estimation_sp: Number(v) }).then(invalidate)}
              />
            </td>
            <td className="num tabular">
              <EditableCell
                value={String(t.estimated_hh)}
                type="number"
                validate={nonNegative}
                onCommit={(v) => api.updateTask(t.task_id, { estimated_hh: Number(v) }).then(invalidate)}
              />
            </td>
            <td>
              <RoleHoursEditor task={t} roles={roles.roles} open={openRoleHours === t.task_id}
                onOpen={() => setOpenRoleHours(openRoleHours === t.task_id ? null : t.task_id)} invalidate={invalidate} />
            </td>
            <td>
              <DeleteCell label={t.task_id} onConfirm={async () => {
                try {
                  await api.deleteTask(t.task_id)
                  invalidate()
                  toast.success(`Задача ${t.task_id} удалена`)
                } catch (e) {
                  toast.error(errorTitle(e), { description: errorHint(e) })
                }
              }} />
            </td>
          </tr>
        ))}
      </tbody>
      </table>
      <TaskAdd teams={roles.teams} invalidate={invalidate} />
    </>
  )
}

/** change 053: добавление строки задачи вручную — запись становится ручной (manual),
 *  повторный импорт её не затирает. */
function TaskAdd({ teams, invalidate }: { teams: string[]; invalidate: () => void }) {
  const [taskId, setTaskId] = useState('')
  const [summary, setSummary] = useState('')
  const [team, setTeam] = useState('')
  const [status, setStatus] = useState('ToDo')
  const [sp, setSp] = useState('')
  const [hh, setHh] = useState('')
  const ok = taskId.trim() !== ''
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')))
  const validNum = (v: string) => v.trim() === '' || Number.isFinite(num(v))
  return (
    <div className="block" style={{ marginTop: 'var(--s-4)' }}>
      <div className="block__head">
        <h3>Добавить задачу</h3>
        <span className="section__hint">часы ролей задаются после создания — колонка «Часы ролей» в строке задачи</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ width: 130, padding: '4px 8px' }} placeholder="task_id *" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
        <input className="input" style={{ width: 240, padding: '4px 8px' }} placeholder="Название" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <input className="input" style={{ width: 140, padding: '4px 8px' }} placeholder="Команда" list="task-add-teams" value={team} onChange={(e) => setTeam(e.target.value)} />
        <datalist id="task-add-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
        <input className="input" style={{ width: 70, padding: '4px 8px' }} placeholder="SP" value={sp} onChange={(e) => setSp(e.target.value)} />
        <input className="input" style={{ width: 80, padding: '4px 8px' }} placeholder="Часы" value={hh} onChange={(e) => setHh(e.target.value)} />
        <Button variant="secondary" disabled={!ok || !validNum(sp) || !validNum(hh)} onClick={() => {
          void api.createTask({
            task_id: taskId.trim(),
            summary: summary || undefined,
            team_id: team || undefined,
            status,
            estimation_sp: num(sp),
            estimated_hh: num(hh),
          })
            .then(() => { markDataEdited(); invalidate(); toast.success(`Задача ${taskId} добавлена`); setTaskId(''); setSummary(''); setTeam(''); setSp(''); setHh('') })
            .catch((e) => toast.error(errorTitle(e), { description: errorHint(e) }))
        }}>Добавить</Button>
      </div>
    </div>
  )
}

const nonNegative = (raw: string): string | null => {
  const v = Number(raw.replace(',', '.'))
  if (!Number.isFinite(v) || v < 0) return 'нужно неотрицательное число'
  return null
}

function useCompanyRoles() {
  const engineers = useEngineers({})
  return useMemo(() => {
    const roleSet = new Set<string>()
    for (const eng of engineers.data ?? []) roleSet.add(eng.role)
    return {
      roles: [...roleSet].sort(),
      teams: [...new Set((engineers.data ?? []).map((e) => e.team_id))].filter(Boolean).sort(),
      carriersOf: (role: string) => (engineers.data ?? []).filter((e) => e.role === role),
    }
  }, [engineers.data])
}

/** Detail-вид часов по ролям задачи: список «роль → часы», добавление/правка/удаление (019 §2.2). */
function RoleHoursEditor({ task, roles, open, onOpen, invalidate }: {
  task: { task_id: string; role_hours: Record<string, number> }
  roles: string[]
  open: boolean
  onOpen: () => void
  invalidate: () => void
}) {
  const commit = async (roleHours: Record<string, number>) => {
    await api.setTaskRoleHours(task.task_id, roleHours)
    invalidate()
  }
  return (
    <>
      <Button size="sm" variant="ghost" icon={<ChevronDown />} onClick={onOpen} aria-expanded={open}
        title={'Часы ролей задачи: добавить/править/удалить роли'}>
        {Object.keys(task.role_hours).length || '—'} ролей
      </Button>
      {open && (
        <div className="callout" style={{ marginTop: 6, padding: 10, display: 'grid', gap: 6 }}>
          <RoleHoursList task={task} roles={roles} commit={commit} />
        </div>
      )}
    </>
  )
}

function RoleHoursList({ task, roles, commit }: {
  task: { task_id: string; role_hours: Record<string, number> }
  roles: string[]
  commit: (next: Record<string, number>) => Promise<void>
}) {
  const entries = Object.entries(task.role_hours)
  const free = roles.filter((r) => !Object.keys(task.role_hours).includes(r))
  const [newRole, setNewRole] = useState('')
  const [newHours, setNewHours] = useState('')

  const push = async (next: Record<string, number>) => {
    try {
      await commit(next)
      toast.success('Часы ролей обновлены', { description: 'Следующая генерация плана учтёт значения.' })
    } catch (e) {
      toast.error(errorTitle(e), { description: errorHint(e) })
    }
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {entries.map(([role, hours]) => (
        <span key={role} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 'var(--text-sm)', minWidth: 150 }}>{role}</b>
          <input
            className="input"
            defaultValue={String(hours)}
            aria-label={`${role}: часы`}
            style={{ width: 80, padding: '2px 6px' }}
            onBlur={(e) => {
              const v = Number(e.target.value.replace(',', '.'))
              if (!Number.isFinite(v) || v === hours) return
              if (v <= 0) { e.target.value = String(hours); toast.error('Правка часов', { description: 'Значение должно быть положительным числом; чтобы убрать роль — крестик.' }); return }
              const next = { ...task.role_hours, [role]: v }
              void push(next)
            }}
          />
          <button type="button" className="muted" aria-label={`Убрать роль ${role}`} title="Убрать роль"
            onClick={() => { const next = { ...task.role_hours }; delete next[role]; void push(next) }}>✕</button>
          {!roles.includes(role) && <Badge tone="over">носителей нет — виртуальный держатель</Badge>}
        </span>
      ))}
      {free.length > 0 && (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Select size="sm" width={170} aria-label="Роль"
            value={newRole} onChange={(e) => { setNewRole(e.target.value); setNewHours('') }}
            options={[{ value: '', label: 'Добавить роль…' }, ...free.map((r) => ({ value: r, label: r }))]} />
          <input className="input" style={{ width: 80, padding: '2px 6px' }} placeholder="ч" aria-label="Часы новой роли"
            value={newHours} onChange={(e) => setNewHours(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={!newRole || !newHours.trim()}
            onClick={() => { const v = Number(newHours.replace(',', '.')); if (!Number.isFinite(v) || v <= 0) { toast.error('Часы роли', { description: 'Значение — положительное число' }); return } void push({ ...task.role_hours, [newRole]: v }); setNewRole(''); setNewHours('') }}>
            Добавить
          </Button>
        </span>
      )}
    </div>
  )
}

/* --- Люди ------------------------------------------------------------------ */

function PeopleTable({ highlight, invalidate }: { highlight?: string | null; invalidate: () => void }) {
  const engineers = useEngineers({})
  const roles = useCompanyRoles()
  if (engineers.error) return <ErrorAlert error={engineers.error} onRetry={() => engineers.refetch()} />
  if (engineers.isLoading) return <SkeletonRows rows={8} cols={5} />
  return (
    <>
      <table className="table">
      <thead>
        <tr>
          <th>engineer_id</th><th>Команда</th><th>Роль</th><th>Грейд</th><th>Навыки</th><th>Ставка</th><th aria-label="Удаление" />
        </tr>
      </thead>
      <tbody>
        {(engineers.data ?? []).map((e) => (
          <tr key={e.engineer_id} style={highlight === e.engineer_id ? { outline: '2px solid var(--plan)', outlineOffset: '-2px' } : undefined}>
            <td className="mono">{e.engineer_id}</td>
            <td>
              <EditableCell value={e.team_id} type="text" validate={(v) => (roles.teams.includes(v) ? null : 'команды нет — создайте во вкладке «Команды»')} onCommit={(v) => api.updateEngineer(e.engineer_id, { team_id: v }).then(invalidate)} />
            </td>
            <td>
              <EditableCell value={e.role} type="text" onCommit={(v) => api.updateEngineer(e.engineer_id, { role: v }).then(invalidate)} />
            </td>
            <td><EditableCell value={e.grade} type="text" onCommit={(v) => api.updateEngineer(e.engineer_id, { grade: v }).then(invalidate)} /></td>
            <td><EditableCell value={e.skills_declared} type="text" onCommit={(v) => api.updateEngineer(e.engineer_id, { skills_declared: v }).then(invalidate)} /></td>
            <td>
              <EditableCell
                value={String(e.capacity_rate)}
                type="rate"
                validate={(v) => (['0.5', '1'].includes(v) ? null : 'допустимо 0.5 или 1')}
                onCommit={(v) => api.updateEngineer(e.engineer_id, { capacity_rate: Number(v) }).then(invalidate)}
              />
            </td>
            <td>
              <DeleteCell label={e.engineer_id} onConfirm={async () => {
                try { await api.deleteEngineer(e.engineer_id); invalidate(); toast.success(`${e.engineer_id} удалён`) }
                catch (err) { toast.error(errorTitle(err), { description: errorHint(err) }) }
              }} />
            </td>
          </tr>
        ))}
      </tbody>
      </table>
      <PersonAdd teams={roles.teams} roles={roles.roles} invalidate={invalidate} />
    </>
  )
}

/** change 053: добавление инженера вручную (запись manual — импорт не затирает). */
function PersonAdd({ teams, roles, invalidate }: { teams: string[]; roles: string[]; invalidate: () => void }) {
  const [eid, setEid] = useState('')
  const [team, setTeam] = useState('')
  const [role, setRole] = useState('')
  const [grade, setGrade] = useState('')
  const [rate, setRate] = useState('1')
  const ok = eid.trim() !== '' && team.trim() !== '' && role.trim() !== ''
  return (
    <div className="block" style={{ marginTop: 'var(--s-4)' }}>
      <div className="block__head">
        <h3>Добавить инженера</h3>
        <span className="section__hint">новую команду сначала создайте во вкладке «Команды»</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ width: 130, padding: '4px 8px' }} placeholder="engineer_id *" value={eid} onChange={(e) => setEid(e.target.value)} />
        <input className="input" style={{ width: 140, padding: '4px 8px' }} placeholder="Команда *" list="person-add-teams" value={team} onChange={(e) => setTeam(e.target.value)} />
        <datalist id="person-add-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
        <input className="input" style={{ width: 190, padding: '4px 8px' }} placeholder="Роль *" list="person-add-roles" value={role} onChange={(e) => setRole(e.target.value)} />
        <datalist id="person-add-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
        <input className="input" style={{ width: 100, padding: '4px 8px' }} placeholder="Грейд" value={grade} onChange={(e) => setGrade(e.target.value)} />
        <Select value={rate} onChange={(e) => setRate(e.target.value)} options={[{ value: '1', label: 'ставка 1' }, { value: '0.5', label: 'ставка 0.5' }]} />
        <Button variant="secondary" disabled={!ok} onClick={() => {
          void api.createEngineer({
            engineer_id: eid.trim(), team_id: team.trim(), role: role.trim(),
            grade: grade || undefined, capacity_rate: Number(rate),
          })
            .then(() => { markDataEdited(); invalidate(); toast.success(`${eid} добавлен`); setEid(''); setTeam(''); setRole(''); setGrade('') })
            .catch((e) => toast.error(errorTitle(e), { description: errorHint(e) }))
        }}>Добавить</Button>
      </div>
    </div>
  )
}

/* --- Команды --------------------------------------------------------------- */

function TeamsTable({ invalidate }: { invalidate: () => void }) {
  const teamsQuery = useTeams()
  return teamsQuery.error ? (
    <ErrorAlert error={teamsQuery.error} onRetry={() => teamsQuery.refetch()} />
  ) : teamsQuery.isLoading ? (
    <SkeletonRows rows={4} cols={3} />
  ) : (
    <>
      <table className="table">
      <thead>
        <tr><th>Команда</th><th>Инженеров</th><th>Ёмкость SP/спринт</th><th aria-label="Удаление" /></tr>
      </thead>
      <tbody>
        {(teamsQuery.data ?? []).map((tm) => (
          <tr key={tm.team_id}>
            <td className="mono">{tm.team_id}</td>
            <td className="num tabular">{tm.engineers.length}</td>
            <td className="num tabular">—</td>
            <td>
              <DeleteCell label={tm.team_id} onConfirm={async () => {
                try { await api.deleteTeam(tm.team_id); invalidate(); toast.success(`Команда ${tm.team_id} удалена`) }
                catch (err) { toast.error(errorTitle(err), { description: errorHint(err) }) }
              }} />
            </td>
          </tr>
        ))}
      </tbody>
      </table>
      <TeamAdd invalidate={invalidate} />
    </>
  )
}

/** change 053: добавление команды вручную; история velocity задаётся импортом —
 *  без неё команда получает виртуальную ёмкость при планировании. */
function TeamAdd({ invalidate }: { invalidate: () => void }) {
  const [teamId, setTeamId] = useState('')
  const [name, setName] = useState('')
  return (
    <div className="block" style={{ marginTop: 'var(--s-4)' }}>
      <div className="block__head">
        <h3>Добавить команду</h3>
        <span className="section__hint">после создания добавьте инженеров во вкладке «Люди»</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ width: 160, padding: '4px 8px' }} placeholder="team_id *" value={teamId} onChange={(e) => setTeamId(e.target.value)} />
        <input className="input" style={{ width: 220, padding: '4px 8px' }} placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="secondary" disabled={teamId.trim() === ''} onClick={() => {
          void api.createTeam(teamId.trim(), name || undefined)
            .then(() => { markDataEdited(); invalidate(); toast.success(`Команда ${teamId} добавлена`); setTeamId(''); setName('') })
            .catch((e) => toast.error(errorTitle(e), { description: errorHint(e) }))
        }}>Добавить</Button>
      </div>
    </div>
  )
}

/* --- Зависимости ----------------------------------------------------------- */

function DependenciesTable({ invalidate }: { invalidate: () => void }) {
  const depsQuery = useDependencies()
  const tasksQuery = useTasks()
  const known = new Set((tasksQuery.data ?? []).map((t) => t.task_id))
  return depsQuery.error ? (
    <ErrorAlert error={depsQuery.error} onRetry={() => depsQuery.refetch()} />
  ) : depsQuery.isLoading ? (
    <SkeletonRows rows={6} cols={4} />
  ) : (
    <>
      <table className="table">
        <thead>
          <tr><th>Блокирует</th><th>Заблокирована</th><th>Тип</th><th></th></tr>
        </thead>
        <tbody>
          {(depsQuery.data ?? []).map((d, i) => {
            const missing = !known.has(d.blocking_task_id) ? d.blocking_task_id : (!known.has(d.blocked_task_id) ? d.blocked_task_id : null)
            return (
              <tr key={`${d.blocking_task_id}:${d.blocked_task_id}:${i}`}>
                <td className="mono">{d.blocking_task_id}</td>
                <td className="mono">{d.blocked_task_id}</td>
                <td><DependencyTypeCell dep={d} invalidate={invalidate} /></td>
                <td>
                  {missing && <Badge tone="over">планировщик проигнорирует: {missing} не найдена</Badge>}
                  <DeleteCell label={`${d.blocking_task_id} → ${d.blocked_task_id}`} onConfirm={async () => {
                    try { await api.deleteDependency(d.blocking_task_id, d.blocked_task_id); invalidate(); toast.success('Зависимость удалена') }
                    catch (err) { toast.error(errorTitle(err), { description: errorHint(err) }) }
                  }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <DependencyAdd known={[...known]} invalidate={invalidate} />
    </>
  )
}

function DependencyTypeCell({ dep, invalidate }: { dep: Dependency; invalidate: () => void }) {
  return (
    <EditableCell
      value={dep.dependency_type ?? 'depends on'}
      type="text"
      onCommit={(v) => api.updateDependency(dep.blocking_task_id, dep.blocked_task_id, v).then(invalidate)}
    />
  )
}

function DependencyAdd({ invalidate }: { known: string[]; invalidate: () => void }) {
  const [blocking, setBlocking] = useState('')
  const [blocked, setBlocked] = useState('')
  const ok = blocking && blocked && blocking !== blocked
  return (
    <div className="block" style={{ marginTop: 'var(--s-4)' }}>
      <div className="block__head">
        <h3>Добавить зависимость</h3>
        <span className="section__hint">на несуществующую задачу — сохранится с пометкой «планировщик проигнорирует»</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" style={{ width: 160, padding: '4px 8px' }} placeholder="блокирует (task_id)" value={blocking} onChange={(e) => setBlocking(e.target.value)} />
        <span className="muted">→</span>
        <input className="input" style={{ width: 160, padding: '4px 8px' }} placeholder="заблокирована (task_id)" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
        <Button variant="secondary" disabled={!ok} onClick={() => {
          void api.createDependency({ blocking_task_id: blocking, blocked_task_id: blocked })
            .then(() => { invalidate(); toast.success('Зависимость добавлена'); setBlocking(''); setBlocked('') })
            .catch((e) => toast.error(errorTitle(e), { description: errorHint(e) }))
        }}>Добавить</Button>
      </div>
    </div>
  )
}
