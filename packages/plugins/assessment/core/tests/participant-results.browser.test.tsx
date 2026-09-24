import ParticipantResultsPage from '../src/client/result/ParticipantResultsPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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
  capabilities: { personal: false, review: false, record: false, manage: true },
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

const PAGES = [
  { id: 'assessment/batch-results', path: '/assessment/batches/:batchId/results', layout: 'admin' },
]

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
        listParticipants: () =>
          Effect.succeed({
            items: [participant(), participant({ id: OTHER_ID, displayName: '王君惠' })],
            nextCursor: null,
          }),
        getParticipant: (request: Request) =>
          Effect.succeed({ participant: participant({ id: request.params?.['participantId'] }) }),
        getParticipantResult: () => Effect.succeed(account),
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
      listParticipants: () =>
        Effect.succeed({
          items: [
            participant({ placement: 'changed' }),
            participant({ id: OTHER_ID, displayName: '王君惠' }),
          ],
          nextCursor: null,
        }),
      listParticipantPlacements: () =>
        Effect.succeed({ items: [moved], nextCursor: null, changedTotal: 1, unavailableTotal: 0 }),
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
    // the ledger for that person, in the page the list was in
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    // the address says who is open, which is what makes a reload and a
    // shared link land here; the router is in memory, so this is the address
    expect(addressNow()).toContain(`participant=${PARTICIPANT_ID}`)
  })

  it('restores an open account from the address alone', async () => {
    await screen({}, `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`)
    // no press: a reload or a shared link lands on the person
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    await expect.element(page.getByText('2023123456')).toBeVisible()
  })

  it('follows a scored line back to the claim that earned it', async () => {
    await screen()
    await page.getByTestId('participant-row').first().click()
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    await page.getByTestId('ledger-line').click()
    // the claim opens over the list, and the address remembers both halves
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(addressNow()).toContain(`entry=${ENTRY_ID}`)
    expect(addressNow()).toContain('view=entries')
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
    await expect.element(page.getByRole('button', { name: '返回参评人员' })).toBeVisible()
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

  it('says a score cannot be read rather than showing an old one', async () => {
    await screen(
      {
        getParticipantResult: () =>
          Effect.fail({ _tag: 'ASSESSMENT_SCORING_UNAVAILABLE' } as never),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`,
    )
    await expect.element(page.getByTestId('result-unavailable')).toBeVisible()
  })
})
