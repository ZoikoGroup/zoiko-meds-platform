/* global process */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { platformDefines } from './platform-defines.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // Build-time platform gates (see platform-defines.js). Replaced as literal
  // text, so a gated-off route group is removed from the bundle outright.
  define: platformDefines(loadEnv(mode, process.cwd(), 'VITE_')),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/internal': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/internal/, '/api'),
      },
    },
  },
}))
