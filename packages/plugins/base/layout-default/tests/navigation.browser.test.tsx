import { StrictMode } from 'react'
import {
  Link,
  Outlet,
  useBlocker,
  useLocation,
  type unstable_RSCPayload as RSCPayload,
} from 'react-router'
import { unstable_RSCHydratedRouter as RSCHydratedRouter } from 'react-router/dom'
import { afterEach, describe, expect, it } from 'vitest'
import { commands, page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { RuntimeProvider, emptyComponentRegistry } from '@qualy/web-runtime'
import { UiProvider } from '@qualy/ui/provider'
import { TopBar, SectionChips } from '../src/client/TopBar.tsx'
import { SideNav } from '../src/client/SideNav.tsx'
import { BottomBar } from '../src/client/BottomBar.tsx'
import '../../../../../apps/web/src/app.css'

const items = ['first', 'second', 'third'].map((id) => ({
  id: `test/${id}` as const,
  label: id,
  icon: 'users',
  target: { kind: 'page' as const, pageId: `test/${id}` as const, path: `/${id}` },
}))

function Navigation({ guard }: { guard: boolean }) {
  const { pathname } = useLocation()
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      guard && currentLocation.pathname !== nextLocation.pathname,
  )
  return (
    <>
      <TopBar
        activeApp={`test/${pathname.slice(1)}`}
        apps={items.map((item) => ({
          id: item.id,
          label: item.label,
          path: item.target.path,
          items: [],
        }))}
      />
      <SideNav groups={[{ id: 'sections', label: undefined, items }]} label="sections" />
      <SectionChips items={items} />
      <BottomBar
        label="bottom"
        items={items.map((item) => ({
          id: item.id,
          label: item.label,
          to: item.target.path,
          icon: item.icon,
        }))}
      />
      <Link to="/first?filter=changed">filter</Link>
      <Link to="/second" target="_blank">
        new window
      </Link>
      {blocker.state === 'blocked' && (
        <div role="dialog">
          <button onClick={() => blocker.reset()}>stay</button>
          <button onClick={() => blocker.proceed()}>leave</button>
        </div>
      )}
      <Outlet />
    </>
  )
}

type RenderPayload = Extract<RSCPayload, { type: 'render' }>

// Run the actual RSC router and its single-fetch request/route-patch lifecycle.
// Only transport and decoding are supplied by the fixture: no application
// service or RSC server is started by this component suite.
async function mount(guard = false) {
  const originalUrl = location.href
  const originalHistoryState: unknown = window.history.state
  const originalLocale = document.documentElement.dataset['locale']
  const globalNames = [
    '__reactRouterDataRouter',
    '__reactRouterRouteModules',
    '__routerInitialized',
    '__routerActionID',
  ] as const
  const globals = window as unknown as Record<string, unknown>
  const originalGlobals = globalNames.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of globalNames) delete globals[key]
  window.history.replaceState(null, '', '/first')
  document.documentElement.dataset['locale'] = 'en-US'

  const root = {
    id: 'root',
    path: '/',
    hasAction: false,
    hasComponent: true,
    hasLoader: true,
    element: (
      <RuntimeProvider
        manifest={{
          viewer: 'anonymous',
          layouts: [],
          pages: [],
          collections: {},
          slots: {},
          context: {},
        }}
        registry={emptyComponentRegistry()}
      >
        <Navigation guard={guard} />
      </RuntimeProvider>
    ),
    params: {},
    pathname: '/',
    pathnameBase: '/',
  }
  const leaf = (pathname: string) => ({
    id: pathname.slice(1),
    path: pathname,
    parentId: 'root',
    hasAction: false,
    hasComponent: true,
    hasLoader: true,
    element: <main data-testid="current-page">{pathname}</main>,
    params: {},
    pathname,
    pathnameBase: pathname,
  })
  const payload = (url: URL): RenderPayload => ({
    type: 'render',
    basename: undefined,
    actionData: null,
    errors: null,
    loaderData: { root: null, [url.pathname.slice(1)]: null },
    location: { pathname: url.pathname, search: url.search, hash: '', state: null, key: 'test' },
    routeDiscovery: { mode: 'initial' },
    matches: [root, leaf(url.pathname)],
  })
  const decoded = new WeakMap<ReadableStream<Uint8Array>, RSCPayload>()
  const requests: { request: Request; release: () => void }[] = []
  const transport = (request: Request) =>
    new Promise<Response>((resolve, reject) => {
      const abort = () => reject(request.signal.reason)
      request.signal.addEventListener('abort', abort, { once: true })
      requests.push({
        request,
        release: () => {
          request.signal.removeEventListener('abort', abort)
          const url = new URL(request.url)
          url.pathname = url.pathname.replace(/\.rsc$/, '')
          const response = new Response('fixture')
          decoded.set(response.body!, payload(url))
          resolve(response)
        },
      })
    })
  const initial = payload(new URL('/first', location.origin))
  initial.patches = Promise.resolve(items.map((item) => leaf(item.target.path)))
  const screen = await render(
    <StrictMode>
      <UiProvider scheme="light">
        <RSCHydratedRouter
          payload={initial}
          fetch={transport}
          createFromReadableStream={async (stream) => decoded.get(stream)}
        />
      </UiProvider>
    </StrictMode>,
  )
  const cleanup = async () => {
    await screen.unmount()
    // The RSC router intentionally belongs to the document. Restore its
    // document globals and history so another component test starts fresh.
    const router = globals['__reactRouterDataRouter'] as { dispose: () => void } | undefined
    router?.dispose()
    globalNames.forEach((key, index) => {
      delete globals[key]
      const descriptor = originalGlobals[index]
      if (descriptor) Object.defineProperty(window, key, descriptor)
    })
    window.history.replaceState(originalHistoryState, '', originalUrl)
    if (originalLocale === undefined) delete document.documentElement.dataset['locale']
    else document.documentElement.dataset['locale'] = originalLocale
  }
  cleanups.push(cleanup)
  await expect.element(page.getByTestId('current-page')).toHaveTextContent('/first')
  return { requests }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  await page.viewport(1280, 800)
})

const frames = async (count: number, read: () => void) => {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    read()
  }
}

describe('RSC navigation feedback', () => {
  for (const surface of ['top', 'side', 'bottom', 'chip'] as const) {
    it(`keeps the ${surface} destination pending and weighted until the slow RSC response commits`, async () => {
      await page.viewport(surface === 'bottom' ? 390 : 1280, 800)
      const { requests } = await mount()
      const nav =
        surface === 'top'
          ? page.getByTestId('top-bar-apps')
          : surface === 'side'
            ? page.getByTestId('side-nav')
            : surface === 'bottom'
              ? page.getByTestId('bottom-bar')
              : page.getByTestId('section-chip').filter({ hasText: 'second' })
      const link = surface === 'chip' ? nav : nav.getByRole('link', { name: 'second', exact: true })
      const opened =
        surface === 'chip'
          ? page.getByTestId('section-chip').filter({ hasText: 'first' })
          : nav.getByRole('link', { name: 'first', exact: true })
      const samples: { busy: string | null; weight: string }[] = []
      await link.click()
      await expect.poll(() => requests.length).toBe(1)
      expect(new URL(requests[0]!.request.url).pathname).toBe('/second.rsc')
      await expect.element(link).toHaveAttribute('aria-busy', 'true')
      const weight = getComputedStyle(link.element()).fontWeight
      await frames(20, () => {
        const element = link.element()
        samples.push({
          busy: element.getAttribute('aria-busy'),
          weight: getComputedStyle(element).fontWeight,
        })
        expect(element.getAttribute('aria-current')).toBeNull()
        expect(opened.element().getAttribute('aria-current')).toBe('page')
      })
      expect(samples.length).toBe(20)
      expect(samples.every((sample) => sample.busy === 'true' && sample.weight === weight)).toBe(
        true,
      )
      await expect.element(page.getByTestId('current-page')).toHaveTextContent('/first')
      requests[0]!.release()
      await frames(8, () => {
        const element = link.element()
        expect(getComputedStyle(element).fontWeight).toBe(weight)
        expect(
          element.getAttribute('aria-busy') === 'true' ||
            element.getAttribute('aria-current') === 'page',
        ).toBe(true)
      })
      await expect.element(page.getByTestId('current-page')).toHaveTextContent('/second')
      await expect.element(link).toHaveAttribute('aria-current', 'page')
      await expect.element(link).not.toHaveAttribute('aria-busy')
      expect(getComputedStyle(link.element()).fontWeight).toBe(weight)
    })
  }

  it('does not leave pending feedback on a cancelled blocker, and follows a confirmed move', async () => {
    const { requests } = await mount(true)
    const second = page.getByTestId('side-nav').getByRole('link', { name: 'second' })
    await second.click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(requests).toHaveLength(0)
    await expect.element(second).not.toHaveAttribute('aria-busy')
    await page.getByRole('button', { name: 'stay' }).click()
    await expect.element(second).not.toHaveAttribute('aria-busy')
    await expect.element(page.getByTestId('current-page')).toHaveTextContent('/first')
    await second.click()
    await page.getByRole('button', { name: 'leave' }).click()
    await expect.poll(() => requests.length).toBe(1)
    await expect.element(second).toHaveAttribute('aria-busy', 'true')
    await frames(12, () => expect(second.element().getAttribute('aria-busy')).toBe('true'))
    requests[0]!.release()
    await expect.element(second).toHaveAttribute('aria-current', 'page')
    await expect.element(second).not.toHaveAttribute('aria-busy')
  })

  it('moves feedback to the latest destination and ignores the superseded response', async () => {
    const { requests } = await mount()
    const nav = page.getByTestId('side-nav')
    const second = nav.getByRole('link', { name: 'second' })
    const third = nav.getByRole('link', { name: 'third' })
    await second.click()
    await expect.element(second).toHaveAttribute('aria-busy', 'true')
    await third.click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[0]!.request.signal.aborted).toBe(true)
    await expect.element(second).not.toHaveAttribute('aria-busy')
    await expect.element(third).toHaveAttribute('aria-busy', 'true')
    requests[1]!.release()
    await expect.element(third).toHaveAttribute('aria-current', 'page')
    requests[0]!.release()
    await frames(4, () =>
      expect(page.getByTestId('current-page').element().textContent).toBe('/third'),
    )
    await expect.element(second).not.toHaveAttribute('aria-busy')
  })

  it('keeps same-page filters out of section-pending feedback', async () => {
    const { requests } = await mount(true)
    await page.getByRole('link', { name: 'filter', exact: true }).click()
    await expect.poll(() => requests.length).toBe(1)
    expect(page.getByRole('dialog').elements()).toHaveLength(0)
    await frames(12, () => expect(document.querySelectorAll('a[aria-busy="true"]')).toHaveLength(0))
    requests[0]!.release()
    await expect.poll(() => location.search).toBe('?filter=changed')
  })

  it('leaves modified clicks, middle clicks, new windows and prevented clicks to the browser', async () => {
    const { requests } = await mount()
    const link = page.getByTestId('side-nav').getByRole('link', { name: 'second' }).element()
    const native: boolean[] = []
    // Prevent the native new-tab default only after React's link handler has
    // had its turn, so the runner does not actually open any extra windows.
    const stopNative = (event: MouseEvent) => {
      native.push(!event.defaultPrevented)
      event.preventDefault()
    }
    document.addEventListener('click', stopNative)
    try {
      for (const options of [
        { ctrlKey: true },
        { metaKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
      ]) {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }))
      }
      page
        .getByRole('link', { name: 'new window' })
        .element()
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      const prevented = new MouseEvent('click', { bubbles: true, cancelable: true })
      prevented.preventDefault()
      link.dispatchEvent(prevented)
      expect(native).toEqual([true, true, true, true, true, true, false])
      await frames(4, () =>
        expect(document.querySelectorAll('a[aria-busy="true"]')).toHaveLength(0),
      )
      expect(requests).toHaveLength(0)
    } finally {
      document.removeEventListener('click', stopNative)
    }
  })
})

it('fades in navigation ink without changing text width or delaying acknowledgement', async () => {
  await commands.emulateMedia({ reducedMotion: 'no-preference' })
  try {
    const { requests } = await mount()
    const second = page.getByTestId('side-nav').getByRole('link', { name: 'second' })
    const element = second.element() as HTMLAnchorElement
    const label = second.getByText('second', { exact: true }).element()
    const ink = () => getComputedStyle(label).getPropertyValue('-webkit-text-stroke-color')
    const width = label.getBoundingClientRect().width
    const weight = getComputedStyle(label).fontWeight
    const from = ink()
    element.click()
    const colors: string[] = []
    await frames(16, () => {
      colors.push(ink())
      expect(element.getAttribute('aria-busy')).toBe('true')
      expect(label.getBoundingClientRect().width).toBe(width)
      expect(getComputedStyle(label).fontWeight).toBe(weight)
    })
    const to = ink()
    expect(to).not.toBe(from)
    expect(colors.some((color) => color !== from && color !== to)).toBe(true)
    requests[0]!.release()
    await expect.element(page.getByTestId('current-page')).toHaveTextContent('/second')
  } finally {
    await commands.emulateMedia({ reducedMotion: 'reduce' })
  }
})
