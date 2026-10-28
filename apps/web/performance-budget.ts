import type { ScreenBudget } from '../../packages/build/web/src/chunk-graph.ts'

// What a screen loads, as the runtime asks for it. Once the manifest is in,
// RuntimeLoader waits for every layout the manifest names along with the
// page; the drawn shell then asks for its slots. A signed-in viewer's
// manifest names the blank, app, workspace and account shells, and the user
// detail shell too for anyone who may read other users. The sets were
// checked against what production loaded for the batch overview on
// 2026-10-28.
const SIGNED_IN_LAYOUTS = [
  'layout:blank-shell/v1',
  'layout:app-shell/v1',
  'layout:workspace-shell/v1',
  'layout:account-shell/v1',
]
const STAFF_LAYOUTS = [...SIGNED_IN_LAYOUTS, 'layout:user-detail-shell/v1']
// every shell with a rail or a drawer renders these
const ACCOUNT_SLOTS = [
  'slot:app-shell/user-menu:auth/user-menu',
  'slot:app-shell/drawer-identity:auth/drawer-identity',
  'slot:app-shell/drawer-account:auth/drawer-account',
  'slot:app-shell/drawer-sign-out:auth/drawer-sign-out',
]
const BATCH_CONTEXT = 'slot:workspace-shell/context:assessment/batch-context'
const STAFF_BADGES = [
  'slot:workspace-shell/navigation-badge:assessment/batch-admin-alerts',
  'slot:workspace-shell/navigation-badge:assessment/reviews-waiting',
]

// Brotli q11 per JS file; see ADR 0011 and docs/notes/web-performance.md.
// Requests: baseline + max(5, ceil(5%)); bytes: +10%, rounded up to 5 KiB.
// Measured 2026-10-28, the others with their layouts and slots. Login was
// re-measured when the shell's parts were pooled, which traded three of its
// requests for 3.5 KB: 56 requests, 350800 bytes.
export const screenBudgets: readonly ScreenBudget[] = [
  {
    name: 'login',
    surfaces: ['page:auth/login', 'layout:blank-shell/v1', 'login:local'],
    requests: 61,
    brotli: 380 * 1024,
    small1: 22,
    small2: 29,
  },
  {
    name: 'batches',
    surfaces: ['page:assessment/batches', ...SIGNED_IN_LAYOUTS],
    slots: ACCOUNT_SLOTS,
    requests: 139,
    brotli: 465 * 1024,
    small1: 67,
    small2: 88,
  },
  {
    name: 'batch-overview',
    surfaces: ['page:assessment/batch', ...STAFF_LAYOUTS],
    slots: [BATCH_CONTEXT, ...STAFF_BADGES, ...ACCOUNT_SLOTS],
    requests: 136,
    brotli: 450 * 1024,
    small1: 63,
    small2: 84,
  },
  {
    name: 'my-entries',
    surfaces: ['page:assessment/batch-my-entries', ...SIGNED_IN_LAYOUTS],
    slots: [BATCH_CONTEXT, ...ACCOUNT_SLOTS],
    requests: 173,
    brotli: 540 * 1024,
    small1: 84,
    small2: 107,
  },
  {
    name: 'org-tree',
    surfaces: ['page:org/page', ...STAFF_LAYOUTS],
    slots: ACCOUNT_SLOTS,
    requests: 129,
    brotli: 430 * 1024,
    small1: 71,
    small2: 84,
  },
]
// Entry re-measured 2026-10-15 at 64256 bytes after React 19.3.0 (react-dom
// grew by about 7 KB Brotli); +10% rounded up to 1 KiB gives 70 KiB (ADR 0011).
export const entryBrotliBudget = 70 * 1024
// Everything the entry imports, measured 2026-10-28 at 265580 bytes; same rule.
export const bootBrotliBudget = 290 * 1024
export const messagePoolBytes = 48 * 1024
