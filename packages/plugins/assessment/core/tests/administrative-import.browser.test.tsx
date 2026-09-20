import AdministrativeRecordsPage from '../src/client/record/AdministrativeRecordsPage.tsx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reasonText } from '../src/client/record/import/issues.ts'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { registerUploadDriver } from '@qualy/plugin-storage/client'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The workbook door, from the recorder's side of the screen.
//
// What is held here is behaviour the server cannot see: that the import is
// only offered once the server found nothing wrong, that warnings have to be
// ticked off before it is, that a finished import lands on its own record,
// and that a fact, its import and the import's rows lead to one another.

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const REVISION_ID = '77777777-7777-4777-8777-777777777777'
const IMPORT_ID = '33333333-3333-4333-8333-333333333333'
const NEW_IMPORT_ID = '33333333-3333-4333-8333-333333333334'
const ENTRY_ID = '44444444-4444-4444-8444-444444444444'
const ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555'
const RESERVATION_ID = '66666666-6666-4666-8666-666666666666'
const PARTICIPANT_ID = '88888888-8888-4888-8888-888888888888'
const USER_ID = '99999999-9999-4999-8999-999999999999'

const PAGES = [{ id: 'assessment/batch-record', path: '/assessment/batches/:batchId/record' }].map(
  (entry) => ({ ...entry, layout: 'admin' }),
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

const item = {
  id: ITEM_ID,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title: '优秀学生干部',
  scoreGroupId: '66666666-6666-4666-8666-666666666667',
  maxEntries: 1,
  sortOrder: 0,
  status: 'active',
  voidReason: null,
  currentRevision: {
    id: REVISION_ID,
    revisionNo: 4,
    entryChannels: ['administrative'],
    formConfig: { fields: [] },
    scoringConfig: {},
    reviewPolicy: {},
    displayConfig: null,
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
}

const importRow = {
  id: IMPORT_ID,
  item: { id: ITEM_ID, title: '优秀学生干部' },
  source: { available: true, filename: '优秀学生干部.xlsx', size: '2048', integrity: null },
  actor: { id: USER_ID, name: '张老师' },
  createdAt: '2026-09-16T10:22:00.000Z',
  importedCount: 126,
  standing: { approved: 118, inReview: 3, rejected: 1, voided: 4, other: 0 },
}

const detail = (over: Record<string, unknown> = {}) => ({
  ...importRow,
  batchId: BATCH_ID,
  itemRevision: { id: REVISION_ID, revisionNo: 4 },
  size: '32267',
  integrity: { algorithm: 'sha256', value: 'abc' },
  defaultBasis: '《关于表彰优秀学生干部的决定》',
  reversals: [],
  capabilities: { reverse: true },
  ...over,
})

const bookLine = {
  entryId: ENTRY_ID,
  participant: {
    id: PARTICIPANT_ID,
    userId: USER_ID,
    displayName: '郭航旗',
    businessNo: '2023123456',
  },
  item: { id: ITEM_ID, title: '优秀学生干部' },
  source: 'import',
  status: 'approved',
  revision: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    payload: {},
    note: '《关于表彰优秀学生干部的决定》',
    actorId: USER_ID,
    actorName: '张老师',
    createdAt: '2026-09-16T10:22:00.000Z',
  },
  recognition: null,
  importId: IMPORT_ID,
}

const entry = {
  id: ENTRY_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  participantId: PARTICIPANT_ID,
  status: 'approved',
  source: 'import',
  currentRevision: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    revisionNo: 1,
    itemRevisionId: REVISION_ID,
    payload: {},
    note: '《关于表彰优秀学生干部的决定》',
    source: 'import',
    actorId: USER_ID,
    subjectId: PARTICIPANT_ID,
    attachments: [],
    createdAt: '2026-09-16T10:22:00.000Z',
  },
  currentReviewInstanceId: null,
  supplement: null,
  refusal: null,
  createdAt: '2026-09-16T10:22:00.000Z',
  updatedAt: '2026-09-16T10:22:00.000Z',
  capabilities: {
    edit: { state: 'hidden', reason: null },
    submit: { state: 'hidden', reason: null },
    withdraw: { state: 'hidden', reason: null },
    abandon: { state: 'hidden', reason: null },
    appeal: { state: 'hidden', reason: null },
    answerSupplement: { state: 'hidden', reason: null },
  },
}

const previewOf = (
  rows: readonly {
    rowNo: number
    issues: readonly { severity: 'error' | 'warning'; field: string | null; reason: string }[]
  }[],
) => {
  const errors = rows.filter((row) => row.issues.some((one) => one.severity === 'error')).length
  const warnings = rows.filter((row) => row.issues.some((one) => one.severity === 'warning')).length
  return {
    item: { id: ITEM_ID, title: '优秀学生干部', revisionId: REVISION_ID },
    summary: { rows: rows.length, valid: rows.length - errors, warnings, errors },
    rows: rows.map((row) => ({
      rowNo: row.rowNo,
      businessNo: `20231234${row.rowNo}`,
      displayNameFromFile: `学生${row.rowNo}`,
      matchedParticipant: null,
      payloadPreview: {},
      recognitionPreview: {},
      basis: '文件',
      issues: row.issues,
    })),
    canCommit: errors === 0 && rows.length > 0,
  }
}

const open = (route: string, stubs: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listItems: () => Effect.succeed({ items: [item], capabilities: { canManage: false } }),
        listScoreGroups: () => Effect.succeed({ groups: [], version: 1 }),
        getRecognitionContract: () =>
          Effect.succeed({
            contract: { itemRevisionId: REVISION_ID, fields: [], defaults: [] },
          }),
        listAdministrativeEntries: () => Effect.succeed({ entries: [bookLine], nextCursor: null }),
        listAdministrativeImports: () => Effect.succeed({ items: [importRow], nextCursor: null }),
        getAdministrativeImport: () => Effect.succeed(detail()),
        listAdministrativeImportRows: () =>
          Effect.succeed({
            items: [
              {
                rowNo: 2,
                entryId: ENTRY_ID,
                participant: {
                  id: PARTICIPANT_ID,
                  displayName: '郭航旗',
                  businessNo: '2023123456',
                },
                businessNoSnapshot: '2023123456',
                displayNameSnapshot: '郭航旗',
                status: 'approved',
                recognition: null,
              },
            ],
            nextCursor: null,
          }),
        getEntry: () => Effect.succeed({ entry }),
        getEntryHistory: () =>
          Effect.succeed({ entryId: ENTRY_ID, revisions: [], rounds: [], events: [] }),
        prepareAdministrativeImportUpload: () =>
          Effect.succeed({
            reservationId: RESERVATION_ID,
            attachmentId: ATTACHMENT_ID,
            grant: { driver: 'browser-suite', payload: {} },
            expiresAt: '2099-01-01T00:00:00.000Z',
          }),
        completeAdministrativeImportUpload: () =>
          Effect.succeed({
            id: ATTACHMENT_ID,
            filename: 'import.xlsx',
            declaredMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: '2048',
            status: 'staged',
          }),
        ...stubs,
      },
    } as never),
    routes: [
      { path: '/assessment/batches/:batchId/record', element: <AdministrativeRecordsPage /> },
    ] as never,
    route,
  })

const base = `/assessment/batches/${BATCH_ID}/record`

/**
 * The file a recorder picks, and the press that has it checked.
 *
 * Uploading only puts the file somewhere; the step's own forward key is what
 * asks the server to read it, so the two travel together here.
 */
const pickWorkbook = async () => {
  await vi.waitFor(() => {
    if (document.querySelector('[data-testid="administrative-import"] input[type="file"]') === null)
      throw new Error('no upload area yet')
  })
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="administrative-import"] input[type="file"]',
  )!
  await userEvent.upload(
    input,
    new File(['xlsx'], 'import.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
  const next = page.getByTestId('record-step-next')
  await vi.waitFor(async () => {
    if ((await next.element().getAttribute('disabled')) !== null)
      throw new Error('the file has not landed yet')
  })
  await userEvent.click(next.element())
}

/** the questions this office settles are a list to read, not a select */
const chooseItem = async () => {
  await vi.waitFor(() => {
    if (document.querySelector('[data-testid="record-item-choice"]') === null) {
      throw new Error('items not loaded yet')
    }
  })
  const choice = [...document.querySelectorAll('[data-testid="record-item-choice"]')].find((one) =>
    (one.textContent ?? '').includes('优秀学生干部'),
  )!
  await userEvent.click(choice)
  // picking selects; the step's own forward key is what enters the form
  await userEvent.click(page.getByTestId('record-step-next').element())
}

// Every refusal the column proof can produce has to reach the reader as a
// sentence: this screen falls back to printing the code itself, and the
// three column refusals had no entry at all.
describe('the words an import problem gets', () => {
  it('has one for every column refusal the proof can produce', () => {
    // the formatter is a parameter, so a stub answering with the message id
    // is enough to tell a known code from the fallback
    const said = ((descriptor: { id: string }) => descriptor.id) as never
    for (const reason of ['column-missing', 'column-unknown', 'column-header-mismatch']) {
      expect(reasonText(said, { reason }, '编号')).not.toBe('assessment/record/import/reason/other')
    }
  })
})

describe('importing a workbook of administrative records', () => {
  let dispose: () => void = () => {}
  beforeEach(() => {
    // the bytes go nowhere: what is under test is the page around the upload
    dispose = registerUploadDriver({ driver: 'browser-suite', upload: async () => {} })
  })
  afterEach(() => dispose())

  it('opens on the records, with the imports one tab away', async () => {
    open(base)
    await expect.element(page.getByTestId('administrative-entries')).toBeVisible()
    await page.getByRole('tab', { name: '导入记录' }).click()
    await expect.poll(() => addressNow()).toContain('tab=imports')
    const line = page.getByTestId('administrative-import')
    await expect.element(line).toHaveAttribute('data-count', '126')
    await expect.element(line).toHaveAttribute('data-voided', '4')
  })

  it('fits the errand inside its panel, at every step', async () => {
    // A dialog that scrolls sideways has a band inside it refusing to
    // shrink, and the reader pays for it with a scrollbar under a panel
    // that has nothing to scroll to. Measured rather than eyeballed,
    // because it has come back twice.
    open(`${base}?mode=import`)
    await chooseItem()
    await expect.element(page.getByTestId('administrative-import')).toBeVisible()
    const panel = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!
    await vi.waitFor(() => {
      if (panel.scrollWidth > panel.clientWidth)
        throw new Error(`the panel scrolls ${panel.scrollWidth - panel.clientWidth}px sideways`)
    })
  })

  it('sets the upload area\u2019s words in the middle of it', async () => {
    // The seat is one fixed height for all three of its states - empty,
    // uploading, holding a file - so the step's middle does not jump every
    // time the file moves. A fixed height is also what puts the words off
    // centre when the area pads or spaces itself, which is why this is
    // measured rather than eyeballed.
    open(`${base}?mode=import`)
    await chooseItem()
    await vi.waitFor(() => {
      if (document.querySelector('[data-upload-seat]') === null)
        throw new Error('no upload area yet')
    })
    const seat = document.querySelector<HTMLElement>('[data-upload-seat]')!
    const box = seat.getBoundingClientRect()
    const said = seat.querySelector<HTMLElement>('[data-slot="dropzone-said"]')!.getBoundingClientRect()
    expect(Math.abs((said.top + said.bottom) / 2 - (box.top + box.bottom) / 2)).toBeLessThan(1.5)
  })

  it('offers no import while the server found errors in the file', async () => {
    const commit = vi.fn(() => Effect.succeed({ importId: NEW_IMPORT_ID, importedCount: 1 }))
    open(`${base}?mode=import`, {
      previewAdministrativeImport: () =>
        Effect.succeed(
          previewOf([
            { rowNo: 2, issues: [] },
            {
              rowNo: 3,
              issues: [{ severity: 'error', field: 'businessNo', reason: 'participant-not-found' }],
            },
          ]),
        ),
      commitAdministrativeImport: commit as never,
    })
    await chooseItem()
    // the template is the question's own, addressed by the question
    await expect
      .element(page.getByTestId('import-template'))
      .toHaveAttribute('href', expect.stringContaining(ITEM_ID))
    await pickWorkbook()
    const preview = page.getByTestId('import-preview')
    await expect.element(preview).toHaveAttribute('data-errors', '1')
    // only the row that needs attention is spread out
    await expect
      .poll(() =>
        [...document.querySelectorAll('[data-testid="import-preview-row"]')].map((row) =>
          row.getAttribute('data-reasons'),
        ),
      )
      .toEqual(['participant-not-found'])
    // the press stays on the screen and says why it cannot run: a button
    // that disappears leaves the reader looking for it instead of at what
    // they have to fix
    await expect.element(page.getByTestId('import-commit')).toBeDisabled()
    expect(commit).not.toHaveBeenCalled()
  })

  it('wants the warnings ticked off, then imports and lands on the import', async () => {
    const commit = vi.fn((_request: { payload: Record<string, unknown> }) =>
      Effect.succeed({ importId: NEW_IMPORT_ID, importedCount: 2 }),
    )
    open(`${base}?mode=import`, {
      previewAdministrativeImport: () =>
        Effect.succeed(
          previewOf([
            { rowNo: 2, issues: [] },
            {
              rowNo: 3,
              issues: [{ severity: 'warning', field: 'displayName', reason: 'name-mismatch' }],
            },
          ]),
        ),
      commitAdministrativeImport: commit as never,
    })
    await chooseItem()
    await pickWorkbook()
    await expect.element(page.getByTestId('import-preview')).toHaveAttribute('data-warnings', '1')
    const importButton = page.getByTestId('import-commit')
    await expect.element(importButton).toBeDisabled()
    await page.getByTestId('import-confirm-warnings').click()
    await expect.element(importButton).toBeEnabled()
    await importButton.click()
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce())
    // what the server re-reads is the stored file, and the reader said they
    // saw what it warned about
    expect(commit.mock.calls[0]![0].payload).toMatchObject({
      attachmentId: ATTACHMENT_ID,
      itemId: ITEM_ID,
      expectedItemRevisionId: REVISION_ID,
      confirmWarnings: true,
    })
    await expect.poll(() => addressNow()).toContain(`import=${NEW_IMPORT_ID}`)
    expect(addressNow()).not.toContain('mode=import')
  })

  it('withdraws what is left of an import, with a reason', async () => {
    const reverse = vi.fn(
      (_request: { params: { importId: string }; payload: { reason: string } }) =>
        Effect.succeed({ affectedCount: 118 }),
    )
    open(`${base}?import=${IMPORT_ID}`, { reverseAdministrativeImport: reverse as never })
    const standing = page.getByTestId('import-standing')
    await expect.element(standing).toHaveAttribute('data-approved', '118')
    await expect.element(standing).toHaveAttribute('data-in-review', '3')
    await page.getByTestId('import-reverse').click()
    await page.getByRole('dialog').getByRole('textbox').fill('文件已撤回')
    await page.getByRole('dialog').getByRole('button', { name: '撤销本次导入' }).click()
    await vi.waitFor(() => expect(reverse).toHaveBeenCalledOnce())
    expect(reverse.mock.calls[0]![0]).toMatchObject({
      params: { importId: IMPORT_ID },
      payload: { reason: '文件已撤回' },
    })
  })

  it('does not offer a withdrawal the server said cannot work', async () => {
    open(`${base}?import=${IMPORT_ID}`, {
      getAdministrativeImport: () => Effect.succeed(detail({ capabilities: { reverse: false } })),
    })
    await expect.element(page.getByTestId('import-standing')).toBeVisible()
    expect(document.querySelector('[data-testid="import-reverse"]')).toBeNull()
  })

  it('leads from an import to its facts and from a fact back to its import', async () => {
    open(`${base}?import=${IMPORT_ID}`)
    await page.getByTestId('import-row').click()
    await expect.poll(() => addressNow()).toContain(`entry=${ENTRY_ID}`)
    // the sheet names where the fact came from, and goes there
    await page.getByRole('button', { name: '查看本次导入' }).click()
    await expect.poll(() => addressNow()).not.toContain('entry=')
    expect(addressNow()).toContain(`import=${IMPORT_ID}`)
  })

  it('names whoever settled the determination, not whoever filed the fact', async () => {
    // the office wrote the record; an appeal re-determined it afterwards.
    // The two halves have different hands, and the sheet used to borrow the
    // filing's for both
    open(`${base}?import=${IMPORT_ID}`, {
      listAdministrativeEntries: () =>
        Effect.succeed({
          entries: [
            {
              ...bookLine,
              recognition: {
                id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                itemRevisionId: REVISION_ID,
                values: {},
                fields: [],
                source: 'review',
                actorName: '李老师',
                createdAt: '2026-09-20T09:00:00.000Z',
              },
            },
          ],
          nextCursor: null,
        }),
    })
    await page.getByTestId('import-row').click()
    const card = page.getByTestId('entry-recognition')
    await expect.element(card).toBeVisible()
    await expect.element(card).toHaveAttribute('data-source', 'review')
    expect((card.element() as HTMLElement).textContent ?? '').toContain('李老师')
  })

  it('goes back from one import to the imports it was opened from', async () => {
    open(`${base}?tab=imports`)
    await page.getByTestId('administrative-import').click()
    await expect.poll(() => addressNow()).toContain(`import=${IMPORT_ID}`)
    await expect.element(page.getByTestId('administrative-import-detail')).toBeVisible()
    await page.getByRole('button', { name: '返回导入记录' }).click()
    await expect.poll(() => addressNow()).not.toContain('import=')
    expect(addressNow()).toContain('tab=imports')
  })
})
