import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Kept separate from vite.config.js so the production build config is
// untouched by test settings. The `@` alias mirrors the app's, and the React
// plugin supplies the automatic JSX runtime for component tests.
export default defineConfig({
  plugins: [react()],
  // Use the automatic JSX runtime everywhere, so test files render components
  // without importing React themselves (matching the app's own build).
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // The scan pipeline's only DOM dependency (canvas rasterization) is stubbed
    // in the tests, so a full DOM environment is unnecessary.
    environment: 'node',
    // Component tests opt into jsdom per file with a
    // `// @vitest-environment jsdom` docblock — jsdom startup is slow, so the
    // pure-logic suites stay on the node default.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Node 24+ defines a localStorage global of its own, which shadows jsdom's.
    // See vitest.setup.js.
    setupFiles: ['./vitest.setup.js'],
    clearMocks: true,
    testTimeout: 15000,
  },
})
