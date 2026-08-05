import { defineConfig, defaultExclude } from 'vitest/config'

export default defineConfig({
  test: {
    // A suite that touches postgres creates a scratch database and applies the
    // whole lineage to it before its first assertion, and several of them run
    // at once. The 5s default was already close and stopped being enough once
    // the assembly suites joined them; a case that genuinely hangs still fails,
    // just later.
    testTimeout: 30_000,
    // The same reasoning applies to hooks, and this was missed: the lineage is
    // applied in beforeAll, so the work the timeout above was raised for
    // happens under the hook timeout, which stayed at its 10s default. The
    // migration-upgrade suite builds several databases that way and timed out
    // only in a full run, where it competes for postgres with everything else.
    hookTimeout: 30_000,
    // Log output only from the tests that failed.
    //
    // These suites start real servers and apply real migration lineages, and
    // the code doing it logs at info level because in production that is
    // exactly what you want to see. In CI it buried the result: thousands of
    // lines of "Sent HTTP response" and "migrations up to date" around the one
    // failure anybody was looking for. Silencing the logger instead would have
    // meant either threading a log level through every Effect.run* boundary in
    // the suite, or changing what the application logs in order to make its
    // tests quieter.
    silent: 'passed-only',
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
