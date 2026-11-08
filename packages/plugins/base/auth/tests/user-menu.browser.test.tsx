import UserMenu from '../src/client/UserMenu.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { useQueryClient } from '@tanstack/react-query'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The account corner's menu keeps its width however long a unit is named:
// the name gives way at its end, the menu does not grow across the bar.

const LONG = '外国语言文学与跨文化交际研究院国际中文教育与汉语国际推广联合培养中心'

function RefreshIdentity() {
  const cache = useQueryClient()
  return <button onClick={() => void cache.refetchQueries()}>Refresh identity</button>
}

it.each([1280, 390])(
  'keeps the last account corner on a failed connection at %ipx',
  async (width) => {
    await page.viewport(width, 800)
    let unavailable = false
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: {
          getSession: () =>
            unavailable
              ? Effect.fail({ _tag: 'HttpClientError', reason: { _tag: 'TransportError' } })
              : Effect.succeed(session(LONG)),
        },
      }),
      children: (
        <>
          <UserMenu />
          <RefreshIdentity />
        </>
      ),
    })
    const trigger = page.getByRole('button', { name: /张三/ })
    await expect.element(trigger).toBeVisible()
    const before = trigger.element()
    const beforeWidth = before.getBoundingClientRect().width
    unavailable = true
    await page.getByRole('button', { name: 'Refresh identity' }).click()
    await expect.element(page.getByTestId('account-disconnected')).toBeVisible()
    expect(trigger.element()).toBe(before)
    expect(trigger.element().getBoundingClientRect().width).toBe(beforeWidth)
    unavailable = false
    await page.getByRole('button', { name: 'Refresh identity' }).click()
    await expect.poll(() => page.getByTestId('account-disconnected').elements().length).toBe(0)
    await page.viewport(1280, 800)
  },
)

const session = (unit: string) => ({
  user: {
    id: 'u',
    displayName: '张三',
    businessNo: '20990001',
    userType: { id: 't', code: 'student', name: '学生' },
    primaryOrgNode: {
      id: 'n',
      name: unit,
      orgType: { id: 'k', name: '中心' },
      lineage: [
        { id: 'r', name: '示例大学', typeName: '学校' },
        { id: 'n', name: unit, typeName: '中心' },
      ],
    },
    tenant: { id: 'tn', slug: 'demo', name: '示例大学' },
  },
})

describe('the account menu', () => {
  // A sign-out the server refused leaves the reader signed in, and says so
  // as a notice of its own rather than as words pushed into the top bar.
  it('says a refused sign-out as a notice, and adds nothing to the bar', async () => {
    const end = vi.fn(() => Effect.fail(apiError('SERVICE_UNAVAILABLE')))
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        auth: { getSession: () => Effect.succeed(session('示例学院')), endSession: end },
      }),
      route: '/',
      children: <UserMenu />,
    })
    await page.getByRole('button', { name: /张三/ }).click()
    await page.getByRole('menuitem', { name: '退出登录' }).click()
    await vi.waitFor(() => expect(end).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(document.querySelector('[data-sonner-toast]')).not.toBeNull())
    expect(document.querySelector('[role="alert"]:not([data-sonner-toast] *)')).toBeNull()
    await expect.element(page.getByRole('button', { name: /张三/ })).toBeVisible()
  })

  it('cuts a long unit name short instead of widening', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        auth: {
          getSession: () =>
            Effect.succeed({
              user: {
                id: 'u',
                displayName: '张三',
                businessNo: '20990001',
                userType: { id: 't', code: 'student', name: '学生' },
                primaryOrgNode: {
                  id: 'n',
                  name: LONG,
                  orgType: { id: 'k', name: '中心' },
                  lineage: [
                    { id: 'r', name: '示例大学', typeName: '学校' },
                    { id: 'n', name: LONG, typeName: '中心' },
                  ],
                },
                tenant: { id: 'tn', slug: 'demo', name: '示例大学' },
              },
            }),
        },
      }),
      route: '/',
      children: <UserMenu />,
    })
    await page.getByRole('button', { name: /张三/ }).click()
    const step = page.getByTitle(LONG)
    await expect.element(step).toBeVisible()
    const menu = step.element().closest('[data-slot="dropdown-menu-content"]')!
    expect(menu.getBoundingClientRect().width).toBeLessThanOrEqual(16 * 16 + 1)
    const name = step.element() as HTMLElement
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
  })
})

it('keeps the reload confirmation outside the account menu until answered', async () => {
  const save = vi.fn(() => Effect.succeed({ locale: 'en-US' as const }))
  await renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      auth: { getSession: () => Effect.succeed(session('示例学院')), putLocale: save },
    }),
    children: <UserMenu />,
  })
  await page.getByRole('button', { name: /张三/ }).click()
  await page.getByRole('combobox', { name: '语言' }).click()
  await page.getByRole('option', { name: 'English' }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  expect(document.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull()
  expect(save).not.toHaveBeenCalled()
  await page.getByTestId('confirm-dismiss').click()
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  expect(save).not.toHaveBeenCalled()
})
