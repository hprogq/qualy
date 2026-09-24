import LoginPage from '../src/client/LoginPage.tsx'
import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { TooManyAttempts } from '@qualy/auth-contract/session'
import { CaptchaRequired } from '@qualy/plugin-captcha/contract'
import { InvalidCredentials } from '@qualy/plugin-auth-local/api'
import { registerCaptchaProvider, type CaptchaClientState } from '@qualy/plugin-captcha/client'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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
  passwordRule: { minLength: 15, maxLength: 128 },
})

/** nobody is signed in: the session read is refused, as it is for a visitor */
const anonymous = { getSession: () => Effect.fail(apiError('AUTH_REQUIRED', undefined)) }

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
      auth: { ...anonymous, listLoginMethods: context([password]) },
    }),
    registry: { login },
    // the method is chosen in the address, so the screen opens on the
    // driver's own form rather than on the list
    route: '/login?method=password',
    children: <LoginPage />,
  })

describe('the sign-in screen', () => {
  it('renders the driver filed under the type the method names', async () => {
    await screen({ local: lazy(() => import('@qualy/plugin-auth-local/client/LoginMethod')) })
    // the local driver's own form, which is the only thing that proves the
    // renderer was resolved rather than the shell drawing an empty card
    await expect.element(page.getByLabelText('邮箱')).toBeVisible()
    await expect.element(page.getByLabelText('密码')).toBeVisible()
    // exact, because the way back out of the driver says 其他登录方式
    await expect.element(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  })

  it('goes from the address to the password on Tab, and only then to a forgotten password', async () => {
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [{ id: 'auth/reset-password', path: '/reset-password', layout: 'blank' }],
            }),
        },
        auth: { ...anonymous, listLoginMethods: context([password]) },
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
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { ...anonymous, listLoginMethods: context([password]) },
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

  it('meets a challenge without being asked twice, and never sends a proof again', async () => {
    // a provider the suite drives: it reports working, and solves when told
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
        client: fakeClient({
          app: { getManifest: emptyManifest() },
          auth: { ...anonymous, listLoginMethods: context([password]) },
          authLocal: {
            login: ({ payload }: { payload: (typeof sent)[number] }) =>
              Effect.suspend((): Effect.Effect<never, CaptchaRequired | InvalidCredentials> => {
                sent.push(payload)
                // the door asks for a challenge whenever no proof came with the attempt
                return payload.captcha === undefined
                  ? Effect.fail(
                      new CaptchaRequired({ provider: 'fake', challenge: { n: sent.length } }),
                    )
                  : Effect.fail(new InvalidCredentials())
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
      await page.getByLabelText('邮箱').fill('ada@school.edu')
      await page.getByLabelText('密码').fill('a long enough password')
      await submit.click()
      // asked for a challenge: checking, not refused - no pause, no shake
      await expect.element(submit).toHaveAttribute('data-captcha', 'working')
      await expect.element(submit).toBeDisabled()
      expect(submit.element().getAttribute('data-wait')).toBeNull()
      // the provider needs the person: the button waits on them, still shut
      reports.at(-1)!({ kind: 'interaction-required' })
      await expect.element(submit).toHaveAttribute('data-captcha', 'interaction')
      await expect.element(submit).toBeDisabled()
      // met: the same attempt goes again by itself, with the proof
      reports.at(-1)!({ kind: 'solved', response: 'proof-1' })
      await expect.poll(() => sent.length).toBe(2)
      expect(sent[1]).toMatchObject({
        email: 'ada@school.edu',
        captcha: { provider: 'fake', response: 'proof-1' },
      })
      // the password was wrong after all: the proof is gone with it, so the
      // next press is a plain attempt the door answers afresh
      await expect.element(submit).toHaveAttribute('data-captcha', 'idle')
      await expect.poll(() => submit.element().hasAttribute('disabled')).toBe(false)
      await submit.click()
      await expect.poll(() => sent.length).toBe(3)
      expect(sent[2]?.captcha).toBeUndefined()
    } finally {
      unregister()
    }
  })

  it('sets a challenge aside when the address changes, and a late proof sends nothing', async () => {
    const reports: ((state: CaptchaClientState) => void)[] = []
    const unregister = registerCaptchaProvider({
      code: 'fake',
      start: ({ onStateChange }) => {
        reports.push(onStateChange)
        onStateChange({ kind: 'working' })
        return Promise.resolve({ dispose: () => undefined })
      },
    })
    let asked = 0
    try {
      await renderScreen({
        client: fakeClient({
          app: { getManifest: emptyManifest() },
          auth: { ...anonymous, listLoginMethods: context([password]) },
          authLocal: {
            login: () =>
              Effect.suspend(() => {
                asked += 1
                return Effect.fail(new CaptchaRequired({ provider: 'fake', challenge: {} }))
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
      await page.getByLabelText('邮箱').fill('ada@school.edu')
      await page.getByLabelText('密码').fill('a long enough password')
      await submit.click()
      await expect.element(submit).toHaveAttribute('data-captcha', 'working')
      const late = reports.at(-1)!
      await page.getByLabelText('邮箱').fill('grace@school.edu')
      await expect.element(submit).toHaveAttribute('data-captcha', 'idle')
      late({ kind: 'solved', response: 'for the old address' })
      await new Promise((settle) => setTimeout(settle, 300))
      expect(asked).toBe(1)
    } finally {
      unregister()
    }
  })

  it('fills in the address this browser was asked to keep', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { ...anonymous, listLoginMethods: context([password]) },
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
    await screen({ local: lazy(() => Promise.resolve({ default: Broken })) })
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
    await screen({})
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
          auth: { ...anonymous, listLoginMethods: context([password]) },
        }),
        route,
        children: <LoginPage />,
      })
    await back('/login?error=AUTH_PERSON_NOT_FOUND')
    await expect
      .element(page.getByTestId('sign-in-failure'))
      .toHaveAttribute('data-code', 'AUTH_PERSON_NOT_FOUND')
    // the way on is still offered beside it
    await expect.element(page.getByRole('button', { name: '账号密码' })).toBeVisible()
  })

  it('shows nothing for an error that is not a code', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { ...anonymous, listLoginMethods: context([password]) },
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
        auth: { ...anonymous, listLoginMethods: context(methods) },
      }),
      route,
      children: <LoginPage />,
    })

  it('names the workspace once, lists the main ways as equals and the rest as tiles', async () => {
    await open([
      password,
      away('cas', '统一身份认证', { prominence: 'primary' }),
      away('github', 'GitHub', { icon: { kind: 'builtin', key: 'github' } }),
    ])
    await expect.element(page.getByTestId('sign-in-tenant')).toHaveTextContent('示范大学')
    await expect.element(page.getByTestId('sign-in-primary').first()).toBeVisible()
    expect(page.getByTestId('sign-in-primary').elements()).toHaveLength(2)
    // nobody recommended one, so none of them is set apart
    expect(
      page
        .getByTestId('sign-in-primary')
        .elements()
        .map((key) => key.getAttribute('data-recommended')),
    ).toEqual(['false', 'false'])
    expect(page.getByTestId('sign-in-tile').elements()).toHaveLength(1)
    await expect.element(page.getByRole('button', { name: '使用 GitHub 登录' })).toBeVisible()
    expect(page.getByTestId('sign-in-more').elements()).toHaveLength(0)
  })

  it('marks the way this browser last signed in by', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: {
          ...anonymous,
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
      page
        .getByTestId('sign-in-primary')
        .elements()
        .map((key) => key.getAttribute('data-last')),
    ).toEqual(['false', 'false'])
  })

  it('draws the recommended way by the version for its filled ground', async () => {
    await open([
      away('cas', '统一身份认证', {
        prominence: 'primary',
        recommended: true,
        icon: { kind: 'image', version: 'light-one', onDark: 'dark-one' },
      }),
      away('sso', '门户', {
        prominence: 'primary',
        icon: { kind: 'image', version: 'light-two', onDark: 'dark-two' },
      }),
    ])
    await expect.element(page.getByTestId('sign-in-primary').first()).toBeVisible()
    const [recommended, plain] = page.getByTestId('sign-in-primary').elements()
    // a light page: the filled button is dark, the plain one is not
    const drawn = (key: Element) => key.querySelector('[data-icon]')!
    expect(drawn(recommended!).getAttribute('data-surface')).toBe('dark')
    expect(drawn(recommended!).getAttribute('data-version')).toBe('dark-one')
    expect(drawn(plain!).getAttribute('data-surface')).toBe('light')
    expect(drawn(plain!).getAttribute('data-version')).toBe('light-two')
  })

  it('sets apart only the way the tenant recommends', async () => {
    await open([
      password,
      away('cas', '统一身份认证', { prominence: 'primary', recommended: true }),
    ])
    await expect.element(page.getByTestId('sign-in-primary').first()).toBeVisible()
    expect(
      page
        .getByTestId('sign-in-primary')
        .elements()
        .map((key) => key.getAttribute('data-recommended')),
    ).toEqual(['false', 'true'])
  })

  it('opens every other way from the last tile, and searches them when there are many', async () => {
    const many = Array.from({ length: 10 }, (_, index) => away(`way${index}`, `方式${index}`))
    await open([password, ...many])
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
    await open([password], '/login?error=AUTH_FLOW_REJECTED')
    const notice = page.getByTestId('sign-in-failure')
    await expect.element(notice).toHaveAttribute('data-tone', 'info')
    await notice.getByRole('button', { name: '关闭' }).click()
    await expect.poll(() => document.querySelector('[data-testid="sign-in-failure"]')).toBeNull()
    await expect.element(page.getByRole('button', { name: '账号密码' })).toBeVisible()
  })

  it('offers nothing to choose when there is nothing to choose', async () => {
    await open([])
    await expect.element(page.getByTestId('sign-in-empty')).toBeVisible()
  })
})

describe('the sign-in screen, for somebody already signed in', () => {
  const signedInAs = () =>
    Effect.succeed({
      user: { id: 'u1', displayName: '张三', email: 'zhang@school.edu', tenantId: 't1' },
    })

  it('sends them home instead of offering a second sign-in', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { getSession: signedInAs, listLoginMethods: context([password]) },
      }),
      route: '/login',
      children: <LoginPage />,
    })
    await expect.poll(addressNow).toBe('/')
    // the ways in were never offered
    expect(page.getByRole('button', { name: '账号密码' }).elements()).toHaveLength(0)
  })

  it('sends them on to where they were sent from, when that is an address here', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { getSession: signedInAs, listLoginMethods: context([password]) },
      }),
      routes: [
        { path: '/login', element: <LoginPage /> },
        { path: '/reports', element: <main data-testid="reports" /> },
      ],
      route: `/login?next=${encodeURIComponent('/reports?term=2026#top')}`,
    })
    await expect.element(page.getByTestId('reports')).toBeInTheDocument()
    expect(addressNow()).toBe('/reports?term=2026')
  })

  it('sends them home instead when the way back leads elsewhere', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { getSession: signedInAs, listLoginMethods: context([password]) },
      }),
      route: `/login?next=${encodeURIComponent('https://elsewhere.example/')}`,
      children: <LoginPage />,
    })
    await expect.poll(addressNow).toBe('/')
  })

  it('offers the ways in when the session it had has lapsed', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: {
          getSession: () => Effect.fail(apiError('SESSION_EXPIRED', undefined)),
          listLoginMethods: context([password]),
        },
      }),
      route: '/login',
      children: <LoginPage />,
    })
    await expect.element(page.getByRole('button', { name: '账号密码' })).toBeVisible()
    expect(addressNow()).toBe('/login')
  })
})

describe('the way back after signing in', () => {
  it('stays in the address while a way in is chosen', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: emptyManifest() },
        auth: { ...anonymous, listLoginMethods: context([password]) },
      }),
      registry: {
        login: { local: lazy(() => import('@qualy/plugin-auth-local/client/LoginMethod')) },
      },
      route: `/login?next=${encodeURIComponent('/reports')}`,
      children: <LoginPage />,
    })
    await page.getByRole('button', { name: '账号密码' }).click()
    await expect.element(page.getByLabelText('邮箱')).toBeVisible()
    expect(new URLSearchParams(addressNow().split('?')[1]).get('next')).toBe('/reports')
  })
})
