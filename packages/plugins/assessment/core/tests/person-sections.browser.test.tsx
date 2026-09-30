import UserDetailShell from '@qualy/plugin-layout-default/client/UserDetailShell'
import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// How much this plugin holds about a person, beside the sections of their
// record that hold it: counted in the shell the record really opens in, so
// what the slot hands its badge is what the badge reads.

const USER_ID = '88888888-8888-4888-8888-888888888888'

const text = (value: string) => value
const section = (id: string, pageId: string, path: string, label: string, order: number) => ({
  id,
  label: text(label),
  target: { kind: 'page', pageId, path },
  group: 'assessment/user-detail',
  order,
})

const manifest = () => ({
  ...emptyManifest(),
  viewer: 'authenticated' as const,
  pages: [
    { id: 'assessment/user-batches', path: '/organization/users/:userId/assessment/batches' },
    { id: 'assessment/user-entries', path: '/organization/users/:userId/assessment/entries' },
  ].map((entry) => ({ ...entry, layout: 'user-detail-shell/v1' })),
  collections: {
    'app-shell/navigation-groups': [
      { id: 'assessment/user-detail', label: text('测评'), order: 20 },
    ],
    'iam/user-detail-navigation': [
      section(
        'assessment/user-batches/rail',
        'assessment/user-batches',
        '/organization/users/:userId/assessment/batches',
        '参评批次',
        10,
      ),
      section(
        'assessment/user-entries/rail',
        'assessment/user-entries',
        '/organization/users/:userId/assessment/entries',
        '申报记录',
        20,
      ),
    ],
  },
  slots: {
    'user-detail-shell/navigation-badge': [{ id: 'assessment/person-sections', order: 0 }],
  },
})

const registry = {
  slots: {
    'user-detail-shell/navigation-badge': {
      'assessment/person-sections': lazy(() => import('../src/client/person/SectionBadge.tsx')),
    },
  },
}

const ids = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `99999999-9999-4999-8999-${String(index).padStart(12, '0')}`,
  )
const memberships = (count: number) =>
  ids(count).map((id) => ({
    batch: {
      id,
      name: `综测 ${id.slice(-2)}`,
      status: 'active' as const,
      materialRange: { start: '2025-03-01', end: '2025-09-01' },
      timezone: 'Asia/Shanghai',
      currentPhaseId: null,
      currentPhaseName: null,
      manageable: false,
    },
    membership: {
      status: 'active' as const,
      includedAt: '2025-09-04T01:00:00.000Z',
      excludedAt: null,
      anchorNodeName: '软件学院',
    },
  }))
const claims = (count: number) =>
  ids(count).map((id) => ({
    id,
    batchId: '11111111-1111-4111-8111-111111111111',
    batchName: '2026 春季综测',
    itemId: '44444444-4444-4444-8444-444444444444',
    itemTitle: 'CET-6',
    status: 'approved' as const,
    source: 'self' as const,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  }))

describe('the sections of a person’s record this plugin holds', () => {
  it.each([
    ['down the side of a wide window', 1280, 800],
    ['across the head of a phone', 390, 844],
  ] as const)('counts each beside its entry %s', async (_where, wide, high) => {
    await page.viewport(wide, high)
    try {
      await renderScreen({
        client: fakeClient({
          app: { getManifest: () => Effect.succeed(manifest()) },
          assessment: {
            listUserBatches: () => Effect.succeed({ items: memberships(3), nextCursor: null }),
            // a full page reads as at least that many
            listUserEntries: () => Effect.succeed({ items: claims(20), nextCursor: 'more' }),
          },
        }),
        registry,
        routes: [{ path: '/organization/users/:userId/*', element: <UserDetailShell /> }],
        route: `/organization/users/${USER_ID}/assessment/batches`,
      })
      const counted = () => [
        ...document.querySelectorAll<HTMLElement>('[data-testid="person-section-count"]'),
      ]
      // the counts wait on two reads and the shell's lazy sections
      await expect.poll(() => counted().length, { timeout: 5_000 }).toBe(2)
      const bySection = new Map(counted().map((badge) => [badge.dataset['section'], badge]))
      expect(bySection.get('batches')?.dataset['count']).toBe('3')
      expect(bySection.get('entries')?.dataset['count']).toBe('20')
      // each beside the entry it counts for
      expect(bySection.get('batches')?.closest('a')?.textContent).toContain('参评批次')
      expect(bySection.get('entries')?.closest('a')?.textContent).toContain('申报记录')
    } finally {
      await page.viewport(1280, 800)
    }
  })
})
