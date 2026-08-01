import { defineConfig, defaultExclude } from 'vitest/config'

export default defineConfig({
  test: {
    // legacy/ holds read-only clones of the old codebases for migration
    // reference; their test suites must never run here
    exclude: [...defaultExclude, 'legacy/**'],
  },
})
