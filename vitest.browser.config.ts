import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Component tests run in a real browser rather than a simulated dom. What
// this project's screens actually get wrong lives in the gap between the
// two: router navigation, focus, native form submission, <dialog>, lazy
// chunks and the query string. Everything else — services, contracts,
// authorization — stays in the node suite, which must not pay for a browser.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // one react instance for the host and every plugin component
    dedupe: ['react', 'react-dom'],
  },
  test: {
    include: ['apps/web/tests/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
  },
})
