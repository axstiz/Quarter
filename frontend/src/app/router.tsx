import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { SkeletonRows } from '@/components/ui/States'
import { Layout } from './Layout'
import { useDatasetLoaded } from '@/api/queries'

// Страницы грузятся по требованию: первый экран не тянет код остальных разделов
const PlanPage = lazy(() => import('@/features/plan/PlanPage').then((m) => ({ default: m.PlanPage })))
const SprintFactPage = lazy(() => import('@/features/sprint/SprintFactPage').then((m) => ({ default: m.SprintFactPage })))
const TeamMapPage = lazy(() => import('@/features/team-map/TeamMapPage').then((m) => ({ default: m.TeamMapPage })))
const MetricsPage = lazy(() => import('@/features/metrics/MetricsPage').then((m) => ({ default: m.MetricsPage })))
const ImportPage = lazy(() => import('@/features/import/ImportPage').then((m) => ({ default: m.ImportPage })))
const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const WorkspaceSelectPage = lazy(() => import('@/features/workspace/WorkspaceSelectPage').then((m) => ({ default: m.WorkspaceSelectPage })))
const DataPage = lazy(() => import('@/features/data/DataPage').then((m) => ({ default: m.DataPage })))

/** change 035: воркспейс полностью отделён — планирование закрыто до загрузки датасета. */
function RequireDataset({ children }: { children: ReactNode }) {
  const status = useDatasetLoaded()
  if (status.isPending) {
    return (
      <div className="content">
        <div className="skeleton" style={{ width: 220, height: 24, marginBottom: 24 }} />
        <SkeletonRows rows={8} cols={5} />
      </div>
    )
  }
  if (status.error) {
    return (
      <div className="content">
        <p style={{ color: 'var(--ink-2)' }}>Не удалось проверить состояние датасета.</p>
        <a href="/data" className="btn btn--secondary" style={{ textDecoration: 'none' }}>Перейти к «Данные»</a>
      </div>
    )
  }
  if (!status.data?.dataset_loaded) return <Navigate to="/data" replace />
  return children
}

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
      { path: '/plan', element: <RequireDataset>{page(<PlanPage />)}</RequireDataset> },
      { path: '/sprint', element: <RequireDataset>{page(<SprintFactPage />)}</RequireDataset> },
      { path: '/team-map', element: <RequireDataset>{page(<TeamMapPage />)}</RequireDataset> },
      { path: '/metrics', element: <RequireDataset>{page(<MetricsPage />)}</RequireDataset> },
      { path: '/import', element: page(<ImportPage />) },
      { path: '/data', element: page(<DataPage />) },
      { path: '*', element: <Navigate to="/workspaces" replace /> },
    ],
  },
])
