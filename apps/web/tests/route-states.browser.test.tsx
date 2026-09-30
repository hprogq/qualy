import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { lazy } from 'react'
import { Outlet } from 'react-router'
import { Effect } from 'effect'
import type { DrawerSignOutContext } from '@qualy/ui-contract'
import { emptyComponentRegistry, ManifestRoutes, type ComponentRegistry } from '@qualy/web-runtime'
import { useRouteSlots } from '../src/route-states.tsx'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// What the host draws where the route tree has no page to show, and what the
// runtime draws when the manifest everything stands under cannot be read:
// each the state a page draws for a record that is not there, told by the
// kind it names and the ways out it offers - never by its words.

const text = (value: string) => value

type Manifest = ReturnType<typeof emptyManifest> & { viewer: 'anonymous' | 'authenticated' }

const withHome = (): Manifest => ({
  ...emptyManifest(),
  viewer: 'authenticated',
  layouts: [{ contract: 'app-shell/v1' }],
  pages: [
    { id: 'probe/home', path: '/home', layout: 'app-shell/v1' },
    { id: 'probe/broken', path: '/broken', layout: 'app-shell/v1' },
  ],
  collections: {
    'app-shell/navigation-primary': [
      {
        id: 'nav/home',
        label: text('Home'),
        target: { kind: 'page', pageId: 'probe/home', path: '/home' },
        order: 0,
      },
    ],
  },
})

function Broken(): never {
  throw new Error('the page’s own code failed')
}

const registry = (): ComponentRegistry => ({
  ...emptyComponentRegistry(),
  layouts: { 'app-shell/v1': lazy(() => Promise.resolve({ default: () => <Outlet /> })) },
  pages: {
    'probe/home': lazy(() => Promise.resolve({ default: () => <p data-testid="home">home</p> })),
    'probe/broken': lazy(() => Promise.resolve({ default: Broken })),
  },
  slots: {
    'app-shell/drawer-sign-out': {
      'probe/sign-out': lazy(() =>
        Promise.resolve({
          default: ({ context }: { context?: DrawerSignOutContext }) => (
            <button
              type="button"
              data-testid="sign-out"
              data-standalone={context?.standalone === true}
            >
              out
            </button>
          ),
        }),
      ),
    },
  },
})

/** the host's route tree over `shown`, with the home the host resolved */
function Host({ shown, homePath }: { shown: Manifest; homePath?: string }) {
  const slots = useRouteSlots(homePath)
  return <ManifestRoutes manifest={shown} registry={registry()} homePath={homePath} slots={slots} />
}

const mount = (shown: Manifest, route: string, homePath?: string) =>
  renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(shown) } }),
    registry: registry(),
    route,
    children: <Host shown={shown} {...(homePath === undefined ? {} : { homePath })} />,
  })

const state = () => document.querySelector<HTMLElement>('[data-slot="resource-state"]')

describe('an address that leads nowhere', () => {
  it('says the page cannot be opened, takes the reader there, and offers the way home', async () => {
    await mount(withHome(), '/nowhere', '/home')
    await vi.waitFor(() => expect(state()?.getAttribute('data-state')).toBe('missing'))
    const heading = page.getByRole('heading', { level: 1 })
    await vi.waitFor(() => expect(document.activeElement).toBe(heading.element()))
    await expect
      .element(page.getByRole('link', { name: '返回首页' }))
      .toHaveAttribute('href', '/home')
    // nothing to try again: another try leads nowhere either
    expect(page.getByRole('button', { name: '重试' }).elements()).toHaveLength(0)
  })
})

describe('a page whose own code failed', () => {
  it('offers a retry and the way home', async () => {
    // the boundary reports what it caught; the reader is not told it
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mount(withHome(), '/broken', '/home')
    await vi.waitFor(() => expect(state()?.getAttribute('data-state')).toBe('failed'))
    await expect.element(page.getByRole('button', { name: '重试' })).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: '返回首页' }))
      .toHaveAttribute('href', '/home')
    vi.restoreAllMocks()
  })
})

describe('nothing to open at all', () => {
  const nothing = (viewer: Manifest['viewer']): Manifest => ({
    ...emptyManifest(),
    viewer,
    slots: { 'app-shell/drawer-sign-out': [{ id: 'probe/sign-out', order: 0 }] },
  })

  it('leaves a signed-in reader the way out of their session', async () => {
    await page.viewport(390, 844)
    try {
      await mount(nothing('authenticated'), '/')
      await vi.waitFor(() => expect(state()?.getAttribute('data-state')).toBe('denied'))
      const way = page.getByTestId('sign-out')
      await expect.element(way).toBeVisible()
      // one of the state's own ways out, not something standing beside it,
      // and told so: drawn as the screen's action rather than the drawer's
      expect(state()!.contains(way.element())).toBe(true)
      await expect.element(way).toHaveAttribute('data-standalone', 'true')
      // across a phone's column, as every state's actions are
      const box = way.element().getBoundingClientRect()
      expect(box.width).toBeGreaterThan(300)
      expect((box.left + box.right) / 2).toBeCloseTo(390 / 2, -1)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  // Not only at the origin: a stale link, a bookmark or a reload of a page
  // since taken away lands on the address that leads nowhere, with no shell
  // and no home to offer - the way out of the session is all there is.
  it('leaves the same way out at an address that leads nowhere', async () => {
    await mount(nothing('authenticated'), '/assessment/batches/0192')
    await vi.waitFor(() => expect(state()?.getAttribute('data-state')).toBe('missing'))
    const way = page.getByTestId('sign-out')
    await expect.element(way).toBeVisible()
    expect(state()!.contains(way.element())).toBe(true)
    await expect.element(way).toHaveAttribute('data-standalone', 'true')
  })

  it('offers a visitor who is not signed in nothing to leave', async () => {
    for (const [route, kind] of [
      ['/', 'denied'],
      ['/somewhere', 'missing'],
    ] as const) {
      const { unmount } = await mount(nothing('anonymous'), route)
      await vi.waitFor(() => expect(state()?.getAttribute('data-state')).toBe(kind))
      expect(state()!.querySelector('[data-slot="resource-state-actions"]')).toBeNull()
      await unmount()
    }
  })
})

describe('a manifest that cannot be read', () => {
  it('tells an unreachable server from one that cannot serve, and offers a retry for both', async () => {
    for (const [error, kind] of [
      [{ _tag: 'HttpClientError', reason: { _tag: 'TransportError' } }, 'offline'],
      [apiError('SERVICE_UNAVAILABLE'), 'unavailable'],
    ] as const) {
      let asked = 0
      const { unmount } = await renderScreen({
        client: fakeClient({
          app: {
            getManifest: () =>
              Effect.suspend(() => {
                asked += 1
                return Effect.fail(error)
              }),
          },
        }),
        children: <p>the product</p>,
      })
      await vi.waitFor(() => expect(state()?.getAttribute('data-state')).toBe(kind), {
        timeout: 5_000,
      })
      const before = asked
      await page.getByRole('button', { name: '重试' }).click()
      await vi.waitFor(() => expect(asked).toBeGreaterThan(before))
      await unmount()
    }
  })
})
