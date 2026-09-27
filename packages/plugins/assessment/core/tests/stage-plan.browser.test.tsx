import BatchPhasesPage from '../src/client/BatchPhasesPage.tsx'
import BatchSettingsPage from '../src/client/BatchSettingsPage.tsx'
import { BatchFlow } from '../src/client/batch/BatchFlow.tsx'
import { BatchZone } from '../src/client/batch/BatchZone.tsx'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import type { ReactNode } from 'react'
import { Link, Route, Routes } from 'react-router'
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

const timelineTemplate = {
  id: '88888888-8888-4888-8888-888888888888',
  name: '常规四阶段',
  kind: 'timeline' as const,
  version: 1,
  phases: [],
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

  it('marks the stage that was moved, not the neighbour it passed', async () => {
    await page.viewport(1280, 800)
    await screen()
    await vi.waitFor(() => expect(keys()).toEqual(['entry', 'review', 'publish']))

    await page.getByRole('button', { name: '编辑阶段' }).click()
    // the second stage taken up past the first: either could be the one
    // that moved by the order alone, and it is the one pressed
    await page.getByRole('button', { name: '上移' }).nth(1).click()
    await vi.waitFor(() => expect(keys()).toEqual(['review', 'entry', 'publish']))
    expect(unsaved()).toEqual(['true', 'false', 'false'])

    // the first then taken on down to the end: what the plan now differs
    // by is that one stage, wherever the presses went in between
    await page.getByRole('button', { name: '下移' }).nth(1).click()
    await vi.waitFor(() => expect(keys()).toEqual(['review', 'publish', 'entry']))
    expect(unsaved()).toEqual(['false', 'false', 'true'])
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

  describe('adding a timeline template over an edit', () => {
    const withTemplate = (over: Stubs = {}) =>
      screen({
        listTemplates: (request: Request) =>
          Effect.succeed({
            items: request.query?.['kind'] === 'timeline' ? [timelineTemplate] : [],
            nextCursor: null,
          }),
        ...over,
      })

    /** one stage renamed in its panel, the edit not saved */
    const renameReview = async () => {
      await vi.waitFor(() => expect(keys()).toHaveLength(3))
      await page.getByTestId('phase-row').nth(1).getByText('审核整理').click()
      const panel = page.getByRole('dialog')
      await panel.getByLabelText('阶段名称').fill('审核整理期')
      await panel.getByRole('button', { name: '完成' }).click()
      await vi.waitFor(() => expect(unsaved()).toEqual(['false', 'true', 'false']))
    }

    const chooseTemplate = async () => {
      await page.getByRole('button', { name: '从模板添加' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabelText('时间线模板').selectOptions(timelineTemplate.name)
      return dialog
    }

    it('saves the edit first when asked to, then adds the template after it', async () => {
      await page.viewport(1280, 800)
      const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
      await withTemplate({ putPhases })
      await renameReview()

      const dialog = await chooseTemplate()
      // the edit the template would be added over is named before anything is written
      await expect
        .element(dialog.getByTestId('template-unsaved'))
        .toHaveAttribute('data-count', '1')
      await dialog.getByRole('button', { name: '保存修改并添加' }).click()

      await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(2))
      // the plan as edited, named against the plan it began from, and only then the template
      const [saved, added] = putPhases.mock.calls.map((call) => call[0].payload!)
      expect(saved!['expectedPlanFingerprint']).toBe('plan-three')
      expect((saved!['phases'] as readonly Record<string, unknown>[])[1]).toMatchObject({
        displayName: '审核整理期',
      })
      expect(added).toEqual({ fromTemplateId: timelineTemplate.id })
      await vi.waitFor(() => expect(page.getByRole('dialog').elements()).toHaveLength(0))
    })

    it('lets the edit go only when that is the press, and keeps it when called off', async () => {
      await page.viewport(1280, 800)
      const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
      await withTemplate({ putPhases })
      await renameReview()

      // called off: nothing written, the edit still there
      let dialog = await chooseTemplate()
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await vi.waitFor(() => expect(page.getByRole('dialog').elements()).toHaveLength(0))
      expect(putPhases).not.toHaveBeenCalled()
      expect(unsaved()).toEqual(['false', 'true', 'false'])

      dialog = await chooseTemplate()
      await dialog.getByRole('button', { name: '放弃修改并添加' }).click()
      await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
      expect(putPhases.mock.calls[0]![0].payload).toEqual({ fromTemplateId: timelineTemplate.id })
      // the edit went with the press that said so
      await vi.waitFor(() => expect(unsaved()).toEqual(['false', 'false', 'false']))
    })

    it('adds nothing when the save is refused, and keeps the edit', async () => {
      await page.viewport(1280, 800)
      const putPhases = vi.fn((_request: Request) =>
        Effect.fail(
          Object.assign(new Error('ASSESSMENT_PLAN_INVALID'), {
            _tag: 'ASSESSMENT_PLAN_INVALID',
            refusals: [{ reason: 'plan-changed', phaseId: null }],
          }),
        ),
      )
      await withTemplate({ putPhases })
      await renameReview()

      const dialog = await chooseTemplate()
      await dialog.getByRole('button', { name: '保存修改并添加' }).click()
      await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
      // the save said no: the template is not added over the plan it failed to change
      await vi.waitFor(() => expect(page.getByRole('dialog').elements()).toHaveLength(0))
      expect(putPhases.mock.calls[0]![0].payload).not.toHaveProperty('fromTemplateId')
      expect(unsaved()).toEqual(['false', 'true', 'false'])
    })

    it('offers a template only on a batch that has not begun', async () => {
      await page.viewport(1280, 800)
      await withTemplate({
        getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
      })
      await vi.waitFor(() => expect(keys()).toHaveLength(3))
      await page.getByRole('button', { name: '编辑阶段' }).click()
      await expect.element(page.getByRole('button', { name: '新增阶段' })).toBeVisible()
      expect(page.getByRole('button', { name: '从模板添加' }).elements()).toHaveLength(0)
    })
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

describe('the stage plan, being edited in the workspace', () => {
  const LONG = '补充提交（语言证书与竞赛获奖材料补交）'
  const shelled = () =>
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              viewer: 'authenticated' as const,
              pages: PAGES,
              collections: {
                'workspace-shell/navigation': [
                  {
                    id: 'assessment/batch-phases/rail',
                    label: { kind: 'literal' as const, value: '阶段安排' },
                    target: {
                      kind: 'page',
                      pageId: 'assessment/batch-phases',
                      path: '/assessment/batches/:batchId/phases',
                    },
                    order: 10,
                  },
                ],
              },
            }),
        },
        assessment: stubs({
          getPhases: () =>
            Effect.succeed({
              ...threeStages,
              phases: threeStages.phases.map((one) =>
                one.id === REVIEW_ID ? { ...one, displayName: LONG } : one,
              ),
            }),
        }),
      }),
      route: `/assessment/batches/${BATCH_ID}/phases`,
      children: (
        <Routes>
          <Route element={<WorkspaceShell />}>
            <Route path="/assessment/batches/:batchId/phases" element={<BatchPhasesPage />} />
          </Route>
        </Routes>
      ),
    })

  /** whether a box shows all it holds, across and down */
  const whole = (node: Element) =>
    node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1

  // the rail open beside a laptop's width, and a tablet's with no rail:
  // the two narrowest tables the plan is edited in
  for (const width of [1024, 834]) {
    it(`keeps a long stage name and what each stage opens whole at ${width}`, async () => {
      await page.viewport(width, 800)
      await shelled()
      await vi.waitFor(() => expect(keys()).toHaveLength(3))
      await page.getByRole('button', { name: '编辑阶段' }).click()
      await expect.element(page.getByRole('button', { name: '新增阶段' })).toBeVisible()
      if (width >= 1024) await expect.element(page.getByTestId('workspace-rail')).toBeVisible()

      const name = page
        .getByTestId('phase-row')
        .nth(1)
        .element()
        .querySelector('[data-slot="phase-name"]')!
      expect(name.textContent).toBe(LONG)
      expect(whole(name)).toBe(true)
      for (const opens of document.querySelectorAll('[data-slot="phase-opens"]')) {
        expect(whole(opens)).toBe(true)
      }
    })
  }
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
      listItems: () =>
        Effect.succeed({
          items: [
            { id: 'some-item', title: '学科竞赛获奖', scoreGroupId: 'paper', status: 'active' },
          ],
          capabilities: { canManage: true },
        }),
      listScoreGroups: () =>
        Effect.succeed({
          groups: [{ id: 'paper', parentGroupId: null, name: '卷面', sortOrder: 0 }],
          version: 1,
          capabilities: { canManage: true },
        }),
    })

    // the stage's own name, not a sentence wrapped around it
    const row = page.getByRole('link', { name: '审核整理', exact: true })
    await expect.element(row).toBeVisible()
    // what it is limited to is part of what is said about it, the items it
    // opens by name included, though no pointer rests on the tags to show them
    const scope = row.getByTestId('phase-scope').element()
    expect(row.element().getAttribute('aria-describedby')?.split(' ')).toContain(scope.id)
    await expect.element(row).toHaveAccessibleDescription(/学科竞赛获奖/)
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

  it('offers no timeline template where there is none to add', async () => {
    await page.viewport(1280, 800)
    await screen({ getPhases: () => Effect.succeed({ phases: [], planFingerprint: 'plan-empty' }) })
    await expect.element(page.getByTestId('phase-plan-empty')).toBeVisible()
    await expect.element(page.getByRole('button', { name: '新增阶段' })).toBeVisible()
    expect(page.getByRole('button', { name: '从模板添加' }).elements()).toHaveLength(0)
  })

  it('offers a timeline template where there is one', async () => {
    await page.viewport(1280, 800)
    await screen({
      getPhases: () => Effect.succeed({ phases: [], planFingerprint: 'plan-empty' }),
      listTemplates: (request: Request) =>
        Effect.succeed({
          items: request.query?.['kind'] === 'timeline' ? [timelineTemplate] : [],
          nextCursor: null,
        }),
    })
    await expect.element(page.getByRole('button', { name: '从模板添加' })).toBeVisible()
  })

  it('says the paper could not be read, rather than that there is none', async () => {
    await page.viewport(1280, 800)
    const listItems = vi.fn(() => Effect.fail({ _tag: 'SERVICE_UNAVAILABLE' } as never))
    await screen({
      listItems,
      getPhases: () =>
        Effect.succeed({
          phases: [
            phase({
              id: ENTRY_ID,
              phaseKey: 'entry',
              displayName: '正式填报',
              permissionProfile: ['assessment.entry.create', 'assessment.entry.submit'],
            }),
          ],
          planFingerprint: 'plan-one',
        }),
    })
    await vi.waitFor(() => expect(keys()).toHaveLength(1))

    await page.getByTestId('phase-row').first().getByText('正式填报').click()
    const editor = page.getByRole('dialog').getByTestId('phase-scope-editor')
    // a reading that failed, of a kind another try can mend
    const state = editor.element().querySelector('[data-slot="resource-state"]')
    expect(state?.getAttribute('data-state')).toBe('unavailable')
    const asked = listItems.mock.calls.length
    await editor.getByRole('button', { name: '重试' }).click()
    await vi.waitFor(() => expect(listItems.mock.calls.length).toBeGreaterThan(asked))
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

  it('counts a reason typed and not yet added, and keeps it when saving on the way out', async () => {
    await page.viewport(1280, 800)
    const updateBatch = vi.fn((_request: Request) => Effect.succeed({ batch: batch() }))
    await screen({ updateBatch }, `/assessment/batches/${BATCH_ID}/settings`)

    // typed into the box, the add never pressed
    await page.getByLabelText('退回事由').fill('证明材料缺少盖章')
    expect(held()).toBe(true)
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()

    await page.getByRole('alertdialog').getByRole('button', { name: '保存后离开' }).click()
    await vi.waitFor(() => expect(updateBatch).toHaveBeenCalledTimes(1))
    expect(updateBatch.mock.calls[0]![0].payload).toMatchObject({
      reviewReasons: { reject: ['证明材料缺少盖章'], escalate: [] },
    })
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

describe('the stage progress', () => {
  const HOUR = 3600_000
  const at = (ms: number) => new Date(Date.now() + ms).toISOString()
  const names = ['学业成绩', '学科竞赛获奖', '志愿服务', '语言技能证书', '社会实践', '文体活动']
  const flow = (
    count: number,
    people: { limited: boolean; you?: boolean | null } = { limited: false },
  ) => [
    {
      phaseId: 'entry',
      displayName: '正式填报',
      description: '',
      entryNote: '',
      status: 'current' as const,
      entry: { kind: 'entered' as const, at: at(-HOUR) },
    },
    {
      phaseId: 'supplement',
      displayName: '补充提交',
      description: '',
      entryNote: '',
      status: 'future' as const,
      entry: { kind: 'pending' as const, at: null },
      scope: {
        items: names.slice(0, count).map((title, index) => ({ id: `i${index}`, title })),
        participantsLimited: people.limited,
        includesReader: people.you ?? null,
      },
    },
  ]
  const mount = (count: number, people?: { limited: boolean; you?: boolean | null }) =>
    renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
      children: (
        <BatchZone zone="Asia/Shanghai">
          <BatchFlow timeline={flow(count, people)} />
        </BatchZone>
      ),
    })

  it('names a few of the items a stage opens, and the rest on request', async () => {
    await mount(6)
    const items = page.getByTestId('stage-scope-items')
    await expect.element(items).toHaveAttribute('data-count', '6')
    await expect.element(items).toHaveAttribute('data-named', '3')
    const toggle = items.getByRole('button')
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')

    await toggle.click()
    await expect.element(items).toHaveAttribute('data-named', '6')
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
    // the names are the fixture's own
    expect(items.element().textContent).toContain(names.at(-1)!)
  })

  it('names every item when there are only a few', async () => {
    await mount(3)
    const items = page.getByTestId('stage-scope-items')
    await expect.element(items).toHaveAttribute('data-named', '3')
    expect(items.getByRole('button').elements()).toHaveLength(0)
  })

  it('tells a participant whether a stage kept to some people admits them', async () => {
    await mount(1, { limited: true, you: true })
    await expect.element(page.getByTestId('stage-scope')).toHaveAttribute('data-reader', 'in')
  })

  it('tells a participant a stage kept to some people leaves them out', async () => {
    await mount(1, { limited: true, you: false })
    await expect.element(page.getByTestId('stage-scope')).toHaveAttribute('data-reader', 'out')
  })

  it('says only that people are limited to a reader on no roster', async () => {
    await mount(1, { limited: true, you: null })
    const scope = page.getByTestId('stage-scope')
    await expect.element(scope).toHaveAttribute('data-people', 'limited')
    expect(scope.element().hasAttribute('data-reader')).toBe(false)
  })
})
