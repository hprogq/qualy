import ParticipantResultsPage from '../src/client/result/ParticipantResultsPage.tsx'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import { useEffect } from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect, Queue, Stream } from 'effect'
import zhCN from '../src/client/locales/zh-CN.ts'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The staff account, as somebody uses it: find a person, read why their
// total is what it is, follow a number back to the filing that earned it,
// and send that filing back for revision.
//
// What a service test cannot see is all of it: that opening a person is a
// level down inside one page rather than a journey to another, that the
// address remembers who is open so a reload lands there, that the browser's
// own back button is the way out, and that a number is a way in to the claim
// behind it.

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'
const ITEM_ID = '44444444-4444-4444-8444-444444444444'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const GROUP_ID = '66666666-6666-4666-8666-666666666666'
const REVISION_ID = '77777777-7777-4777-8777-777777777777'

const batch = {
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: false, manage: true, redetermine: false },
  participantCount: 2,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
}

const participant = (over: Record<string, unknown> = {}) => ({
  id: PARTICIPANT_ID,
  userId: '88888888-8888-4888-8888-888888888888',
  displayName: '郭航旗',
  businessNo: '2023123456',
  userTypeId: '99999999-9999-4999-8999-999999999999',
  anchorNodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  anchorPath: 'root.a.a1',
  anchorLineage: [],
  status: 'active' as const,
  includedAt: '2026-02-02T00:00:00.000Z',
  excludedAt: null,
  placement: 'current' as const,
  ...over,
})

const item = {
  id: ITEM_ID,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title: 'CET-6',
  scoreGroupId: GROUP_ID,
  sortOrder: 0,
  status: 'active',
  maxEntries: 1,
  currentRevision: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    revisionNo: 1,
    entryChannels: ['participant'],
    formConfig: { files: {} },
    scoringConfig: null,
    reviewPolicy: null,
    createdAt: '2026-02-03T00:00:00.000Z',
  },
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: ENTRY_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  participantId: PARTICIPANT_ID,
  status: 'approved',
  source: 'self',
  currentRevision: {
    id: REVISION_ID,
    revisionNo: 1,
    itemRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    payload: {},
    note: null,
    source: 'self',
    actorId: '88888888-8888-4888-8888-888888888888',
    subjectId: '88888888-8888-4888-8888-888888888888',
    attachments: [],
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  currentReviewInstanceId: null,
  supplement: null,
  refusal: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  capabilities: {
    edit: { state: 'hidden', reason: null },
    submit: { state: 'hidden', reason: null },
    withdraw: { state: 'hidden', reason: null },
    abandon: { state: 'hidden', reason: null },
    appeal: { state: 'hidden', reason: null },
    answerSupplement: { state: 'hidden', reason: null },
  },
  ...over,
})

const account = {
  mode: 'provisional' as const,
  total: '1.00',
  groups: [
    {
      groupId: GROUP_ID,
      parentGroupId: null,
      depth: 0,
      name: '语言能力',
      itemsTotal: '1.00',
      childrenTotal: '0.00',
      raw: '1.00',
      final: '1.00',
      cap: '5.00',
      floor: null,
    },
  ],
  lines: [
    {
      lineId: `itm:${ITEM_ID}`,
      kind: 'entry' as const,
      label: 'CET-6',
      value: '1.00',
      itemId: ITEM_ID,
      provenance: { entryId: ENTRY_ID, entryRevisionId: REVISION_ID },
    },
  ],
}

/** one page of the roster as the results page reads it: nobody waiting on anything */
const rosterPage = (rows: readonly ReturnType<typeof participant>[]) =>
  Effect.succeed({
    items: rows.map((row) => ({
      ...row,
      filings: { inReview: 0, toSupplement: 0, reconsidering: 0, toRevise: 0, blocked: 0 },
    })),
    total: rows.length,
    page: 1,
    pageSize: 20,
  })

const PAGES = [
  { id: 'assessment/batch-results', path: '/assessment/batches/:batchId/results', layout: 'admin' },
]

/**
 * The browser's own back and forward, which a modal question on the page
 * does not hold: the router's history, stepped from outside the screen.
 */
const travel = { go: (_delta: number) => {} }
function Travel() {
  const navigate = useNavigate()
  useEffect(() => {
    travel.go = (delta) => void navigate(delta)
  }, [navigate])
  return null
}

interface Request {
  params?: Record<string, string>
  payload?: Record<string, unknown>
  query?: Record<string, string>
}

const screen = (
  over: Record<string, unknown> = {},
  route = `/assessment/batches/${BATCH_ID}/results`,
) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch }),
        // the roster's own doors: this page adds people to the round now
        previewImport: () => Effect.succeed({ candidates: 0 }),
        importParticipants: () => Effect.succeed({ added: 0 }),
        addParticipants: () => Effect.succeed({ added: 0, skipped: 0 }),
        setParticipantStatus: () => Effect.succeed({ ok: true }),
        listParticipantPlacements: () =>
          Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
        reviewAlerts: () =>
          Effect.succeed({
            groups: [],
            unreachable: { routes: [], cannotSubmit: 0, cannotAppeal: 0 },
          }),
        listParticipantAccounts: () =>
          rosterPage([participant(), participant({ id: OTHER_ID, displayName: '王君惠' })]),
        listParticipantScores: (request: { query?: { participantIds?: string | string[] } }) =>
          Effect.succeed({
            scores: [request.query?.participantIds ?? []].flat().map((participantId) => ({
              participantId,
              state: 'scored' as const,
              total: '1.00',
              reason: null,
            })),
          }),
        // what the add and import dialogs read, from this domain
        listScopeOptions: () => Effect.succeed({ nodes: [] }),
        listParticipantCandidates: () =>
          Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
        getParticipant: (request: Request) =>
          Effect.succeed({ participant: participant({ id: request.params?.['participantId'] }) }),
        getParticipantResult: () => Effect.succeed(account),
        // where the person stands, named for the heading over their account
        listRosterUnits: () =>
          Effect.succeed({
            units: [
              { id: 'n1', name: '软件学院', parentId: null },
              { id: 'n2', name: '软件2301班', parentId: 'n1' },
            ],
          }),
        // the reader's own review queue, which marks what waits on them
        listReviewInbox: () =>
          Effect.succeed({ items: [], nextCursor: null, handledToday: 0, judging: true }),
        listUserTypeOptions: () =>
          Effect.succeed({
            userTypes: [
              { id: '99999999-9999-4999-8999-999999999999', code: 'student', name: '学生' },
            ],
          }),
        listParticipantEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              {
                entry: entry(),
                recognition: {
                  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                  source: 'review' as const,
                  entryRevisionId: REVISION_ID,
                  values: { 'dddddddd-dddd-4ddd-8ddd-dddddddddddd': '省级' },
                  createdAt: Date.parse('2026-03-02T00:00:00.000Z'),
                  createdByName: '王老师',
                  byPanel: false,
                },
              },
            ],
            nextCursor: null,
          }),
        listItems: () => Effect.succeed({ items: [item], version: 1 }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              {
                id: GROUP_ID,
                parentGroupId: null,
                name: '语言能力',
                cap: '5.00',
                floor: null,
                sortOrder: 0,
                itemCount: 1,
              },
            ],
            version: 1,
          }),
        getRecognitionContract: () =>
          Effect.succeed({
            contract: {
              itemRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              fields: [
                {
                  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                  schema: { type: 'string', title: '等级' },
                },
              ],
              defaults: [],
            },
          }),
        getEntryHistory: () =>
          Effect.succeed({ entryId: ENTRY_ID, revisions: [], rounds: [], events: [] }),
        ...over,
      },
    }),
    routes: [{ path: '/assessment/batches/:batchId/results', element: <ParticipantResultsPage /> }],
    route,
  })

describe('the participant results screen', () => {
  it('gives the unit tree the window from where it stands to the bottom', async () => {
    await page.viewport(1280, 800)
    try {
      await screen()
      await expect.element(page.getByText('郭航旗')).toBeVisible()
      const seat = page.getByTestId('sticky-fill')
      await expect.element(seat).toHaveAttribute('data-filling', 'true')
      // the tree beside a list reaches the foot of the window, not the end of its rows
      await expect
        .poll(() => window.innerHeight - seat.element().getBoundingClientRect().bottom)
        .toBeLessThan(40)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('offers a move the organization made, and syncs only what it showed', async () => {
    const decided = vi.fn((_request: Request) => Effect.succeed({ synced: 1, kept: 0 }))
    const moved = {
      participantId: PARTICIPANT_ID,
      displayName: '郭航旗',
      businessNo: '2023123456',
      standing: 'changed' as const,
      unavailable: null,
      changes: ['placement'],
      frozen: {
        units: [
          { id: 'n1', name: '软件学院' },
          { id: 'n2', name: '软件2301班' },
        ],
        userType: { id: 't1', name: '学生' },
      },
      current: {
        units: [
          { id: 'n1', name: '软件学院' },
          { id: 'n3', name: '软件2302班' },
        ],
        userType: { id: 't1', name: '学生' },
      },
      currentBeyondReach: false,
      canSync: true,
      observedFingerprint: 'f'.repeat(64),
    }
    await screen({
      listParticipantAccounts: () =>
        rosterPage([
          participant({ placement: 'changed' }),
          participant({ id: OTHER_ID, displayName: '王君惠' }),
        ]),
      listParticipantPlacements: () =>
        Effect.succeed({ items: [moved], nextCursor: null, changedTotal: 1, unavailableTotal: 0 }),
      reviewAlerts: () =>
        Effect.succeed({
          groups: [],
          unreachable: { routes: [], cannotSubmit: 0, cannotAppeal: 0 },
        }),
      reconcileParticipantPlacements: decided,
    })
    // the roster marks who moved, and only them
    await expect
      .element(page.getByTestId('placement-mark'))
      .toHaveAttribute('data-placement', 'changed')
    expect(page.getByTestId('placement-mark').elements()).toHaveLength(1)
    const notice = page.getByTestId('placement-notice')
    await expect.element(notice).toHaveAttribute('data-changed', '1')

    await notice.getByRole('button').click()
    const row = page.getByTestId('placement-difference')
    await expect.element(row).toHaveAttribute('data-changes', 'placement')
    await expect.element(row.getByText('软件学院 / 软件2302班')).toBeVisible()
    await row.getByRole('button', { name: '同步' }).click()
    await expect.poll(() => decided.mock.calls.length).toBe(1)
    // the decision names what was shown, never where to put them
    expect(decided.mock.calls[0]![0].payload).toEqual({
      decisions: [
        { participantId: PARTICIPANT_ID, observedFingerprint: 'f'.repeat(64), decision: 'sync' },
      ],
    })
  })

  it('opens a person into the same page, and the address says who', async () => {
    await screen()
    await expect.element(page.getByText('郭航旗')).toBeVisible()
    await expect.element(page.getByText('王君惠')).toBeVisible()

    await page.getByTestId('participant-row').first().click()
    // that person's claims, in the page the list was in, and their total a tab away
    await expect.element(page.getByTestId('entries-workspace')).toBeVisible()
    await page.getByTestId('participant-tab-score').click()
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    // the address says who is open, which is what makes a reload and a
    // shared link land here; the router is in memory, so this is the address
    expect(addressNow()).toContain(`participant=${PARTICIPANT_ID}`)
  })

  it('makes its entrance once, not again on the way back from a person', async () => {
    await screen()
    const first = page.getByTestId('participant-row').first()
    await expect.element(first).toBeVisible()
    // the list arrives with the screen's own entrance
    expect(document.querySelector('[data-arrival="still"]')).toBeNull()
    await first.click()
    await expect.poll(() => addressNow()).toContain('participant=')
    await page.getByRole('button', { name: '返回参评名单' }).click()
    await expect.poll(() => addressNow()).not.toContain('participant=')
    await expect.element(page.getByTestId('participant-row').first()).toBeVisible()
    // coming back is a move inside the screen, which says so on its own
    expect(document.querySelector('[data-arrival="still"]')).not.toBeNull()
  })

  it('restores an open account from the address alone', async () => {
    await screen(
      {},
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=score`,
    )
    // no press: a reload or a shared link lands on the person
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    await expect.element(page.getByText('2023123456')).toBeVisible()
  })

  it('follows a scored line back to the claim that earned it', async () => {
    await screen()
    await page.getByTestId('participant-row').first().click()
    await page.getByTestId('participant-tab-score').click()
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    await page.getByTestId('ledger-line').click()
    // the claim opens over its question on the claims half, and the address
    // remembers all three
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(addressNow()).toContain(`entry=${ENTRY_ID}`)
    expect(addressNow()).toContain(`open=${ITEM_ID}`)
    expect(addressNow()).not.toContain('view=')
    // what the round determined, which the owner's own page never showed
    await expect.element(page.getByText('省级')).toBeVisible()
    await expect.element(page.getByText('王老师', { exact: false })).toBeVisible()
  })

  it('sends a claim back for revision, with a reason', async () => {
    const interveneOnEntry = vi.fn((_request: Request) =>
      Effect.succeed({ entry: entry({ status: 'needs_revision' }) }),
    )
    await screen(
      { interveneOnEntry },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await page.getByRole('button', { name: '退回修改' }).click()
    await userEvent.fill(page.getByRole('textbox'), '证书与本人不符')
    // the dialog commits in the act's own words, not "save"
    await page.getByRole('button', { name: '退回修改' }).last().click()
    expect(interveneOnEntry).toHaveBeenCalledTimes(1)
    const sent = interveneOnEntry.mock.calls[0]![0]
    expect(sent.params?.['entryId']).toBe(ENTRY_ID)
    expect(sent.payload).toEqual({ kind: 'return-for-revision', reason: '证书与本人不符' })
  })

  it('says why a send-back was refused, in the refusal’s own words', async () => {
    const interveneOnEntry = vi.fn((_request: Request) =>
      Effect.fail(
        apiError('ASSESSMENT_ENTRY_ACTION_REFUSED', {
          action: 'return',
          reason: 'entry-not-returnable',
        }),
      ),
    )
    await screen(
      { interveneOnEntry },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await page.getByRole('button', { name: '退回修改' }).click()
    await userEvent.fill(page.getByRole('textbox'), '证书与本人不符')
    await page.getByRole('button', { name: '退回修改' }).last().click()
    await vi.waitFor(() => expect(interveneOnEntry).toHaveBeenCalledTimes(1))
    // which sentence, by its catalog entry: the general one tells nobody
    // whether to wait or to do something else
    await expect
      .poll(() => document.querySelector('[data-sonner-toast]')?.textContent ?? '')
      .toContain(zhCN['assessment/entry/refuse-not-returnable'])
  })

  it('offers no correction in an archived round', async () => {
    await screen(
      { getBatch: () => Effect.succeed({ batch: { ...batch, status: 'archived' } }) },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(page.getByRole('button', { name: '退回修改' }).elements()).toHaveLength(0)
  })

  it('reads an archived round as closed on the score half too', async () => {
    await screen(
      { getBatch: () => Effect.succeed({ batch: { ...batch, status: 'archived' } }) },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=score`,
    )
    await expect
      .element(page.getByTestId('result-moving'))
      .toHaveAttribute('data-closed', 'archived')
  })

  it('sends back only a claim under review or approved', async () => {
    await screen(
      {
        listParticipantEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [{ entry: entry({ status: 'rejected' }), recognition: null }],
            nextCursor: null,
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(page.getByRole('button', { name: '退回修改' }).elements()).toHaveLength(0)
  })

  // The two corrections of a concluded claim (ruling of 2026-09-25) are
  // the server's to offer: this reader re-determines, and the claim's own
  // appeal is still running, which the dialog says before it is confirmed.
  const correctable = (corrections: {
    reopen: { state: string; reason: string | null }
    redetermine: { state: string; reason: string | null }
  }) => ({
    listParticipantEntries: () =>
      Effect.succeed({
        participantId: PARTICIPANT_ID,
        entries: [
          {
            entry: entry({ openRound: { origin: 'appeal' } }),
            corrections,
            recognition: {
              id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              source: 'review' as const,
              entryRevisionId: REVISION_ID,
              values: { 'dddddddd-dddd-4ddd-8ddd-dddddddddddd': '省级' },
              createdAt: Date.parse('2026-03-02T00:00:00.000Z'),
              createdByName: '王老师',
            },
          },
        ],
        nextCursor: null,
      }),
  })

  it('re-determines a concluded claim, warning that the running appeal ends', async () => {
    const redetermineEntry = vi.fn((_request: Request) =>
      Effect.succeed({
        redetermination: { kind: 'approval-revoked', status: 'rejected', endedRound: true },
      }),
    )
    await screen(
      {
        ...correctable({
          reopen: { state: 'blocked', reason: 'review-already-open' },
          redetermine: { state: 'available', reason: null },
        }),
        redetermineEntry,
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('staff-reopen')).toHaveAttribute('data-offer', 'blocked')
    await page.getByTestId('staff-redetermine').click()
    await expect.element(page.getByTestId('redetermine-ends-round')).toBeVisible()
    await page.getByRole('radio', { name: '不通过' }).click()
    await expect
      .element(page.getByTestId('redetermine-form'))
      .toHaveAttribute('data-decision', 'reject')
    await userEvent.fill(page.getByRole('textbox'), '证书与本人不符')
    await page.getByRole('dialog').getByRole('button', { name: '重新认定' }).click()
    await vi.waitFor(() => expect(redetermineEntry).toHaveBeenCalledTimes(1))
    const sent = redetermineEntry.mock.calls[0]![0]
    expect(sent.params?.['entryId']).toBe(ENTRY_ID)
    expect(sent.payload).toEqual({ decision: 'reject', reason: '证书与本人不符' })
  })

  // A question with no escalation workflow cannot be re-examined. The shut
  // key says so, and points on to re-determining only for a reader who can
  // re-determine now: the two are separate powers, and a hint towards an act
  // the reader cannot see is not a way on.
  it.each([
    ['available', 'assessment/staff/reopen-no-route'],
    ['hidden', 'assessment/staff/reopen-no-route-only'],
  ] as const)(
    'says why re-examining is shut, and points on only where it can (re-determine %s)',
    async (state, sentence) => {
      await screen(
        correctable({
          reopen: { state: 'blocked', reason: 'no-appeal-route' },
          redetermine: { state, reason: null },
        }),
        `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
      )
      await expect
        .element(page.getByTestId('staff-reopen'))
        .toHaveAttribute('data-offer', 'blocked')
      // the key is disabled, so what answers the pointer is what holds it
      await userEvent.hover(page.getByTestId('staff-reopen').element().parentElement!)
      await expect.element(page.getByRole('tooltip')).toBeVisible()
      await expect.poll(() => page.getByRole('tooltip').element().textContent).toBe(zhCN[sentence])
    },
  )

  it('offers neither correction where the server offers none', async () => {
    await screen(
      correctable({
        reopen: { state: 'hidden', reason: null },
        redetermine: { state: 'hidden', reason: null },
      }),
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(page.getByTestId('staff-reopen').elements()).toHaveLength(0)
    expect(page.getByTestId('staff-redetermine').elements()).toHaveLength(0)
  })

  // Re-determining reads the accounts it covers (ruling of 2026-09-25 #33):
  // such a reader opens a person and re-determines there, without any of
  // the roster's own doors.
  it('opens the results to a reader who re-determines, with none of the roster’s doors', async () => {
    const reader = {
      ...batch,
      manageable: false,
      capabilities: { ...batch.capabilities, manage: false, redetermine: true },
    }
    const redetermineEntry = vi.fn((_request: Request) =>
      Effect.succeed({
        redetermination: { kind: 'approval-revoked', status: 'rejected', endedRound: false },
      }),
    )
    const placements = vi.fn(() =>
      Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
    )
    await screen({
      getBatch: () => Effect.succeed({ batch: reader }),
      listParticipantPlacements: placements,
      ...correctable({
        reopen: { state: 'hidden', reason: null },
        redetermine: { state: 'available', reason: null },
      }),
      redetermineEntry,
    })
    await expect.element(page.getByText('郭航旗')).toBeVisible()
    // adding people is the roster's door, and this reader holds none of it
    expect(page.getByRole('button', { name: '添加人员' }).elements()).toHaveLength(0)
    expect(placements).not.toHaveBeenCalled()
    await page.getByTestId('participant-row').first().click()
    await page.getByTestId('participant-tab-score').click()
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    // the claim behind the number, and the correction this reader may make
    await page.getByTestId('ledger-line').click()
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    await page.getByTestId('staff-redetermine').click()
    await page.getByRole('radio', { name: '不通过' }).click()
    await userEvent.fill(page.getByRole('textbox'), '证书与本人不符')
    await page.getByRole('dialog').getByRole('button', { name: '重新认定' }).click()
    await vi.waitFor(() => expect(redetermineEntry).toHaveBeenCalledTimes(1))
  })

  // the hand-back is the server's to offer: an approved claim whose owner
  // cannot take it up again now is shown held, with the reason, rather than
  // lit and then refused (ruling of 2026-09-25 #13)
  it('holds the hand-back where the server says its owner could not refile', async () => {
    const interveneOnEntry = vi.fn((_request: Request) => Effect.succeed({ entry: entry() }))
    await screen(
      {
        ...correctable({
          returnForRevision: { state: 'blocked', reason: 'owner-cannot-refile' },
          reopen: { state: 'hidden', reason: null },
          redetermine: { state: 'hidden', reason: null },
        } as never),
        interveneOnEntry,
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    const key = page.getByTestId('staff-return')
    await expect.element(key).toHaveAttribute('data-offer', 'blocked')
    await expect.element(key).toBeDisabled()
    expect(interveneOnEntry).not.toHaveBeenCalled()
  })

  // a record the office revoked stays on the account at zero, marked as
  // revoked rather than drawn like a refusal or a plain zero (ruling #25)
  it('marks a revoked record apart from a refused claim on the account', async () => {
    const revokedEntry = '12121212-1212-4121-8121-121212121212'
    await screen(
      {
        getParticipantResult: () =>
          Effect.succeed({
            ...account,
            lines: [
              ...account.lines,
              {
                lineId: `entry:${revokedEntry}`,
                kind: 'excluded-evidence' as const,
                label: 'CET-6',
                value: '0.00',
                itemId: ITEM_ID,
                revoked: true,
                provenance: { entryId: revokedEntry },
              },
              {
                lineId: `entry:${OTHER_ID}`,
                kind: 'excluded-evidence' as const,
                label: 'CET-6',
                value: '0.00',
                itemId: ITEM_ID,
                provenance: { entryId: OTHER_ID },
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=score`,
    )
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    const excluded = () =>
      [...document.querySelectorAll('[data-line-kind="excluded-evidence"]')].map((row) => [
        row.getAttribute('data-entry'),
        row.getAttribute('data-revoked'),
      ])
    await vi.waitFor(() => expect(excluded()).toHaveLength(2))
    expect(excluded()).toEqual([
      [revokedEntry, 'true'],
      [OTHER_ID, null],
    ])
  })

  it('re-examines a concluded claim through the escalation workflow, with a reason', async () => {
    const reopenEntry = vi.fn((_request: Request) => Effect.fail(apiError('BAD', {})))
    await screen(
      {
        ...correctable({
          reopen: { state: 'available', reason: null },
          redetermine: { state: 'hidden', reason: null },
        }),
        reopenEntry,
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await page.getByTestId('staff-reopen').click()
    await userEvent.fill(page.getByRole('textbox'), '抽查发现证书存疑')
    await page.getByRole('dialog').getByRole('button', { name: '复查' }).click()
    await vi.waitFor(() => expect(reopenEntry).toHaveBeenCalledTimes(1))
    expect(reopenEntry.mock.calls[0]![0].payload).toEqual({ reason: '抽查发现证书存疑' })
  })

  const recorded = {
    listParticipantEntries: () =>
      Effect.succeed({
        participantId: PARTICIPANT_ID,
        entries: [{ entry: entry({ status: 'approved', source: 'record' }), recognition: null }],
        nextCursor: null,
      }),
  }

  it('does not offer to withdraw a record to a reader who could not have made it', async () => {
    await screen(
      recorded,
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(page.getByRole('button', { name: '撤销认定' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '退回修改' }).elements()).toHaveLength(0)
  })

  it('offers to withdraw a record to a reader who holds the record power', async () => {
    await screen(
      {
        ...recorded,
        getBatch: () =>
          Effect.succeed({
            batch: { ...batch, capabilities: { ...batch.capabilities, record: true } },
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByRole('button', { name: '撤销认定' })).toBeVisible()
  })

  it('writes when a claim came back in the language the page is read in', async () => {
    const at = '2026-03-02T07:05:00.000Z'
    await screen(
      {
        listParticipantEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              {
                entry: entry({
                  status: 'needs_revision',
                  refusal: {
                    kind: 'returned',
                    reason: null,
                    comment: null,
                    suggestedPayload: null,
                    actorName: '王老师',
                    at,
                  },
                }),
                recognition: null,
              },
            ],
            nextCursor: null,
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    // the browser itself reports en-US; the page is read in zh-CN
    await expect.element(page.getByTestId('refusal-when')).toHaveTextContent(
      new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(at)),
    )
  })

  it('never hands the band over to an empty heading', async () => {
    // the band becomes the person the moment one is chosen, so a banner that
    // waited for the name would leave the heading blank for the length of a
    // request - the page visibly losing its title and getting it back
    await screen({
      getParticipant: () => Effect.never as never,
    })
    await page.getByTestId('participant-row').first().click()
    // the section's own heading is gone and something stands in its place,
    // with the way back already usable
    await expect.element(page.getByRole('button', { name: '返回参评名单' })).toBeVisible()
  })

  it('says a determination a review panel made is the panel’s', async () => {
    await screen(
      {
        listParticipantEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              {
                entry: entry(),
                recognition: {
                  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                  source: 'review' as const,
                  entryRevisionId: REVISION_ID,
                  values: { 'dddddddd-dddd-4ddd-8ddd-dddddddddddd': '省级' },
                  createdAt: Date.parse('2026-03-02T00:00:00.000Z'),
                  createdByName: null,
                  byPanel: true,
                },
              },
            ],
            nextCursor: null,
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect
      .element(page.getByTestId('entry-recognition'))
      .toHaveAttribute('data-by-panel', 'true')
  })

  it('names a determination by the words the question uses, never by its id', async () => {
    await screen(
      {},
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    const card = page.getByTestId('entry-recognition')
    // The card is drawn as soon as the entry is, and the words come from the
    // question's contract, which is a second request: read once, the card
    // can still be only its heading, which is how this failed on a slower
    // runner. So wait for the words, then look for what must be absent.
    // toMatchTextContent, not toHaveTextContent: in vitest 5 the latter is an
    // exact comparison of the whole text (docs/notes/vitest.md).
    // the question's own word for the field, and the value under it
    await expect.element(card).toMatchTextContent('等级')
    await expect.element(card).toMatchTextContent('省级')
    // the opaque address the contract stores it under is nobody's to read
    expect(card.element().textContent ?? '').not.toContain('dddddddd')
  })

  it('says once that the person is not there, and leads back to the list', async () => {
    const missing = () => Effect.fail(apiError('ASSESSMENT_PARTICIPANT_NOT_FOUND'))
    await screen(
      {
        getParticipant: missing,
        listParticipantEntries: missing,
        getParticipantResult: missing,
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`,
    )
    const state = page.getByTestId('participant-absent')
    await expect.element(state).toBeVisible()
    await expect
      .poll(() =>
        document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
      )
      .toBe('missing')
    // said once: not again where the name would be, nor by the claims
    expect(document.querySelectorAll('[data-slot="resource-state"]')).toHaveLength(1)
    expect(page.getByRole('alert').elements()).toHaveLength(0)
    await expect
      .element(page.getByTestId('participant-head'))
      .toHaveAttribute('data-absent', 'missing')
    expect(page.getByTestId('participant-tab-entries').elements()).toHaveLength(0)
    // nothing to ask again about somebody who is not there
    expect(state.getByRole('button', { name: '重试' }).elements()).toHaveLength(0)
    await state.getByRole('button', { name: '返回参评名单' }).click()
    await expect.poll(() => addressNow()).not.toContain('participant=')
    await expect.element(page.getByTestId('participant-row').first()).toBeVisible()
  })

  it('asks nobody about an address that cannot name a person', async () => {
    const getParticipant = vi.fn(() => Effect.succeed({ participant: participant() }))
    await screen(
      { getParticipant },
      `/assessment/batches/${BATCH_ID}/results?participant=not-a-person`,
    )
    await expect
      .poll(() =>
        document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
      )
      .toBe('missing')
    expect(getParticipant).not.toHaveBeenCalled()
  })

  it('offers to ask again when the person could not be read', async () => {
    const reads = { fail: true }
    await screen(
      {
        getParticipant: (request: Request) =>
          reads.fail
            ? Effect.fail(apiError('SOMETHING_ELSE'))
            : Effect.succeed({
                participant: participant({ id: request.params?.['participantId'] }),
              }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`,
    )
    const state = page.getByTestId('participant-absent')
    await expect.element(state).toBeVisible()
    await expect
      .poll(() =>
        document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
      )
      .toBe('failed')
    reads.fail = false
    await state.getByRole('button', { name: '重试' }).click()
    await expect.element(page.getByTestId('participant-head')).not.toHaveAttribute('data-absent')
    await expect
      .element(page.getByTestId('participant-head').getByRole('heading', { level: 1 }))
      .toHaveTextContent('郭航旗')
  })

  it('says a score cannot be read rather than showing an old one', async () => {
    await screen(
      {
        getParticipantResult: () =>
          Effect.fail({ _tag: 'ASSESSMENT_SCORING_UNAVAILABLE' } as never),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=score`,
    )
    await expect.element(page.getByTestId('result-unavailable')).toBeVisible()
  })
})

// Opened, a person stands beside their account rather than above it: in the
// column the round's rail gives up for them while the window has one, and
// in a head over the work where it has not - folded on a phone. Where they
// stand is said from the unit's own end, with the whole chain a press away.
describe('one account beside its person', () => {
  const SCHOOL = 'n0'
  const lineage = [
    { nodeId: 'n2', nodeTypeId: 'class' },
    { nodeId: 'n1', nodeTypeId: 'college' },
    { nodeId: SCHOOL, nodeTypeId: 'school' },
  ]
  const text = (value: string) => ({ kind: 'literal' as const, value })
  const rail = [
    {
      id: 'assessment/batch-results/rail',
      label: text('参评名单'),
      target: {
        kind: 'page',
        pageId: 'assessment/batch-results',
        path: '/assessment/batches/:batchId/results',
      },
      order: 10,
    },
  ]
  const shelled = (
    route: string,
    locale: 'zh-CN' | 'en-US' = 'zh-CN',
    stubs: Record<string, unknown> = {},
  ) =>
    renderScreen({
      locale,
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: PAGES,
              collections: {
                'app-shell/navigation-groups': [],
                'app-shell/navigation-primary': [],
                'workspace-shell/navigation': rail,
              },
            }),
        },
        assessment: {
          getBatch: () => Effect.succeed({ batch }),
          listParticipantAccounts: () =>
            rosterPage([
              participant({ anchorLineage: lineage }),
              participant({ id: OTHER_ID, displayName: '王君惠' }),
            ]),
          listParticipantScores: () => Effect.succeed({ scores: [] }),
          // the list's own doors, which the way back lands among
          listScopeOptions: () => Effect.succeed({ nodes: [] }),
          listParticipantCandidates: () =>
            Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
          previewImport: () => Effect.succeed({ candidates: 0 }),
          listParticipantPlacements: () =>
            Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
          reviewAlerts: () =>
            Effect.succeed({
              groups: [],
              unreachable: { routes: [], cannotSubmit: 0, cannotAppeal: 0 },
            }),
          getParticipant: () =>
            Effect.succeed({ participant: participant({ anchorLineage: lineage }) }),
          getParticipantResult: () => Effect.succeed(account),
          listRosterUnits: () =>
            Effect.succeed({
              units: [
                { id: SCHOOL, name: '示例大学', parentId: null },
                { id: 'n1', name: '软件学院', parentId: SCHOOL },
                { id: 'n2', name: '软件2301班', parentId: 'n1' },
              ],
            }),
          listUserTypeOptions: () =>
            Effect.succeed({
              userTypes: [
                { id: '99999999-9999-4999-8999-999999999999', code: 'student', name: '学生' },
              ],
            }),
          listReviewInbox: () =>
            Effect.succeed({ items: [], nextCursor: null, handledToday: 0, judging: false }),
          listParticipantEntries: () =>
            Effect.succeed({ participantId: PARTICIPANT_ID, entries: [], nextCursor: null }),
          listItems: () => Effect.succeed({ items: [item], version: 1 }),
          listScoreGroups: () => Effect.succeed({ groups: [], version: 1 }),
          ...stubs,
        },
      }),
      route,
      children: (
        <Routes>
          <Route element={<WorkspaceShell />}>
            <Route
              path="/assessment/batches/:batchId/results"
              element={<ParticipantResultsPage />}
            />
          </Route>
        </Routes>
      ),
    })
  const open = `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`

  it('stands the person in the rail’s column, and gives the rail back on the way out', async () => {
    await page.viewport(1280, 800)
    await shelled(open)
    const column = page.getByTestId('workspace-rail')
    await expect.element(column).toHaveAttribute('data-lent', 'true')
    const panel = column.getByTestId('participant-panel')
    await expect.element(panel.getByRole('heading', { level: 1 })).toHaveTextContent('郭航旗')
    // the halves of the account are the column's entries now, not a row
    // over the work, and there is no head over it at all
    await expect
      .element(panel.getByTestId('participant-tab-entries'))
      .toHaveAttribute('aria-current', 'true')
    await expect
      .element(page.getByTestId('participant-account'))
      .toHaveAttribute('data-beside', 'true')
    expect(page.getByTestId('participant-head').elements()).toHaveLength(0)
    expect(column.getByRole('link', { name: '参评名单' }).elements()).toHaveLength(0)
    // the score half carries the total beside its name
    await expect.element(panel.getByTestId('participant-total')).toHaveTextContent('1.00')

    await panel.getByRole('button', { name: '返回参评名单' }).click()
    await expect.poll(() => addressNow()).not.toContain('participant=')
    await expect.element(column).not.toHaveAttribute('data-lent')
    await expect.element(column.getByRole('link', { name: '参评名单' })).toBeVisible()
  })

  it('names the column after the person and says whose work the main part is', async () => {
    await page.viewport(1280, 800)
    await shelled(open)
    // a landmark found by the person it is about
    const column = page.getByRole('complementary', { name: '郭航旗' })
    await expect.element(column).toBeVisible()
    // the main part of the page carries a heading of its own that names them
    const main = page.getByRole('main')
    await expect
      .element(main.getByRole('heading', { level: 2, name: /郭航旗/ }))
      .toBeInTheDocument()
    // the way back is called by the words it shows, so saying them presses it
    const back = column.getByRole('button', { name: '返回参评名单' })
    const shown = back.element().textContent?.trim() ?? ''
    expect(shown).not.toBe('')
    expect(back.element().getAttribute('aria-label') ?? shown).toContain(shown)
  })

  it('says where they stand from its own end in the column, in either language', async () => {
    await page.viewport(1280, 800)
    const units = [
      { id: SCHOOL, name: '示例大学', parentId: null },
      { id: 'n1', name: '计算机与软件学院', parentId: SCHOOL },
      { id: 'n2', name: '计算机科学与技术2023级1班', parentId: 'n1' },
    ]
    for (const locale of ['en-US', 'zh-CN'] as const) {
      const { unmount } = await shelled(open, locale, {
        listRosterUnits: () => Effect.succeed({ units }),
      })
      const panel = page.getByTestId('participant-panel')
      await expect.element(panel).toBeVisible()
      const unitFact = () => panel.element().querySelector('[data-fact="unit"]')
      await expect.poll(() => unitFact()?.getAttribute('data-path')).toContain('2023级1班')
      const fact = unitFact()
      // the class, all of it, however long the name over it is
      const path = fact!.querySelector('[data-testid="unit-path"]')!
      const last = path.querySelector('[data-path-step="1"]')!
      const words = last.lastElementChild as HTMLElement
      const line = path.getBoundingClientRect()
      expect(last.getBoundingClientRect().top).toBeLessThan(line.bottom - 1)
      expect(words.scrollWidth).toBeLessThanOrEqual(words.clientWidth)
      // named over it, not beside it
      const name = fact!.previousElementSibling!
      expect(name.tagName).toBe('DT')
      expect(name.getBoundingClientRect().bottom).toBeLessThanOrEqual(line.top + 1)
      await unmount()
    }
  })

  it('sets what stands in for the claims in from the column and the window’s edge', async () => {
    await page.viewport(1280, 800)
    const cases = [
      {
        state: 'failed',
        stubs: { listItems: () => Effect.fail(apiError('ASSESSMENT_BATCH_NOT_FOUND')) },
      },
      // a round whose paper has no questions yet
      {
        state: 'ready',
        stubs: { listItems: () => Effect.succeed({ items: [], version: 1 }) },
      },
    ] as const
    for (const { state, stubs } of cases) {
      const { unmount } = await shelled(open, 'zh-CN', stubs)
      const seat = page.getByTestId('participant-entries')
      await expect.element(seat).toHaveAttribute('data-state', state)
      const main = page.getByRole('main').element().getBoundingClientRect()
      const drawn = seat.element().firstElementChild!.getBoundingClientRect()
      expect(drawn.width).toBeGreaterThan(0)
      expect(drawn.left - main.left).toBeGreaterThanOrEqual(16)
      expect(main.right - drawn.right).toBeGreaterThanOrEqual(16)
      expect(drawn.top - main.top).toBeGreaterThanOrEqual(16)
      await unmount()
    }
  })

  // While it loads, the outline of the workspace runs to the same edges the
  // workspace will, so nothing shifts when the claims arrive.
  it('draws the claims’ outline edge to edge while they load, as the workspace sits', async () => {
    await page.viewport(1280, 800)
    await shelled(open, 'zh-CN', { listParticipantEntries: () => Effect.never })
    const seat = page.getByTestId('participant-entries')
    await expect.element(seat).toHaveAttribute('data-state', 'loading')
    const outline = page.getByTestId('workspace-skeleton')
    await expect.element(outline).toHaveAttribute('data-viewer', 'staff')
    const box = seat.element().getBoundingClientRect()
    const drawn = outline.element().getBoundingClientRect()
    expect(Math.round(drawn.left)).toBe(Math.round(box.left))
    expect(Math.round(drawn.right)).toBe(Math.round(box.right))
    expect(Math.round(drawn.top)).toBe(Math.round(box.top))
  })

  it('counts the claims only once they are read', async () => {
    await page.viewport(1280, 800)
    await shelled(open, 'zh-CN', { listParticipantEntries: () => Effect.never })
    const half = page.getByTestId('participant-panel').getByTestId('participant-tab-entries')
    await expect.element(half).toBeVisible()
    await expect.element(half).toHaveAttribute('data-count', '')
    expect(half.element().textContent).not.toMatch(/\d/)
    // the head a narrower window draws says the same
    await page.viewport(834, 1112)
    const tab = page.getByTestId('participant-head').getByTestId('participant-tab-entries')
    await expect.element(tab).toHaveAttribute('data-count', '')
    await page.viewport(1280, 800)
  })

  it('stands the account in the middle of a wide window, not against the column', async () => {
    await page.viewport(1920, 1000)
    try {
      await shelled(`${open}&view=score`)
      const ledger = page.getByTestId('result-ledger')
      await expect.element(ledger).toBeVisible()
      const main = page.getByRole('main').element().getBoundingClientRect()
      const drawn = ledger.element().getBoundingClientRect()
      const before = drawn.left - main.left
      const after = main.right - drawn.right
      // room to spare on both sides, and the same on each
      expect(before).toBeGreaterThan(100)
      expect(Math.abs(before - after)).toBeLessThanOrEqual(2)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('opens the whole chain of where they stand, from the school down', async () => {
    await page.viewport(1280, 800)
    await shelled(open)
    const fact = page.getByTestId('participant-panel').getByTestId('unit-chain-open')
    await expect.element(fact).toBeVisible()
    await fact.click()
    const chain = page.getByTestId('unit-chain')
    await expect.element(chain).toBeVisible()
    const levels = [...chain.element().querySelectorAll('li')]
    expect(levels.map((level) => level.textContent)).toEqual(['示例大学', '软件学院', '软件2301班'])
    expect(levels.at(-1)!.getAttribute('aria-current')).toBe('true')
    await userEvent.keyboard('{Escape}')
  })

  it('stands the person over the work where the window lends no column', async () => {
    await page.viewport(834, 1112)
    try {
      await shelled(open)
      await expect.element(page.getByTestId('participant-head')).toBeVisible()
      await expect
        .element(page.getByTestId('participant-account'))
        .toHaveAttribute('data-beside', 'false')
      expect(page.getByTestId('participant-panel').elements()).toHaveLength(0)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  // Over the work the facts share a line, a rule between each two. When they
  // wrap, the fact that starts the next line has nothing before it, so no
  // rule stands in front of it; and where they stand is said whole where
  // the line has room for it.
  it('never starts a line of facts with a rule, and says the unit whole where it fits', async () => {
    await page.viewport(834, 1112)
    try {
      await shelled(open, 'zh-CN', {
        listRosterUnits: () =>
          Effect.succeed({
            units: [
              { id: SCHOOL, name: '示例大学', parentId: null },
              { id: 'n1', name: '计算机与软件学院', parentId: SCHOOL },
              { id: 'n2', name: '计算机科学与技术2023级1班', parentId: 'n1' },
            ],
          }),
        listUserTypeOptions: () =>
          Effect.succeed({
            userTypes: [
              {
                id: '99999999-9999-4999-8999-999999999999',
                code: 'student',
                name: '全日制本科生（含第二学士学位）与交换生',
              },
            ],
          }),
      })
      const head = page.getByTestId('participant-head')
      await expect.element(head).toBeVisible()
      await expect.poll(() => head.element().querySelector('[data-fact="kind"]')).not.toBeNull()
      const facts = [...head.element().querySelectorAll('[data-fact]')]
      const clip = facts[0]!.parentElement!.parentElement!.getBoundingClientRect()
      const tops = new Set(facts.map((fact) => Math.round(fact.getBoundingClientRect().top)))
      // the facts do not all fit on one line here
      expect(tops.size).toBeGreaterThan(1)
      for (const fact of facts) {
        const rule = fact.firstElementChild!.getBoundingClientRect()
        if (rule.right <= clip.left + 0.5) continue
        // a rule that shows stands after another fact on its line
        const before = fact.previousElementSibling
        expect(before).not.toBeNull()
        expect(
          Math.abs(before!.getBoundingClientRect().top - fact.getBoundingClientRect().top),
        ).toBeLessThan(2)
      }
      await expect.element(head.getByTestId('unit-path')).toHaveAttribute('data-clipped', 'false')
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('folds the facts behind the name on a phone, and brings them out on a press', async () => {
    await page.viewport(390, 844)
    try {
      await shelled(open)
      const head = page.getByTestId('participant-head')
      await expect.element(head).toBeVisible()
      await expect.element(head.getByRole('heading', { level: 1 })).toHaveTextContent('郭航旗')
      // the number and where they stand stay; the rest waits behind the fold
      await expect.poll(() => document.querySelector('[data-fact="number"]')).not.toBeNull()
      expect(document.querySelector('[data-fact="kind"]')).toBeNull()
      expect(head.getByTestId('participant-standing').elements()).toHaveLength(0)
      const fold = head.getByTestId('participant-fold')
      await expect.element(fold).toHaveAttribute('aria-expanded', 'false')
      await fold.click()
      await expect.element(fold).toHaveAttribute('aria-expanded', 'true')
      await expect.poll(() => document.querySelector('[data-fact="kind"]')).not.toBeNull()
      await expect.element(head.getByTestId('participant-standing')).toBeVisible()
    } finally {
      await page.viewport(1280, 800)
    }
  })
})

// Opened, a person stands among the people either side of them: the list
// the reader came from, under the facts in the column, with them in its
// middle and the next one a press away. It searches the same list the list
// page does, and the keys over it step along the same rows.
describe('the list beside an open account', () => {
  const personId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`
  const NONE_WAITING = { inReview: 0, toSupplement: 0, reconsidering: 0, toRevise: 0, blocked: 0 }
  const PEOPLE = Array.from({ length: 45 }, (_, index) =>
    participant({
      id: personId(index + 1),
      displayName: `参评人${String(index + 1).padStart(2, '0')}`,
      businessNo: `2023${String(100_000 + index + 1)}`,
    }),
  )
  /**
   * The roster as the server pages it, searched and located the way it is.
   * Asked for everybody with something waiting, it leaves out whoever the
   * test has since dealt with.
   */
  const paged =
    (
      asked: Request[],
      dealtWith: ReadonlySet<string> = new Set(),
      people: readonly ReturnType<typeof participant>[] = PEOPLE,
    ) =>
    (request: Request) => {
      asked.push(request)
      const words = request.query?.['q'] ?? ''
      const waiting = request.query?.['attention'] !== undefined
      const standing = request.query?.['status']
      const matched = people.filter(
        (one) =>
          (words === '' || one.displayName.includes(words) || one.businessNo.includes(words)) &&
          (standing === undefined || one.status === standing) &&
          !(waiting && dealtWith.has(one.id)),
      )
      const size = Number(request.query?.['limit'] ?? 20)
      const last = Math.max(1, Math.ceil(matched.length / size))
      let at = Math.min(Math.max(1, Number(request.query?.['page'] ?? 1)), last)
      const around = matched.findIndex((one) => one.id === request.query?.['around'])
      if (around >= 0) at = Math.floor(around / size) + 1
      return Effect.succeed({
        items: matched
          .slice((at - 1) * size, at * size)
          .map((one) => ({ ...one, filings: waiting ? ONE_IN_REVIEW : NONE_WAITING })),
        total: matched.length,
        page: at,
        pageSize: size,
      })
    }
  const ONE_IN_REVIEW = { ...NONE_WAITING, inReview: 1 }
  const rail = [
    {
      id: 'assessment/batch-results/rail',
      label: { kind: 'literal' as const, value: '参评名单' },
      target: {
        kind: 'page',
        pageId: 'assessment/batch-results',
        path: '/assessment/batches/:batchId/results',
      },
      order: 10,
    },
  ]
  const shelled = (
    route: string,
    stubs: Record<string, unknown> = {},
    {
      dealtWith = new Set<string>(),
      people = PEOPLE,
      locale = 'zh-CN',
    }: {
      dealtWith?: ReadonlySet<string>
      people?: readonly ReturnType<typeof participant>[]
      locale?: 'zh-CN' | 'en-US'
    } = {},
  ) => {
    const asked: Request[] = []
    const rendered = renderScreen({
      locale,
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: PAGES,
              collections: {
                'app-shell/navigation-groups': [],
                'app-shell/navigation-primary': [],
                'workspace-shell/navigation': rail,
              },
            }),
        },
        assessment: {
          getBatch: () => Effect.succeed({ batch }),
          listParticipantAccounts: paged(asked, dealtWith, people),
          listParticipantScores: () => Effect.succeed({ scores: [] }),
          // the reader's own desk, which a decided round is read again for
          getMyOverview: () => Effect.never,
          listScopeOptions: () => Effect.succeed({ nodes: [] }),
          listParticipantCandidates: () =>
            Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
          previewImport: () => Effect.succeed({ candidates: 0 }),
          listParticipantPlacements: () =>
            Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
          reviewAlerts: () =>
            Effect.succeed({
              groups: [],
              unreachable: { routes: [], cannotSubmit: 0, cannotAppeal: 0 },
            }),
          getParticipant: (request: Request) =>
            Effect.succeed({
              participant:
                PEOPLE.find((one) => one.id === request.params?.['participantId']) ?? PEOPLE[0],
            }),
          getParticipantResult: () => Effect.succeed(account),
          listRosterUnits: () => Effect.succeed({ units: [] }),
          listUserTypeOptions: () => Effect.succeed({ userTypes: [] }),
          listReviewInbox: () =>
            Effect.succeed({ items: [], nextCursor: null, handledToday: 0, judging: false }),
          listParticipantEntries: () =>
            Effect.succeed({ participantId: PARTICIPANT_ID, entries: [], nextCursor: null }),
          listItems: () => Effect.succeed({ items: [item], version: 1 }),
          listScoreGroups: () => Effect.succeed({ groups: [], version: 1 }),
          ...stubs,
        },
      }),
      route,
      children: (
        <>
          <Travel />
          <Routes>
            <Route element={<WorkspaceShell />}>
              <Route
                path="/assessment/batches/:batchId/results"
                element={<ParticipantResultsPage />}
              />
            </Route>
          </Routes>
        </>
      ),
    })
    return { asked, rendered }
  }
  /** the round's line, saying only what the test tells it to */
  const line = () => {
    const said = { wake: (_kind: string) => {} }
    const watchBatch = vi.fn(() =>
      Effect.succeed(
        Stream.callback<{ kind: string }>((queue) =>
          Effect.sync(() => {
            said.wake = (kind) => void Queue.offerUnsafe(queue, { kind })
          }),
        ),
      ),
    )
    return { said, watchBatch }
  }
  const at = (n: number, rest = '') =>
    `/assessment/batches/${BATCH_ID}/results?participant=${personId(n)}${rest}`
  const current = () =>
    document.querySelector<HTMLElement>('[data-testid="roster-walk-row"][aria-current="true"]')
  /** how far the open person's row stands from the middle of the list's window */
  const offCentre = () => {
    const scroller = document.querySelector('[data-testid="roster-walk-scroller"]')!
    const box = scroller.getBoundingClientRect()
    const row = current()!.getBoundingClientRect()
    return Math.abs(row.top + row.height / 2 - (box.top + box.height / 2))
  }
  const rowHeight = () => current()!.getBoundingClientRect().height

  it('stands the list under the facts in the column, the open person in its middle', async () => {
    await page.viewport(1280, 800)
    await shelled(at(23, '&list-page=2')).rendered
    const column = page.getByTestId('workspace-rail')
    const list = column.getByTestId('roster-walk')
    await expect.element(list).toHaveAttribute('data-total', '45')
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    // under the two halves, in the same column
    const halves = column.getByTestId('participant-tab-score').element().getBoundingClientRect()
    expect(list.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(halves.bottom)
    await expect.poll(offCentre).toBeLessThanOrEqual(rowHeight())
    // named, so a reader moving by landmarks finds it
    await expect.element(column.getByRole('navigation', { name: '参评名单' })).toBeInTheDocument()
  })

  it('keeps room for a handful of rows on a short window, the column scrolling whole', async () => {
    await page.viewport(1280, 640)
    try {
      await shelled(at(23, '&list-page=2')).rendered
      await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
      const scroller = page.getByTestId('roster-walk-scroller').element()
      const halves = page.getByTestId('participant-tab-score').element().getBoundingClientRect()
      expect(scroller.getBoundingClientRect().top).toBeGreaterThanOrEqual(halves.bottom)
      const list = page.getByTestId('roster-walk').element().getBoundingClientRect()
      expect(list.height).toBeGreaterThanOrEqual(239)
      const seat = page.getByTestId('workspace-aside').element()
      expect(seat.scrollHeight).toBeGreaterThan(seat.clientHeight)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('follows the next person to the middle, the column and its focus staying put', async () => {
    await page.viewport(1280, 800)
    await shelled(at(18, '&list-page=1')).rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(18))
    const panel = page.getByTestId('participant-panel').element()
    const scroller = page.getByTestId('roster-walk-scroller').element()
    const before = scroller.scrollTop
    const next = page.getByRole('button', { name: '下一位' })
    await next.click()
    await next.click()
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(20))
    await expect.poll(offCentre).toBeLessThanOrEqual(rowHeight())
    expect(scroller.scrollTop).toBeGreaterThan(before)
    // the same column, not one drawn again: the key pressed keeps the focus
    expect(page.getByTestId('participant-panel').element()).toBe(panel)
    expect(document.activeElement).toBe(next.element())
    // and across a page's edge, the list's page moves with them
    await next.click()
    await next.click()
    await expect.poll(() => addressNow()).toContain(`participant=${personId(22)}`)
    expect(addressNow()).toContain('list-page=2')
    await expect.poll(offCentre).toBeLessThanOrEqual(rowHeight())
  })

  it('opens somebody from the list, keeping the half and the question read', async () => {
    await page.viewport(1440, 900)
    await shelled(at(23, `&list-page=2&view=score&open=${ITEM_ID}&entry=${ENTRY_ID}`)).rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    await page
      .getByTestId('roster-walk')
      .getByRole('button', { name: /参评人25/ })
      .click()
    await expect.poll(() => addressNow()).toContain(`participant=${personId(25)}`)
    const address = addressNow()
    expect(address).toContain('view=score')
    expect(address).toContain(`open=${ITEM_ID}`)
    expect(address).not.toContain('entry=')
    expect(address).toContain('list-page=2')
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(25))
  })

  it('finds the page of somebody the address does not place, and moves the list there', async () => {
    await page.viewport(1280, 800)
    const { asked, rendered } = shelled(at(44))
    await rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(44))
    expect(asked.some((one) => one.query?.['around'] === personId(44))).toBe(true)
    await expect.poll(() => addressNow()).toContain('list-page=3')
    await expect
      .element(page.getByTestId('roster-neighbors'))
      .toHaveAttribute('data-position', '44')
  })

  it('searches the list the list page shows, and says the open person is off it', async () => {
    await page.viewport(1440, 900)
    const { asked, rendered } = shelled(at(23, '&list-page=2'))
    await rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    const search = page.getByTestId('roster-walk').getByRole('searchbox')
    await search.fill('参评人0')
    // one question for both sides of the page: the list page's own words
    await expect.poll(() => addressNow()).toContain('list-q=')
    expect(addressNow()).not.toContain('list-page=')
    await expect.poll(() => asked.at(-1)?.query?.['q']).toBe('参评人0')
    await expect.element(page.getByTestId('roster-walk-off')).toBeVisible()
    const strip = page.getByTestId('roster-neighbors')
    await expect.element(strip).toHaveAttribute('data-off', 'true')
    await expect.element(strip.getByRole('button', { name: '下一位' })).toBeDisabled()
    await expect.element(strip.getByRole('button', { name: '上一位' })).toBeDisabled()
    // Enter opens the first it finds
    await search.click()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => addressNow()).toContain(`participant=${personId(1)}`)
    // with the words gone, the open person is found again
    await search.fill('')
    await expect.poll(() => addressNow()).not.toContain('list-q=')
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(1))
    expect(page.getByTestId('roster-walk-off').elements()).toHaveLength(0)
  })

  it('opens the list over the account where the window lends no column', async () => {
    for (const [wide, high] of [
      [834, 1112],
      [390, 844],
    ] as const) {
      await page.viewport(wide, high)
      const { unmount } = await shelled(at(23, '&list-page=2')).rendered
      const opener = page.getByTestId('roster-walk-open')
      await expect.element(opener).toHaveAttribute('aria-haspopup', 'dialog')
      expect(page.getByTestId('participant-panel').elements()).toHaveLength(0)
      await opener.click()
      const sheet = page.getByTestId('roster-walk-sheet')
      await expect.element(sheet).toBeVisible()
      await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
      await expect.poll(offCentre).toBeLessThanOrEqual(rowHeight())
      await sheet.getByRole('button', { name: /参评人24/ }).click()
      await expect.poll(() => addressNow()).toContain(`participant=${personId(24)}`)
      await expect.element(sheet).not.toBeInTheDocument()
      await unmount()
    }
    await page.viewport(1280, 800)
  })

  it('keeps one line to the round across people, and the list current on it', async () => {
    await page.viewport(1280, 800)
    // the round's line, saying only what the test tells it to
    let wake = (_kind: string) => {}
    const watchBatch = vi.fn(() =>
      Effect.succeed(
        Stream.callback<{ kind: string }>((queue) =>
          Effect.sync(() => {
            wake = (kind) => void Queue.offerUnsafe(queue, { kind })
          }),
        ),
      ),
    )
    const results = vi.fn(() => Effect.succeed(account))
    const { asked, rendered } = shelled(at(23, '&list-page=2&view=score'), {
      watchBatch,
      getParticipantResult: results,
    })
    await rendered
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    await new Promise((settle) => setTimeout(settle, 100))
    const readBefore = results.mock.calls.length
    // the first word on the line finds reads the page has only just made
    wake('sync')
    // and the score half says it is kept current, as the claims half does
    await expect.element(page.getByTestId('result-live')).toHaveAttribute('data-state', 'live')
    await new Promise((settle) => setTimeout(settle, 300))
    expect(results.mock.calls.length).toBe(readBefore)

    // stepping to the next person keeps the same line, and says so throughout
    const dialled = watchBatch.mock.calls.length
    await page.getByRole('button', { name: '下一位' }).click()
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(24))
    await expect.element(page.getByTestId('result-live')).toHaveAttribute('data-state', 'live')
    expect(watchBatch.mock.calls.length).toBe(dialled)

    // what somebody's claims wait on moved: the list is read again
    const reads = asked.length
    wake('entries-changed')
    await expect.poll(() => asked.length, { timeout: 4_000 }).toBeGreaterThan(reads)
  })

  it('reads the list again when a round is decided, on its own', async () => {
    await page.viewport(1280, 800)
    const { said, watchBatch } = line()
    const { asked, rendered } = shelled(at(23, '&list-page=2'), { watchBatch })
    await rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    await expect.poll(() => watchBatch.mock.calls.length).toBeGreaterThan(0)
    await new Promise((settle) => setTimeout(settle, 300))
    const reads = asked.length
    said.wake('review-instance-changed')
    await expect.poll(() => asked.length, { timeout: 4_000 }).toBeGreaterThan(reads)
    // and the line is still there for the next one
    const again = asked.length
    said.wake('entries-changed')
    await expect.poll(() => asked.length, { timeout: 4_000 }).toBeGreaterThan(again)
  })

  it('asks about taking off only the person it was opened for', async () => {
    await page.viewport(1280, 800)
    const setParticipantStatus = vi.fn((_request: Request) =>
      Effect.succeed({ participant: PEOPLE[0] }),
    )
    await shelled(at(23, '&list-page=2'), { setParticipantStatus }).rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    await page.getByRole('button', { name: '下一位' }).click()
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(24))
    await page.getByTestId('participant-panel').getByTestId('participant-standing').click()
    const question = page.getByRole('alertdialog')
    await expect.element(question).toBeVisible()
    // back to the one before, which a question on the screen does not stop
    travel.go(-1)
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    await expect.element(question).not.toBeInTheDocument()
    // and forward again, where nobody has been asked anything yet
    travel.go(1)
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(24))
    await new Promise((settle) => setTimeout(settle, 200))
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)
    expect(setParticipantStatus).not.toHaveBeenCalled()
  })

  it('folds the facts again for the next person on a phone', async () => {
    await page.viewport(390, 844)
    try {
      await shelled(at(23, '&list-page=2')).rendered
      const fold = page.getByTestId('participant-fold')
      await expect.element(fold).toHaveAttribute('aria-expanded', 'false')
      await fold.click()
      await expect.element(fold).toHaveAttribute('aria-expanded', 'true')
      await page.getByRole('button', { name: '下一位' }).click()
      await expect.poll(() => addressNow()).toContain(`participant=${personId(24)}`)
      await expect.element(fold).toHaveAttribute('aria-expanded', 'false')
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('goes on from where somebody dealt with stood, on a list of the waiting', async () => {
    await page.viewport(1280, 800)
    const { said, watchBatch } = line()
    const dealtWith = new Set<string>()
    const { rendered } = shelled(at(8, '&list-waiting=any'), { watchBatch }, { dealtWith })
    await rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(8))
    await expect.poll(() => watchBatch.mock.calls.length).toBeGreaterThan(0)
    await new Promise((settle) => setTimeout(settle, 300))
    // their round is decided, and the list of the waiting no longer holds them
    dealtWith.add(personId(8))
    said.wake('review-instance-changed')
    await expect.poll(() => current(), { timeout: 4_000 }).toBeNull()
    const strip = page.getByTestId('roster-neighbors')
    const next = strip.getByRole('button', { name: '下一位' })
    const previous = strip.getByRole('button', { name: '上一位' })
    await expect.element(next).toBeEnabled()
    await expect.element(previous).toBeEnabled()
    await next.click()
    // whoever stood after them
    await expect.poll(() => addressNow()).toContain(`participant=${personId(9)}`)
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(9))
    // and the one before that is the one who stood before them
    await previous.click()
    await expect.poll(() => addressNow()).toContain(`participant=${personId(7)}`)
  })

  it('does not step from somebody the list never held', async () => {
    await page.viewport(1280, 800)
    const dealtWith = new Set([personId(8)])
    await shelled(at(8, '&list-waiting=any'), {}, { dealtWith }).rendered
    const strip = page.getByTestId('roster-neighbors')
    await expect.element(strip).toHaveAttribute('data-off', 'true')
    await expect.element(strip.getByRole('button', { name: '下一位' })).toBeDisabled()
    await expect.element(strip.getByRole('button', { name: '上一位' })).toBeDisabled()
  })
})

// The list beside an account as a reader works it: the open person told
// apart from a row under the pointer, keys that say plainly there is nowhere
// to step, Enter that answers the words it was pressed on, keys along the
// rows, and a list that can say it failed or found nobody - and that reads
// again only what is near when the round moves.
describe('working the list beside an open account', () => {
  const personId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`
  const NONE_WAITING = { inReview: 0, toSupplement: 0, reconsidering: 0, toRevise: 0, blocked: 0 }
  const peopleOf = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      participant({
        id: personId(index + 1),
        displayName: `参评人${String(index + 1).padStart(2, '0')}`,
        businessNo: `2023${String(100_000 + index + 1)}`,
      }),
    )
  const PEOPLE = peopleOf(45)
  const paged =
    (asked: Request[], people: readonly ReturnType<typeof participant>[] = PEOPLE) =>
    (request: Request) => {
      asked.push(request)
      const words = request.query?.['q'] ?? ''
      const standing = request.query?.['status']
      const matched = people.filter(
        (one) =>
          (words === '' || one.displayName.includes(words) || one.businessNo.includes(words)) &&
          (standing === undefined || one.status === standing) &&
          !(request.query?.['attention'] !== undefined && one.id === personId(8)),
      )
      const size = Number(request.query?.['limit'] ?? 20)
      const last = Math.max(1, Math.ceil(matched.length / size))
      let at = Math.min(Math.max(1, Number(request.query?.['page'] ?? 1)), last)
      const around = matched.findIndex((one) => one.id === request.query?.['around'])
      if (around >= 0) at = Math.floor(around / size) + 1
      return Effect.succeed({
        items: matched
          .slice((at - 1) * size, at * size)
          .map((one) => ({ ...one, filings: NONE_WAITING })),
        total: matched.length,
        page: at,
        pageSize: size,
      })
    }
  const rail = [
    {
      id: 'assessment/batch-results/rail',
      label: { kind: 'literal' as const, value: '参评名单' },
      target: {
        kind: 'page',
        pageId: 'assessment/batch-results',
        path: '/assessment/batches/:batchId/results',
      },
      order: 10,
    },
  ]
  const shelled = (
    route: string,
    stubs: Record<string, unknown> = {},
    {
      people = PEOPLE,
      locale = 'zh-CN',
    }: { people?: readonly ReturnType<typeof participant>[]; locale?: 'zh-CN' | 'en-US' } = {},
  ) => {
    const asked: Request[] = []
    const rendered = renderScreen({
      locale,
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: PAGES,
              collections: {
                'app-shell/navigation-groups': [],
                'app-shell/navigation-primary': [],
                'workspace-shell/navigation': rail,
              },
            }),
        },
        assessment: {
          getBatch: () => Effect.succeed({ batch }),
          listParticipantAccounts: paged(asked, people),
          listParticipantScores: () => Effect.succeed({ scores: [] }),
          getMyOverview: () => Effect.never,
          getParticipant: (request: Request) =>
            Effect.succeed({
              participant:
                people.find((one) => one.id === request.params?.['participantId']) ?? people[0],
            }),
          getParticipantResult: () => Effect.succeed(account),
          listRosterUnits: () => Effect.succeed({ units: [] }),
          listUserTypeOptions: () => Effect.succeed({ userTypes: [] }),
          listReviewInbox: () =>
            Effect.succeed({ items: [], nextCursor: null, handledToday: 0, judging: false }),
          listParticipantEntries: () =>
            Effect.succeed({ participantId: PARTICIPANT_ID, entries: [], nextCursor: null }),
          listItems: () => Effect.succeed({ items: [item], version: 1 }),
          listScoreGroups: () => Effect.succeed({ groups: [], version: 1 }),
          ...stubs,
        },
      }),
      route,
      children: (
        <Routes>
          <Route element={<WorkspaceShell />}>
            <Route
              path="/assessment/batches/:batchId/results"
              element={<ParticipantResultsPage />}
            />
          </Route>
        </Routes>
      ),
    })
    return { asked, rendered }
  }
  const at = (n: number, rest = '') =>
    `/assessment/batches/${BATCH_ID}/results?participant=${personId(n)}${rest}`
  const current = () =>
    document.querySelector<HTMLElement>('[data-testid="roster-walk-row"][aria-current="true"]')
  const rowOf = (n: number) =>
    document.querySelector<HTMLElement>(
      `[data-testid="roster-walk-row"][data-participant="${personId(n)}"]`,
    )!
  const walkList = () => page.getByTestId('roster-walk')

  it('keeps the list in the column when the person is not there', async () => {
    await page.viewport(1280, 800)
    const missing = () => Effect.fail(apiError('ASSESSMENT_PARTICIPANT_NOT_FOUND'))
    await shelled(`/assessment/batches/${BATCH_ID}/results?participant=${personId(99)}`, {
      getParticipant: missing,
      listParticipantEntries: missing,
      getParticipantResult: missing,
    }).rendered
    const panel = page.getByTestId('participant-panel')
    await expect.element(panel).toHaveAttribute('data-absent', 'missing')
    // no name to stand there, nor the halves of an account nobody has
    expect(panel.getByRole('heading', { level: 1 }).elements()).toHaveLength(0)
    expect(panel.getByTestId('participant-tab-entries').elements()).toHaveLength(0)
    // the way back and the list itself stay, so the next person is a press away
    await expect.element(panel.getByRole('button', { name: '返回参评名单' })).toBeVisible()
    await expect.element(panel.getByTestId('roster-walk')).toHaveAttribute('data-total', '45')
    // with no name to pin over it, rather than a blank line saying so again
    await expect.element(page.getByTestId('roster-neighbors')).toHaveAttribute('data-off', 'true')
    expect(panel.getByTestId('roster-walk-off').elements()).toHaveLength(0)
    // and the state stands once, in the room the work would have had
    const main = page.getByRole('main')
    await expect.element(main.getByTestId('participant-absent')).toBeVisible()
    expect(document.querySelectorAll('[data-slot="resource-state"]')).toHaveLength(1)
    await panel.getByRole('button', { name: /参评人02/ }).click()
    await expect.poll(() => addressNow()).toContain(`participant=${personId(2)}`)
  })

  it('tells the open person apart from a row under the pointer', async () => {
    await page.viewport(1280, 800)
    await shelled(at(23, '&list-page=2')).rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    // a bar at the open row's edge, on no other
    expect(getComputedStyle(current()!, '::before').width).toBe('2px')
    expect(getComputedStyle(rowOf(24), '::before').content).toBe('none')
    // and the ground a hovered row takes is lighter than the open row's
    await userEvent.hover(rowOf(24))
    await expect
      .poll(() => getComputedStyle(rowOf(24)).backgroundColor)
      .not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(rowOf(24)).backgroundColor).not.toBe(
      getComputedStyle(current()!).backgroundColor,
    )
    // the open row does not change under the pointer
    const resting = getComputedStyle(current()!).backgroundColor
    await userEvent.hover(current()!)
    await new Promise((settle) => setTimeout(settle, 200))
    expect(getComputedStyle(current()!).backgroundColor).toBe(resting)
  })

  it('leaves a key with nowhere to step on a clear ground, only faded', async () => {
    await page.viewport(1280, 800)
    await shelled(at(8, '&list-waiting=any')).rendered
    const strip = page.getByTestId('roster-neighbors')
    await expect.element(strip).toHaveAttribute('data-off', 'true')
    for (const name of ['上一位', '下一位']) {
      const key = strip.getByRole('button', { name })
      await expect.element(key).toBeDisabled()
      expect(getComputedStyle(key.element()).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    }
  })

  it('names the way to the list by the place, and says only the list before it knows one', async () => {
    await page.viewport(834, 1112)
    try {
      await shelled(at(23, '&list-page=2'), {
        listParticipantAccounts: () => Effect.never,
      }).rendered
      const opener = page.getByTestId('roster-walk-open')
      await expect.element(opener).toBeVisible()
      // a name, not a name trailing off into a comma
      const name = opener.element().getAttribute('aria-label') ?? ''
      expect(name).not.toBe('')
      expect(name).not.toMatch(/[,，、]\s*$/)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('keeps the count up while new words are answered', async () => {
    await page.viewport(1280, 800)
    const pages = paged([])
    await shelled(at(23, '&list-page=2'), {
      listParticipantAccounts: (request: Request) =>
        request.query?.['q'] === undefined ? pages(request) : Effect.never,
    }).rendered
    await expect.element(walkList()).toHaveAttribute('data-total', '45')
    const count = () => walkList().element().querySelector('[data-slot="count"]')
    expect(count()?.textContent).toBe('45')
    await walkList().getByRole('searchbox').fill('参评人0')
    await expect.poll(() => addressNow()).toContain('list-q=')
    await expect
      .element(walkList().getByTestId('roster-walk-scroller'))
      .toHaveAttribute('aria-busy', 'true')
    expect(count()?.textContent).toBe('45')
  })

  it('says what to type in a search that fits the column, in English too', async () => {
    await page.viewport(1280, 800)
    await shelled(at(23, '&list-page=2'), {}, { locale: 'en-US' }).rendered
    await expect.element(walkList().getByRole('searchbox')).toBeVisible()
    const field = walkList().getByRole('searchbox').element() as HTMLInputElement
    await expect.poll(() => field.placeholder).not.toBe('')
    const style = getComputedStyle(field)
    const ruler = document.createElement('canvas').getContext('2d')!
    ruler.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const room = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    expect(ruler.measureText(field.placeholder).width).toBeLessThanOrEqual(room)
  })

  it('opens the first on Enter only for the words it was pressed on', async () => {
    await page.viewport(1440, 900)
    const pages = paged([])
    await shelled(at(23, '&list-page=2'), {
      // where the open person stands cannot be asked for these words
      listParticipantAccounts: (request: Request) =>
        request.query?.['around'] !== undefined && request.query?.['q'] === '参评人1'
          ? Effect.fail(apiError('BAD'))
          : pages(request),
    }).rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    const search = walkList().getByRole('searchbox')
    await search.fill('参评人1')
    await search.click()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => addressNow()).toContain('list-q=')
    await new Promise((settle) => setTimeout(settle, 500))
    // nobody could say whether they were found: nobody is opened
    expect(addressNow()).toContain(`participant=${personId(23)}`)
    // other words, answered later, open nobody without a press of their own
    await search.fill('参评人0')
    await expect.element(page.getByTestId('roster-walk-off')).toBeVisible()
    await new Promise((settle) => setTimeout(settle, 500))
    expect(addressNow()).toContain(`participant=${personId(23)}`)
    await search.click()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => addressNow()).toContain(`participant=${personId(1)}`)
  })

  it('opens the first on Enter however far the rows read are from it', async () => {
    await page.viewport(1440, 900)
    // Somebody the list of the waiting does not hold, with a page far down it
    // open, and the page before it slow to come: the rows read stay where
    // they started.
    const people = peopleOf(100)
    const pages = paged([], people)
    await shelled(
      at(8, '&list-waiting=any&list-page=4'),
      {
        listParticipantAccounts: (request: Request) =>
          request.query?.['page'] === '3' && request.query?.['around'] === undefined
            ? Effect.never
            : pages(request),
      },
      { people },
    ).rendered
    await expect.element(page.getByTestId('roster-walk-off')).toBeVisible()
    await expect
      .poll(() => document.querySelectorAll('[data-testid="roster-walk-row"]').length)
      .toBeGreaterThan(0)
    await new Promise((settle) => setTimeout(settle, 300))
    // the rows read do not start at the first
    const top = document.querySelector('[data-testid="roster-walk-row"]')!
    expect(Number(top.getAttribute('data-position'))).toBeGreaterThan(1)
    await walkList().getByRole('searchbox').click()
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => addressNow()).toContain(`participant=${personId(1)}`)
  })

  it('says the list could not be read, and reads it again on a press', async () => {
    await page.viewport(1280, 800)
    const pages = paged([])
    const answer = { fail: true }
    await shelled(at(23, '&list-page=2'), {
      listParticipantAccounts: (request: Request) =>
        answer.fail ? Effect.fail(apiError('BAD')) : pages(request),
    }).rendered
    await expect.element(walkList()).toHaveAttribute('data-state', 'failed')
    answer.fail = false
    await walkList().getByRole('button', { name: '重试' }).click()
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    await expect.element(walkList()).toHaveAttribute('data-state', 'ready')
  })

  it('offers to clear what narrows a list that finds nobody', async () => {
    await page.viewport(1280, 800)
    await shelled(at(23, '&list-page=2&list-status=excluded')).rendered
    await expect.element(walkList()).toHaveAttribute('data-state', 'empty')
    await expect.element(page.getByTestId('roster-walk-filtered')).toBeVisible()
    await page.getByTestId('roster-walk-empty').getByRole('button', { name: '清除筛选' }).click()
    await expect.poll(() => addressNow()).not.toContain('list-status=')
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    // words that find nobody, and the way back from them
    await walkList().getByRole('searchbox').fill('无此人')
    await expect.element(walkList()).toHaveAttribute('data-state', 'empty')
    await page.getByTestId('roster-walk-empty').getByRole('button', { name: '清除搜索' }).click()
    await expect.poll(() => addressNow()).not.toContain('list-q=')
    await expect.element(walkList().getByRole('searchbox')).toHaveValue('')
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
  })

  it('moves along the rows by keys, with one stop on the tab order', async () => {
    await page.viewport(1280, 800)
    await shelled(at(23, '&list-page=2')).rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    const stops = () =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="roster-walk-row"]')]
        .filter((row) => row.tabIndex === 0)
        .map((row) => row.dataset['participant'])
    const focused = () => (document.activeElement as HTMLElement | null)?.dataset['participant']
    // the list is one stop, at the open person
    expect(stops()).toEqual([personId(23)])
    const search = walkList().getByRole('searchbox')
    await search.click()
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe(personId(23))
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe(personId(24))
    // the stop goes where the focus went
    expect(stops()).toEqual([personId(24)])
    await userEvent.keyboard('{Home}')
    const top = [...document.querySelectorAll<HTMLElement>('[data-testid="roster-walk-row"]')][0]!
    expect(document.activeElement).toBe(top)
    // up from the first row is back in the search
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(search.element())
    // Escape takes the words away before anything else
    await search.fill('参评人2')
    await expect.poll(() => addressNow()).toContain('list-q=')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => addressNow()).not.toContain('list-q=')
    await expect.element(search).toHaveValue('')
  })

  it('reads again only the pages near the open person when the round moves', async () => {
    await page.viewport(1280, 800)
    const said = { wake: (_kind: string) => {} }
    const watchBatch = vi.fn(() =>
      Effect.succeed(
        Stream.callback<{ kind: string }>((queue) =>
          Effect.sync(() => {
            said.wake = (kind) => void Queue.offerUnsafe(queue, { kind })
          }),
        ),
      ),
    )
    const { asked, rendered } = shelled(
      at(23, '&list-page=2'),
      { watchBatch },
      { people: peopleOf(160) },
    )
    await rendered
    await expect.poll(() => current()?.dataset['participant']).toBe(personId(23))
    const scroller = page.getByTestId('roster-walk-scroller').element()
    const furthest = () => Math.max(...asked.map((one) => Number(one.query?.['page'] ?? 1)))
    // the reader scrolls a long way down the list
    await expect
      .poll(
        () => {
          scroller.scrollTop = scroller.scrollHeight
          return furthest()
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(6)
    await new Promise((settle) => setTimeout(settle, 300))
    const before = asked.length
    said.wake('entries-changed')
    await expect.poll(() => asked.length, { timeout: 4_000 }).toBeGreaterThan(before)
    await new Promise((settle) => setTimeout(settle, 600))
    const again = new Set(
      asked
        .slice(before)
        .filter((one) => one.query?.['around'] === undefined)
        .map((one) => Number(one.query?.['page'] ?? 1)),
    )
    expect([...again].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})
