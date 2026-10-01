import { beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { reopenInLocale } from '@qualy/web-i18n'
import { AuthShell } from '../src/client/sign-in/AuthShell.tsx'
import DrawerAccount from '../src/client/DrawerAccount.tsx'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

vi.mock('@qualy/web-i18n', async (original) => ({
  ...(await original<typeof import('@qualy/web-i18n')>()),
  reopenInLocale: vi.fn(),
}))
beforeEach(() => vi.mocked(reopenInLocale).mockClear())

it('asks before saving a choice, and cancellation keeps the form and language', async () => {
  const save = vi.fn(() => Effect.succeed({ locale: 'en-US' as const }))
  await renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      auth: { putLocale: save },
    }),
    children: (
      <>
        <input aria-label="Draft" defaultValue="unsaved work" />
        <DrawerAccount />
      </>
    ),
  })
  await page.getByRole('radio', { name: 'English' }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  expect(save).not.toHaveBeenCalled()
  expect(reopenInLocale).not.toHaveBeenCalled()
  await page.getByTestId('confirm-dismiss').click()
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  await expect.element(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('unsaved work')
  await expect.element(page.getByRole('radio', { name: '简体中文' })).toBeChecked()
  expect(save).not.toHaveBeenCalled()
})

it('saves and reopens only after confirmation', async () => {
  const save = vi.fn(() => Effect.succeed({ locale: 'en-US' as const }))
  await renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      auth: { putLocale: save },
    }),
    children: <DrawerAccount />,
  })
  await page.getByRole('radio', { name: 'English' }).click()
  await page.getByTestId('confirm-accept').click()
  await expect.poll(() => vi.mocked(reopenInLocale).mock.calls).toEqual([['en-US']])
  expect(save).toHaveBeenCalledOnce()
  expect(save).toHaveBeenCalledWith({ payload: { locale: 'en-US' } })
})

it('keeps the choice open for retry if saving fails, and never reloads', async () => {
  const save = vi.fn(() => Effect.fail(apiError('INTERNAL_FAILURE')))
  await renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      auth: { putLocale: save },
    }),
    children: <DrawerAccount />,
  })
  await page.getByRole('radio', { name: 'English' }).click()
  await page.getByTestId('confirm-accept').click()
  await expect.poll(() => save.mock.calls.length).toBe(1)
  await expect.element(page.getByTestId('confirm-accept')).toBeEnabled()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  expect(reopenInLocale).not.toHaveBeenCalled()
})

it('does not ask or save when the current language is selected', async () => {
  const save = vi.fn(() => Effect.succeed({ locale: 'zh-CN' as const }))
  await renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      auth: { putLocale: save },
    }),
    children: <DrawerAccount />,
  })
  await page.getByRole('radio', { name: '简体中文' }).click()
  expect(page.getByRole('alertdialog').elements()).toHaveLength(0)
  expect(save).not.toHaveBeenCalled()
})

it('asks from the login language menu after the menu closes', async () => {
  const save = vi.fn(() => Effect.succeed({ locale: 'zh-CN' as const }))
  await renderScreen({
    locale: 'en-US',
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      auth: { putLocale: save },
    }),
    children: (
      <AuthShell>
        <input aria-label="Draft" defaultValue="unfinished login" />
      </AuthShell>
    ),
  })
  await page.getByRole('button', { name: /Language.*English/ }).click()
  await page.getByRole('menuitem', { name: '简体中文' }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  await page.getByTestId('confirm-dismiss').click()
  await expect.element(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('unfinished login')
  expect(save).not.toHaveBeenCalled()
  expect(reopenInLocale).not.toHaveBeenCalled()
})
