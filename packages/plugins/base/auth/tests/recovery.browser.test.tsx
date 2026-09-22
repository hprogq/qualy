import ResetPasswordPage from '../src/client/recovery/ResetPasswordPage.tsx'
import ConfirmEmailPage from '../src/client/recovery/ConfirmEmailPage.tsx'
import AccountSecurityPage from '../src/client/account/AccountSecurityPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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
  passwordStatus: 'set',
  ...over,
})

const client = (stubs: Record<string, Record<string, unknown>>) =>
  fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) }, ...stubs })

describe('a forgotten password', () => {
  it('asks for the email, and says the same whatever comes of it', async () => {
    const ask = vi.fn(() => Effect.succeed({ ok: true as const }))
    renderScreen({
      client: client({ auth: { createPasswordReset: ask } }),
      route: '/reset-password',
      children: <ResetPasswordPage />,
    })
    await page.getByLabelText('邮箱').fill('zhang@school.edu')
    await page.getByRole('button', { name: '发送链接' }).click()
    await expect.element(page.getByTestId('reset-asked')).toBeInTheDocument()
    expect(ask).toHaveBeenCalledWith({ payload: { email: 'zhang@school.edu' } })
  })

  it('sets the new one with the token the link carried, and never two that differ', async () => {
    const redeem = vi.fn(() => Effect.succeed({ ok: true as const }))
    renderScreen({
      client: client({ auth: { createPasswordResetRedemption: redeem } }),
      route: '/reset-password#token=link-token',
      children: <ResetPasswordPage />,
    })
    await page.getByLabelText('新密码', { exact: true }).fill('a long new password')
    await page.getByLabelText('再次输入新密码').fill('a different password')
    await page.getByRole('button', { name: '设置密码' }).click()
    await expect.element(page.getByTestId('password-mismatch')).toBeInTheDocument()
    expect(redeem).not.toHaveBeenCalled()

    await page.getByLabelText('再次输入新密码').fill('a long new password')
    await page.getByRole('button', { name: '设置密码' }).click()
    await expect.element(page.getByTestId('reset-done')).toBeInTheDocument()
    expect(redeem).toHaveBeenCalledWith({
      payload: { token: 'link-token', password: 'a long new password' },
    })
  })
})

describe('a link that confirms an email', () => {
  it('is taken up once, as the kind of link it is', async () => {
    const change = vi.fn(() => Effect.succeed({ ok: true as const }))
    const verify = vi.fn(() => Effect.succeed({ ok: true as const }))
    renderScreen({
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
    renderScreen({
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
    renderScreen({
      client: client({ self: { getSelf: () => Effect.succeed(me()), putSelfPassword: put } }),
      route: '/account/security',
      children: <AccountSecurityPage />,
    })
    await expect.element(page.getByTestId('password-card')).toHaveAttribute('data-standing', 'set')
    await page.getByLabelText('当前密码').fill('old password here')
    await page.getByLabelText('新密码', { exact: true }).fill('new password here')
    await page.getByLabelText('再次输入新密码').fill('new password here')
    await page.getByRole('button', { name: '修改密码' }).click()
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith({
      payload: { newPassword: 'new password here', currentPassword: 'old password here' },
    })
  })

  it('offers no password form before the address is proven, and sends the proof on request', async () => {
    const verify = vi.fn(() => Effect.succeed({ sent: true }))
    const change = vi.fn(() => Effect.succeed({ ok: true as const }))
    renderScreen({
      client: client({
        self: {
          getSelf: () => Effect.succeed(me({ passwordStatus: 'unset', emailVerified: false })),
          createSelfEmailVerification: verify,
          createSelfEmailChange: change,
        },
      }),
      route: '/account/security',
      children: <AccountSecurityPage />,
    })
    await expect.element(page.getByTestId('password-card')).toHaveAttribute('data-standing', 'unset')
    expect(document.querySelector('[data-testid="password-card"] form')).toBeNull()
    await expect.element(page.getByTestId('email-verified')).toHaveAttribute('data-verified', 'no')
    await page.getByRole('button', { name: '发送验证邮件' }).click()
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1))

    await page.getByLabelText('新邮箱').fill('zhang.new@school.edu')
    await page.getByRole('button', { name: '发送确认邮件' }).click()
    await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    expect(change).toHaveBeenCalledWith({ payload: { newEmail: 'zhang.new@school.edu' } })
  })
})
