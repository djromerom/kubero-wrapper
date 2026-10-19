import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      usePolling: process.env.VITE_USE_POLLING === 'true',
      interval: 300,
    },
    proxy: {
      '/api': apiTarget,
      '/ws': {
        target: apiTarget.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
})
