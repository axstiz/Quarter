import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { SkeletonRows } from '@/components/ui/States'
import { Layout } from './Layout'

// Страницы грузятся по требованию: первый экран не тянет код остальных разделов
const PlanPage = lazy(() => import('@/features/plan/PlanPage').then((m) => ({ default: m.PlanPage })))
const SprintFactPage = lazy(() => import('@/features/sprint/SprintFactPage').then((m) => ({ default: m.SprintFactPage })))
const TeamMapPage = lazy(() => import('@/features/team-map/TeamMapPage').then((m) => ({ default: m.TeamMapPage })))
const MetricsPage = lazy(() => import('@/features/metrics/MetricsPage').then((m) => ({ default: m.MetricsPage })))
const ImportPage = lazy(() => import('@/features/import/ImportPage').then((m) => ({ default: m.ImportPage })))
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))

const page = (el: ReactNode) => (
  <Suspense
    fallback={
      <div className="content">
        <div className="skeleton" style={{ width: 220, height: 24, marginBottom: 24 }} />
        <SkeletonRows rows={8} cols={5} />
      </div>
    }
  >
    {el}
  </Suspense>
)

export const router = createBrowserRouter([
  { path: '/login', element: page(<LoginPage />) },
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/plan" replace /> },
      { path: '/plan', element: page(<PlanPage />) },
      { path: '/sprint', element: page(<SprintFactPage />) },
      { path: '/team-map', element: page(<TeamMapPage />) },
      { path: '/metrics', element: page(<MetricsPage />) },
      { path: '/import', element: page(<ImportPage />) },
      { path: '*', element: <Navigate to="/plan" replace /> },
    ],
  },
])
