import { ImportWizard } from '../src/client/ImportWizard.tsx'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { registerUploadDriver } from '@qualy/plugin-storage/client'
import type { OrgNodePickerContext } from '@qualy/ui-contract'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// Walking the five steps the way somebody does: pick a file, say which sheet
// and which row names the columns, say what each column is for, read what the
// check found, and land on the record.
//
// What the third step is really asked to prove is that the path is drawn
// rather than assembled in the reader's head: the unit everybody hangs under,
// a level per column, and the file's own first row standing in it.

const ATTACHMENT = '11111111-1111-4111-8111-111111111111'
const RESERVATION = '22222222-2222-4222-8222-222222222222'
const TYPE_STUDENT = '33333333-3333-4333-8333-333333333333'
const TYPE_YEAR = '44444444-4444-4444-8444-444444444444'
const TYPE_CLASS = '55555555-5555-4555-8555-555555555555'
const TYPE_ROOT = '66666666-6666-4666-8666-666666666666'
const NODE_COLLEGE = '77777777-7777-4777-8777-777777777777'
const IMPORT_ID = '88888888-8888-4888-8888-888888888888'

const headers = [
  { column: 'A', text: '学号' },
  { column: 'B', text: '姓名' },
  { column: 'C', text: '年级' },
  { column: 'D', text: '班级' },
]

const workbook = {
  sheets: [{ name: '名单', rowCount: 128, columnCount: 4 }],
  table: {
    sheet: '名单',
    headerRow: 1,
    headers,
    rowCount: 128,
    sample: [
      { rowNo: 2, cells: { A: '2023010101', B: '张明远', C: '2023级', D: '软件2301班' } },
      { rowNo: 3, cells: { A: '2023010102', B: '李文静', C: '2023级', D: '软件2301班' } },
    ],
  },
}

const preview = (over: Record<string, unknown> = {}) => ({
  chain: [
    { orgTypeId: TYPE_ROOT, orgTypeName: '学院', source: 'fixed-node', detail: '软件学院' },
    { orgTypeId: TYPE_YEAR, orgTypeName: '年级', source: 'column', detail: 'C' },
    { orgTypeId: TYPE_CLASS, orgTypeName: '班级', source: 'column', detail: 'D' },
  ],
  nodes: { reused: 2, created: 6, conflicts: 0 },
  users: { create: 125, existing: 3, warnings: 0, errors: 0 },
  rowCount: 128,
  issues: [],
  createdNodes: ['软件学院 / 2023级', '软件学院 / 2023级 / 软件2301班'],
  planFingerprint: 'plan-1',
  ...over,
})

/** the organization's own picker, stood in for: one college, already named */
function CollegePicker({ context }: { context: OrgNodePickerContext }) {
  return (
    <button
      type="button"
      onClick={() =>
        context.onChange(
          [NODE_COLLEGE],
          [{ id: NODE_COLLEGE, name: '软件学院', path: '示范大学 / 软件学院' }],
        )
      }
    >
      软件学院
    </button>
  )
}

const stubs = (over: Record<string, unknown> = {}) => ({
  getUserImportOptions: () =>
    Effect.succeed({
      userTypes: [{ id: TYPE_STUDENT, name: '本科生' }],
      orgTypes: [
        { id: TYPE_ROOT, name: '学校', sortOrder: 0 },
        { id: TYPE_YEAR, name: '年级', sortOrder: 1 },
        { id: TYPE_CLASS, name: '班级', sortOrder: 2 },
      ],
      rules: [],
      root: { id: 'root', name: '示范大学', orgTypeId: TYPE_ROOT },
    }),
  prepareUserImportUpload: () =>
    Effect.succeed({
      reservationId: RESERVATION,
      attachmentId: ATTACHMENT,
      grant: { driver: 'browser-suite', payload: {} },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }),
  completeUserImportUpload: () =>
    Effect.succeed({ id: ATTACHMENT, filename: '2024级本科生名单.xlsx', size: '88000' }),
  inspectUserImportUpload: () => Effect.succeed(workbook),
  previewUserImport: () => Effect.succeed(preview()),
  commitUserImport: () =>
    Effect.succeed({
      importId: IMPORT_ID,
      createdUsers: 125,
      existingUsers: 3,
      createdNodes: 6,
      reusedNodes: 2,
    }),
  ...over,
})

const open = (over: Record<string, unknown> = {}, onOpenRecord = () => undefined) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            slots: { 'iam/org-node-picker': [{ id: 'auth/org-node-picker', order: 0 }] },
          }),
      },
      directory: stubs(over),
    } as never),
    registry: {
      slots: { 'iam/org-node-picker': { 'auth/org-node-picker': CollegePicker } },
    } as never,
    children: (
      <ImportWizard open anchorNodeId={null} onClose={() => undefined} onOpenRecord={onOpenRecord} />
    ),
  })

/** the file, chosen; the step advances by itself once the bytes have landed */
const pickFile = async () => {
  await vi.waitFor(() => {
    if (document.querySelector('[data-testid="import-wizard"] input[type="file"]') === null)
      throw new Error('no upload area yet')
  })
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="import-wizard"] input[type="file"]',
  )!
  await userEvent.upload(
    input,
    new File(['xlsx'], '2024级本科生名单.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  )
  await vi.waitFor(() => {
    if (document.querySelector('[data-testid="import-body"]')?.getAttribute('data-step') !== '1')
      throw new Error('still on the file step')
  })
}

const chooseOption = async (trigger: Element, name: string) => {
  await userEvent.click(trigger as HTMLElement)
  await userEvent.click(page.getByRole('option', { name }).element() as HTMLElement)
}

describe('importing users from a spreadsheet', () => {
  let dispose: () => void = () => undefined
  beforeEach(() => {
    // the bytes go nowhere: what is under test is the flow around the upload
    dispose = registerUploadDriver({ driver: 'browser-suite', upload: async () => undefined })
  })
  afterEach(() => dispose())

  it('draws the path the file lands on, with its own first row standing in it', async () => {
    open()
    await pickFile()
    await userEvent.click(page.getByRole('button', { name: '下一步' }).element() as HTMLElement)
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="import-body"]')?.getAttribute('data-step') !== '2')
        throw new Error('not on the columns step')
    })

    // the unit everybody hangs under, named by the picker that knows it
    await userEvent.click(page.getByRole('button', { name: '软件学院' }).element() as HTMLElement)
    await chooseOption(page.getByTestId('column-name').element(), '姓名')
    await chooseOption(page.getByTestId('column-business').element(), '学号')
    await userEvent.click(page.getByRole('button', { name: '添加层级' }).element() as HTMLElement)
    await chooseOption(page.getByRole('combobox', { name: '组织类型' }).element(), '年级')
    await chooseOption(page.getByRole('combobox', { name: '选择列' }).element(), '年级')

    // the answer to this step, drawn rather than assembled in the head
    const shown = document.querySelector('[data-testid="import-example"]')!
    expect(shown.textContent).toContain('示范大学 / 软件学院 / 2023级')
    expect(shown.textContent).toContain('张明远')
  })

  it('names how many the file holds on the press that writes them', async () => {
    open()
    await pickFile()
    await userEvent.click(page.getByRole('button', { name: '下一步' }).element() as HTMLElement)
    await userEvent.click(page.getByRole('button', { name: '软件学院' }).element() as HTMLElement)
    await chooseOption(page.getByTestId('column-name').element(), '姓名')
    await chooseOption(page.getByTestId('column-business').element(), '学号')
    await chooseOption(page.getByTestId('user-type').element(), '本科生')
    await userEvent.click(page.getByRole('button', { name: '预检文件' }).element() as HTMLElement)

    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="import-preview"]') === null)
        throw new Error('the check has not answered yet')
    })
    // the number is the size of the list, not the number of new people: it
    // is what the press is about to read, and a reader counts the file
    await expect.element(page.getByRole('button', { name: '导入名单（128 人）' })).toBeEnabled()
  })

  it('refuses to write while a row is wrong, and offers the list to take away', async () => {
    open({
      previewUserImport: () =>
        Effect.succeed(
          preview({
            users: { create: 125, existing: 3, warnings: 0, errors: 2 },
            issues: [
              { rowNo: 14, field: null, severity: 'error', reason: 'business-no-required' },
              { rowNo: 52, field: null, severity: 'error', reason: 'duplicate-in-file', detail: '31' },
            ],
          }),
        ),
    })
    await pickFile()
    await userEvent.click(page.getByRole('button', { name: '下一步' }).element() as HTMLElement)
    await userEvent.click(page.getByRole('button', { name: '软件学院' }).element() as HTMLElement)
    await chooseOption(page.getByTestId('column-name').element(), '姓名')
    await chooseOption(page.getByTestId('column-business').element(), '学号')
    await chooseOption(page.getByTestId('user-type').element(), '本科生')
    await userEvent.click(page.getByRole('button', { name: '预检文件' }).element() as HTMLElement)

    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="import-preview"]') === null)
        throw new Error('the check has not answered yet')
    })
    expect(
      document.querySelector('[data-testid="import-preview"]')?.getAttribute('data-errors'),
    ).toBe('2')
    expect(document.querySelectorAll('[data-testid="import-issue"]').length).toBe(2)
    await expect.element(page.getByRole('button', { name: '导入名单（128 人）' })).toBeDisabled()
    // a spreadsheet is corrected where it was written, so the list has to
    // be able to leave with the reader
    await expect.element(page.getByRole('button', { name: '下载问题清单' })).toBeVisible()
  })
})
