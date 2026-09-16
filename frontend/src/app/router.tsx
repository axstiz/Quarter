import { createBrowserRouter, Navigate } from 'react-router-dom'
import { LoginPage } from '@/features/auth/LoginPage'
import { MetricsPage } from '@/features/metrics/MetricsPage'
import { PlanPage } from '@/features/plan/PlanPage'
import { SprintPage } from '@/features/sprint/SprintPage'
import { StarMapPage } from '@/features/star-map/StarMapPage'
import { AppLayout } from './AppLayout'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/plan" replace /> },
      { path: '/plan', element: <PlanPage /> },
      { path: '/sprint', element: <SprintPage /> },
      { path: '/star-map', element: <StarMapPage /> },
      { path: '/metrics', element: <MetricsPage /> },
      { path: '*', element: <Navigate to="/plan" replace /> },
    ],
  },
])
