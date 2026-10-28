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
// the app shell's top bar renders the user menu; a rail shell renders it
// too, and its drawer's three, mounted ahead of being opened
const TOP_BAR_SLOTS = ['slot:app-shell/user-menu:auth/user-menu']
const RAIL_SLOTS = [
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
// Baselines measured 2026-10-28 once the icons, the shells, the shell's
// parts and the overview's unread dot were pooled or split: login 57 /
// 353576, batches 86 / 419153, batch-overview 82 / 403800, my-entries 113 /
// 494234, org-tree 75 / 389593 (JS requests / Brotli bytes).
export const screenBudgets: readonly ScreenBudget[] = [
  {
    name: 'login',
    surfaces: ['page:auth/login', 'layout:blank-shell/v1', 'login:local'],
    requests: 62,
    brotli: 380 * 1024,
    small1: 22,
    small2: 29,
  },
  {
    name: 'batches',
    surfaces: ['page:assessment/batches', ...SIGNED_IN_LAYOUTS],
    slots: TOP_BAR_SLOTS,
    requests: 91,
    brotli: 455 * 1024,
    small1: 28,
    small2: 44,
  },
  {
    name: 'batch-overview',
    surfaces: ['page:assessment/batch', ...STAFF_LAYOUTS],
    slots: [BATCH_CONTEXT, ...STAFF_BADGES, ...RAIL_SLOTS],
    requests: 87,
    brotli: 435 * 1024,
    small1: 28,
    small2: 42,
  },
  {
    name: 'my-entries',
    surfaces: ['page:assessment/batch-my-entries', ...SIGNED_IN_LAYOUTS],
    slots: [BATCH_CONTEXT, ...RAIL_SLOTS],
    requests: 119,
    brotli: 535 * 1024,
    small1: 41,
    small2: 59,
  },
  {
    name: 'org-tree',
    surfaces: ['page:org/page', ...STAFF_LAYOUTS],
    slots: TOP_BAR_SLOTS,
    requests: 80,
    brotli: 420 * 1024,
    small1: 29,
    small2: 39,
  },
]
// Entry re-measured 2026-10-15 at 64256 bytes after React 19.3.0 (react-dom
// grew by about 7 KB Brotli); +10% rounded up to 1 KiB gives 70 KiB (ADR 0011).
export const entryBrotliBudget = 70 * 1024
// Everything the entry imports, measured 2026-10-28 at 262370 bytes; same rule.
export const bootBrotliBudget = 285 * 1024
export const messagePoolBytes = 48 * 1024
