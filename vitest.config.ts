import { defineConfig, defaultExclude } from 'vitest/config'

export default defineConfig({
  test: {
    // A suite that touches postgres creates a scratch database and applies the
    // whole lineage to it before its first assertion, and several of them run
    // at once. The 5s default was already close and stopped being enough once
    // the assembly suites joined them; a case that genuinely hangs still fails,
    // just later.
    testTimeout: 30_000,
    exclude: [
      ...defaultExclude,
      // legacy/ holds read-only clones of the old codebases
      'legacy/**',
      // repos/ holds upstream sources vendored at the exact installed version,
      // for reading. Their own suites are not this repository's to run.
      'repos/**',
      // browser-mode tests run under vitest.browser.config.ts: they need a
      // real browser, and a database test should not pay for starting one
      '**/*.browser.test.tsx',
    ],
  },
})
