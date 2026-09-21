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
const WorkspaceSelectPage = lazy(() => import('@/features/workspace/WorkspaceSelectPage').then((m) => ({ default: m.WorkspaceSelectPage })))
const DataPage = lazy(() => import('@/features/data/DataPage').then((m) => ({ default: m.DataPage })))

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
      // онбординг (021): первый экран — выбор рабочего пространства, всегда
      { index: true, element: <Navigate to="/workspaces" replace /> },
      { path: '/workspaces', element: page(<WorkspaceSelectPage />) },
      { path: '/plan', element: page(<PlanPage />) },
      { path: '/sprint', element: page(<SprintFactPage />) },
      { path: '/team-map', element: page(<TeamMapPage />) },
      { path: '/metrics', element: page(<MetricsPage />) },
      { path: '/import', element: page(<ImportPage />) },
      { path: '/data', element: page(<DataPage />) },
      { path: '*', element: <Navigate to="/workspaces" replace /> },
    ],
  },
])
