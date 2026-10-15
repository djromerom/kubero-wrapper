import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      usePolling: process.env.VITE_USE_POLLING === 'true',
      interval: 300,
    },
    proxy: {
      '/api': process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
      '/ws': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
