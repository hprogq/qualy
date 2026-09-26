import BatchPhasesPage from '../src/client/BatchPhasesPage.tsx'
import BatchSettingsPage from '../src/client/BatchSettingsPage.tsx'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import type { assessmentApi } from '@qualy/plugin-assessment/client/api'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The stage plan and the batch settings as somebody editing them meets
// them: a move is a change like any other, leaving with changes asks first
// and can save on the way out, a stage says where it stands and what it
// waits on, the paper failing to load is not an empty paper, and a stage
// that opens many items names a few of them until asked for the rest.

type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']
type PhaseDto = ApiResult<typeof assessmentApi, 'assessment', 'getPhases'>['phases'][number]
type Stubs = Partial<
  Record<keyof ClientOf<typeof assessmentApi>['assessment'], (...args: never[]) => unknown>
>

interface Request {
  params?: Record<string, string>
  payload?: Record<string, unknown>
  query?: Record<string, string>
}

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const REVIEW_ID = '44444444-4444-4444-8444-444444444444'
const PUBLISH_ID = '55555555-5555-4555-8555-555555555555'

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
  status: 'draft',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  ...over,
})

const phase = (over: Partial<PhaseDto> & { id: string; phaseKey: string }): PhaseDto => ({
  ordinal: 0,
  displayName: over.phaseKey,
  description: '',
  entryNote: '',
  plannedEntryAt: null,
  actualEntryAt: null,
  permissionProfile: [],
  itemScope: [],
  participantScope: [],
  sourceTemplateId: null,
  sourceTemplateVersion: null,
  ...over,
})

/** three stages, none of them given a time yet */
const threeStages = {
  phases: [
    phase({ id: ENTRY_ID, phaseKey: 'entry', displayName: '正式填报' }),
    phase({ id: REVIEW_ID, phaseKey: 'review', ordinal: 1, displayName: '审核整理' }),
    phase({ id: PUBLISH_ID, phaseKey: 'publish', ordinal: 2, displayName: '结果公示' }),
  ],
  planFingerprint: 'plan-three',
}

const stubs = (over: Stubs = {}): Stubs => ({
  getBatch: () => Effect.succeed({ batch: batch() }),
  getPhases: () => Effect.succeed(threeStages),
  listTemplates: () => Effect.succeed({ items: [], nextCursor: null }),
  listItems: () => Effect.succeed({ items: [], capabilities: { canManage: true } }),
  listScoreGroups: () =>
    Effect.succeed({ groups: [], version: 1, capabilities: { canManage: true } }),
  ...over,
})

const PAGES = [
  { id: 'assessment/batches', path: '/assessment/batches', layout: 'admin' },
  { id: 'assessment/batch-phases', path: '/assessment/batches/:batchId/phases', layout: 'admin' },
  {
    id: 'assessment/batch-settings',
    path: '/assessment/batches/:batchId/settings',
    layout: 'admin',
  },
]

/** a page with a way off it, as the rail or any link in the product would be */
const withWayOut = (element: ReactNode) => (
  <>
    <Link to="/elsewhere">elsewhere</Link>
    {element}
  </>
)

const screen = (over: Stubs = {}, route = `/assessment/batches/${BATCH_ID}/phases`) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: stubs(over),
    }),
    routes: [
      { path: '/assessment/batches', element: <p data-testid="batch-list">batches</p> },
      { path: '/assessment/batches/:batchId/phases', element: withWayOut(<BatchPhasesPage />) },
      {
        path: '/assessment/batches/:batchId/settings',
        element: withWayOut(<BatchSettingsPage />),
      },
      { path: '/elsewhere', element: <p data-testid="elsewhere">elsewhere page</p> },
    ],
    route,
  })

/** whether the browser would ask before the tab went, as the page answers it */
const held = () => {
  const leaving = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(leaving)
  return leaving.defaultPrevented
}

const unsaved = () =>
  page
    .getByTestId('phase-standing')
    .elements()
    .map((node) => node.getAttribute('data-unsaved'))

const keys = () =>
  page
    .getByTestId('phase-row')
    .elements()
    .map((node) => node.getAttribute('data-phase-key'))

describe('the stage plan, being edited', () => {
  it('counts a stage moved as a change, marks it, and asks before it is dropped', async () => {
    await page.viewport(1280, 800)
    await screen()
    await vi.waitFor(() => expect(keys()).toEqual(['entry', 'review', 'publish']))

    await page.getByRole('button', { name: '编辑阶段' }).click()
    await page.getByRole('button', { name: '下移' }).first().click()
    await vi.waitFor(() => expect(keys()).toEqual(['review', 'entry', 'publish']))

    // one stage moved: one row says it is not saved, and the tab is held
    await vi.waitFor(() => expect(unsaved().filter((mark) => mark === 'true')).toHaveLength(1))
    expect(held()).toBe(true)
    await expect.element(page.getByTestId('unsaved-mark')).toBeVisible()

    // cancelling a move is dropping a change, so it is asked about first
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click()
    await vi.waitFor(() => expect(keys()).toEqual(['entry', 'review', 'publish']))
    expect(unsaved()).toEqual(['false', 'false', 'false'])
    expect(held()).toBe(false)
  })

  it('has nothing to ask about once a stage is moved back where it was', async () => {
    await page.viewport(1280, 800)
    await screen()
    await vi.waitFor(() => expect(keys()).toHaveLength(3))

    await page.getByRole('button', { name: '编辑阶段' }).click()
    await page.getByRole('button', { name: '下移' }).first().click()
    await vi.waitFor(() => expect(keys()).toEqual(['review', 'entry', 'publish']))
    await page.getByRole('button', { name: '上移' }).nth(1).click()
    await vi.waitFor(() => expect(keys()).toEqual(['entry', 'review', 'publish']))
    expect(unsaved()).toEqual(['false', 'false', 'false'])
    expect(held()).toBe(false)

    // and cancelling puts the empty draft down without a question
    await page.getByRole('button', { name: '取消', exact: true }).click()
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)
    await expect.element(page.getByRole('button', { name: '编辑阶段' })).toBeVisible()
  })

  it('asks before the page is left with changes, and saves the plan on the way out', async () => {
    await page.viewport(1280, 800)
    const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
    await screen({ putPhases })
    await vi.waitFor(() => expect(keys()).toHaveLength(3))

    await page.getByTestId('phase-row').nth(1).getByText('审核整理').click()
    const panel = page.getByRole('dialog')
    await panel.getByLabelText('阶段名称').fill('审核整理期')
    await panel.getByRole('button', { name: '完成' }).click()

    await page.getByRole('link', { name: 'elsewhere' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    // nothing has moved while the question is open
    expect(addressNow()).toBe(`/assessment/batches/${BATCH_ID}/phases`)

    await page.getByRole('alertdialog').getByRole('button', { name: '保存后离开' }).click()
    await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
    // the same save the page's own button makes, naming the plan it began from
    const sent = putPhases.mock.calls[0]![0].payload!
    expect(sent['expectedPlanFingerprint']).toBe('plan-three')
    expect((sent['phases'] as readonly Record<string, unknown>[])[1]).toMatchObject({
      displayName: '审核整理期',
    })
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
  })

  it('stays when the save on the way out is refused, with the reason on the page', async () => {
    await page.viewport(1280, 800)
    const putPhases = vi.fn((_request: Request) =>
      Effect.fail(
        Object.assign(new Error('ASSESSMENT_PLAN_INVALID'), {
          _tag: 'ASSESSMENT_PLAN_INVALID',
          refusals: [{ reason: 'scheduled-phase-immutable', phaseId: REVIEW_ID }],
        }),
      ),
    )
    await screen({ putPhases })
    await vi.waitFor(() => expect(keys()).toHaveLength(3))

    await page.getByTestId('phase-row').nth(1).getByText('审核整理').click()
    const panel = page.getByRole('dialog')
    await panel.getByLabelText('阶段名称').fill('审核整理期')
    await panel.getByRole('button', { name: '完成' }).click()

    await page.getByRole('link', { name: 'elsewhere' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '保存后离开' }).click()
    await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
    await expect
      .element(page.getByTestId('phase-refusal'))
      .toHaveAttribute('data-reason', 'scheduled-phase-immutable')
    expect(addressNow()).toBe(`/assessment/batches/${BATCH_ID}/phases`)
  })
})

describe('the stage plan, read', () => {
  it('names a row by its stage, and says where it stands after the name', async () => {
    await page.viewport(1280, 800)
    await screen({
      getPhases: () =>
        Effect.succeed({
          phases: [
            phase({ id: ENTRY_ID, phaseKey: 'entry', displayName: '正式填报' }),
            phase({
              id: REVIEW_ID,
              phaseKey: 'review',
              ordinal: 1,
              displayName: '审核整理',
              itemScope: ['some-item'],
            }),
          ],
          planFingerprint: 'plan-two',
        }),
    })

    // the stage's own name, not a sentence wrapped around it
    const row = page.getByRole('link', { name: '审核整理', exact: true })
    await expect.element(row).toBeVisible()
    // what it is limited to is part of what is said about it
    const scope = row.getByTestId('phase-scope').element()
    expect(row.element().getAttribute('aria-describedby')?.split(' ')).toContain(scope.id)
  })

  it('keeps saying which stage is in hand while it has an edit not saved', async () => {
    await page.viewport(1280, 800)
    await screen({
      getBatch: () =>
        Effect.succeed({ batch: batch({ status: 'active', currentPhaseId: ENTRY_ID }) }),
      getPhases: () =>
        Effect.succeed({
          ...threeStages,
          phases: threeStages.phases.map((one) =>
            one.id === ENTRY_ID ? { ...one, actualEntryAt: '2026-03-01T00:00:00.000Z' } : one,
          ),
        }),
    })
    await vi.waitFor(() => expect(keys()).toHaveLength(3))

    await page.getByTestId('phase-row').first().getByText('正式填报').click()
    const panel = page.getByRole('dialog')
    await panel.getByLabelText('阶段名称').fill('正式填报期')
    await panel.getByRole('button', { name: '完成' }).click()

    const standing = page.getByTestId('phase-standing').first()
    await expect.element(standing).toHaveAttribute('data-unsaved', 'true')
    await expect.element(standing).toHaveAttribute('data-standing', 'current')
    // both are drawn: the stage in hand, and the edit not saved
    expect(
      [...standing.element().querySelectorAll('[data-tone]')].map((node) =>
        node.getAttribute('data-tone'),
      ),
    ).toEqual(['ok', 'warn'])
  })

  it('says of a stage behind the next to be scheduled that it waits on the one before', async () => {
    await page.viewport(1280, 800)
    await screen()
    await vi.waitFor(() => expect(keys()).toHaveLength(3))

    // the first may take a time; the two behind it wait for the one before
    const waits = page
      .getByTestId('phase-when')
      .elements()
      .map((node) => node.getAttribute('data-waits'))
    expect(waits).toEqual([null, 'earlier', 'earlier'])
  })
})

describe('the batch settings, being edited', () => {
  it('asks before the page is left with changes, and saves them on the way out', async () => {
    await page.viewport(1280, 800)
    const updateBatch = vi.fn((_request: Request) => Effect.succeed({ batch: batch() }))
    await screen({ updateBatch }, `/assessment/batches/${BATCH_ID}/settings`)

    await page.getByRole('textbox', { name: '名称' }).fill('2026 春季综测（修订）')
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    expect(addressNow()).toBe(`/assessment/batches/${BATCH_ID}/settings`)

    await page.getByRole('alertdialog').getByRole('button', { name: '保存后离开' }).click()
    await vi.waitFor(() => expect(updateBatch).toHaveBeenCalledTimes(1))
    expect(updateBatch.mock.calls[0]![0].payload).toMatchObject({ name: '2026 春季综测（修订）' })
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
  })

  it('lets the reader go without the changes', async () => {
    await page.viewport(1280, 800)
    const updateBatch = vi.fn((_request: Request) => Effect.succeed({ batch: batch() }))
    await screen({ updateBatch }, `/assessment/batches/${BATCH_ID}/settings`)

    await page.getByRole('textbox', { name: '名称' }).fill('2026 春季综测（修订）')
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(updateBatch).not.toHaveBeenCalled()
  })

  it('goes to the list without asking once the batch it was changing is deleted', async () => {
    await page.viewport(1280, 800)
    const deleteBatch = vi.fn(() => Effect.succeed({}))
    await screen({ deleteBatch }, `/assessment/batches/${BATCH_ID}/settings`)

    await page.getByRole('textbox', { name: '名称' }).fill('2026 春季综测（修订）')
    await page.getByRole('button', { name: '删除批次' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除批次' }).click()
    await vi.waitFor(() => expect(deleteBatch).toHaveBeenCalledTimes(1))
    await expect.element(page.getByTestId('batch-list')).toBeVisible()
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)
  })
})
