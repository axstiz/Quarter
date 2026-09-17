import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { router } from './app/router'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // 4xx — осмысленный ответ бэка, повторять незачем
      retry: (count, err) => count < 1 && !(err && 'status' in err && Number(err.status) < 500),
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* reducedMotion="user": при prefers-reduced-motion Motion отключает перемещения, оставляя прозрачность */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
        <Toaster position="bottom-right" closeButton duration={4500} gap={8} />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)
