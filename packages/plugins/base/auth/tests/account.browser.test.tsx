import AccountLoginsPage from '../src/client/account/AccountLoginsPage.tsx'
import AccountProfilePage from '../src/client/account/AccountProfilePage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The reader's own account. What the screens have to get right is what they
// offer: facts to read, and letting go of an account only where the server
// said it may be let go - never a password, never the last way in.

type Me = ApiResult<typeof authApi, 'self', 'getSelf'>
type Entrance = ApiResult<typeof authApi, 'self', 'listSelfEntrances'>['entrances'][number]

const LOCAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const HUB_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const me = (over: Partial<Me> = {}): Me => ({
  id: '66666666-6666-4666-8666-666666666666',
  displayName: '张三',
  businessNo: '20990001',
  email: 'zhang@school.edu',
  emailVerified: true,
  userType: { id: 'ut', name: '学生' },
  unit: { id: 'n', name: '示例学院' },
  passwordStatus: 'set',
  ...over,
})

const password: Entrance = {
  providerId: LOCAL_ID,
  name: '邮箱密码',
  type: 'local',
  resolution: { mode: 'user-field', field: 'email' },
  binding: {
    mode: 'managed',
    secret: { label: { kind: 'literal', value: '密码' }, hint: null, minLength: 12, maxLength: 128 },
  },
  bound: {
    id: 'b1',
    subject: null,
    displayLabel: null,
    boundAt: '2099-01-01T00:00:00.000Z',
    lastUsedAt: null,
    hasCredential: true,
  },
  bindHref: null,
  unbindable: false,
}

const hub = (over: Partial<Entrance> = {}): Entrance => ({
  providerId: HUB_ID,
  name: '代码托管',
  type: 'github',
  resolution: { mode: 'binding-subject' },
  binding: { mode: 'self' },
  bound: {
    id: 'b2',
    subject: '1024',
    displayLabel: 'zhang-dev',
    boundAt: '2099-01-01T00:00:00.000Z',
    lastUsedAt: '2099-01-02T00:00:00.000Z',
    hasCredential: false,
  },
  bindHref: null,
  unbindable: true,
  ...over,
})

const stubs = (entrances: Entrance[], over: Record<string, unknown> = {}) => ({
  app: { getManifest: () => Effect.succeed(emptyManifest()) },
  self: {
    getSelf: () => Effect.succeed(me()),
    listSelfEntrances: () => Effect.succeed({ entrances }),
    ...over,
  },
})

describe('the reader’s profile', () => {
  it('shows what is on file about them', async () => {
    renderScreen({
      client: fakeClient(stubs([])),
      route: '/account',
      children: <AccountProfilePage />,
    })
    const card = page.getByTestId('account-profile')
    await expect.element(card).toBeInTheDocument()
    // fixture data, not copy
    await expect.element(card.getByText('20990001')).toBeInTheDocument()
    await expect.element(card.getByText('示例学院')).toBeInTheDocument()
    await expect.element(page.getByTestId('email-verified')).toHaveAttribute('data-verified', 'yes')
  })
})

describe('the reader’s ways in', () => {
  it('offers to let go only of what the server says may go', async () => {
    const release = vi.fn(() => Effect.succeed({ signedOut: false }))
    renderScreen({
      client: fakeClient(
        stubs([password, hub(), hub({ providerId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: '另一个', unbindable: false })], {
          deleteSelfAuthBinding: release,
        }),
      ),
      route: '/account/logins',
      children: <AccountLoginsPage />,
    })
    const rows = page.getByTestId('account-entrance')
    await expect.element(rows.first()).toBeInTheDocument()
    expect(await rows.elements()).toHaveLength(3)
    // the bound account is named by the fixture's own label
    await expect.element(page.getByText('zhang-dev').first()).toBeInTheDocument()
    const offered = page.getByRole('button', { name: '解除绑定' })
    expect(await offered.elements()).toHaveLength(1)

    await offered.click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeInTheDocument()
    expect(release).not.toHaveBeenCalled()
    await asked.getByRole('button', { name: '解除绑定' }).click()
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(release).toHaveBeenCalledWith({ params: { providerId: HUB_ID } })
  })
})

describe('binding an account of your own', () => {
  it('offers to bind where a way in takes one, and says why a bind came back', async () => {
    renderScreen({
      client: fakeClient(
        stubs([
          password,
          hub({ bound: null, unbindable: false, bindHref: '/api/auth/github/hub/start?intent=bind' }),
        ]),
      ),
      route: '/account/logins?error=AUTH_BINDING_SUBJECT_TAKEN',
      children: <AccountLoginsPage />,
    })
    await expect
      .element(page.getByTestId('account-failure'))
      .toHaveAttribute('data-code', 'AUTH_BINDING_SUBJECT_TAKEN')
    const rows = page.getByTestId('account-entrance')
    await expect.element(rows.first()).toBeInTheDocument()
    const bindable = (await rows.elements()).map((row) => row.getAttribute('data-bindable'))
    expect(bindable).toEqual(['false', 'true'])
    expect(await page.getByRole('button', { name: '绑定', exact: true }).elements()).toHaveLength(1)
  })
})
