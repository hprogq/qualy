import ParticipantResultsPage from '../src/client/result/ParticipantResultsPage.tsx'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect, Stream } from 'effect'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// One person's account read by staff, in the same workspace the person files
// in: who they are and where they stand at the top, their claims question
// by question underneath, and the staff reader's own keys where the owner's
// would be - never a way to file or submit on somebody's behalf.

afterEach(() => page.viewport(1280, 800))

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '66666666-6666-4666-8666-666666666666'
const OWN_ITEM = '44444444-4444-4444-8444-444444444441'
const RECORDED_ITEM = '44444444-4444-4444-8444-444444444442'
const entryId = (n: number) => `55555555-5555-4555-8555-5555555555${String(n).padStart(2, '0')}`

const batch = (capabilities: Record<string, boolean> = {}) => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: {
    personal: false,
    review: false,
    record: false,
    manage: true,
    redetermine: false,
    ...capabilities,
  },
  participantCount: 2,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
})

const participant = (over: Record<string, unknown> = {}) => ({
  id: PARTICIPANT_ID,
  userId: '88888888-8888-4888-8888-888888888888',
  displayName: '郭航旗',
  businessNo: '2023123456',
  userTypeId: 'type-student',
  anchorNodeId: 'n2',
  anchorPath: 'n0.n1.n2',
  // as the round freezes it: their own unit first, the root last
  anchorLineage: [
    { nodeId: 'n2', nodeTypeId: 'class' },
    { nodeId: 'n1', nodeTypeId: 'college' },
    { nodeId: 'n0', nodeTypeId: 'school' },
  ],
  status: 'active' as const,
  includedAt: '2026-02-02T00:00:00.000Z',
  excludedAt: null,
  placement: 'current' as const,
  ...over,
})

/** the round's units, root first, as the unit tree reads them */
const UNITS = [
  { id: 'n0', name: '示例大学', parentId: null },
  { id: 'n1', name: '软件学院', parentId: 'n0' },
  { id: 'n2', name: '软件2301班', parentId: 'n1' },
]

const question = (id: string, title: string, channels: readonly string[], sortOrder: number) => ({
  id,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title,
  scoreGroupId: GROUP_ID,
  sortOrder,
  status: 'active',
  maxEntries: 3,
  voidReason: null,
  currentRevision: {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${String(sortOrder)}`,
    revisionNo: 1,
    entryChannels: channels,
    formConfig: { fields: [{ key: 'summary', type: 'text', label: '事项说明' }] },
    scoringConfig: null,
    reviewPolicy: null,
    displayConfig: null,
    reason: null,
    createdAt: '2026-02-03T00:00:00.000Z',
  },
  createdAt: '2026-02-03T00:00:00.000Z',
})

const hidden = { state: 'hidden' as const, reason: null }

const claim = (n: number, item: string, status: string, over: Record<string, unknown> = {}) => ({
  entry: {
    id: entryId(n),
    batchId: BATCH_ID,
    itemId: item,
    participantId: PARTICIPANT_ID,
    status,
    source: 'self',
    currentRevision: {
      id: `77777777-7777-4777-8777-7777777777${String(n).padStart(2, '0')}`,
      revisionNo: 1,
      itemRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      payload: { summary: `事项 ${String(n)}` },
      note: null,
      source: 'self',
      actorId: '88888888-8888-4888-8888-888888888888',
      subjectId: '88888888-8888-4888-8888-888888888888',
      attachments: [],
      createdAt: new Date(Date.UTC(2026, 2, 1, 0, n)).toISOString(),
    },
    currentReviewInstanceId: null,
    supplement: null,
    refusal: null,
    openRound: null,
    recognition: null,
    createdAt: new Date(Date.UTC(2026, 2, 1, 0, n)).toISOString(),
    capabilities: {
      edit: hidden,
      submit: hidden,
      withdraw: hidden,
      abandon: hidden,
      appeal: hidden,
    },
    ...over,
  },
  recognition: null,
  corrections: { returnForRevision: hidden, reopen: hidden, redetermine: hidden },
})

/** the account as the result endpoint gives it: one line per claim that counts */
const account = (lines: readonly unknown[] = []) => ({
  mode: 'provisional' as const,
  total: '3.00',
  groups: [
    {
      groupId: GROUP_ID,
      parentGroupId: null,
      depth: 0,
      name: '学业发展',
      itemsTotal: '3.00',
      childrenTotal: '0.00',
      raw: '3.00',
      final: '3.00',
      cap: '10.00',
      floor: null,
    },
  ],
  lines,
})

/** a line on the account that came from one claim */
const counted = (n: number, item: string, value = '1.00') => ({
  lineId: `entry:${entryId(n)}`,
  kind: 'entry' as const,
  label: '事项',
  value,
  itemId: item,
  provenance: { entryId: entryId(n) },
})

/** the round's wake-up channel, holding back one wake-up until the test lets it go */
const wakeOnce = (kind: string) => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const watchBatch = () =>
    Effect.succeed(
      Stream.concat(
        Stream.fromEffect(Effect.promise(() => gate).pipe(Effect.as({ kind }))),
        Stream.never,
      ),
    )
  return { watchBatch, release: () => release() }
}

const screen = ({
  route,
  element = <ParticipantResultsPage />,
  capabilities,
  queue = [],
  claims = [
    claim(1, OWN_ITEM, 'approved'),
    claim(2, OWN_ITEM, 'in_review'),
    claim(3, RECORDED_ITEM, 'voided', { source: 'record' }),
    claim(4, RECORDED_ITEM, 'approved', { source: 'record' }),
  ],
  who = participant(),
  stubs = {},
  locale = 'zh-CN',
}: {
  route: string
  locale?: 'zh-CN' | 'en-US'
  element?: ReactNode
  capabilities?: Record<string, boolean>
  claims?: readonly unknown[]
  /** the reader's own review queue in the round, read again on every ask */
  queue?: readonly unknown[] | (() => readonly unknown[])
  who?: unknown
  /** any read or write the case needs answered its own way */
  stubs?: Record<string, unknown>
}) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: [
              {
                id: 'assessment/batch-results',
                path: '/assessment/batches/:batchId/results',
                layout: 'admin',
              },
              {
                id: 'assessment/batch-record',
                path: '/assessment/batches/:batchId/record',
                layout: 'admin',
              },
              {
                id: 'assessment/review-instance',
                path: '/assessment/batches/:batchId/reviews/:instanceId',
                layout: 'admin',
              },
            ],
          }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch(capabilities) }),
        listParticipants: () => Effect.succeed({ items: [who], nextCursor: null }),
        listParticipantPlacements: () =>
          Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
        getParticipant: () => Effect.succeed({ participant: who }),
        getParticipantResult: () => Effect.succeed(account()),
        // the list the page was opened from; nobody on it unless a case says
        listParticipantAccounts: () =>
          Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
        listParticipantEntries: () =>
          Effect.succeed({ participantId: PARTICIPANT_ID, entries: claims, nextCursor: null }),
        listItems: () =>
          Effect.succeed({
            items: [
              question(OWN_ITEM, '科研成果', ['participant'], 1),
              question(RECORDED_ITEM, '体测加分', ['administrative'], 2),
            ],
            version: 1,
          }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              {
                id: GROUP_ID,
                parentGroupId: null,
                name: '学业发展',
                cap: '10.00',
                floor: null,
                sortOrder: 0,
                itemCount: 2,
              },
            ],
            version: 1,
          }),
        listRosterUnits: () => Effect.succeed({ units: UNITS, userTypes: [] }),
        listUserTypeOptions: () =>
          Effect.succeed({ userTypes: [{ id: 'type-student', code: 'student', name: '学生' }] }),
        getRecognitionContract: () => Effect.succeed({ contract: null }),
        listReviewInbox: () =>
          Effect.succeed({
            items: typeof queue === 'function' ? queue() : queue,
            nextCursor: null,
            handledToday: 0,
            judging: true,
          }),
        getEntryHistory: () => Effect.succeed({ revisions: [], rounds: [], events: [] }),
        ...stubs,
      },
    }),
    routes: [{ path: '/assessment/batches/:batchId/results', element }],
    route,
    locale,
  })

const base = `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`
const rows = () => [...document.querySelectorAll('[data-testid="claim-row"]')]
/** where the heading says the person stands */
const unitFact = () => document.querySelector('[data-fact="unit"]')
/** that place as the path it is said by, from the top down */
const unitSaid = () => unitFact()?.getAttribute('data-path') ?? ''

/** nothing waiting on anybody's claims, as a roster row counts them */
const NO_FILINGS = { inReview: 0, toSupplement: 0, reconsidering: 0, toRevise: 0, blocked: 0 }

/** the list the reader goes back to, with its totals and its doors */
const listReads = {
  listParticipantScores: () => Effect.succeed({ scores: [] }),
  listScopeOptions: () => Effect.succeed({ nodes: [] }),
  listParticipantCandidates: () => Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
  previewImport: () => Effect.succeed({ candidates: 0 }),
}

/** the browser's back key, which a router held in memory has no button for */
function BackKey() {
  const navigate = useNavigate()
  return (
    <button type="button" hidden data-testid="history-back" onClick={() => void navigate(-1)}>
      back
    </button>
  )
}

const pressBack = () =>
  (document.querySelector('[data-testid="history-back"]') as HTMLButtonElement).click()

/** a wake-up channel that opens at once and stays open */
const openLine = () =>
  Effect.succeed(Stream.concat(Stream.make({ kind: 'sync' as const }), Stream.never))

describe('reading somebody’s entries', () => {
  // Up to a section from a question's requirements is somewhere the back key
  // returns from, on a desk as on the participant's own page.
  it('brings the back key back from a section to the question', async () => {
    await page.viewport(1440, 900)
    // two groups at the top, so the question's own is a section it sits in
    // rather than the paper itself
    const OTHER_GROUP = '55555555-5555-4555-8555-555555555559'
    const group = (id: string, name: string, sortOrder: number) => ({
      id,
      parentGroupId: null,
      name,
      cap: '10.00',
      floor: null,
      sortOrder,
      itemCount: 2,
    })
    await screen({
      route: `${base}&view=entries&open=${OWN_ITEM}`,
      element: (
        <>
          <ParticipantResultsPage />
          <BackKey />
        </>
      ),
      stubs: {
        listScoreGroups: () =>
          Effect.succeed({
            groups: [group(GROUP_ID, '学业发展', 0), group(OTHER_GROUP, '文体素养', 1)],
            version: 1,
          }),
        listItems: () =>
          Effect.succeed({
            items: [
              question(OWN_ITEM, '科研成果', ['participant'], 1),
              {
                ...question(RECORDED_ITEM, '体测加分', ['administrative'], 2),
                scoreGroupId: OTHER_GROUP,
              },
            ],
            version: 1,
          }),
      },
    })
    await expect.poll(() => rows().length).toBe(2)
    const aside = page.getByRole('complementary', { name: '填报要求' })
    await userEvent.click(aside.element().querySelector(`[data-section="${GROUP_ID}"]`)!)
    await expect.poll(() => addressNow()).toContain(`open=${GROUP_ID}`)
    pressBack()
    await expect.poll(() => addressNow()).toContain(`open=${OWN_ITEM}`)
  })

  // The account follows the round while the line is open, and the head says
  // so; one that no longer moves says nothing of the kind.
  it('says the account is kept live while the round runs', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries`, stubs: { watchBatch: openLine } })
    await expect.element(page.getByTestId('entries-live')).toHaveAttribute('data-state', 'live')
  })

  it('says nothing about keeping current once the round is archived', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: `${base}&view=entries`,
      stubs: {
        watchBatch: openLine,
        getBatch: () => Effect.succeed({ batch: { ...batch(), status: 'archived' } }),
      },
    })
    await expect.poll(() => rows().length).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(page.getByTestId('entries-live').elements()).toHaveLength(0)
  })

  it('says who the person is and where they stand, above their account', async () => {
    await screen({ route: base, who: participant({ placement: 'changed' }) })
    await expect.element(page.getByText('郭航旗')).toBeVisible()
    const fact = (key: string) =>
      document.querySelector(`[data-fact="${key}"]`)?.textContent?.trim() ?? ''
    await expect.poll(() => unitSaid()).toBe('软件学院 / 软件2301班')
    await expect.poll(() => fact('kind')).toBe('学生')
    expect(fact('number')).toBe('2023123456')
    await expect
      .element(page.getByTestId('participant-roster'))
      .toHaveAttribute('data-status', 'active')
    // the organization has them somewhere else now: said, not acted on
    await expect
      .element(page.getByTestId('participant-placement'))
      .toHaveAttribute('data-placement', 'changed')
  })

  it('reads the claims in the workspace the person files in, with no way to file', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries` })
    await expect.element(page.getByTestId('entries-workspace')).toBeVisible()
    await expect.poll(() => rows().length).toBe(2)
    expect(page.getByTestId('file-claim').elements()).toHaveLength(0)
    // the account's own figures at the head, as the staff reader counts them
    await expect
      .poll(() => document.querySelector('[data-stat="in_review"]')?.getAttribute('data-count'))
      .toBe('1')
    expect(document.querySelector('[data-stat="approved"]')?.getAttribute('data-count')).toBe('2')
    // what is still moving narrows the structure to the question it is on
    await expect.element(page.getByTestId('rail-todo')).toHaveAttribute('data-count', '1')
  })

  it('keeps a withdrawn record under a filter of its own', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries&open=${RECORDED_ITEM}` })
    await expect.poll(() => rows().length).toBe(1)
    const voided = () => document.querySelector('[data-chip="voided"]')
    await expect.poll(() => voided()?.getAttribute('data-count')).toBe('1')
    await userEvent.click(voided()!)
    await expect
      .poll(() => rows().map((row) => row.getAttribute('data-entry')))
      .toEqual([entryId(3)])
    expect(rows()[0]!.getAttribute('data-standing')).toBe('voided')
  })

  it('reads a question left with only a withdrawn record as empty, the record a filter away', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: `${base}&view=entries&open=${RECORDED_ITEM}`,
      claims: [claim(3, RECORDED_ITEM, 'voided', { source: 'record' })],
    })
    await expect.element(page.getByTestId('entries-tray')).toBeVisible()
    expect(page.getByTestId('entries-no-match').elements()).toHaveLength(0)
    await userEvent.click(document.querySelector('[data-chip="voided"]')!)
    await expect
      .poll(() => rows().map((row) => row.getAttribute('data-entry')))
      .toEqual([entryId(3)])
  })

  // What waits on this reader is the server's queue, never a guess from the
  // claim's state: one of the two claims in review is theirs to decide.
  it('marks what waits on the reader’s own decision, with the way to it', async () => {
    await page.viewport(1440, 900)
    const INSTANCE = '99999999-9999-4999-8999-999999999991'
    await screen({
      route: `${base}&view=entries&open=${OWN_ITEM}`,
      capabilities: { review: true },
      claims: [claim(1, OWN_ITEM, 'in_review'), claim(2, OWN_ITEM, 'in_review')],
      queue: [
        {
          instanceId: INSTANCE,
          entryId: entryId(2),
          batchId: BATCH_ID,
          batchName: '2026 春季综测',
          itemId: OWN_ITEM,
          itemTitle: '科研成果',
          participantName: '郭航旗',
          businessNo: '2023123456',
          unitId: null,
          unitName: null,
          roundNo: 1,
          route: 'normal',
          values: [],
          attachmentCount: 0,
          submittedAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    })
    await expect.element(page.getByTestId('awaiting-me')).toHaveAttribute('data-count', '1')
    await expect
      .poll(() =>
        rows()
          .filter((row) => row.hasAttribute('data-awaiting-me'))
          .map((row) => row.getAttribute('data-entry')),
      )
      .toEqual([entryId(2)])
    expect(
      page.getByTestId('awaiting-me').getByRole('link').element().getAttribute('href'),
    ).toContain(INSTANCE)
  })

  it('reads no queue for a reader who does not review in the round', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries&open=${OWN_ITEM}` })
    await expect.poll(() => rows().length).toBe(2)
    expect(page.getByTestId('awaiting-me').elements()).toHaveLength(0)
  })

  it('offers the office’s own record only where the reader holds that power', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: `${base}&view=entries&open=${RECORDED_ITEM}`,
      capabilities: { record: true },
    })
    const record = page.getByTestId('staff-record')
    await expect.element(record).toBeVisible()
    expect(record.element().getAttribute('href')).toContain('mode=manual')
  })

  it('does not offer a record to a reader without that power', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries&open=${RECORDED_ITEM}` })
    await expect.poll(() => rows().length).toBe(1)
    expect(page.getByTestId('staff-record').elements()).toHaveLength(0)
  })

  it('lands a claim followed from the account on its own question', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries&entry=${entryId(4)}` })
    // the question the claim was filed under is written into the address,
    // so closing the drawer leaves the reader there
    await expect.poll(() => addressNow()).toContain(`open=${RECORDED_ITEM}`)
    await expect
      .poll(() => document.querySelector('[data-testid="item-pane"]')?.getAttribute('data-item'))
      .toBe(RECORDED_ITEM)
    await expect.element(page.getByRole('dialog')).toBeVisible()
  })

  it('walks a phone from the structure into one question', async () => {
    await page.viewport(390, 844)
    await screen({ route: `${base}&view=entries` })
    await expect
      .poll(() =>
        document.querySelector('[data-testid="entries-workspace"]')?.getAttribute('data-screen'),
      )
      .toBe('structure')
    await page.getByRole('button', { name: /科研成果/ }).click()
    await expect.poll(() => addressNow()).toContain(`open=${OWN_ITEM}`)
    await expect.poll(() => rows().length).toBe(2)
    // opened with nobody either side on the list, no keys are drawn for them
    expect(page.getByTestId('roster-neighbors').elements()).toHaveLength(0)
  })

  // Opened from the list, somebody's claims are what the page is for; the
  // total is the other tab.
  it('opens on the claims unless the address asks for the total', async () => {
    await page.viewport(1440, 900)
    await screen({ route: base })
    await expect.element(page.getByTestId('entries-workspace')).toBeVisible()
    await expect
      .element(page.getByTestId('participant-tab-entries'))
      .toHaveAttribute('aria-current', 'true')
    // the page's own heading is the person; the workspace's name sits under it
    await expect
      .element(page.getByTestId('structure-rail').getByRole('heading', { level: 2 }))
      .toBeInTheDocument()
    expect(document.querySelectorAll('[data-testid="entries-workspace"] h1')).toHaveLength(0)
    // and the section's own heading, parked out of sight, is not a second one
    await expect.poll(() => page.getByRole('heading', { level: 1 }).elements().length).toBe(1)
    expect(page.getByRole('heading', { level: 1 }).element().textContent).toContain('郭航旗')

    await page.getByTestId('participant-tab-score').click()
    await expect.element(page.getByTestId('result-ledger')).toBeVisible()
    await expect.poll(() => addressNow()).toContain('view=score')
  })

  // The question the reader had open before is not where a followed number
  // leads: the claim's own question is, every time.
  it('follows a number to its claim’s question, whatever question was open', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: `${base}&view=score&open=${OWN_ITEM}`,
      claims: [
        claim(1, OWN_ITEM, 'approved'),
        claim(4, RECORDED_ITEM, 'approved', { source: 'record' }),
      ],
      stubs: {
        getParticipantResult: () =>
          Effect.succeed(account([counted(1, OWN_ITEM), counted(4, RECORDED_ITEM, '2.00')])),
      },
    })
    const line = () =>
      document.querySelector(`[data-testid="ledger-line"][data-entry="${entryId(4)}"]`)
    await expect.poll(line).not.toBeNull()
    await userEvent.click(line()!)
    await expect.poll(() => addressNow()).toContain(`open=${RECORDED_ITEM}`)
    await expect
      .poll(() => document.querySelector('[data-testid="item-pane"]')?.getAttribute('data-item'))
      .toBe(RECORDED_ITEM)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(addressNow()).toContain(`entry=${entryId(4)}`)
  })

  it('opens a claim the address names on its own question, over another one', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&open=${OWN_ITEM}&entry=${entryId(4)}` })
    await expect.poll(() => addressNow()).toContain(`open=${RECORDED_ITEM}`)
    await expect
      .poll(() => document.querySelector('[data-testid="item-pane"]')?.getAttribute('data-item'))
      .toBe(RECORDED_ITEM)
  })

  // A question with more claims than the account lists leads to all of them,
  // on the claims half, at that question.
  it('takes a question with more claims than the account lists to all of them', async () => {
    await page.viewport(1440, 900)
    const many = Array.from({ length: 8 }, (_, i) => claim(10 + i, OWN_ITEM, 'approved'))
    await screen({
      route: `${base}&view=score`,
      claims: many,
      stubs: {
        getParticipantResult: () =>
          Effect.succeed(account(many.map((_, i) => counted(10 + i, OWN_ITEM, '0.25')))),
      },
    })
    const item = () =>
      document.querySelector(`[data-testid="ledger-item"][data-item="${OWN_ITEM}"]`)
    await expect.poll(item).not.toBeNull()
    await userEvent.click(item()!.querySelector('button')!)
    const more = page.getByTestId('ledger-more')
    await expect.element(more).toHaveAttribute('data-count', '8')
    await more.click()
    await expect.poll(() => addressNow()).toContain(`open=${OWN_ITEM}`)
    expect(addressNow()).not.toContain('view=score')
    await expect
      .poll(() => document.querySelector('[data-testid="item-pane"]')?.getAttribute('data-item'))
      .toBe(OWN_ITEM)
  })

  it('offers no recalculation for an account too large to evaluate', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: `${base}&view=score`,
      stubs: {
        getParticipantResult: () => Effect.fail(apiError('ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE')),
      },
    })
    const panel = page.getByTestId('result-unavailable')
    await expect.element(panel).toHaveAttribute('data-reason', 'too-large')
    expect(panel.getByRole('button').elements()).toHaveLength(0)
  })

  // The claims stay readable while the score is out of reach, and say that
  // every figure on them is unknown for now, with the way to ask again.
  it('says over the claims that the score is out of reach, and asks again', async () => {
    await page.viewport(1440, 900)
    let down = true
    const scored = vi.fn(() =>
      down ? Effect.fail(apiError('ASSESSMENT_SCORING_UNAVAILABLE')) : Effect.succeed(account()),
    )
    await screen({ route: base, stubs: { getParticipantResult: scored } })
    const notice = page.getByTestId('standing-unavailable')
    await expect.element(notice).toHaveAttribute('data-standing', 'unavailable')
    await expect.poll(() => rows().length).toBeGreaterThan(0)
    down = false
    await notice.getByRole('button').click()
    await expect.element(page.getByTestId('standing-unavailable')).not.toBeInTheDocument()
  })

  it('says the structure could not be read rather than drawing it without sections', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: base,
      stubs: { listScoreGroups: () => Effect.fail(apiError('SERVICE_UNAVAILABLE')) },
    })
    await expect.element(page.getByRole('button', { name: '重试' })).toBeVisible()
    expect(page.getByTestId('entries-workspace').elements()).toHaveLength(0)
  })

  // Somebody else deciding the round takes it off this reader's queue, and
  // the mark on this page goes with it without a reload.
  it('takes a round off the reader’s marks when the queue moves elsewhere', async () => {
    await page.viewport(1440, 900)
    const INSTANCE = '99999999-9999-4999-8999-999999999991'
    const row = {
      instanceId: INSTANCE,
      entryId: entryId(2),
      batchId: BATCH_ID,
      batchName: '2026 春季综测',
      itemId: OWN_ITEM,
      itemTitle: '科研成果',
      participantName: '郭航旗',
      businessNo: '2023123456',
      unitId: null,
      unitName: null,
      roundNo: 1,
      route: 'normal',
      values: [],
      attachmentCount: 0,
      submittedAt: '2026-03-01T00:00:00.000Z',
    }
    let waiting: readonly unknown[] = [row]
    const { watchBatch, release } = wakeOnce('review-inbox-changed')
    await screen({
      route: `${base}&open=${OWN_ITEM}`,
      capabilities: { review: true },
      claims: [claim(1, OWN_ITEM, 'in_review'), claim(2, OWN_ITEM, 'in_review')],
      queue: () => waiting,
      stubs: { watchBatch },
    })
    await expect.element(page.getByTestId('awaiting-me')).toHaveAttribute('data-count', '1')
    waiting = []
    release()
    await expect.element(page.getByTestId('awaiting-me')).not.toBeInTheDocument()
    expect(rows().filter((one) => one.hasAttribute('data-awaiting-me'))).toHaveLength(0)
  })

  // Somebody in the round saving a draft reads this person's account again,
  // and never the reader's whole queue: a queue moves only with its own
  // wake-ups.
  it('reads the account again on a claim’s wake-up, and leaves the queue be', async () => {
    await page.viewport(1440, 900)
    let queueReads = 0
    const claimReads = vi.fn(() =>
      Effect.succeed({
        participantId: PARTICIPANT_ID,
        entries: [claim(1, OWN_ITEM, 'in_review')],
        nextCursor: null,
      }),
    )
    const { watchBatch, release } = wakeOnce('entries-changed')
    await screen({
      route: `${base}&open=${OWN_ITEM}`,
      capabilities: { review: true },
      queue: () => {
        queueReads += 1
        return []
      },
      stubs: { watchBatch, listParticipantEntries: claimReads },
    })
    await expect.poll(() => rows().length).toBe(1)
    await expect.poll(() => queueReads).toBeGreaterThan(0)
    const claimsBefore = claimReads.mock.calls.length
    const queueBefore = queueReads
    release()
    await expect.poll(() => claimReads.mock.calls.length).toBeGreaterThan(claimsBefore)
    // any read the same wake-up asked for has been asked for by now
    await new Promise((settle) => setTimeout(settle, 200))
    expect(queueReads).toBe(queueBefore)
  })

  // Walking down the list keeps the half and the question being read, so one
  // question can be read person after person; the claim that was open was
  // the last person's. Going back to the list leaves the question behind.
  it('walks to the next person on the same question, and back to the list without it', async () => {
    await page.viewport(1440, 900)
    const OTHER = '22222222-2222-4222-8222-222222222223'
    await screen({
      route: `${base}&view=score&open=${OWN_ITEM}&entry=${entryId(1)}`,
      stubs: {
        ...listReads,
        listParticipantAccounts: () =>
          Effect.succeed({
            items: [participant(), participant({ id: OTHER, displayName: '王君惠' })].map(
              (row) => ({ ...row, filings: NO_FILINGS }),
            ),
            total: 2,
            page: 1,
            pageSize: 20,
          }),
      },
    })
    const strip = page.getByTestId('roster-neighbors')
    await expect.element(strip).toHaveAttribute('data-position', '1')
    await strip.getByRole('button', { name: '下一位' }).click()
    await expect.poll(() => addressNow()).toContain(`participant=${OTHER}`)
    expect(addressNow()).toContain('view=score')
    expect(addressNow()).toContain(`open=${OWN_ITEM}`)
    expect(addressNow()).not.toContain('entry=')

    await page.getByRole('button', { name: '返回参评名单' }).click()
    await expect.poll(() => addressNow()).not.toContain('participant=')
    expect(addressNow()).not.toContain('open=')
  })

  // Thousands on the list, the way to either neighbour still fits at the
  // end of the tab row - beside the tabs, or under them - on a tablet and
  // on a phone, in either language.
  it.each([
    [390, 844, 'zh-CN'],
    [390, 844, 'en-US'],
    [834, 1112, 'zh-CN'],
    [834, 1112, 'en-US'],
  ] as const)(
    'keeps the way to the next of thousands inside a %ix%i screen (%s)',
    async (wide, high, locale) => {
      await page.viewport(wide, high)
      const people = Array.from({ length: 20 }, (_, i) =>
        i === 10
          ? participant()
          : participant({
              id: `22222222-2222-4222-8222-3333333333${String(i).padStart(2, '0')}`,
              displayName: `参评人${String(i)}`,
            }),
      )
      await screen({
        route: `${base}&list-page=62`,
        locale,
        stubs: {
          ...listReads,
          listParticipantAccounts: () =>
            Effect.succeed({
              items: people.map((one) => ({ ...one, filings: NO_FILINGS })),
              total: 3456,
              page: 62,
              pageSize: 20,
            }),
        },
      })
      const strip = page.getByTestId('roster-neighbors')
      await expect.element(strip).toHaveAttribute('data-position', '1231')
      expect(strip.element().getAttribute('data-total')).toBe('3456')
      const keys = strip.getByRole('button').elements()
      expect(keys).toHaveLength(2)
      const tabs = [
        page.getByTestId('participant-tab-entries').element(),
        page.getByTestId('participant-tab-score').element(),
      ]
      // nothing in the row runs past it, or past the screen
      const row = tabs[0]!.parentElement!
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
      for (const piece of [...tabs, ...keys, strip.element()]) {
        const at = piece.getBoundingClientRect()
        expect(at.width).toBeGreaterThan(0)
        expect(at.left).toBeGreaterThanOrEqual(0)
        expect(at.right).toBeLessThanOrEqual(wide)
      }
      for (const key of keys) await expect.element(key).toBeVisible()
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(wide)
      // the open tab stands on the row's rule, whatever else the row holds
      expect(
        Math.abs(tabs[0]!.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom),
      ).toBeLessThanOrEqual(2)
    },
  )

  // A unit the organization has since taken away is still where they were
  // admitted from: it keeps its place on the path, unnamed.
  it('keeps a unit it can no longer name in its place on the path', async () => {
    await screen({
      route: base,
      who: participant({
        anchorNodeId: 'n9',
        anchorLineage: [
          { nodeId: 'n9', nodeTypeId: 'class' },
          { nodeId: 'n1', nodeTypeId: 'college' },
          { nodeId: 'n0', nodeTypeId: 'school' },
        ],
      }),
    })
    await expect.poll(() => unitFact()?.getAttribute('data-unknown')).toBe('1')
    expect(unitSaid()).toBe('软件学院 / …')
  })

  // Nobody left on the round may stand in the class somebody taken off it
  // was admitted from; the heading still names it.
  it('names the unit of somebody taken off the round', async () => {
    const asked = vi.fn((request: { query?: Record<string, string> }) =>
      Effect.succeed({
        units:
          request.query?.['status'] === 'all' ? UNITS : UNITS.filter((unit) => unit.id !== 'n2'),
        userTypes: [],
      }),
    )
    await screen({
      route: base,
      who: participant({ status: 'excluded', excludedAt: '2026-03-10T00:00:00.000Z' }),
      stubs: { listRosterUnits: asked },
    })
    await expect.poll(() => unitSaid()).toBe('软件学院 / 软件2301班')
    expect(unitFact()?.getAttribute('data-unknown')).toBe('0')
    // through the door the list it was opened from reads its units by
    expect(asked.mock.calls.at(-1)![0].query).toEqual({ reading: 'accounts', status: 'all' })
  })

  it('says where somebody stands the same way on the list and over their account', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: `/assessment/batches/${BATCH_ID}/results`,
      stubs: {
        ...listReads,
        listParticipantAccounts: () =>
          Effect.succeed({
            items: [{ ...participant(), filings: NO_FILINGS }],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
      },
    })
    const listed = page.getByTestId('participant-unit')
    await expect.element(listed).toHaveAttribute('data-path', '软件学院 / 软件2301班')
    const onList = listed.element().getAttribute('data-path')
    await page.getByTestId('participant-row').click()
    await expect.poll(() => addressNow()).toContain(`participant=${PARTICIPANT_ID}`)
    await expect.poll(() => unitSaid()).toBe(onList)
  })
})
