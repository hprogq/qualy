import { ImportRecordSheet } from '../src/client/ImportRecord.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The record of one import: what it did, what became of the people, and
// the reversal that goes out with the reason typed for it.

const IMPORT_ID = '55555555-5555-4555-8555-555555555555'
const USER_ID = '44444444-4444-4444-8444-444444444444'

const PAGES = [
  { id: 'directory-import/record', path: '/organization/users/imports/:importId' },
  { id: 'directory-import/users', path: '/organization/users/import' },
  { id: 'auth/user-detail', path: '/organization/users/:userId' },
].map((entry) => ({ ...entry, layout: 'admin' }))

const summary = (standing = { living: 2, deleted: 0 }) => ({
  id: IMPORT_ID,
  filename: 'students.xlsx',
  sizeBytes: '12345',
  actorId: USER_ID,
  actorName: '张老师',
  userTypeName: '学生',
  anchorPath: '示例大学 / 软件学院',
  chain: ['学校', '学院', '年级', '班级'],
  sourceRowCount: 2,
  createdUserCount: 2,
  existingUserCount: 0,
  createdNodeCount: 3,
  reusedNodeCount: 0,
  createdAt: '2026-09-19T02:00:00.000Z',
  standing,
})

const open = (stubs: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      directory: {
        getUserImport: () =>
          Effect.succeed({
            import: summary(),
            events: [],
            nodes: [
              { id: 'n1', orgNodeId: 'o1', path: '示例大学 / 软件学院 / 2023级', depth: 1, disposition: 'created', present: true },
            ],
          }),
        listUserImportRows: () =>
          Effect.succeed({
            items: [
              { sourceRowNo: 2, userId: USER_ID, businessNo: '230101', displayName: '张三', orgPath: '示例大学 / 软件学院 / 2023级 / 1班', disposition: 'created', standing: 'active' },
              { sourceRowNo: 3, userId: null, businessNo: '230102', displayName: '李四', orgPath: '示例大学 / 软件学院 / 2023级 / 1班', disposition: 'existing', standing: 'missing' },
            ],
            total: 2,
            page: 1,
            pageSize: 20,
          }),
        previewUserImportReversal: () =>
          Effect.succeed({ toRetire: 2, alreadyGone: 0, withIdentities: 1, withGrants: 0 }),
        ...stubs,
      },
    } as never),
    children: <ImportRecordSheet importId={IMPORT_ID} open onClose={() => undefined} />,
  })

describe('the record of an import', () => {
  it('shows what it did and what became of the people', async () => {
    open()
    await expect.element(page.getByText('students.xlsx', { exact: false })).toBeVisible()
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-testid="import-row"]').length).toBe(2),
    )
    const rows = [...document.querySelectorAll('[data-testid="import-row"]')]
    expect(rows.map((row) => row.getAttribute('data-standing'))).toEqual(['active', 'missing'])
    expect(document.querySelector('[data-testid="import-standing"]')?.getAttribute('data-living')).toBe('2')
    // a created person is a way to their page; one no longer there is a name
    expect(rows[0]!.querySelector('a')).not.toBeNull()
    expect(rows[1]!.querySelector('a')).toBeNull()
  })

  it('reverses only with a reason, and sends the reason typed', async () => {
    const reverse = vi.fn(() => Effect.succeed({ retired: 2, skipped: 0 }))
    open({ reverseUserImport: reverse })
    await page.getByRole('button', { name: '撤销本次导入' }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: '撤销导入' })
    await expect.element(confirm).toBeDisabled()
    await page.getByRole('dialog').getByRole('textbox').fill('名单用错了')
    await expect.element(confirm).not.toBeDisabled()
    await confirm.click()
    await vi.waitFor(() => expect(reverse).toHaveBeenCalledOnce())
    const request = (reverse.mock.calls[0] as unknown as [{ params: unknown; payload: unknown }])[0]
    expect(request.params).toEqual({ importId: IMPORT_ID })
    expect(request.payload).toEqual({ reason: '名单用错了' })
  })
})
