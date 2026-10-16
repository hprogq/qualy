import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { layoutComponents, pageComponents } from 'virtual:qualy/plugins'
import { SIGN_IN_PAGE } from '@qualy/auth-contract/sign-in-failure'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
import { Effect } from 'effect'

const BlankShell = (await layoutComponents['blank-shell/v1']!()).default
const AppShell = (await layoutComponents['app-shell/v1']!()).default
const AccountShell = (await layoutComponents['account-shell/v1']!()).default
const LoginPage = (await pageComponents[SIGN_IN_PAGE]!()).default

const registration = {
  icp: { record: '京ICP备00000000号-0', href: 'https://beian.miit.gov.cn/' },
  publicSecurity: {
    record: '京公网安备00000000000000号',
    href: 'https://beian.mps.gov.cn/#/query/webSearch?code=00000000000000',
  },
}

afterEach(() => page.viewport(1280, 800))

const login = (
  locale: 'zh-CN' | 'en-US',
  context: Record<string, unknown>,
  methods: readonly unknown[] = [],
) =>
  renderScreen({
    locale,
    client: fakeClient({
      app: { getManifest: { ...emptyManifest(), context } },
      auth: {
        getSession: () => Effect.fail(apiError('AUTH_REQUIRED')),
        listLoginMethods: {
          tenant: { name: 'Demo school' },
          methods,
          passwordRule: { minLength: 15, maxLength: 128 },
        },
      },
    }),
    route: '/login',
    routes: [{ path: '/login', element: <BlankShell />, children: [{ element: <LoginPage /> }] }],
  })

describe('deployment registration in the page shells', () => {
  it('adds no registration footer when nothing is configured', async () => {
    await login('zh-CN', {})
    await expect.element(page.getByTestId('auth-shell')).toBeVisible()
    await expect.element(page.getByTestId('site-registration')).not.toBeInTheDocument()
    expect(page.getByTestId('auth-shell').element().getBoundingClientRect().height).toBe(800)
  })

  it.each(['zh-CN', 'en-US'] as const)(
    'keeps the record text unchanged and localizes accessible labels in %s',
    async (locale) => {
      await login(locale, { 'site/registration': registration })
      const icp = page.getByRole('link', {
        name: `${locale === 'en-US' ? 'ICP registration: ' : 'ICP备案：'}${registration.icp.record}`,
      })
      await expect.element(icp).toHaveTextContent(registration.icp.record)
      await expect.element(icp).toHaveAttribute('href', registration.icp.href)
      await expect.element(icp).toHaveAttribute('rel', 'noopener noreferrer')
      const security = page.getByRole('link', {
        name: `${locale === 'en-US' ? 'Public security registration: ' : '公安联网备案：'}${registration.publicSecurity.record}`,
      })
      await expect.element(security).toHaveTextContent(registration.publicSecurity.record)
      await expect.element(security).toHaveAttribute('href', registration.publicSecurity.href)
      // the filing emblem leads the public security record, named by its link
      const emblem = security.element().querySelector('img')
      expect(emblem).not.toBeNull()
      expect(emblem!.getAttribute('alt')).toBe('')
      expect(emblem!.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    },
  )

  it.each([320, 1280])('fits the login and footer within a %ipx viewport', async (width) => {
    await page.viewport(width, 800)
    await login('zh-CN', { 'site/registration': registration })
    await expect.element(page.getByTestId('sign-in-tenant')).toBeVisible()
    const footer = page.getByTestId('site-registration')
    await expect.element(footer).toBeVisible()
    // drawn inside the sign-in frame rather than under it: the frame keeps
    // the whole viewport and nothing is pushed up to make room
    const shell = page.getByTestId('auth-shell').element()
    expect(shell.contains(footer.element())).toBe(true)
    expect(shell.getBoundingClientRect().height).toBe(800)
    const bounds = footer.element().getBoundingClientRect()
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    expect(bounds.bottom).toBeLessThanOrEqual(800)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    const [icp, security] = footer.element().querySelectorAll('a')
    const [first, second] = [icp!.getBoundingClientRect(), security!.getBoundingClientRect()]
    if (width === 320) {
      // one record to a line on a phone
      expect(second.top).toBeGreaterThanOrEqual(first.bottom)
      expect(footer.element().closest('main')).not.toBeNull()
    } else {
      // beside each other, closing the product half rather than piling up
      // under the form column's own choices
      expect(second.top).toBe(first.top)
      expect(footer.element().closest('aside')).not.toBeNull()
      expect(footer.element().closest('main')).toBeNull()
    }
  })

  it.each([320, 1280])(
    'keeps the shared-device choice apart from the records at %ipx',
    async (width) => {
      await page.viewport(width, 800)
      await login('zh-CN', { 'site/registration': registration }, [
        {
          code: 'cas',
          type: 'cas',
          name: 'CAS',
          prominence: 'primary',
          recommended: false,
          icon: null,
          mode: 'redirect',
          href: '/api/auth/cas/cas/start',
        },
      ])
      const seat = page.getByTestId('sign-in-shared-device-seat')
      await expect.element(seat).toBeVisible()
      const records = page.getByTestId('site-registration').element()
      if (width === 320) {
        // the choice follows the ways in; the records alone close the column
        const gap =
          records.getBoundingClientRect().top - seat.element().getBoundingClientRect().bottom
        expect(gap).toBeGreaterThan(80)
      } else {
        // the choice closes the form's column, the records the product half
        expect(seat.element().closest('main')).not.toBeNull()
        expect(records.closest('aside')).not.toBeNull()
        // and the two last lines share one bottom edge across the divide
        expect(
          Math.abs(
            records.getBoundingClientRect().bottom - seat.element().getBoundingClientRect().bottom,
          ),
        ).toBeLessThanOrEqual(1)
      }
    },
  )

  it.each([768, 1280])(
    'shows the configured ICP record in the %ipx application shell',
    async (width) => {
      await page.viewport(width, 800)
      await renderScreen({
        client: fakeClient({
          app: {
            getManifest: {
              ...emptyManifest(),
              viewer: 'authenticated',
              context: { 'site/registration': { icp: registration.icp } },
            },
          },
        }),
        routes: [
          { path: '/', element: <AppShell />, children: [{ element: <p>Page content</p> }] },
        ],
      })
      await expect.element(page.getByTestId('site-registration')).toBeVisible()
      await expect
        .element(page.getByRole('link', { name: /ICP备案/ }))
        .toHaveTextContent(registration.icp.record)
      expect(page.getByTestId('site-registration').element().querySelectorAll('a')).toHaveLength(1)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    },
  )

  const twoApps = {
    'app-shell/navigation-groups': [
      { id: 'app/one', label: 'One', order: 1 },
      { id: 'app/two', label: 'Two', order: 2 },
    ],
    'app-shell/navigation-primary': [
      {
        id: 'nav/one',
        label: 'First',
        group: 'app/one',
        target: { kind: 'page', pageId: 'one/page', path: '/one' },
      },
      {
        id: 'nav/two',
        label: 'Second',
        group: 'app/two',
        target: { kind: 'page', pageId: 'two/page', path: '/two' },
      },
    ],
  }

  const authenticated = (shell: ReactElement) =>
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: {
            ...emptyManifest(),
            viewer: 'authenticated',
            context: { 'site/registration': registration },
            collections: twoApps,
          },
        },
      }),
      route: '/one',
      routes: [
        {
          path: '/one',
          element: shell,
          children: [{ element: <div style={{ minHeight: 1200 }}>Page content</div> }],
        },
      ],
    })

  it('folds the application records away with the footer on a phone', async () => {
    await page.viewport(320, 800)
    await authenticated(<AppShell />)
    await expect.element(page.getByText('Page content')).toBeVisible()
    await expect.element(page.getByTestId('site-registration')).not.toBeVisible()
  })

  it.each([320, 1280])('leaves the records out of a feature shell at %ipx', async (width) => {
    await page.viewport(width, 800)
    await authenticated(<AccountShell />)
    await expect.element(page.getByText('Page content')).toBeVisible()
    await expect.element(page.getByTestId('site-registration')).not.toBeInTheDocument()
  })
})
