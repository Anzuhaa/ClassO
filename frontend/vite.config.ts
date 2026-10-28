import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config: React fast-refresh + a dev proxy that forwards /v1 and /healthz
// to the Go backend so the frontend can use same-origin API calls in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
})