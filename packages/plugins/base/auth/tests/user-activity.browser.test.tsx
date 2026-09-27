import UserActivityPage from '../src/client/iam/UserActivityPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// Somebody's sessions and sign-ins, as whoever administers their account
// reads them: the same records the person reads of themselves, their own
// ones asked of by the person's id, and a way to sign them out. A reader who
// may read the person but not their account is told so once, and nothing
// of the account is asked for.

type Person = ApiResult<typeof authApi, 'identity', 'getUser'>
type Session = ApiResult<typeof authApi, 'identity', 'listUserSessions'>['items'][number]

const USER_ID = '66666666-6666-4666-8666-666666666666'
const SESSION_A = '77777777-7777-4777-8777-77777777770a'
const SESSION_B = '77777777-7777-4777-8777-77777777770b'

const person = (accountManageable = true): Person => ({
  user: {
    id: USER_ID,
    businessNo: '20230001',
    email: 'zhang@school.edu',
    emailVerifiedAt: null,
    displayName: '张三',
    status: 'active',
    version: 1,
    userType: { id: 'ut', code: 'student', name: '学生' },
    primaryOrgNode: { id: 'n', name: '2023级' },
    manageable: true,
  },
  orgPath: [],
  placement: { mode: 'unrestricted' },
  roles: [],
  lastSignInAt: null,
  accountManageable,
})

const session = (id: string): Session => ({
  id,
  current: false,
  entrance: { name: '邮箱密码', type: 'local' },
  createdAt: '2026-09-20T01:00:00.000Z',
  lastUsedAt: '2026-09-25T01:00:00.000Z',
  expiresAt: '2026-10-20T01:00:00.000Z',
  clientIp: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36',
})

const open = (who: Person, stubs: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      identity: { getUser: () => Effect.succeed(who), ...stubs },
    }),
    path: '/organization/users/:userId/activity',
    route: `/organization/users/${USER_ID}/activity`,
    children: <UserActivityPage />,
  })

describe("a person's security activity", () => {
  it('reads their sessions and sign-ins by their id, and signs them out everywhere after asking', async () => {
    const sessions = vi.fn(() =>
      Effect.succeed({ items: [session(SESSION_A), session(SESSION_B)], nextCursor: null }),
    )
    const signIns = vi.fn(() => Effect.succeed({ items: [], total: 0, page: 1, pageSize: 5 }))
    const endAll = vi.fn(() => Effect.succeed({ ended: 2 }))
    await open(person(), {
      listUserSessions: sessions,
      listUserSignIns: signIns,
      deleteUserSessions: endAll,
    })
    const card = page.getByTestId('sessions-card')
    await expect.element(card).toHaveAttribute('data-count', '2')
    expect(sessions).toHaveBeenCalledWith({ params: { userId: USER_ID }, query: {} })
    await vi.waitFor(() =>
      expect(signIns).toHaveBeenCalledWith({
        params: { userId: USER_ID },
        query: { page: '1', limit: '5' },
      }),
    )
    // none of theirs is the reader's own, so each can be ended
    expect(card.element().querySelectorAll('[data-testid="session-row"] button')).toHaveLength(2)
    // named as what it does to them, like each row's, not as the reader signing out
    await card.getByRole('button', { name: '结束全部会话' }).click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeInTheDocument()
    expect(endAll).not.toHaveBeenCalled()
    await asked.getByTestId('confirm-accept').click()
    await vi.waitFor(() => expect(endAll).toHaveBeenCalledWith({ params: { userId: USER_ID } }))
  })

  it('ends one session of theirs by its id, after asking', async () => {
    const endOne = vi.fn(() => Effect.succeed({ ok: true as const }))
    await open(person(), {
      listUserSessions: () => Effect.succeed({ items: [session(SESSION_A)], nextCursor: null }),
      listUserSignIns: () => Effect.succeed({ items: [], total: 0, page: 1, pageSize: 5 }),
      deleteUserSession: endOne,
    })
    const row = page.getByTestId('session-row')
    await expect.element(row).toBeInTheDocument()
    // named as what it does to them, not as signing the reader out
    await row.getByRole('button', { name: '结束会话' }).click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeInTheDocument()
    expect(endOne).not.toHaveBeenCalled()
    await asked.getByTestId('confirm-accept').click()
    await vi.waitFor(() =>
      expect(endOne).toHaveBeenCalledWith({ params: { userId: USER_ID, sessionId: SESSION_A } }),
    )
  })

  it('offers the whole record only when there is something in it', async () => {
    const signIns = vi.fn(() => Effect.succeed({ items: [], total: 0, page: 1, pageSize: 5 }))
    await open(person(), {
      listUserSessions: () => Effect.succeed({ items: [], nextCursor: null }),
      listUserSignIns: signIns,
    })
    const card = page.getByTestId('sign-ins-card')
    await expect.element(card).toBeInTheDocument()
    await vi.waitFor(() => expect(signIns).toHaveBeenCalled())
    // read, and empty: nothing to open a sheet onto
    await vi.waitFor(() => expect(card.element().querySelector('[role="status"]')).toBeNull())
    expect(page.getByTestId('sign-ins-card-all').query()).toBeNull()
  })

  it('says so once to a reader beyond the account, and asks nothing of it', async () => {
    const sessions = vi.fn(() => Effect.succeed({ items: [], nextCursor: null }))
    const signIns = vi.fn(() => Effect.succeed({ items: [], total: 0, page: 1, pageSize: 5 }))
    await open(person(false), { listUserSessions: sessions, listUserSignIns: signIns })
    await expect
      .element(page.getByTestId('user-activity-denied'))
      .toHaveAttribute('data-state', 'denied')
    expect(document.querySelector('[data-testid="sessions-card"]')).toBeNull()
    expect(sessions).not.toHaveBeenCalled()
    expect(signIns).not.toHaveBeenCalled()
  })
})
