import BatchOverviewPage from '../src/client/BatchOverviewPage.tsx'
import BatchSettingsPage from '../src/client/BatchSettingsPage.tsx'
import MyEntriesPage from '../src/client/entry/MyEntriesPage.tsx'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import { lazy, type ReactNode } from 'react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { assessmentApi } from '@qualy/plugin-assessment/client/api'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The workspace around one batch, when the batch is not there for the reader
// and when a screen of it is not theirs (§32.94). Mounted inside the real
// workspace shell wherever what is being asserted is the shell folding or
// the rail, because half of it lives there.

type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']
type Alerts = ApiResult<typeof assessmentApi, 'assessment', 'reviewAlerts'>

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const NODE_ID = '55555555-5555-4555-8555-555555555555'

const batch = (over: Partial<BatchDto> = {}): BatchDto => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: false, manage: true, redetermine: false },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  ...over,
})

const quiet: Alerts = {
  groups: [],
  unreachable: { routes: [], cannotSubmit: 0, cannotAppeal: 0 },
}

type Stub = (...args: never[]) => unknown

const stubs = (over: Record<string, Stub> = {}): Record<string, Stub> => ({
  getBatch: () => Effect.succeed({ batch: batch() }),
  getTimeline: () => Effect.succeed({ timeline: [] }),
  getMyOverview: () => Effect.succeed({ participant: null, reviewer: null }),
  listMyActivity: () => Effect.succeed({ items: [], nextCursor: null }),
  reviewAlerts: () => Effect.succeed(quiet),
  listParticipantPlacements: () =>
    Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
  previewAccessSync: () =>
    Effect.succeed({ items: [], nextCursor: null, pendingTotal: 0, lapsedTotal: 0 }),
  listMyEntries: () => Effect.succeed({ items: [], nextCursor: null }),
  // the switch in the bar above the rail, which reads the list only when opened
  listBatches: () =>
    Effect.succeed({ items: [], nextCursor: null, total: 0, capabilities: { create: false } }),
  ...over,
})

const text = (value: string) => ({ kind: 'literal' as const, value })
const railEntry = (id: string, pageId: string, path: string, label: string, order: number) => ({
  id,
  label: text(label),
  target: { kind: 'page', pageId, path },
  capability: 'assessment/manage',
  order,
})

const PAGES = [
  { id: 'assessment/batches', path: '/assessment/batches' },
  { id: 'assessment/batch', path: '/assessment/batches/:batchId' },
  { id: 'assessment/batch-items', path: '/assessment/batches/:batchId/items' },
  { id: 'assessment/batch-phases', path: '/assessment/batches/:batchId/phases' },
  { id: 'assessment/batch-results', path: '/assessment/batches/:batchId/results' },
  { id: 'assessment/batch-access', path: '/assessment/batches/:batchId/access' },
  { id: 'assessment/batch-settings', path: '/assessment/batches/:batchId/settings' },
  { id: 'assessment/batch-my-entries', path: '/assessment/batches/:batchId/my-entries' },
].map((entry) => ({ ...entry, layout: 'admin' }))

const manifest = () => ({
  ...emptyManifest(),
  viewer: 'authenticated' as const,
  pages: PAGES,
  collections: {
    'workspace-shell/navigation': [
      railEntry(
        'assessment/batch-phases/rail',
        'assessment/batch-phases',
        '/assessment/batches/:batchId/phases',
        '阶段安排',
        10,
      ),
      railEntry(
        'assessment/batch-items/rail',
        'assessment/batch-items',
        '/assessment/batches/:batchId/items',
        '项目配置',
        15,
      ),
      railEntry(
        'assessment/batch-results/rail',
        'assessment/batch-results',
        '/assessment/batches/:batchId/results',
        '参评名单',
        20,
      ),
      railEntry(
        'assessment/batch-access/rail',
        'assessment/batch-access',
        '/assessment/batches/:batchId/access',
        '人员权限',
        30,
      ),
    ],
  },
  slots: {
    'workspace-shell/context': [{ id: 'assessment/batch-context', order: 0 }],
  },
})

const registry = {
  slots: {
    'workspace-shell/context': {
      'assessment/batch-context': lazy(() => import('../src/client/batch/BatchContextBar.tsx')),
    },
  },
}

/** one section of the batch inside the shell the workspace really has */
const shelled = (
  route: string,
  over: Record<string, Stub> = {},
  section: { path: string; element: ReactNode } = {
    path: '/assessment/batches/:batchId',
    element: <BatchOverviewPage />,
  },
) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(manifest()) },
      assessment: stubs(over),
    }),
    registry,
    route,
    children: (
      <Routes>
        <Route element={<WorkspaceShell />}>
          <Route path={section.path} element={section.element} />
        </Route>
      </Routes>
    ),
  })

/** the state standing where the pages would have been, when the shell folded */
const absence = () => page.getByTestId('subject-absence')
const stateIn = (seat: Element | null) =>
  seat?.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state')

describe('a batch that is not there for the reader', () => {
  it('folds the workspace away and says so where the page would be', async () => {
    await page.viewport(1280, 800)
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      getBatch: () => Effect.fail(apiError('ASSESSMENT_BATCH_NOT_FOUND')),
    })
    await expect.element(absence()).toBeVisible()
    expect(stateIn(absence().element())).toBe('missing')
    // nothing bound to the batch stays: no rail, no band naming a section
    // of it, and the band above the rail folded rather than taken down
    expect(page.getByTestId('workspace-rail').elements()).toHaveLength(0)
    expect(page.getByTestId('batch-band').elements()).toHaveLength(0)
    await expect.element(page.getByTestId('shell-context')).toHaveAttribute('data-folded', 'true')
    // what another try cannot change offers none, only the way back
    expect(absence().element().querySelectorAll('button')).toHaveLength(0)
    const back = absence().element().querySelector('a[data-way-back]')
    expect(back?.getAttribute('href')).toBe('/assessment/batches')
    // the reader who cannot see it is taken to what happened
    const heading = absence().getByRole('heading', { level: 1 })
    await vi.waitFor(() => expect(document.activeElement).toBe(heading.element()))
  })

  it('knows an address that names no batch without asking the server', async () => {
    await page.viewport(1280, 800)
    const getBatch = vi.fn(() => Effect.succeed({ batch: batch() }))
    await shelled('/assessment/batches/not-a-batch', { getBatch })
    await expect.element(absence()).toBeVisible()
    expect(stateIn(absence().element())).toBe('missing')
    expect(getBatch).not.toHaveBeenCalled()
  })

  it('offers another try when the batch could not be read, and unfolds once it is', async () => {
    await page.viewport(1280, 800)
    let reachable = false
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      getBatch: () =>
        reachable
          ? Effect.succeed({ batch: batch() })
          : Effect.fail(apiError('SERVICE_UNAVAILABLE')),
    })
    await expect.element(absence()).toBeVisible()
    expect(stateIn(absence().element())).toBe('unavailable')
    reachable = true
    await absence().getByRole('button', { name: '重试' }).click()
    await expect.element(page.getByTestId('batch-band')).toBeVisible()
    expect(page.getByTestId('subject-absence').elements()).toHaveLength(0)
    await expect.element(page.getByTestId('workspace-rail')).toBeInTheDocument()
  })

  it('draws no band for a section of nothing where no shell folds for it', async () => {
    await page.viewport(1280, 800)
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(manifest()) },
        assessment: stubs({ getBatch: () => Effect.fail(apiError('ASSESSMENT_BATCH_NOT_FOUND')) }),
      }),
      route: `/assessment/batches/${BATCH_ID}`,
      routes: [{ path: '/assessment/batches/:batchId', element: <BatchOverviewPage /> }],
    })
    const state = page.getByRole('heading', { level: 1 })
    await expect.element(state).toBeVisible()
    const seat = state.element().closest('[data-slot="resource-state"]')
    expect(seat?.getAttribute('data-state')).toBe('missing')
    expect(seat?.getAttribute('data-size')).toBe('page')
    expect(page.getByTestId('batch-band').elements()).toHaveLength(0)
  })
})

describe('a screen of the batch that is not for the reader', () => {
  it('tells somebody not on the roster so on their own filings, and asks for none', async () => {
    await page.viewport(1280, 800)
    const listMyEntries = vi.fn(() => Effect.succeed({ items: [], nextCursor: null }))
    await shelled(
      `/assessment/batches/${BATCH_ID}/my-entries`,
      { listMyEntries },
      { path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> },
    )
    const answer = page.getByTestId('batch-standing-missing')
    await expect.element(answer).toBeVisible()
    await expect.element(answer).toHaveAttribute('data-requires', 'personal')
    // one pane's answer inside a workspace that is still there, with the way
    // to the round's front page rather than a retry
    const state = answer.element().querySelector('[data-slot="resource-state"]')
    expect(state?.getAttribute('data-state')).toBe('denied')
    expect(state?.getAttribute('data-size')).toBe('section')
    expect(answer.element().querySelectorAll('button')).toHaveLength(0)
    expect(answer.element().querySelector('a[data-way-back]')?.getAttribute('href')).toBe(
      `/assessment/batches/${BATCH_ID}`,
    )
    await expect.element(page.getByTestId('workspace-rail')).toBeInTheDocument()
    expect(listMyEntries).not.toHaveBeenCalled()
  })

  it('tells somebody who does not manage the round so on its settings', async () => {
    await page.viewport(1280, 800)
    await shelled(
      `/assessment/batches/${BATCH_ID}/settings`,
      {
        getBatch: () =>
          Effect.succeed({
            batch: batch({
              manageable: false,
              capabilities: {
                personal: true,
                review: false,
                record: false,
                manage: false,
                redetermine: false,
              },
            }),
          }),
      },
      { path: '/assessment/batches/:batchId/settings', element: <BatchSettingsPage /> },
    )
    await expect
      .element(page.getByTestId('batch-standing-missing'))
      .toHaveAttribute('data-requires', 'manage')
    expect(page.getByRole('textbox').elements()).toHaveLength(0)
  })
})
