import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { lazy } from 'react'
import { Outlet } from 'react-router'
import { Effect } from 'effect'
import { emptyComponentRegistry, ManifestRoutes, type ComponentRegistry } from '@qualy/web-runtime'
import { useRouteSlots } from '../src/route-states.tsx'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// What the host draws where the route tree has no page to show, and what the
// runtime draws when the manifest everything stands under cannot be read:
// each the state a page draws for a record that is not there, told by the
// kind it names and the ways out it offers - never by its words.

const text = (value: string) => ({ kind: 'literal' as const, value })

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
