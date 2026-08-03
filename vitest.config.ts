import { defineConfig, defaultExclude } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      ...defaultExclude,
      // legacy/ holds read-only clones of the old codebases
      'legacy/**',
      // browser-mode tests run under vitest.browser.config.ts: they need a
      // real browser, and a database test should not pay for starting one
      '**/*.browser.test.tsx',
    ],
  },
})
