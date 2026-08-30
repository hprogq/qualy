import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
import '../src/app.css'

// The approval collecting an explicit determination.
//
// The server refuses an approve that omits a non-empty recognition, so the
// dialog is where the words actually get said: seeded facts arrive
// pre-filled, reviewer-only facts arrive blank and block the act until
// somebody writes them, contradicting a seeded fact demands an explanation,
// and a sitting's frozen text is confirmed read-only and verbatim. A fixed
// question offers no form at all, which must leave the dialog exactly as it
// was before any of this existed.

const ReviewInstancePage = (await components['assessment/ReviewInstancePage']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_ID = '55555555-5555-4555-8555-555555555555'

const PAGES = [
  { id: 'assessment/review-instance', path: '/assessment/batches/:batchId/reviews/:instanceId' },
].map((entry) => ({ ...entry, component: entry.id, layout: 'admin' }))

const batch = () => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: false,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: true, review: true, record: true, manage: false },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 1,
  currentPhaseId: null,
  currentPhaseName: '填报期',
  createdAt: '2026-02-01T00:00:00.000Z',
})

/** the frozen contract the fixtures determine under */
const recognitionForm = () => ({
  fields: [
    {
      id: 'rec-level',
      schema: {
        type: 'string',
        enum: ['national', 'provincial'],
        'x-qualy-enumLabels': { national: '国家级', provincial: '省部级' },
        title: '认定赛事级别',
      },
    },
    {
      id: 'rec-ordinal',
      schema: { type: 'integer', minimum: 1, maximum: 10, title: '认定获奖序位' },
    },
    {
      id: 'rec-hours',
      schema: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2, title: '认定时长' },
    },
  ],
  seed: { 'rec-level': 'national', 'rec-hours': '2' },
  locked: null,
})

const review = (over: Record<string, unknown> = {}) => ({
  id: INSTANCE_ID,
  state: 'active' as const,
  outcome: null,
  roundNo: 1,
  entryId: ENTRY_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  itemTitle: '学科竞赛获奖',
  participantName: '周予安',
  businessNo: '2023011047',
  unitName: '软件2023级2班',
  submittedAt: '2026-03-03T00:00:00.000Z',
  completedAt: null,
  revision: {
    revisionNo: 1,
    payload: { name: '中国机器人大赛', 'claimed-level': 'provincial', 'claimed-placing': 2 },
    note: null,
    attachments: [],
  },
  form: {
    itemType: 'evidence',
    formConfig: {
      fields: [
        { key: 'name', type: 'text', label: '竞赛名称' },
        {
          key: 'claimed-level',
          type: 'choice',
          label: '申报级别',
          options: [
            { value: 'national', label: '国家级' },
            { value: 'provincial', label: '省部级' },
          ],
        },
        { key: 'claimed-placing', type: 'integer', label: '申报序位', min: 1, max: 10 },
      ],
    },
  },
  chain: {
    route: 'normal' as const,
    stageId: 'class',
    normal: [
      {
        id: 'class',
        index: 0,
        label: null,
        nodeName: '软件2023级2班',
        roleNames: ['审核员'],
        reviewers: ['张老师'],
        skipped: null,
        opinions: null,
      },
    ],
    escalation: [],
  },
  context: null,
  events: [],
  supplements: [],
  actions: {
    approve: { state: 'available' as const, reason: null },
    reject: { state: 'available' as const, reason: null },
    escalate: { state: 'blocked' as const, reason: 'no-route' },
    supplement: { state: 'available' as const, reason: null },
  },
  recognitionForm: recognitionForm(),
  capabilities: { canDecide: true, canCancelSupplement: false, canAnswerSupplement: false },
  ...over,
})

const open = (fixture: ReturnType<typeof review>, stubs: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        getReviewInstance: () => Effect.succeed({ review: fixture }),
        getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
        listReviewInbox: () => Effect.succeed({ items: [], nextCursor: null, handledToday: 0 }),
        ...stubs,
      },
    } as never),
    routes: [
      {
        path: '/assessment/batches/:batchId/reviews/:instanceId',
        element: (
          <div style={{ display: 'flex', height: '100dvh', flexDirection: 'column', overflow: 'hidden' }}>
            <ReviewInstancePage />
          </div>
        ),
      },
    ] as never,
    route: `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
  })

const openApprove = async () => {
  await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
  await page.getByRole('button', { name: /^通过/ }).click()
  await expect.element(page.getByRole('dialog')).toBeVisible()
}

const decidedPayload = (decided: ReturnType<typeof vi.fn>) => {
  expect(decided).toHaveBeenCalled()
  return (decided.mock.calls[0] as { payload: Record<string, unknown> }[])[0]!.payload
}

const stagedDecide = () =>
  vi.fn(() =>
    Effect.succeed({ review: review({ state: 'completed', outcome: 'approved' }) }),
  )

const confirmAndWait = async (decided: ReturnType<typeof vi.fn>) => {
  await page.getByRole('dialog').getByRole('button', { name: /^通过/ }).click()
  // through the 5-second undo window
  await vi.waitFor(() => expect(decided).toHaveBeenCalled(), { timeout: 8_000 })
}

afterEach(() => page.viewport(1280, 800))

describe('approving with a determination', () => {
  it('leaves a fixed question exactly as before: no form, no key on the wire', async () => {
    const decided = stagedDecide()
    open(review({ recognitionForm: null }), { decideReview: decided as never })
    await openApprove()
    expect(document.querySelector('[data-testid="recognition-form"]')).toBeNull()
    await confirmAndWait(decided)
    expect(decidedPayload(decided)).not.toHaveProperty('recognition')
  })

  it('pre-fills the seed, takes a first fill without a reason, and sends whole values', async () => {
    const decided = stagedDecide()
    open(review(), { decideReview: decided as never })
    await openApprove()
    const form = document.querySelector('[data-testid="recognition-form"]')!
    // the seeded choice arrives chosen, by its business label
    const level = form.querySelector('[data-parameter="rec-level"] select') as HTMLSelectElement
    expect(level.value).toBe('national')
    // the reviewer-only fact is blank and the act is gated on it
    const approve = page.getByRole('dialog').getByRole('button', { name: /^通过/ })
    await expect.element(approve).toBeDisabled()
    const ordinal = form.querySelector('[data-parameter="rec-ordinal"] input') as HTMLInputElement
    ordinal.focus()
    await page.getByRole('dialog').getByRole('textbox').nth(0)
    // writing a fact nobody had determined is doing the job: no reason box
    const { userEvent } = await import('vitest/browser')
    await userEvent.fill(ordinal, '2')
    expect(document.body.textContent).not.toContain('认定调整说明')
    await confirmAndWait(decided)
    const payload = decidedPayload(decided)
    expect(payload['recognition']).toEqual({
      values: { 'rec-level': 'national', 'rec-ordinal': 2, 'rec-hours': '2' },
    })
  })

  it('sends the decimal in canonical spelling', async () => {
    const decided = stagedDecide()
    open(review(), { decideReview: decided as never })
    await openApprove()
    const form = document.querySelector('[data-testid="recognition-form"]')!
    const { userEvent } = await import('vitest/browser')
    await userEvent.fill(
      form.querySelector('[data-parameter="rec-ordinal"] input') as HTMLInputElement,
      '2',
    )
    // "3.50" is how somebody types it; "3.5" is what it means
    const hours = form.querySelector('[data-parameter="rec-hours"] input') as HTMLInputElement
    await userEvent.fill(hours, '3.50')
    // same number as the seed? no - 3.5 differs from 2, so a reason is owed
    await expect
      .element(page.getByRole('dialog').getByText('认定调整说明'))
      .toBeVisible()
    await userEvent.fill(
      page.getByRole('dialog').getByLabelText('认定调整说明').element() as HTMLInputElement,
      '按打卡记录核定',
    )
    await confirmAndWait(decided)
    const payload = decidedPayload(decided)
    expect(payload['recognition']).toEqual({
      values: { 'rec-level': 'national', 'rec-ordinal': 2, 'rec-hours': '3.5' },
      reason: '按打卡记录核定',
    })
  })

  it('blocks a value the field refuses, and says why beside it', async () => {
    const decided = stagedDecide()
    open(review(), { decideReview: decided as never })
    await openApprove()
    const form = document.querySelector('[data-testid="recognition-form"]')!
    const { userEvent } = await import('vitest/browser')
    const ordinal = form.querySelector('[data-parameter="rec-ordinal"] input') as HTMLInputElement
    await userEvent.fill(ordinal, 'abc')
    await expect
      .element(page.getByRole('dialog').getByRole('button', { name: /^通过/ }))
      .toBeDisabled()
    await expect.element(page.getByRole('alert').first()).toBeVisible()
    expect(decided).not.toHaveBeenCalled()
  })

  it('demands a reason only when a seeded fact is contradicted', async () => {
    const decided = stagedDecide()
    open(review(), { decideReview: decided as never })
    await openApprove()
    const form = document.querySelector('[data-testid="recognition-form"]')!
    const { userEvent } = await import('vitest/browser')
    await userEvent.fill(
      form.querySelector('[data-parameter="rec-ordinal"] input') as HTMLInputElement,
      '2',
    )
    const level = form.querySelector('[data-parameter="rec-level"] select') as HTMLSelectElement
    await userEvent.selectOptions(level, 'provincial')
    await expect.element(page.getByRole('dialog').getByText('认定调整说明')).toBeVisible()
    // the gate holds until the explanation is written
    await expect
      .element(page.getByRole('dialog').getByRole('button', { name: /^通过/ }))
      .toBeDisabled()
    await userEvent.fill(
      page.getByRole('dialog').getByLabelText('认定调整说明').element() as HTMLInputElement,
      '证书落款为省级主办单位',
    )
    await confirmAndWait(decided)
    const payload = decidedPayload(decided)
    expect(payload['recognition']).toEqual({
      values: { 'rec-level': 'provincial', 'rec-ordinal': 2, 'rec-hours': '2' },
      reason: '证书落款为省级主办单位',
    })
  })

  it('confirms a frozen sitting text read-only and verbatim', async () => {
    const decided = stagedDecide()
    open(
      review({
        recognitionForm: {
          ...recognitionForm(),
          locked: {
            values: { 'rec-level': 'provincial', 'rec-ordinal': 3, 'rec-hours': '1.5' },
            hash: 'abc123',
          },
        },
      }),
      { decideReview: decided as never },
    )
    await openApprove()
    const form = document.querySelector('[data-testid="recognition-form"]')!
    const level = form.querySelector('[data-parameter="rec-level"] select') as HTMLSelectElement
    expect(level.value).toBe('provincial')
    expect(level.disabled).toBe(true)
    // no reason box: confirming the sitting's text changes nothing
    expect(document.body.textContent).not.toContain('认定调整说明')
    await confirmAndWait(decided)
    expect(decidedPayload(decided)['recognition']).toEqual({
      values: { 'rec-level': 'provincial', 'rec-ordinal': 3, 'rec-hours': '1.5' },
    })
  })

  it('keeps the refusal entirely out of it', async () => {
    const decided = stagedDecide()
    open(review(), { decideReview: decided as never })
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    await page.getByRole('button', { name: /退回/ }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    // a refusal determines nothing: no recognition form in this dialog
    expect(document.querySelector('[data-testid="recognition-form"]')).toBeNull()
    await page.getByLabelText('审核意见').fill('材料不足')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /确认退回/ })
      .click()
    await vi.waitFor(() => expect(decided).toHaveBeenCalled(), { timeout: 8_000 })
    expect(decidedPayload(decided)).not.toHaveProperty('recognition')
  })

  it('holds the slide key to the same gate under a thumb', async () => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = ((query: string) =>
      query.includes('pointer: fine')
        ? { matches: false, media: query, addEventListener() {}, removeEventListener() {} }
        : real(query)) as typeof window.matchMedia
    try {
      page.viewport(390, 844)
      const decided = stagedDecide()
      open(review(), { decideReview: decided as never })
      await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
      await page.getByRole('button', { name: /^通过/ }).click()
      await expect.element(page.getByRole('dialog')).toBeVisible()
      // the reviewer-only fact is blank, so the handle will not take a drag
      const handle = document.querySelector('[data-slide-handle]') as HTMLButtonElement
      expect(handle.disabled).toBe(true)
      const form = document.querySelector('[data-testid="recognition-form"]')!
      const { userEvent } = await import('vitest/browser')
      await userEvent.fill(
        form.querySelector('[data-parameter="rec-ordinal"] input') as HTMLInputElement,
        '2',
      )
      await vi.waitFor(() => {
        if ((document.querySelector('[data-slide-handle]') as HTMLButtonElement).disabled)
          throw new Error('still gated')
      })
    } finally {
      window.matchMedia = real
    }
  })

  it("reads typed evidence in the reviewer's words, and suggests in kind", async () => {
    const decided = stagedDecide()
    open(review({ recognitionForm: null }), { decideReview: decided as never })
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    await page.getByRole('button', { name: /退回/ }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await page.getByLabelText('审核意见').fill('序位与证书不符')
    const { userEvent } = await import('vitest/browser')
    // open the suggestion grid and correct the integer
    await page.getByRole('checkbox', { name: /修改建议/ }).click()
    await vi.waitFor(() => {
      if (document.querySelector('[data-suggest-slot="3"]') === null)
        throw new Error('grid not open yet')
    })
    // "theirs" prints the choice's words and the number itself - not a
    // blank where the value would not coerce to a string
    const dialogText = (page.getByRole('dialog').element() as HTMLElement).textContent ?? ''
    expect(dialogText).toContain('省部级')
    expect(dialogText).toContain('2')
    const slot = document.querySelector('[data-suggest-slot="3"]') as HTMLInputElement
    // a typo holds the door
    await userEvent.fill(slot, '3x')
    await expect
      .element(page.getByRole('dialog').getByRole('button', { name: /确认退回/ }))
      .toBeDisabled()
    await userEvent.fill(slot, '3')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /确认退回/ })
      .click()
    await vi.waitFor(() => expect(decided).toHaveBeenCalled(), { timeout: 8_000 })
    const payload = decidedPayload(decided)
    // the suggestion files as the field's own kind: a number, not its text
    expect(payload['suggestedPayload']).toMatchObject({ 'claimed-placing': 3 })
  })
})
