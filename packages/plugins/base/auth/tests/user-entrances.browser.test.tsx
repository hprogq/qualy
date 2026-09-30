import UserIdentitiesPage from '../src/client/iam/UserIdentitiesPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// What this screen has to get right is what it does NOT decide: how a door
// finds the person, and whether anything may be written for them, are the
// door's own say and arrive from the server. A screen that knew "local means
// a password" would be wrong the day a second kind is installed.

type Entrance = ApiResult<typeof authApi, 'identity', 'listUserEntrances'>['entrances'][number]
type Person = ApiResult<typeof authApi, 'identity', 'getUser'>

const USER_ID = '66666666-6666-4666-8666-666666666666'
const LOCAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CAS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OAUTH_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const word = (value: string) => value

const person = (over: Partial<Person['user']> = {}): Person => ({
  user: {
    id: USER_ID,
    businessNo: '20230001',
    email: 'ada@school.edu',
    emailVerifiedAt: null,
    displayName: '张三',
    status: 'active',
    version: 1,
    userType: { id: 'ut', code: 'student', name: '学生' },
    primaryOrgNode: { id: 'n', name: '本部' },
    manageable: true,
    ...over,
  },
  orgPath: [],
  placement: { mode: 'unrestricted' },
  roles: [],
  lastSignInAt: null,
  accountManageable: true,
})

const local = (over: Partial<Entrance> = {}): Entrance => ({
  providerId: LOCAL_ID,
  name: '邮箱密码',
  type: 'local',
  status: 'active',
  admits: true,
  resolution: { mode: 'user-field', field: 'email' },
  binding: {
    mode: 'managed',
    secret: { label: word('口令'), hint: null, minLength: 8, maxLength: 64 },
  },
  lastSignInAt: null,
  bound: null,
  ...over,
})

const cas: Entrance = {
  providerId: CAS_ID,
  name: '统一认证',
  type: 'cas',
  status: 'active',
  admits: true,
  resolution: { mode: 'user-field', field: 'businessNo' },
  binding: null,
  lastSignInAt: null,
  bound: null,
}

const oauth: Entrance = {
  providerId: OAUTH_ID,
  name: '企业微信',
  type: 'wecom',
  status: 'active',
  admits: true,
  resolution: { mode: 'binding-subject' },
  binding: { mode: 'self' },
  lastSignInAt: null,
  bound: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    subject: '10086',
    displayLabel: 'ada-wx',
    boundAt: '2026-09-01T00:00:00.000Z',
    lastUsedAt: null,
    hasCredential: false,
  },
}

const open = (
  entrances: Entrance[],
  manageable: boolean,
  stubs: Record<string, unknown> = {},
  who: Person = person(),
) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      identity: {
        listUserEntrances: () => Effect.succeed({ entrances, manageable }),
        getUser: () => Effect.succeed(who),
        ...stubs,
      },
    }),
    path: '/organization/users/:userId/identities',
    route: `/organization/users/${USER_ID}/identities`,
    children: <UserIdentitiesPage />,
  })

const rowOf = (type: string) =>
  document.querySelector(`[data-testid="entrance-row"][data-entrance-type="${type}"]`)!

describe('the ways in of one person', () => {
  it('offers a control only where one can work', async () => {
    await open([local(), cas, oauth], true)
    await expect.element(page.getByTestId('entrances')).toBeInTheDocument()
    await vi.waitFor(() => expect(rowOf('local')).toBeTruthy())
    // a credential an administrator may set: one way to set it
    expect(rowOf('local').getAttribute('data-resolution')).toBe('user-field:email')
    expect(rowOf('local').getAttribute('data-binding')).toBe('managed')
    expect(rowOf('local').getAttribute('data-credential')).toBe('unset')
    expect(rowOf('local').querySelectorAll('button')).toHaveLength(1)
    // a door that goes by a fact the person already has: nothing to press
    expect(rowOf('cas').getAttribute('data-resolution')).toBe('user-field:businessNo')
    expect(rowOf('cas').querySelectorAll('button')).toHaveLength(0)
    // an account only the person can bind: it can be withdrawn, and not written
    expect(rowOf('wecom').getAttribute('data-bound')).toBe('true')
    expect(rowOf('wecom').querySelectorAll('button')).toHaveLength(1)
  })

  it('reads the address a password door finds them by off the person', async () => {
    await open([local(), cas], true)
    await vi.waitFor(() => expect(rowOf('local')?.textContent).toContain('ada@school.edu'))
    // the business number is the person's too, and nothing is bound for it
    expect(rowOf('cas').textContent).toContain('20230001')
  })

  it('offers the address, not a password, to somebody the door could not find', async () => {
    const update = vi.fn(() => Effect.succeed({ ok: true as const }))
    await open([local()], true, { updateUser: update }, person({ email: null }))
    await vi.waitFor(() => expect(rowOf('local')).toBeTruthy())
    // no password for somebody the door cannot find, and the one press there
    // is fills in what it finds them by, here rather than on another page
    await vi.waitFor(() => expect(rowOf('local').querySelectorAll('button')).toHaveLength(1))
    expect(page.getByRole('button', { name: '设置密码' }).query()).toBeNull()
    await page.getByRole('button', { name: '设置邮箱' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: '邮箱' }).fill(' ada@school.edu ')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({
      params: { userId: USER_ID },
      payload: { version: 1, email: 'ada@school.edu' },
    })
  })

  it('offers no field to fill in on an account beyond the reader', async () => {
    await open([local()], false, {}, person({ email: null }))
    await vi.waitFor(() => expect(rowOf('local')).toBeTruthy())
    expect(rowOf('local').querySelectorAll('button')).toHaveLength(0)
  })

  it('asks only for the password, and sends what was typed', async () => {
    const put = vi.fn(() => Effect.succeed({ id: 'created' }))
    await open([local()], true, { putUserAuthBinding: put })
    await page.getByRole('button', { name: '设置密码' }).click()
    const save = page.getByRole('dialog').getByRole('button', { name: '保存', exact: true })
    // the label is the door's own word, and a secret shorter than the door
    // said it takes is answered by the list under it, not sent
    await page.getByLabelText('口令').fill('short')
    await save.click()
    const length = page
      .getByTestId('password-checklist')
      .element()
      .querySelector<HTMLElement>('[data-check="length"]')!
    await expect.element(length).toHaveAttribute('data-refused', 'true')
    expect(put).not.toHaveBeenCalled()
    await page.getByLabelText('口令').fill('long-enough')
    await save.click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith({
      params: { userId: USER_ID, providerId: LOCAL_ID },
      payload: { secret: 'long-enough' },
    })
  })

  it('names the dialog for what it does and says whose password it is', async () => {
    const withPassword = local({
      bound: {
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        subject: null,
        displayLabel: null,
        boundAt: '2026-09-01T00:00:00.000Z',
        lastUsedAt: null,
        hasCredential: true,
      },
    })
    await open([withPassword], true)
    await page.getByRole('button', { name: '重置密码' }).click()
    // the title is the act, not the door's own name glued to the word
    // "password": a door called 邮箱密码 made 设置邮箱密码密码
    const dialog = page.getByRole('dialog', { name: '重置登录密码' })
    await expect.element(dialog).toBeInTheDocument()
    expect(dialog.element().textContent).not.toContain('邮箱密码')
    // and the person and the account it is for, so nobody resets the wrong one
    expect(dialog.element().textContent).toContain('张三')
    expect(dialog.element().textContent).toContain('ada@school.edu')
  })

  it('withdraws only after asking', async () => {
    const remove = vi.fn(() => Effect.succeed({ ok: true as const }))
    await open([oauth], true, { deleteUserAuthBinding: remove })
    await page.getByRole('button', { name: '撤销' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
    await page.getByRole('alertdialog').getByRole('button', { name: '撤销' }).click()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove).toHaveBeenCalledWith({ params: { userId: USER_ID, providerId: OAUTH_ID } })
  })

  it('offers nothing to a reader who may only look', async () => {
    await open([local(), oauth], false)
    await expect.element(page.getByTestId('entrances')).toBeInTheDocument()
    await vi.waitFor(() => expect(rowOf('local')).toBeTruthy())
    expect(document.querySelectorAll('[data-testid="entrance-row"] button')).toHaveLength(0)
  })
})
