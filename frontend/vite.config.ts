import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': '/src' } },
  server: {
    // Реальный бэк: uv run uvicorn src.main:app --reload (порт 8000).
    // auth/workspaces/permissions монтируются на корне бэка — проксируем группу префиксов.
    proxy: {
      '/api': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/workspaces': 'http://localhost:8000',
      '/permissions': 'http://localhost:8000',
    },
  },
})
