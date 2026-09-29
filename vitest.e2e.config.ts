import { defineConfig } from 'vitest/config'

// The end-to-end journeys (tools/e2e): a real browser against a whole
// deployment on this machine, started by `node tools/quality/e2e-stack.ts up`.
// One file at a time and one journey at a time - they share one deployment
// and its data, and a journey that files a claim changes what the next one
// sees. Slow on purpose: they sign in, wait for real requests and a real
// sandbox, and a timeout here says the product was slow, not the test.
export default defineConfig({
  test: {
    include: ['tools/e2e/**/*.journey.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
})
