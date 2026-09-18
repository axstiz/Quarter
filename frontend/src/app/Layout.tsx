import { AnimatePresence, motion } from 'motion/react'
import { BarChart3, CalendarRange, ClipboardCheck, LogOut, Menu, Moon, Sparkles, Sun, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { USE_MOCKS } from '@/api/client'
import { useCurrentPlanId, useFacts, usePlanVersions } from '@/api/queries'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { formatDateTime } from '@/lib/format'
import { versionLabel } from '@/lib/labels'
import { t } from '@/lib/motion'
import { useTheme } from './theme'

const NAV = [
  { to: '/plan', label: 'План квартала', icon: CalendarRange },
  { to: '/sprint', label: 'Факт спринта', icon: ClipboardCheck },
  { to: '/team-map', label: 'Звёздная карта', icon: Sparkles },
  { to: '/metrics', label: 'Метрики', icon: BarChart3 },
]

export function Layout() {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="app">
      <Sidebar open={menuOpen} />
      <AnimatePresence>
        {menuOpen && (
          <motion.div className="panel-scrim" style={{ zIndex: 59 }} onClick={() => setMenuOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: t.base }} exit={{ opacity: 0, transition: t.fast }} />
        )}
      </AnimatePresence>
      <div className="main">
        <header className="topbar">
          <Button className="topbar__menu" variant="ghost" iconOnly icon={<Menu />} aria-label="Открыть меню" onClick={() => setMenuOpen(true)} />
          <PlanVersionSelect />
          <div className="topbar__spacer" />
          <QuarterStrip />
        </header>
        {/* Смена раздела: короткое проявление контента. Выход мгновенный — навигация не должна ждать анимацию. */}
        <motion.main key={location.pathname} className="page-wrap" initial={{ opacity: 0, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', transition: t.base }} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Outlet />
        </motion.main>
      </div>
    </div>
  )
}

function Sidebar({ open }: { open: boolean }) {
  const [params] = useSearchParams()
  const { theme, toggle } = useTheme()
  const plan = params.get('plan')
  const search = plan ? `?plan=${plan}` : ''

  return (
    <aside className="sidebar" data-open={open} aria-label="Навигация">
      <div className="brand">
        <img className="brand__mark" src="/favicon.svg" alt="" />
        <div>
          <div className="brand__name">Квартал</div>
          <div className="brand__sub">планирование команд</div>
        </div>
      </div>
      <nav className="nav">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={{ pathname: to, search }} className="nav__item">
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="nav-active" className="nav__active" transition={t.layout} />}
                <Icon aria-hidden />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar__footer">
        <NavLink to="/import" className="nav__item">
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="nav-active" className="nav__active" transition={t.layout} />}
              <Upload aria-hidden />
              <span>Загрузка данных</span>
            </>
          )}
        </NavLink>
        <Link to="/login" className="nav__item">
          <LogOut aria-hidden />
          <span>Выйти</span>
        </Link>
        <div className="sidebar__meta">
          <span className="muted" style={{ fontSize: 'var(--text-2xs)' }} title={USE_MOCKS ? 'VITE_API_MOCKS=true — данные из src/mocks' : 'Данные из /api/v1'}>
            {USE_MOCKS ? 'Мок-данные' : 'API подключён'}
          </span>
          <Button variant="ghost" size="sm" iconOnly icon={theme === 'dark' ? <Sun /> : <Moon />} onClick={toggle} aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} />
        </div>
      </div>
    </aside>
  )
}

/** Какую версию плана смотрим. По умолчанию — последнюю; старые только на чтение. */
function PlanVersionSelect() {
  const versions = usePlanVersions()
  const current = useCurrentPlanId()
  const [, setParams] = useSearchParams()
  const list = versions.data ?? []
  if (!list.length) return null
  const latest = list.at(-1)!.plan_id

  const select = (id: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id === latest) next.delete('plan')
      else next.set('plan', id)
      next.delete('task')
      return next
    })

  return (
    <>
      <Select
        size="sm"
        width={340}
        aria-label="Версия плана"
        value={current ?? ''}
        onChange={(e) => select(e.target.value)}
        options={[...list].reverse().map((v) => ({
          value: v.plan_id,
          label: `${v.plan_id === latest ? '● ' : ''}${versionLabel(v)} · ${formatDateTime(v.created_at)}`,
        }))}
      />
      <AnimatePresence>
        {current && current !== latest && (
          <motion.span initial={{ opacity: 0, transform: 'translateX(-4px)' }} animate={{ opacity: 1, transform: 'translateX(0px)', transition: t.base }} exit={{ opacity: 0, transition: t.fast }}>
            <Button size="sm" variant="ghost" onClick={() => select(latest)}>
              Старая версия — к актуальной
            </Button>
          </motion.span>
        )}
      </AnimatePresence>
    </>
  )
}

/** Сквозной индикатор квартала: по каким спринтам загружен факт, какой следующий. */
function QuarterStrip() {
  const planId = useCurrentPlanId()
  const facts = useFacts(planId)
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  if (!planId) return null
  const loaded = new Set(facts.data?.map((f) => f.sprint_no))
  const next = [1, 2, 3, 4, 5, 6].find((n) => !loaded.has(n))
  const plan = params.get('plan')
  // Выбранный спринт показываем только там, где он выбран — на странице факта
  const selected = pathname === '/sprint' ? Number(params.get('sprint')) || next || 6 : null

  return (
    <div className="quarter">
      <span className="quarter__label">Квартал</span>
      <ol className="quarter__track" aria-label="Спринты квартала">
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const state = loaded.has(n) ? 'done' : n === next ? 'next' : 'future'
          const status = state === 'done' ? 'факт загружен' : state === 'next' ? 'следующий к загрузке факта' : 'факт ещё не загружен'
          const title = `Спринт ${n}: ${status}`
          return (
            <li key={n} style={{ display: 'contents' }}>
            <Link
              className="quarter__cell"
              data-state={state}
              aria-current={selected === n ? 'page' : undefined}
              to={`/sprint?sprint=${n}${plan ? `&plan=${plan}` : ''}`}
              title={title}
              aria-label={title}
              style={{ textDecoration: 'none' }}
            >
              {n}
            </Link>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
