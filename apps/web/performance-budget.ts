import type { ScreenBudget } from '../../packages/build/web/src/chunk-graph.ts'

// Measured 2026-10-01, Brotli q11 per JS file; see ADR 0011.
// Requests: baseline + max(5, ceil(5%)); bytes: +10%, rounded up to 5 KiB.
export const screenBudgets: readonly ScreenBudget[] = [
  {
    name: 'login',
    surfaces: ['page:auth/login', 'layout:blank-shell/v1', 'login:local'],
    requests: 72,
    brotli: 340 * 1024,
    small1: 39,
    small2: 45,
  },
  {
    name: 'batches',
    surfaces: ['page:assessment/batches', 'layout:app-shell/v1'],
    requests: 108,
    brotli: 400 * 1024,
    small1: 52,
    small2: 66,
  },
  {
    name: 'my-entries',
    surfaces: ['page:assessment/batch-my-entries', 'layout:workspace-shell/v1'],
    requests: 138,
    brotli: 470 * 1024,
    small1: 72,
    small2: 87,
  },
  {
    name: 'org-tree',
    surfaces: ['page:org/page', 'layout:app-shell/v1'],
    requests: 97,
    brotli: 375 * 1024,
    small1: 55,
    small2: 61,
  },
]
export const entryBrotliBudget = 62 * 1024
export const messagePoolBytes = 48 * 1024
