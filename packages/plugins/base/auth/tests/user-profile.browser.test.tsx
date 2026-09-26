import UserProfilePage from '../src/client/iam/UserProfilePage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// A person's profile, as somebody administering them reads it: what is
// missing is filled in on the line that says it is missing, by whoever may
// change the account, and by nobody else.

type Person = ApiResult<typeof authApi, 'identity', 'getUser'>

const USER_ID = '66666666-6666-4666-8666-666666666666'

const person = (
  over: Partial<Person['user']> = {},
  account: Partial<Omit<Person, 'user'>> = {},
): Person => ({
  user: {
    id: USER_ID,
    businessNo: '20230001',
    email: null,
    emailVerifiedAt: null,
    displayName: '张三',
    status: 'active',
    version: 4,
    userType: { id: 'ut', code: 'student', name: '学生' },
    primaryOrgNode: { id: 'n', name: '2023级' },
    manageable: true,
    ...over,
  },
  orgPath: [{ id: 'n', name: '2023级', orgTypeName: '年级' }],
  placement: { mode: 'unrestricted' },
  roles: [],
  lastSignInAt: null,
  accountManageable: true,
  ...account,
})

const open = (who: Person, stubs: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      identity: { getUser: () => Effect.succeed(who), ...stubs },
    }),
    path: '/organization/users/:userId',
    route: `/organization/users/${USER_ID}`,
    children: <UserProfilePage />,
  })

const emailLine = () => page.getByTestId('profile-email')

describe("a person's profile", () => {
  it('sets a missing address from the line that says it is missing', async () => {
    const update = vi.fn(() => Effect.succeed({ ok: true as const }))
    await open(person(), { updateUser: update })
    await expect.element(emailLine()).toHaveAttribute('data-email-state', 'none')
    await emailLine().getByRole('button').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: '邮箱' }).fill('zhang@school.edu')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    // the one field, against the version the page read
    expect(update).toHaveBeenCalledWith({
      params: { userId: USER_ID },
      payload: { version: 4, email: 'zhang@school.edu' },
    })
  })

  it('offers a change of an address already on file', async () => {
    await open(person({ email: 'zhang@school.edu', emailVerifiedAt: '2026-09-01T00:00:00.000Z' }))
    await expect.element(emailLine()).toHaveAttribute('data-email-state', 'verified')
    await emailLine().getByRole('button', { name: '更改' }).click()
    await expect
      .element(page.getByRole('dialog').getByRole('textbox', { name: '邮箱' }))
      .toHaveValue('zhang@school.edu')
  })

  it('has a link sent to an address nobody proved, and no press to prove it by hand', async () => {
    const send = vi.fn(() => Effect.succeed({ sent: true }))
    await open(person({ email: 'zhang@school.edu' }), { createUserEmailVerification: send })
    await expect.element(emailLine()).toHaveAttribute('data-email-state', 'unverified')
    // two presses and no third: have a link sent, or change the address
    expect(emailLine().element().querySelectorAll('button')).toHaveLength(2)
    await emailLine().getByRole('button', { name: '发送验证邮件' }).click()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send).toHaveBeenCalledWith({ params: { userId: USER_ID } })
  })

  it('offers no link for an address already proven', async () => {
    await open(person({ email: 'zhang@school.edu', emailVerifiedAt: '2026-09-01T00:00:00.000Z' }))
    await expect.element(emailLine()).toHaveAttribute('data-email-state', 'verified')
    expect(emailLine().getByRole('button', { name: '发送验证邮件' }).query()).toBeNull()
  })

  it('sets a missing number the same way', async () => {
    const update = vi.fn(() => Effect.succeed({ ok: true as const }))
    await open(person({ businessNo: null }), { updateUser: update })
    const line = page.getByTestId('profile-business-no')
    await expect.element(line).toHaveAttribute('data-state', 'none')
    await line.getByRole('button').click()
    await page.getByRole('dialog').getByRole('textbox').fill('20230009')
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({
      params: { userId: USER_ID },
      payload: { version: 4, businessNo: '20230009' },
    })
  })

  it('offers nothing on an account beyond the reader', async () => {
    await open(person({ businessNo: null }, { accountManageable: false }))
    await expect.element(emailLine()).toHaveAttribute('data-email-state', 'none')
    expect(emailLine().element().querySelector('button')).toBeNull()
    expect(page.getByTestId('profile-business-no').element().querySelector('button')).toBeNull()
  })

  it('offers nothing on the system account, whose address is provisioned', async () => {
    await open(
      person(
        { email: 'root@school.edu', emailVerifiedAt: '2026-09-01T00:00:00.000Z', businessNo: null },
        {
          placement: { mode: 'tenant-root' },
        },
      ),
    )
    await expect.element(emailLine()).toHaveAttribute('data-email-state', 'verified')
    expect(emailLine().element().querySelector('button')).toBeNull()
    // nobody can give it a number, so its lack is not marked as a gap
    const number = page.getByTestId('profile-business-no')
    await expect.element(number).toHaveAttribute('data-state', 'none')
    await expect.element(number).toHaveAttribute('data-warn', 'no')
    expect(number.element().querySelector('button')).toBeNull()
  })
})
