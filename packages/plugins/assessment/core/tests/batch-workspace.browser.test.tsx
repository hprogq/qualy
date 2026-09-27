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
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The workspace around one batch, when the batch is not there for the reader
// and when a screen of it is not theirs (§32.96); and the overview's lane for
// whoever administers it, with the dots beside the rail entries it points at
// (§32.97). Mounted inside the real workspace shell wherever what is being
// asserted is the shell folding or the rail, because half of it lives there.

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

/** a round with something stopped in each of the ways an administrator mends */
const stopped: Alerts = {
  groups: [
    {
      nodeId: NODE_ID,
      nodeName: '软件2401',
      unitPath: ['软件学院', '软件2401'],
      roleIds: [],
      roleNames: ['班长', '学习委员'],
      reason: 'no-assignee',
      waiting: 3,
    },
    {
      nodeId: null,
      nodeName: null,
      unitPath: [],
      roleIds: [],
      roleNames: ['辅导员'],
      reason: 'no-assignee',
      waiting: 2,
    },
  ],
  unreachable: {
    routes: [
      {
        itemId: 'item-a',
        itemTitle: '学业成绩',
        route: 'normal',
        participants: 1,
        levelNames: ['班级'],
      },
      {
        itemId: 'item-b',
        itemTitle: '竞赛获奖',
        route: 'escalation',
        participants: 4,
        levelNames: ['年级'],
      },
    ],
    cannotSubmit: 1,
    cannotAppeal: 4,
  },
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
    'workspace-shell/navigation-badge': [{ id: 'assessment/batch-admin-alerts', order: 0 }],
  },
})

const registry = {
  slots: {
    'workspace-shell/context': {
      'assessment/batch-context': lazy(() => import('../src/client/batch/BatchContextBar.tsx')),
    },
    'workspace-shell/navigation-badge': {
      'assessment/batch-admin-alerts': lazy(
        () => import('../src/client/batch/AdminAlertBadge.tsx'),
      ),
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

describe('the administration lane of the overview', () => {
  const lane = () => document.querySelectorAll('[data-testid="overview-lane"][data-lane="manage"]')
  const row = (action: string) =>
    page.getByTestId('overview-actions').element().querySelector(`[data-action="${action}"]`)

  it('lists what stops the round, one line each with the way to mend it', async () => {
    await page.viewport(1280, 800)
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      reviewAlerts: () => Effect.succeed(stopped),
      listParticipantPlacements: () =>
        Effect.succeed({ items: [], nextCursor: null, changedTotal: 2, unavailableTotal: 1 }),
      previewAccessSync: () =>
        Effect.succeed({ items: [], nextCursor: null, pendingTotal: 3, lapsedTotal: 0 }),
    })
    await expect.element(page.getByTestId('overview-actions')).toBeVisible()
    const strip = page
      .getByTestId('overview-actions')
      .element()
      .querySelector('[data-testid="overview-lane"][data-lane="manage"]')
    expect(strip?.getAttribute('data-count')).toBe('5')
    expect(row('admin-review-gap')?.getAttribute('data-count')).toBe('5')
    // who cannot submit and who cannot appeal, each on a line of their own
    expect(row('admin-unreachable')?.getAttribute('data-count')).toBe('1')
    expect(row('admin-unappealable')?.getAttribute('data-count')).toBe('4')
    expect(row('admin-placements')?.getAttribute('data-count')).toBe('2')
    expect(row('admin-access')?.getAttribute('data-count')).toBe('3')
    // an administrator with nothing of their own here has no story to follow
    expect(page.getByTestId('overview-activity').elements()).toHaveLength(0)
    expect(page.getByTestId('activity-bones').elements()).toHaveLength(0)
    // each row goes to the page that mends it
    const verb = row('admin-access')!.querySelector('button')!
    verb.click()
    await vi.waitFor(() => expect(addressNow()).toBe(`/assessment/batches/${BATCH_ID}/access`))
  })

  // An ordinary route that misses somebody stops them filing; an escalation
  // route that misses them only stops an appeal. Said as one line, a
  // question people can file into read as one they cannot, and the people
  // who cannot appeal went unsaid.
  it('tells the questions nobody can file into from the ones nobody can appeal', async () => {
    await page.viewport(1280, 800)
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      reviewAlerts: () =>
        Effect.succeed({
          groups: [],
          unreachable: {
            routes: [
              ...stopped.unreachable.routes,
              {
                itemId: 'item-c',
                itemTitle: '社会实践',
                route: 'normal',
                participants: 2,
                levelNames: ['班级'],
              },
              {
                itemId: 'item-c',
                itemTitle: '社会实践',
                route: 'escalation',
                participants: 2,
                levelNames: ['年级'],
              },
            ],
            cannotSubmit: 2,
            cannotAppeal: 5,
          },
        }),
    })
    await expect.element(page.getByTestId('overview-actions')).toBeVisible()
    const itemsOf = (action: string) => row(action)?.getAttribute('data-items')?.split(' ')
    expect(row('admin-unreachable')?.getAttribute('data-count')).toBe('2')
    expect(itemsOf('admin-unreachable')).toEqual(['item-a', 'item-c'])
    expect(row('admin-unappealable')?.getAttribute('data-count')).toBe('5')
    expect(itemsOf('admin-unappealable')).toEqual(['item-b', 'item-c'])
  })

  // Past three names a row says how many there are, and says it first: at
  // the end of a line cut short at two, the count was the part cut off.
  it('keeps how many there are in sight when the names run past two lines', async () => {
    await page.viewport(1024, 768)
    const units = ['一', '二', '三', '四', '五', '六', '七', '九'].map((at) => `软件工程${at}班`)
    const titles = [
      '前三学年平均学分绩与专业排名',
      '学科竞赛获奖（国家级及以上）',
      '社会实践与志愿服务',
      '学生干部任职',
      '科研论文发表',
      '创新创业项目',
      '文体活动获奖',
    ]
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      reviewAlerts: () =>
        Effect.succeed({
          groups: units.map((unit, at) => ({
            nodeId: `${NODE_ID.slice(0, -1)}${at}`,
            nodeName: unit,
            unitPath: ['软件学院', unit],
            roleIds: [],
            roleNames: ['班长', '学习委员', '团支书', '班级综测负责人'],
            reason: 'no-assignee' as const,
            waiting: 1,
          })),
          unreachable: {
            routes: titles.map((itemTitle, at) => ({
              itemId: `item-${at}`,
              itemTitle,
              route: 'normal' as const,
              participants: 1,
              levelNames: ['班级'],
            })),
            cannotSubmit: 1,
            cannotAppeal: 0,
          },
        }),
    })
    await expect.element(page.getByTestId('overview-actions')).toBeVisible()
    await expect.element(page.getByTestId('workspace-rail')).toBeVisible()
    /** where the count stands against the box its line is cut to */
    const countInSight = (action: string, total: number) => {
      const detail = row(action)!.querySelector<HTMLElement>('[data-part="detail"]')!
      const words = detail.firstChild!
      const at = words.textContent!.indexOf(String(total))
      expect(at).toBeGreaterThanOrEqual(0)
      const range = document.createRange()
      range.setStart(words, at)
      range.setEnd(words, at + String(total).length)
      const seen = range.getBoundingClientRect()
      return seen.height > 0 && seen.bottom <= detail.getBoundingClientRect().bottom + 0.5
    }
    // the lines really are cut: otherwise the count is in sight wherever it stands
    const gap = row('admin-review-gap')!.querySelector<HTMLElement>('[data-part="detail"]')!
    expect(gap.scrollHeight).toBeGreaterThan(gap.clientHeight)
    expect(countInSight('admin-review-gap', units.length)).toBe(true)
    expect(countInSight('admin-unreachable', titles.length)).toBe(true)
  })

  it('says only the appeals when every question can still be filed into', async () => {
    await page.viewport(1280, 800)
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      reviewAlerts: () =>
        Effect.succeed({
          groups: [],
          unreachable: {
            routes: stopped.unreachable.routes.filter((one) => one.route === 'escalation'),
            cannotSubmit: 0,
            cannotAppeal: 4,
          },
        }),
    })
    await expect.element(page.getByTestId('overview-actions')).toBeVisible()
    expect(row('admin-unreachable')).toBeNull()
    expect(row('admin-unappealable')?.getAttribute('data-items')).toBe('item-b')
  })

  // An archived batch takes no appointment, no roster change and no change
  // to its questions, so nothing the lane would list could be mended there:
  // the staff page counts none of it for the same reason (§32.97).
  it('lists nothing on an archived batch, and lights no dot beside its rail', async () => {
    await page.viewport(1280, 800)
    const reviewAlerts = vi.fn(() => Effect.succeed(stopped))
    const listParticipantPlacements = vi.fn(() =>
      Effect.succeed({ items: [], nextCursor: null, changedTotal: 2, unavailableTotal: 1 }),
    )
    const previewAccessSync = vi.fn(() =>
      Effect.succeed({ items: [], nextCursor: null, pendingTotal: 3, lapsedTotal: 0 }),
    )
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      getBatch: () => Effect.succeed({ batch: batch({ status: 'archived' }) }),
      reviewAlerts,
      listParticipantPlacements,
      previewAccessSync,
    })
    // the desk is still there for a manager with nothing else here, and
    // says there is nothing to do
    await expect.element(page.getByTestId('overview-clear')).toBeVisible()
    await expect.element(page.getByTestId('workspace-rail')).toBeInTheDocument()
    expect(lane()).toHaveLength(0)
    expect(page.getByTestId('overview-actions').elements()).toHaveLength(0)
    expect(document.querySelectorAll('[data-testid="rail-alert"]')).toHaveLength(0)
    expect(reviewAlerts).not.toHaveBeenCalled()
    expect(listParticipantPlacements).not.toHaveBeenCalled()
    expect(previewAccessSync).not.toHaveBeenCalled()
  })

  it('says what stands behind each administration entry of the rail with a dot', async () => {
    await page.viewport(1280, 800)
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      reviewAlerts: () => Effect.succeed(stopped),
      listParticipantPlacements: () =>
        Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
      previewAccessSync: () =>
        Effect.succeed({ items: [], nextCursor: null, pendingTotal: 1, lapsedTotal: 4 }),
    })
    const dots = () =>
      [...document.querySelectorAll('[data-testid="rail-alert"]')].map((dot) =>
        dot.getAttribute('data-navigation'),
      )
    await vi.waitFor(() =>
      expect(dots().sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual([
        'assessment/batch-access/rail',
        'assessment/batch-items/rail',
      ]),
    )
    // the entry reads as one that needs attention to whoever hears the rail
    const items = page.getByRole('link', { name: /项目配置/ })
    expect(items.element().querySelector('[role="img"][aria-label]')).not.toBeNull()
  })

  it('keeps the desk for a pure administrator on a phone, where the plan is not shown', async () => {
    await page.viewport(390, 844)
    await shelled(`/assessment/batches/${BATCH_ID}`)
    // nothing stopped: the desk says so rather than the page standing empty
    const heading = page.getByRole('heading', { name: '需要你处理' })
    await expect.element(heading).toBeVisible()
    expect(heading.element().getBoundingClientRect().height).toBeGreaterThan(0)
    expect(page.getByTestId('overview-lane').elements()).toHaveLength(0)
  })

  it('asks for none of it on behalf of somebody who does not administer the round', async () => {
    await page.viewport(1280, 800)
    const reviewAlerts = vi.fn(() => Effect.succeed(stopped))
    const listParticipantPlacements = vi.fn(() =>
      Effect.succeed({ items: [], nextCursor: null, changedTotal: 2, unavailableTotal: 0 }),
    )
    const previewAccessSync = vi.fn(() =>
      Effect.succeed({ items: [], nextCursor: null, pendingTotal: 2, lapsedTotal: 0 }),
    )
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      getBatch: () =>
        Effect.succeed({
          batch: batch({
            manageable: false,
            capabilities: {
              personal: false,
              review: true,
              record: false,
              manage: false,
              redetermine: false,
            },
          }),
        }),
      getMyOverview: () =>
        Effect.succeed({
          participant: null,
          reviewer: { pendingCount: 2, answeredAskCount: 0, queueGroups: [], answeredAsks: [] },
        }),
      reviewAlerts,
      listParticipantPlacements,
      previewAccessSync,
    })
    await expect.element(page.getByTestId('overview-actions')).toBeVisible()
    expect(row('review-pending')).not.toBeNull()
    expect(lane()).toHaveLength(0)
    expect(document.querySelectorAll('[data-testid="rail-alert"]')).toHaveLength(0)
    expect(reviewAlerts).not.toHaveBeenCalled()
    expect(listParticipantPlacements).not.toHaveBeenCalled()
    expect(previewAccessSync).not.toHaveBeenCalled()
  })

  it('says when the counts could not be read, and reads them again on the word', async () => {
    await page.viewport(1280, 800)
    let reachable = false
    let asked = 0
    let answer: () => void = () => {}
    const answered = new Promise<void>((done) => {
      answer = done
    })
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      reviewAlerts: () =>
        Effect.suspend(() => {
          asked += 1
          return reachable
            ? Effect.promise(() => answered).pipe(Effect.as(stopped))
            : Effect.fail(apiError('SERVICE_UNAVAILABLE'))
        }),
    })
    await vi.waitFor(() => expect(row('admin-unreadable')).not.toBeNull(), { timeout: 8_000 })
    // a reading that failed is not one more thing waiting on the reader
    const actions = page.getByTestId('overview-actions').element()
    expect(actions.closest('section')?.getAttribute('data-count')).toBe('0')
    expect(lane()[0]?.getAttribute('data-count')).toBe('0')
    reachable = true
    const before = asked
    const retry = row('admin-unreadable')!.querySelector('button')!
    retry.click()
    // asking again, it takes no second press
    await vi.waitFor(() => expect(retry.getAttribute('aria-busy')).toBe('true'))
    expect(retry.disabled).toBe(true)
    answer()
    await vi.waitFor(() => expect(row('admin-review-gap')).not.toBeNull())
    expect(row('admin-unreadable')).toBeNull()
    // the handle inside the row is the row's own door: one press, one read
    expect(asked - before).toBe(1)
  })
})

describe('the overview when its own reads fail', () => {
  it('stands a state with another try where the desk would be, not a line of red', async () => {
    await page.viewport(1280, 800)
    let reachable = false
    // a reviewer, whose desk is the overview's own read and nothing else
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      getBatch: () =>
        Effect.succeed({
          batch: batch({
            manageable: false,
            capabilities: {
              personal: false,
              review: true,
              record: false,
              manage: false,
              redetermine: false,
            },
          }),
        }),
      getMyOverview: () =>
        reachable
          ? Effect.succeed({
              participant: null,
              reviewer: { pendingCount: 2, answeredAskCount: 0, queueGroups: [], answeredAsks: [] },
            })
          : Effect.fail(apiError('ASSESSMENT_INTERNAL')),
      listMyActivity: () =>
        reachable
          ? Effect.succeed({ items: [], nextCursor: null })
          : Effect.fail(apiError('SERVICE_UNAVAILABLE')),
    })
    const failed = () =>
      page
        .getByRole('main')
        .element()
        .querySelector('[data-slot="resource-state"][data-state="failed"]')
    await vi.waitFor(() => expect(failed()).not.toBeNull())
    reachable = true
    await page.getByRole('main').getByRole('button', { name: '重试' }).click()
    await expect.element(page.getByTestId('overview-actions')).toBeVisible()
    expect(failed()).toBeNull()
  })

  it('says the feed could not be read, and not that nothing has happened', async () => {
    await page.viewport(1280, 800)
    await shelled(`/assessment/batches/${BATCH_ID}`, {
      getBatch: () =>
        Effect.succeed({
          batch: batch({
            manageable: false,
            capabilities: {
              personal: false,
              review: true,
              record: false,
              manage: false,
              redetermine: false,
            },
          }),
        }),
      getMyOverview: () =>
        Effect.succeed({
          participant: null,
          reviewer: { pendingCount: 2, answeredAskCount: 0, queueGroups: [], answeredAsks: [] },
        }),
      listMyActivity: () => Effect.fail(apiError('SERVICE_UNAVAILABLE')),
    })
    await expect.element(page.getByTestId('overview-actions')).toBeVisible()
    await vi.waitFor(
      () =>
        expect(
          page
            .getByRole('main')
            .element()
            .querySelector('[data-slot="resource-state"][data-state="unavailable"]'),
        ).not.toBeNull(),
      { timeout: 8_000 },
    )
    expect(page.getByTestId('overview-activity').elements()).toHaveLength(0)
  })
})
