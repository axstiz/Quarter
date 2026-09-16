import { BarChart3, CalendarRange, ClipboardCheck, GitBranch, LogOut, Menu, Moon, Sparkles, Sun, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { USE_MOCKS } from '@/api/client'
import { useCurrentPlanId, usePlanVersions } from '@/api/queries'
import { cn } from '@/lib/cn'
import { formatDateTime, shortId } from '@/lib/format'
import { ImportProvider, useOpenImport } from './ImportContext'
import { useTheme } from './theme'

const NAV = [
  { to: '/plan', label: 'План квартала', icon: CalendarRange },
  { to: '/sprint', label: 'Факт и пересчёт', icon: ClipboardCheck },
  { to: '/star-map', label: 'Звёздная карта', icon: Sparkles },
  { to: '/metrics', label: 'Метрики', icon: BarChart3 },
]

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMobileOpen(false), [location.pathname])

  return (
    <ImportProvider>
      <div className="flex min-h-full">
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0',
            mobileOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full',
          )}
        >
          <Sidebar onClose={() => setMobileOpen(false)} />
        </aside>
        {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden" onClick={() => setMobileOpen(false)} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2 lg:hidden">
            <button className="rounded-md p-1.5 text-muted hover:bg-surface-2" onClick={() => setMobileOpen(true)} aria-label="Меню">
              <Menu className="size-5" />
            </button>
            <Logo />
          </div>
          <main className="flex min-w-0 flex-1 flex-col">
            <Outlet />
          </main>
        </div>
      </div>
    </ImportProvider>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
        <Sparkles className="size-4" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">Квартал</div>
        <div className="text-[11px] text-muted">планирование команд</div>
      </div>
    </div>
  )
}

function Sidebar({ onClose }: { onClose: () => void }) {
  const [params] = useSearchParams()
  const openImport = useOpenImport()
  const { theme, toggle } = useTheme()
  const planParam = params.get('plan')
  const suffix = planParam ? `?plan=${planParam}` : ''

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <Logo />
        <button className="rounded-md p-1 text-muted hover:bg-surface-2 lg:hidden" onClick={onClose} aria-label="Закрыть меню">
          <X className="size-4" />
        </button>
      </div>

      <nav className="space-y-0.5 px-2 pt-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to + suffix}
            className={({ isActive }) =>
              cn(
                'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition',
                isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <PlanVersions />

      <div className="mt-auto space-y-3 p-3">
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Upload className="size-3.5 text-accent" /> Загрузка данных
          </div>
          <p className="mt-1 text-xs text-muted">xlsx / csv / json — AI сопоставит колонки, вы подтвердите.</p>
          <button onClick={openImport} className="mt-2 text-xs font-semibold text-accent hover:underline">
            Импортировать →
          </button>
        </div>

        <div className="flex items-center justify-between">
          {USE_MOCKS ? (
            <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn" title="VITE_API_MOCKS=true — данные из src/mocks">
              MOCK API
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="size-1.5 rounded-full bg-ok" /> API /api/v1
            </span>
          )}
          <div className="flex items-center gap-0.5">
            <button onClick={toggle} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Сменить тему">
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <NavLink to="/login" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Выйти">
              <LogOut className="size-4" />
            </NavLink>
          </div>
        </div>
      </div>
    </>
  )
}

function PlanVersions() {
  const versions = usePlanVersions()
  const current = useCurrentPlanId()
  const [params, setParams] = useSearchParams()
  const list = versions.data ?? []
  if (!list.length) return null

  const latest = list.at(-1)!.plan_id
  const select = (id: string) => {
    const next = new URLSearchParams(params)
    if (id === latest) next.delete('plan')
    else next.set('plan', id)
    setParams(next)
  }

  return (
    <div className="mt-6 min-h-0 px-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">
        <GitBranch className="size-3" /> Версии плана
      </div>
      <ol className="scroll-thin max-h-56 space-y-0.5 overflow-y-auto">
        {[...list].reverse().map((v) => (
          <li key={v.plan_id}>
            <button
              onClick={() => select(v.plan_id)}
              className={cn(
                'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition',
                v.plan_id === current ? 'bg-surface-2' : 'hover:bg-surface-2/70',
              )}
            >
              <span className={cn('size-2 shrink-0 rounded-full border-2', v.plan_id === current ? 'border-accent bg-accent' : 'border-subtle')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {v.is_initial ? 'Первичный план' : `После спринта ${v.recomputed_after_sprint}`}
                  {v.plan_id === latest && <span className="ml-1.5 text-[11px] font-semibold text-ok">актуальный</span>}
                </span>
                <span className="block truncate font-mono text-[11px] text-subtle">
                  {shortId(v.plan_id)} · {formatDateTime(v.created_at)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
