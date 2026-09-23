import LoginPage from '../src/client/LoginPage.tsx'
import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { TooManyAttempts } from '@qualy/auth-contract/session'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The sign-in screen finds a driver's renderer by the driver's TYPE.
//
// It used to find it by a string the server derived from the driver plugin's
// package and source file and put in the method list, so every anonymous
// visitor was told which package implements the way in. `local` is what a
// way of signing in is called, the build files the renderer under the same
// word, and this is the only test that walks that resolution.

const password = {
  code: 'password',
  type: 'local',
  name: '账号密码',
  prominence: 'primary' as const,
  recommended: false,
  icon: { kind: 'builtin' as const, key: 'mail' as const },
  mode: 'component' as const,
}

/** the public login context: a workspace by name, its ways in, and its password rule */
const context = (methods: readonly unknown[]) => ({
  tenant: { name: '示范大学' },
  methods,
  passwordRule: { minLength: 12, maxLength: 128 },
})

const away = (code: string, name: string, over: Record<string, unknown> = {}) => ({
  code,
  type: 'cas',
  name,
  prominence: 'secondary' as const,
  recommended: false,
  icon: null,
  mode: 'redirect' as const,
  href: `/api/auth/cas/${code}/start`,
  ...over,
})

const screen = (login: Record<string, ReturnType<typeof lazy>>) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: emptyManifest() },
      auth: { listLoginMethods: context([password]) },
    }),
    registry: { login },
    // the method is chosen in the address, so the screen opens on the
    // driver's own form rather than on the list
    route: '/login?method=password',
    children: <LoginPage />,
  })

describe('the sign-in screen', () => {
  it('renders the driver filed under the type the method names', async () => {
    screen({ local: lazy(() => import('@qualy/plugin-auth-local/client/LoginMethod')) })
    // the local driver's own form, which is the only thing that proves the
    // renderer was resolved rather than the shell drawing an empty card
    await expect.element(page.getByLabelText('邮箱')).toBeVisible()
    await expect.element(page.getByLabelText('密码')).toBeVisible()
    // exact, because the way back out of the driver says 其他登录方式
    await expect.element(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  })

  it('goes from the address to the password on Tab, and only then to a forgotten password', async () => {
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [{ id: 'auth/reset-password', path: '/reset-password', layout: 'blank' }],
            }),
        },
        auth: { listLoginMethods: context([password]) },
      }),
      registry: {
        login: { local: lazy(() => import('@qualy/plugin-auth-local/client/LoginMethod')) },
      },
      route: '/login?method=password',
      children: <LoginPage />,
    })
    const forgot = page.getByRole('link', { name: '忘记密码？' })
    await expect.element(forgot).toBeVisible()
    await page.getByLabelText('邮箱').click()
    await userEvent.tab()
    await expect.element(page.getByLabelText('密码')).toHaveFocus()
    await userEvent.tab()
    await expect.element(forgot).toHaveFocus()
  })

  it('sends nothing it can tell is wrong, and holds the button for the wait a refusal names', async () => {
    let tried = 0
    renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { listLoginMethods: context([password]) },
        authLocal: {
          login: () =>
            Effect.suspend(() => {
              tried += 1
              return Effect.fail(new TooManyAttempts({ retryAfterSeconds: 125 }))
            }),
        },
      }),
      registry: {
        login: { local: lazy(() => import('@qualy/plugin-auth-local/client/LoginMethod')) },
      },
      route: '/login?method=password',
      children: <LoginPage />,
    })
    const submit = page.getByTestId('local-submit')
    await page.getByLabelText('邮箱').fill('not an address')
    await page.getByLabelText('密码').fill('short')
    await submit.click()
    await expect.element(page.getByLabelText('邮箱')).toHaveAttribute('aria-invalid', 'true')
    await expect.element(page.getByLabelText('密码')).toHaveAttribute('aria-invalid', 'true')
    expect(tried).toBe(0)

    await page.getByLabelText('邮箱').fill('ada@school.edu')
    await page.getByLabelText('密码').fill('a long enough password')
    await submit.click()
    await expect.element(submit).toBeDisabled()
    await expect.element(submit).toHaveAttribute('data-wait', '125')
    // a press while it waits is no request
    await submit.click({ force: true })
    expect(tried).toBe(1)
  })

  it('fills in the address this browser was asked to keep', async () => {
    renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { listLoginMethods: context([password]) },
      }),
      registry: {
        login: { local: lazy(() => import('@qualy/plugin-auth-local/client/LoginMethod')) },
      },
      route: '/login?method=password',
      storage: { 'qualy:sign-in-email': 'kept@school.edu' },
      children: <LoginPage />,
    })
    await expect.element(page.getByLabelText('邮箱')).toHaveValue('kept@school.edu')
    await expect.element(page.getByTestId('remember-email')).toBeChecked()
  })

  it('catches a renderer that throws instead of taking the screen down', async () => {
    // the sign-in screen used to render the driver itself, outside the
    // surface boundary: a driver that threw on its first render took the
    // whole door with it and nothing said which way in had failed
    const Broken = () => {
      throw new Error('this driver exploded')
    }
    screen({ local: lazy(() => Promise.resolve({ default: Broken })) })
    await expect
      .element(page.getByTestId('login-renderer'))
      .toHaveAttribute('data-renderer', 'missing')
    // and the way out is still there, which is the whole point of catching it
    await expect.element(page.getByRole('button', { name: '其他登录方式' })).toBeVisible()
  })

  it('fails closed when this build carries no renderer for that type', async () => {
    // a deployment whose api offers a driver the browser bundle does not
    // have: the screen says so and offers the way back, rather than showing
    // a card with nothing in it
    screen({})
    await expect
      .element(page.getByTestId('login-renderer'))
      .toHaveAttribute('data-renderer', 'missing')
    await expect.element(page.getByLabelText('用户名')).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: '其他登录方式' })).toBeVisible()
  })

  it('says why a sign-in that went elsewhere came back, and reads only codes', async () => {
    const back = (route: string) =>
      renderScreen({
        client: fakeClient({
          app: { getManifest: emptyManifest() },
          auth: { listLoginMethods: context([password]) },
        }),
        route,
        children: <LoginPage />,
      })
    back('/login?error=AUTH_PERSON_NOT_FOUND')
    await expect
      .element(page.getByTestId('sign-in-failure'))
      .toHaveAttribute('data-code', 'AUTH_PERSON_NOT_FOUND')
    // the way on is still offered beside it
    await expect.element(page.getByRole('button', { name: '账号密码' })).toBeVisible()
  })

  it('shows nothing for an error that is not a code', async () => {
    renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { listLoginMethods: context([password]) },
      }),
      route: `/login?error=${encodeURIComponent('<b>hello</b>')}`,
      children: <LoginPage />,
    })
    await expect.element(page.getByRole('button', { name: '账号密码' })).toBeVisible()
    expect(document.querySelector('[data-testid="sign-in-failure"]')).toBeNull()
  })
})

describe('the ways in, as the page lays them out', () => {
  const open = (methods: readonly unknown[], route = '/login') =>
    renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { listLoginMethods: context(methods) },
      }),
      route,
      children: <LoginPage />,
    })

  it('names the workspace once, lists the main ways as equals and the rest as tiles', async () => {
    open([
      password,
      away('cas', '统一身份认证', { prominence: 'primary' }),
      away('github', 'GitHub', { icon: { kind: 'builtin', key: 'github' } }),
    ])
    await expect.element(page.getByTestId('sign-in-tenant')).toHaveTextContent('示范大学')
    await expect.element(page.getByTestId('sign-in-primary').first()).toBeVisible()
    expect(page.getByTestId('sign-in-primary').elements()).toHaveLength(2)
    // nobody recommended one, so none of them is set apart
    expect(
      page.getByTestId('sign-in-primary').elements().map((key) => key.getAttribute('data-recommended')),
    ).toEqual(['false', 'false'])
    expect(page.getByTestId('sign-in-tile').elements()).toHaveLength(1)
    await expect
      .element(page.getByRole('button', { name: '使用 GitHub 登录' }))
      .toBeVisible()
    expect(page.getByTestId('sign-in-more').elements()).toHaveLength(0)
  })

  it('marks the way this browser last signed in by', async () => {
    renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: {
          listLoginMethods: context([
            password,
            away('cas', '统一身份认证', { prominence: 'primary' }),
            away('github', 'GitHub'),
          ]),
        },
      }),
      route: '/login',
      storage: { 'qualy:sign-in-method': 'github' },
      children: <LoginPage />,
    })
    await expect.element(page.getByTestId('sign-in-tile')).toHaveAttribute('data-last', 'true')
    expect(
      page.getByTestId('sign-in-primary').elements().map((key) => key.getAttribute('data-last')),
    ).toEqual(['false', 'false'])
  })

  it('sets apart only the way the tenant recommends', async () => {
    open([password, away('cas', '统一身份认证', { prominence: 'primary', recommended: true })])
    await expect.element(page.getByTestId('sign-in-primary').first()).toBeVisible()
    expect(
      page.getByTestId('sign-in-primary').elements().map((key) => key.getAttribute('data-recommended')),
    ).toEqual(['false', 'true'])
  })

  it('opens every other way from the last tile, and searches them when there are many', async () => {
    const many = Array.from({ length: 10 }, (_, index) => away(`way${index}`, `方式${index}`))
    open([password, ...many])
    // six tiles in a row: five ways and the way to all of them
    await expect.element(page.getByTestId('sign-in-more')).toBeVisible()
    expect(page.getByTestId('sign-in-tile').elements()).toHaveLength(5)
    await page.getByTestId('sign-in-more').click()
    await expect.element(page.getByTestId('sign-in-all')).toBeVisible()
    expect(page.getByTestId('sign-in-listed').elements()).toHaveLength(10)
    await page.getByRole('searchbox').fill('方式3')
    await expect.poll(() => page.getByTestId('sign-in-listed').elements().length).toBe(1)
    // and back to where it started
    await page.getByRole('button', { name: '返回' }).click()
    await expect.element(page.getByTestId('sign-in-more')).toBeVisible()
  })

  it('says an expired sign-in in grey, not as an error, and lets it be put down', async () => {
    open([password], '/login?error=AUTH_FLOW_REJECTED')
    const notice = page.getByTestId('sign-in-failure')
    await expect.element(notice).toHaveAttribute('data-tone', 'info')
    await notice.getByRole('button', { name: '关闭' }).click()
    await expect.poll(() => document.querySelector('[data-testid="sign-in-failure"]')).toBeNull()
    await expect.element(page.getByRole('button', { name: '账号密码' })).toBeVisible()
  })

  it('offers nothing to choose when there is nothing to choose', async () => {
    open([])
    await expect.element(page.getByTestId('sign-in-empty')).toBeVisible()
  })
})
