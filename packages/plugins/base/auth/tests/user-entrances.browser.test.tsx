import UserIdentitiesPage from '../src/client/iam/UserIdentitiesPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// What this screen has to get right is what it does NOT decide: which kinds
// of entrance take an account written for somebody, and what such an account
// is made of, are the entrance's own say and arrive from the server. A
// screen that knew "local means a password" would be wrong the day a second
// kind is installed.

type Entrance = ApiResult<typeof authApi, 'identity', 'listUserEntrances'>['entrances'][number]

const USER_ID = '66666666-6666-4666-8666-666666666666'
const LOCAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CAS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OAUTH_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const word = (value: string) => ({ kind: 'literal' as const, value })

const local = (over: Partial<Entrance> = {}): Entrance => ({
  providerId: LOCAL_ID,
  name: '账号密码',
  type: 'local',
  status: 'active',
  admits: true,
  binding: {
    mode: 'managed',
    identifierLabel: word('登录名'),
    identifierHint: null,
    secret: { label: word('口令'), minLength: 8 },
  },
  identity: null,
  ...over,
})

const cas: Entrance = {
  providerId: CAS_ID,
  name: '统一认证',
  type: 'cas',
  status: 'active',
  admits: true,
  binding: { mode: 'derived', by: word('学工号') },
  identity: null,
}

const oauth: Entrance = {
  providerId: OAUTH_ID,
  name: '企业微信',
  type: 'wecom',
  status: 'active',
  admits: true,
  binding: { mode: 'self' },
  identity: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    identifier: 'wx-ada',
    boundAt: '2026-09-01T00:00:00.000Z',
    lastUsedAt: null,
    hasCredential: false,
  },
}

const open = (entrances: Entrance[], manageable: boolean, stubs: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      identity: {
        listUserEntrances: () => Effect.succeed({ entrances, manageable }),
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
  it('offers a form only where the entrance takes an account written for somebody', async () => {
    open([local(), cas, oauth], true)
    await expect.element(page.getByTestId('entrances')).toHaveAttribute('data-bound', '1')
    // a kind an administrator may write: one way to add it
    expect(rowOf('local').getAttribute('data-binding')).toBe('managed')
    expect(rowOf('local').querySelectorAll('button')).toHaveLength(1)
    // a kind that goes by a fact the person already has: nothing to press
    expect(rowOf('cas').getAttribute('data-binding')).toBe('derived')
    expect(rowOf('cas').querySelectorAll('button')).toHaveLength(0)
    // a kind only the person can bind: it can be withdrawn, and not written
    expect(rowOf('wecom').getAttribute('data-bound')).toBe('true')
    expect(rowOf('wecom').querySelectorAll('button')).toHaveLength(1)
  })

  it('builds the form from what the entrance asked for, and sends what was typed', async () => {
    const put = vi.fn(() => Effect.succeed({ id: 'created' }))
    open([local()], true, { putUserIdentity: put })
    await page.getByRole('button', { name: '添加账号' }).click()
    // the labels are the entrance's own words, not this screen's
    const name = page.getByRole('textbox', { name: '登录名' })
    await name.fill('ada')
    const save = page.getByRole('dialog').getByRole('button', { name: '保存', exact: true })
    // a secret shorter than the entrance said it takes is not sent at all
    await page.getByLabelText('口令').fill('short')
    await expect.element(save).toBeDisabled()
    await page.getByLabelText('口令').fill('long-enough')
    await save.click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith({
      params: { userId: USER_ID, providerId: LOCAL_ID },
      payload: { identifier: 'ada', secret: 'long-enough' },
    })
  })

  it('withdraws only after asking', async () => {
    const remove = vi.fn(() => Effect.succeed({ ok: true as const }))
    open([oauth], true, { deleteUserIdentity: remove })
    await page.getByRole('button', { name: '撤销' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
    await page.getByRole('alertdialog').getByRole('button', { name: '撤销' }).click()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove).toHaveBeenCalledWith({ params: { userId: USER_ID, providerId: OAUTH_ID } })
  })

  it('offers nothing to a reader who may only look', async () => {
    open([local(), oauth], false)
    await expect.element(page.getByTestId('entrances')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-testid="entrance-row"] button')).toHaveLength(0)
  })
})
