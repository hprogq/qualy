import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
import '../src/app.css'

// The registrar making a determination while they file the fact.
//
// The defaults follow the material until a field is touched - after that
// the value is the registrar's judgment and the form stops second-guessing
// it - and switching to another question starts a clean sheet, because one
// contract's drafts must never leak into the next. Whatever the screen
// shows, the submission is explicit: the wire carries the values the
// registrar confirmed.

const RecordPage = (await components['assessment/RecordPage']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_A = '22222222-2222-4222-8222-222222222222'
const ITEM_B = '88888888-8888-4888-8888-888888888888'
const REVISION_A = '77777777-7777-4777-8777-777777777777'
const REVISION_B = '99999999-9999-4999-8999-999999999999'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'
const PARTICIPANT_B = '44444444-4444-4444-8444-444444444445'

const PAGES = [{ id: 'assessment/batch-record', path: '/assessment/batches/:batchId/record' }].map(
  (entry) => ({ ...entry, component: entry.id, layout: 'admin' }),
)

const batch = () => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: false,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: true, manage: false },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 1,
  currentPhaseId: null,
  currentPhaseName: '填报期',
  createdAt: '2026-02-01T00:00:00.000Z',
})

const item = (id: string, revisionId: string, title: string) => ({
  id,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title,
  scoreGroupId: '66666666-6666-4666-8666-666666666666',
  maxEntries: null,
  sortOrder: 0,
  status: 'active',
  voidReason: null,
  currentRevision: {
    id: revisionId,
    revisionNo: 1,
    entrySource: 'administrative',
    formConfig: {
      fields: [
        {
          id: 'claimed-level',
          key: 'claimed-level-slot',
          type: 'choice',
          label: '申报级别',
          required: true,
          options: [
            { value: 'national', label: '国家级' },
            { value: 'provincial', label: '省部级' },
          ],
        },
      ],
    },
    scoringConfig: {},
    reviewPolicy: {},
    displayConfig: null,
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
})

const contractOf = (itemRevisionId: string) => ({
  itemRevisionId,
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
  ],
  defaults: [
    {
      recognitionId: 'rec-level',
      payloadKey: 'claimed-level-slot',
      assignment: { kind: 'direct' as const },
    },
  ],
})

const open = (stubs: Record<string, unknown>) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listItems: () =>
          Effect.succeed({
            items: [
              item(ITEM_A, REVISION_A, '竞赛获奖登记'),
              item(ITEM_B, REVISION_B, '荣誉称号登记'),
            ],
            capabilities: { canManage: false },
          }),
        listParticipants: () =>
          Effect.succeed({
            items: [
              {
                id: PARTICIPANT_ID,
                userId: '55555555-5555-4555-8555-555555555555',
                displayName: '周予安',
                businessNo: null,
                userTypeId: 'ut',
                anchorNodeId: 'node',
                anchorPath: 'a',
                status: 'active',
              },
              {
                id: PARTICIPANT_B,
                userId: '55555555-5555-4555-8555-555555555556',
                displayName: '林晚舟',
                businessNo: null,
                userTypeId: 'ut',
                anchorNodeId: 'node',
                anchorPath: 'b',
                status: 'active',
              },
            ],
            nextCursor: null,
          }),
        getRecognitionContract: ((request: { params: { itemId: string } }) =>
          Effect.succeed({
            contract: contractOf(request?.params?.itemId === ITEM_B ? REVISION_B : REVISION_A),
          })) as never,
        ...stubs,
      },
    } as never),
    routes: [{ path: '/assessment/batches/:batchId/record', element: <RecordPage /> }] as never,
    route: `/assessment/batches/${BATCH_ID}/record`,
  })

/** an option inside a closed select is real but "not visible": wait on it */
const waitForItems = () =>
  vi.waitFor(() => {
    const options = [...document.querySelectorAll('option')].map((one) => one.textContent)
    if (!options.includes('竞赛获奖登记')) throw new Error('items not loaded yet')
  })

const chooseItem = async (title: string) => {
  const { userEvent } = await import('vitest/browser')
  const selects = document.querySelectorAll('select')
  await userEvent.selectOptions(selects[0]!, title)
}

describe('recording with a determination', () => {
  it('follows the material until the registrar has judged, then submits their word', async () => {
    const created = vi.fn((request: { payload: Record<string, unknown> }) =>
      Effect.fail({
        _tag: 'ASSESSMENT_ENTRY_ACTION_REFUSED',
        action: 'create',
        reason: 'x',
        request,
      }),
    )
    open({ createEntry: created as never })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    const { userEvent } = await import('vitest/browser')
    // the evidence choice seeds the determination
    await userEvent.selectOptions(page.getByLabelText('申报级别').element(), '国家级')
    const recognition = () =>
      document.querySelector(
        '[data-testid="record-recognition"] [data-parameter="rec-level"] select',
      ) as HTMLSelectElement
    await vi.waitFor(() => {
      if (recognition().value !== 'national') throw new Error('seed not followed yet')
    })
    // material changes, untouched determination follows
    await userEvent.selectOptions(page.getByLabelText('申报级别').element(), '省部级')
    await vi.waitFor(() => {
      if (recognition().value !== 'provincial') throw new Error('still following')
    })
    // the registrar judges otherwise; the material moving again must not
    // overwrite their word
    await userEvent.selectOptions(recognition(), 'national')
    await userEvent.selectOptions(page.getByLabelText('申报级别').element(), '国家级')
    await userEvent.selectOptions(page.getByLabelText('申报级别').element(), '省部级')
    expect(recognition().value).toBe('national')
  })

  it('starts a clean sheet on another person', async () => {
    // half a record written about one student must never be filable
    // against the next one picked from the roster
    open({})
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    const selects = () => document.querySelectorAll('select')
    await userEvent.selectOptions(selects()[1]!, '周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    await userEvent.selectOptions(page.getByLabelText('申报级别').element(), '国家级')
    const recognition = () =>
      document.querySelector(
        '[data-testid="record-recognition"] [data-parameter="rec-level"] select',
      ) as HTMLSelectElement
    await userEvent.selectOptions(recognition(), 'provincial')
    // a different subject: evidence and determination both start over
    await userEvent.selectOptions(selects()[1]!, '林晚舟')
    await vi.waitFor(() => {
      const evidence = page.getByLabelText('申报级别').element() as HTMLSelectElement
      if (evidence.value !== '' || recognition().value !== '')
        throw new Error('the previous person\u2019s sheet is still standing')
    })
  })

  it('starts a clean sheet after a successful filing', async () => {
    const created = vi.fn(() => Effect.succeed({ entry: { id: 'e1', status: 'approved' } }))
    open({ createEntry: created as never })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    const selects = () => document.querySelectorAll('select')
    await userEvent.selectOptions(selects()[1]!, '周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    await userEvent.selectOptions(page.getByLabelText('申报级别').element(), '国家级')
    const recognition = () =>
      document.querySelector(
        '[data-testid="record-recognition"] [data-parameter="rec-level"] select',
      ) as HTMLSelectElement
    await userEvent.selectOptions(recognition(), 'provincial')
    await userEvent.fill(page.getByLabelText('认定依据').element(), '校运会秩序册第 3 页')
    await userEvent.click(page.getByRole('button', { name: '登记' }).element())
    await vi.waitFor(() => {
      if (created.mock.calls.length === 0) throw new Error('not filed yet')
    })
    // the filing is done; what was typed for it dies with it - the next
    // record, even for the same question and person, starts from nothing
    await vi.waitFor(() => {
      const who = selects()[1] as HTMLSelectElement
      if (who.value !== '') throw new Error('subject still selected')
      const evidence = page.getByLabelText('申报级别').element() as HTMLSelectElement
      if (evidence.value !== '') throw new Error('evidence survived the filing')
      if (recognition().value !== '') throw new Error('determination survived the filing')
    })
  })

  it('starts a clean sheet on another question', async () => {
    open({})
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    const { userEvent } = await import('vitest/browser')
    const recognition = () =>
      document.querySelector(
        '[data-testid="record-recognition"] [data-parameter="rec-level"] select',
      ) as HTMLSelectElement
    await userEvent.selectOptions(recognition(), 'national')
    // switching questions is a new contract: the touched draft dies with
    // the old one instead of leaking into it
    await chooseItem('荣誉称号登记')
    await vi.waitFor(() => {
      if (recognition().value !== '') throw new Error('old draft still standing')
    })
  })
})
