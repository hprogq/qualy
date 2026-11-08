import type { ScreenBudget } from '../../packages/build/web/src/chunk-graph.ts'

// What a server-drawn document loads (docs/adr/0012-rsc-data-mode.md): the
// entry and what it imports, the document's own client components, then
// the page and the one layout it stands in - the html names exactly those,
// where the page-rendered build waited for every layout the manifest named
// - then the slots that layout draws for this viewer.

/** the document's own client components, which every document's html asks for */
export const DOCUMENT_HOST_MODULES = [
  'apps/web/src/rsc/Document.tsx',
  'apps/web/src/rsc/html-document.tsx',
  'apps/web/src/rsc/route-error.tsx',
  'apps/web/src/rsc/frames.tsx',
]

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

// Brotli q11 per JS file. Requests: baseline + max(5, ceil(5%)); bytes:
// +10%, rounded up to 5 KiB (ADR 0011). Baselines measured 2026-11-08 on
// the server-drawn build, pooled as the page-rendered one was
// (chunk-pools.ts): login 61 / 390345, batches 85 / 449342, batch-overview
// 83 / 434414, my-entries 113 / 526976, org-tree 75 / 421652 (JS requests /
// Brotli bytes). The requests are the page-rendered build's within four;
// the bytes 7-10% more, the server-drawn router and the Flight client.
export const documentBudgets: readonly ScreenBudget[] = [
  {
    name: 'login',
    surfaces: ['page:auth/login', 'layout:blank-shell/v1', 'login:local'],
    requests: 66,
    brotli: 420 * 1024,
    small1: 23,
    small2: 26,
  },
  {
    name: 'batches',
    surfaces: ['page:assessment/batches', 'layout:app-shell/v1'],
    slots: TOP_BAR_SLOTS,
    requests: 90,
    brotli: 485 * 1024,
    small1: 27,
    small2: 38,
  },
  {
    name: 'batch-overview',
    surfaces: ['page:assessment/batch', 'layout:workspace-shell/v1'],
    slots: [BATCH_CONTEXT, ...STAFF_BADGES, ...RAIL_SLOTS],
    requests: 88,
    brotli: 470 * 1024,
    small1: 29,
    small2: 38,
  },
  {
    name: 'my-entries',
    surfaces: ['page:assessment/batch-my-entries', 'layout:workspace-shell/v1'],
    slots: [BATCH_CONTEXT, ...RAIL_SLOTS],
    requests: 119,
    brotli: 570 * 1024,
    small1: 39,
    small2: 53,
  },
  {
    name: 'org-tree',
    surfaces: ['page:org/page', 'layout:app-shell/v1'],
    slots: TOP_BAR_SLOTS,
    requests: 80,
    brotli: 455 * 1024,
    small1: 28,
    small2: 34,
  },
]

// The entry alone, measured 2026-11-08 at 70184 Brotli bytes; +10% rounded up
// to 1 KiB.
export const documentEntryBrotliBudget = 76 * 1024
// Everything the entry imports, measured 2026-11-08 at 217370; same rule.
export const documentBootBrotliBudget = 234 * 1024
