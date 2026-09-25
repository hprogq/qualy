import ResetPasswordPage from '../src/client/recovery/ResetPasswordPage.tsx'
import ConfirmEmailPage from '../src/client/recovery/ConfirmEmailPage.tsx'
import AccountSecurityPage from '../src/client/account/AccountSecurityPage.tsx'
import AccountActivityPage from '../src/client/account/AccountActivityPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import { Effect } from 'effect'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'
import { CaptchaRequired } from '@qualy/plugin-captcha/contract'
import { registerCaptchaProvider, type CaptchaClientState } from '@qualy/plugin-captcha/client'

// The screens mail links lead to, and the reader's own security page. What
// they must get right is what they send: the token from the fragment, the
// current password only where there is one, nothing when two new passwords
// differ, and a link spent once.

type Me = ApiResult<typeof authApi, 'self', 'getSelf'>

const me = (over: Partial<Me> = {}): Me => ({
  id: '66666666-6666-4666-8666-666666666666',
  displayName: '张三',
  businessNo: '20990001',
  email: 'zhang@school.edu',
  emailVerified: true,
  userType: { id: 'ut', name: '学生' },
  unit: { id: 'n', name: '示例学院' },
  unitLineage: [
    { id: 'r', name: '示例大学' },
    { id: 'n', name: '示例学院' },
  ],
  passwordStatus: 'set',
  ...over,
})

/** the devices and sign-ins the security page also lists, none of them */
const records = {
  listSelfSessions: () => Effect.succeed({ items: [], nextCursor: null }),
  listSelfSignIns: () => Effect.succeed({ items: [], nextCursor: null }),
}

/** what a password is held to, as every page that sets one reads it */
const passwordRule = () =>
  Effect.succeed({ tenant: null, methods: [], passwordRule: { minLength: 15, maxLength: 128 } })

const client = (stubs: Record<string, Record<string, unknown>>) =>
  fakeClient({
    app: { getManifest: () => Effect.succeed(emptyManifest()) },
    ...stubs,
    auth: { listLoginMethods: passwordRule, ...stubs['auth'] },
  })

describe('a forgotten password', () => {
  it('asks for the email, and says the same whatever comes of it', async () => {
    const ask = vi.fn(() => Effect.succeed({ ok: true as const }))
    await renderScreen({
      client: client({ auth: { createPasswordReset: ask } }),
      route: '/reset-password',
      children: <ResetPasswordPage />,
    })
    await page.getByLabelText('邮箱').fill('zhang@school.edu')
    await page.getByRole('button', { name: '发送链接' }).click()
    await expect.element(page.getByTestId('reset-asked')).toBeInTheDocument()
    expect(ask).toHaveBeenCalledWith({ payload: { email: 'zhang@school.edu' } })
  })

  it('meets a challenge before the link is sent, and sends the proof once', async () => {
    const reports: ((state: CaptchaClientState) => void)[] = []
    const unregister = registerCaptchaProvider({
      code: 'fake',
      start: ({ onStateChange }) => {
        reports.push(onStateChange)
        onStateChange({ kind: 'working' })
        return Promise.resolve({ dispose: () => undefined })
      },
    })
    const sent: { email: string; captcha?: { provider: string; response: string } }[] = []
    try {
      await renderScreen({
        client: client({
          auth: {
            createPasswordReset: ({ payload }: { payload: (typeof sent)[number] }) =>
              Effect.suspend(() => {
                sent.push(payload)
                return payload.captcha === undefined
                  ? Effect.fail(new CaptchaRequired({ provider: 'fake', challenge: {} }))
                  : Effect.succeed({ ok: true as const })
              }),
          },
        }),
        route: '/reset-password',
        children: <ResetPasswordPage />,
      })
      const submit = page.getByTestId('reset-ask-submit')
      await page.getByLabelText('邮箱').fill('zhang@school.edu')
      await submit.click()
      await expect.element(submit).toHaveAttribute('data-captcha', 'working')
      await expect.element(submit).toBeDisabled()
      // no refusal is said: this is a check, not an error
      expect(page.getByRole('alert').elements()).toHaveLength(0)
      reports.at(-1)!({ kind: 'solved', response: 'proof' })
      await expect.element(page.getByTestId('reset-asked')).toBeInTheDocument()
      expect(sent).toEqual([
        { email: 'zhang@school.edu' },
        { email: 'zhang@school.edu', captcha: { provider: 'fake', response: 'proof' } },
      ])
    } finally {
      unregister()
    }
  })

  it('sets the new one with the token the link carried, and never two that differ', async () => {
    const redeem = vi.fn(() => Effect.succeed({ ok: true as const }))
    const assess = vi.fn(({ payload }: { payload: { token: string; password: string } }) =>
      Effect.succeed({
        checks: {
          length: [...payload.password].length >= 15,
          impersonal: !payload.password.includes('zhang'),
          unguessable: !/^(.)\1+$/.test(payload.password),
        },
      }),
    )
    await renderScreen({
      client: client({
        auth: {
          createPasswordResetInspection: () => Effect.succeed({ ok: true as const }),
          createPasswordResetAssessment: assess,
          createPasswordResetRedemption: redeem,
          listLoginMethods: () =>
            Effect.succeed({
              tenant: null,
              methods: [],
              passwordRule: { minLength: 15, maxLength: 128 },
            }),
        },
      }),
      route: '/reset-password#token=link-token',
      children: <ResetPasswordPage />,
    })
    const rule = (check: string) =>
      page
        .getByTestId('password-checklist')
        .element()
        .querySelector<HTMLElement>(`[data-check="${check}"]`)!
    const field = page.getByLabelText('新密码', { exact: true })
    // what it is held to is said while it is typed; a press before it holds
    // is answered by the list, and nothing is sent
    await field.fill('too short')
    await expect.element(rule('length')).toHaveAttribute('data-state', 'unmet')
    await page.getByRole('button', { name: '设置密码' }).click()
    await expect.element(rule('length')).toHaveAttribute('data-refused', 'true')
    expect(redeem).not.toHaveBeenCalled()
    // long enough, and judged by the server against the person once typing pauses
    await field.fill('zhang by the quiet sea')
    await expect.element(rule('length')).toHaveAttribute('data-state', 'met')
    await expect.element(rule('impersonal')).toHaveAttribute('data-state', 'unmet')
    await expect.element(rule('impersonal')).toHaveAttribute('data-refused', 'true')
    expect(assess).toHaveBeenCalledWith({
      payload: { token: 'link-token', password: 'zhang by the quiet sea' },
    })
    await page.getByRole('button', { name: '设置密码' }).click()
    expect(redeem).not.toHaveBeenCalled()

    await field.fill('quiet river stones')
    await expect.element(rule('impersonal')).toHaveAttribute('data-state', 'met')
    await expect.element(rule('unguessable')).toHaveAttribute('data-state', 'met')
    await page.getByLabelText('再次输入新密码').fill('a different password')
    await page.getByRole('button', { name: '设置密码' }).click()
    await expect.element(page.getByTestId('password-mismatch')).toBeInTheDocument()
    expect(redeem).not.toHaveBeenCalled()

    await page.getByLabelText('再次输入新密码').fill('quiet river stones')
    await page.getByRole('button', { name: '设置密码' }).click()
    await expect.element(page.getByTestId('reset-done')).toBeInTheDocument()
    expect(redeem).toHaveBeenCalledWith({
      payload: { token: 'link-token', password: 'quiet river stones' },
    })
  })

  it('says a link no longer works as the page opens, before anything is typed', async () => {
    const inspect = vi.fn(() => Effect.fail(apiError('AUTH_CHALLENGE_INVALID', undefined)))
    await renderScreen({
      client: client({
        auth: {
          createPasswordResetInspection: inspect,
          listLoginMethods: () =>
            Effect.succeed({
              tenant: null,
              methods: [],
              passwordRule: { minLength: 15, maxLength: 128 },
            }),
        },
      }),
      route: '/reset-password#token=spent-token',
      children: <ResetPasswordPage />,
    })
    await expect.element(page.getByTestId('reset-expired')).toBeInTheDocument()
    expect(inspect).toHaveBeenCalledWith({ payload: { token: 'spent-token' } })

    // and the way on from there is the form that sends a new one
    await page.getByRole('button', { name: '重新获取链接' }).click()
    await expect.element(page.getByLabelText('邮箱')).toBeInTheDocument()
    await expect.element(page.getByTestId('reset-expired')).not.toBeInTheDocument()
    expect(inspect).toHaveBeenCalledTimes(1)
  })
})

describe('a link that confirms an email', () => {
  it('is taken up once, as the kind of link it is', async () => {
    const change = vi.fn(() => Effect.succeed({ ok: true as const }))
    const verify = vi.fn(() => Effect.succeed({ ok: true as const }))
    await renderScreen({
      client: client({
        auth: { createEmailChangeRedemption: change, createEmailVerificationRedemption: verify },
      }),
      route: '/confirm-email#purpose=change&token=move-token',
      children: <ConfirmEmailPage />,
    })
    const state = page.getByTestId('confirm-state')
    await expect.element(state).toHaveAttribute('data-state', 'done')
    await expect.element(state).toHaveAttribute('data-purpose', 'change')
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith({ payload: { token: 'move-token' } })
    expect(verify).not.toHaveBeenCalled()
  })

  it('says a link without its token is incomplete, and asks nothing', async () => {
    const verify = vi.fn(() => Effect.succeed({ ok: true as const }))
    await renderScreen({
      client: client({ auth: { createEmailVerificationRedemption: verify } }),
      route: '/confirm-email',
      children: <ConfirmEmailPage />,
    })
    await expect.element(page.getByTestId('confirm-state')).toHaveAttribute('data-state', 'missing')
    expect(verify).not.toHaveBeenCalled()
  })
})

describe('the reader’s security', () => {
  it('asks for the current password where there is one, and sends it with the new', async () => {
    const put = vi.fn(() => Effect.succeed({ ok: true as const }))
    await renderScreen({
      client: client({
        self: {
          ...records,
          getSelf: () => Effect.succeed(me()),
          putSelfPassword: put,
          createSelfPasswordAssessment: () =>
            Effect.succeed({ checks: { length: true, impersonal: true, unguessable: true } }),
        },
      }),
      route: '/account/security',
      children: <AccountSecurityPage />,
    })
    await expect.element(page.getByTestId('password-card')).toHaveAttribute('data-standing', 'set')
    // the form is not there until asked for
    expect(document.querySelector('[data-testid="password-card"] form')).toBeNull()
    await page.getByRole('button', { name: '修改密码' }).click()
    // in a dialog over the page, not unfolded into it
    await expect.element(page.getByRole('dialog')).toBeInTheDocument()
    expect(document.querySelector('[data-testid="password-card"] form')).toBeNull()
    await page.getByLabelText('当前密码').fill('old password here')
    await page.getByLabelText('新密码', { exact: true }).fill('new password here')
    // held to the same list as every other form that sets a password
    await expect
      .element(
        page
          .getByTestId('password-checklist')
          .element()
          .querySelector<HTMLElement>('[data-check="unguessable"]')!,
      )
      .toHaveAttribute('data-state', 'met')
    await page.getByLabelText('再次输入新密码').fill('new password here')
    await page.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith({
      payload: { newPassword: 'new password here', currentPassword: 'old password here' },
    })
  })

  it('offers no password form before the address is proven, and sends the proof on request', async () => {
    const verify = vi.fn(() => Effect.succeed({ sent: true }))
    const change = vi.fn(() => Effect.succeed({ ok: true as const }))
    await renderScreen({
      client: client({
        self: {
          ...records,
          getSelf: () => Effect.succeed(me({ passwordStatus: 'unset', emailVerified: false })),
          createSelfEmailVerification: verify,
          createSelfEmailChange: change,
        },
      }),
      route: '/account/security',
      children: <AccountSecurityPage />,
    })
    await expect
      .element(page.getByTestId('password-card'))
      .toHaveAttribute('data-standing', 'unset')
    expect(document.querySelector('[data-testid="password-card"] form')).toBeNull()
    await expect.element(page.getByTestId('email-verified')).toHaveAttribute('data-verified', 'no')
    await page.getByRole('button', { name: '发送验证邮件' }).click()
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1))

    await page.getByRole('button', { name: '更改' }).click()
    await page.getByLabelText('新邮箱').fill('zhang.new@school.edu')
    await page.getByRole('button', { name: '发送确认邮件' }).click()
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    expect(change).toHaveBeenCalledWith({ payload: { newEmail: 'zhang.new@school.edu' } })
  })
})

describe('the reader’s devices and sign-ins', () => {
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'
  const SAFARI_PHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
  const session = (id: string, current: boolean, userAgent: string) => ({
    id,
    current,
    entrance: { name: '邮箱密码', type: 'local' },
    createdAt: '2026-09-20T08:00:00.000Z',
    lastUsedAt: '2026-09-23T08:00:00.000Z',
    expiresAt: '2026-10-20T08:00:00.000Z',
    clientIp: '203.0.113.7',
    userAgent,
  })

  it('ends one other device, or every other at once, and never offers the one in hand', async () => {
    const endOne = vi.fn(() => Effect.succeed({ ok: true as const }))
    const endAll = vi.fn(() => Effect.succeed({ ended: 1 }))
    await renderScreen({
      client: client({
        self: {
          getSelf: () => Effect.succeed(me()),
          listSelfSessions: () =>
            Effect.succeed({
              items: [session('s-here', true, CHROME_MAC), session('s-phone', false, SAFARI_PHONE)],
              nextCursor: null,
            }),
          listSelfSignIns: () => Effect.succeed({ items: [], nextCursor: null }),
          deleteSelfSession: endOne,
          deleteSelfSessions: endAll,
        },
      }),
      route: '/account/security',
      children: <AccountSecurityPage />,
    })
    const rows = page.getByTestId('session-row')
    await expect.element(rows.first()).toBeInTheDocument()
    expect(rows.elements()).toHaveLength(2)
    // the device in the words a person knows it by
    await expect.element(page.getByText('Chrome - macOS')).toBeVisible()
    await expect.element(page.getByText('Safari - iOS')).toBeVisible()
    // one way out per other device, none for the one in hand
    const here = page.getByTestId('session-row').filter({ hasText: 'Chrome - macOS' })
    expect(here.element().querySelector('button')).toBeNull()
    await page
      .getByTestId('session-row')
      .filter({ hasText: 'Safari - iOS' })
      .getByRole('button')
      .click()
    await vi.waitFor(() =>
      expect(endOne).toHaveBeenCalledWith({ params: { sessionId: 's-phone' } }),
    )

    await page.getByRole('button', { name: '退出其他所有会话' }).click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeInTheDocument()
    expect(endAll).not.toHaveBeenCalled()
    await asked.getByRole('button', { name: '退出其他所有会话' }).click()
    await vi.waitFor(() => expect(endAll).toHaveBeenCalledTimes(1))
  })

  it('keeps the history on a page of its own, reached from what is signed in now', async () => {
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [
                {
                  id: 'auth/account-activity',
                  path: '/account/activity',
                  layout: 'account-shell/v1',
                },
              ],
            }),
        },
        self: {
          getSelf: () => Effect.succeed(me()),
          listSelfSessions: () => Effect.succeed({ items: [], nextCursor: null }),
        },
        auth: { listLoginMethods: passwordRule },
      }),
      route: '/account/security',
      children: <AccountSecurityPage />,
    })
    const way = page.getByTestId('sessions-card').getByRole('link', { name: '查看登录记录' })
    await expect.element(way).toHaveAttribute('href', '/account/activity')
    // said in the size of the card's head, not the page's body
    expect(Number.parseFloat(getComputedStyle(way.element()).fontSize)).toBeLessThan(15)
    expect(document.querySelector('[data-testid="sign-ins-card"]')).toBeNull()
  })
})

describe('the reader’s security activity', () => {
  const attempt = (id: string, outcome: 'success' | 'failure', current = false) => ({
    id,
    occurredAt: '2026-09-23T08:00:00.000Z',
    outcome,
    entrance: { name: '邮箱密码', type: 'local' },
    current,
    clientIp: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36',
  })
  const change = (id: string, actor: 'self' | 'other') => ({
    id,
    occurredAt: '2026-09-20T08:00:00.000Z',
    name: { kind: 'literal' as const, value: `变更 ${id}` },
    actor,
  })

  it('shows the latest of each record, and the whole of it with filters and pages in a sheet', async () => {
    const signIns = vi.fn((request: { query: Record<string, string | undefined> }) => {
      const whole = Array.from({ length: 30 }, (_, n) =>
        attempt(`a${String(n)}`, n % 3 === 0 ? 'failure' : 'success', n === 0),
      )
      const kept =
        request.query['outcome'] === undefined
          ? whole
          : whole.filter((one) => one.outcome === request.query['outcome'])
      const size = Number(request.query['limit'] ?? '20')
      const page = Number(request.query['page'] ?? '1')
      return Effect.succeed({
        items: kept.slice((page - 1) * size, page * size),
        total: kept.length,
        page,
        pageSize: size,
      })
    })
    const changes = vi.fn(() =>
      Effect.succeed({
        items: [change('c1', 'self'), change('c2', 'other')],
        total: 2,
        page: 1,
        pageSize: 5,
      }),
    )
    await renderScreen({
      client: client({ self: { listSelfSignIns: signIns, listSelfAccountChanges: changes } }),
      route: '/account/activity',
      children: <AccountActivityPage />,
    })
    // on the page: the latest few of each, asked for as a few
    const recent = page.getByTestId('sign-ins-card').getByTestId('sign-in-row')
    await expect.element(recent.first()).toBeInTheDocument()
    expect(recent.elements()).toHaveLength(5)
    expect(signIns).toHaveBeenCalledWith({ query: { page: '1', limit: '5' } })
    const changed = page.getByTestId('account-changes').getByTestId('account-change')
    await expect.element(changed.first()).toBeInTheDocument()
    expect(changed.elements().map((row) => row.getAttribute('data-actor'))).toEqual([
      'self',
      'other',
    ])
    // each record opens on its own, whether or not the card holds all of it
    await page.getByTestId('account-changes-all').click()
    await expect.element(page.getByTestId('account-changes-sheet')).toBeVisible()
    await page.getByTestId('account-changes-sheet').getByRole('button', { name: '关闭' }).click()

    // the whole record opens in a sheet, a page at a time, filtered there
    await page.getByTestId('sign-ins-card-all').click()
    const sheet = page.getByTestId('sign-ins-card-sheet')
    await expect.element(sheet.getByTestId('records-pager')).toHaveAttribute('data-total', '30')
    // what narrows the rows at the start, the days at the end, on one line
    const toggles = sheet.getByRole('radiogroup').element().getBoundingClientRect()
    const days = sheet
      .getByRole('button', { name: /全部日期/ })
      .element()
      .getBoundingClientRect()
    expect(Math.abs(days.top + days.height / 2 - (toggles.top + toggles.height / 2))).toBeLessThan(
      4,
    )
    expect(days.left).toBeGreaterThan(toggles.right)
    // on a phone the days take the whole row, and a range of two dates fits one line
    await page.viewport(360, 740)
    await vi.waitFor(() => {
      const days = sheet.getByRole('button', { name: /全部日期/ }).element()
      const row = days.closest('[data-testid="sign-ins-card-sheet"] div')!.getBoundingClientRect()
      expect(days.getBoundingClientRect().width).toBeGreaterThan(row.width * 0.8)
    })
    await page.viewport(1280, 800)
    await sheet.getByRole('radio', { name: '失败' }).click()
    await vi.waitFor(() =>
      expect(signIns).toHaveBeenCalledWith({
        query: expect.objectContaining({ outcome: 'failure', page: '1', limit: '20' }),
      }),
    )
  })
})
