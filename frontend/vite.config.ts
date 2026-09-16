import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': '/src' } },
  server: {
    // Реальный бэк: uv run uvicorn src.main:app --reload (порт 8000)
    proxy: { '/api': 'http://localhost:8000' },
  },
})
