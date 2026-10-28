import { lazy, useState } from 'react'
import { Outlet } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { preloadable, UiSlot } from '@qualy/web-runtime'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// Slots are the extension seam: a plugin drops a component into somebody
// else's layout. Whether that component keeps its identity across a re-render
// is not cosmetic - React reconciles by TYPE, so a slot host that builds a
// fresh wrapper component on every render unmounts every contribution and
// mounts a new one. Everything the user had typed disappears and every query
// the component owns refetches, for a locale switch or a manifest refresh.

const TOKEN = { key: 'test/slot' } as unknown as Parameters<typeof UiSlot>[0]['token']

function Counter({ context }: { context?: unknown }) {
  const [clicks, setClicks] = useState(0)
  return (
    <button type="button" onClick={() => setClicks((count) => count + 1)}>
      {`${String(context)} clicked ${clicks}`}
    </button>
  )
}

function Host() {
  const [context, setContext] = useState('first')
  return (
    <>
      <button type="button" onClick={() => setContext('second')}>
        change the context
      </button>
      <UiSlot token={TOKEN} context={context} />
    </>
  )
}

describe('a slot contribution', () => {
  it('keeps its state when the slot re-renders with a new context', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: { ...emptyManifest(), slots: { 'test/slot': [contribution] } } },
      }),
      // the registry holds what the aggregate puts there, under the slot
      // and the item's id: lazy components
      registry: {
        slots: { 'test/slot': { 'test/counter': lazy(async () => ({ default: Counter })) } },
      },
      children: <Host />,
    })

    await page.getByRole('button', { name: 'first clicked 0' }).click()
    await expect.element(page.getByRole('button', { name: 'first clicked 1' })).toBeVisible()

    // the props change, the component type does not
    await page.getByRole('button', { name: 'change the context' }).click()
    await expect.element(page.getByRole('button', { name: 'second clicked 1' })).toBeVisible()
  })
})

describe('the slots a layout renders', () => {
  // A shell asks for its slots once it has drawn, which on a cold start was
  // a third wave of files after the layout and the page. Declared with the
  // layout, the ones the viewer's manifest files are fetched beside it.
  it('are fetched while the layout itself is still on its way, and only those', async () => {
    let arrive = () => {}
    const arrived = new Promise<void>((resolve) => (arrive = resolve))
    const preloads = {
      drawn: vi.fn(() => Promise.resolve()),
      other: vi.fn(() => Promise.resolve()),
    }
    const registered = (preload: () => Promise<void>) =>
      Object.assign(
        lazy(() => Promise.resolve({ default: () => null })),
        { preload },
      )
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: {
            ...emptyManifest(),
            layouts: [{ contract: 'shell/v1' }],
            pages: [{ id: 'test/home', path: '/', layout: 'shell/v1' }],
            slots: {
              'shell/menu': [{ id: 'test/menu', order: 0 }],
              'test/picker': [{ id: 'test/picker', order: 0 }],
            },
          },
        },
      }),
      registry: {
        layouts: {
          'shell/v1': preloadable(() => arrived.then(() => ({ default: () => <Outlet /> }))),
        },
        layoutSlots: { 'shell/v1': ['shell/menu'] },
        slots: {
          'shell/menu': { 'test/menu': registered(preloads.drawn) },
          // filed for the viewer, but no layout renders it: a picker a page opens
          'test/picker': { 'test/picker': registered(preloads.other) },
        },
      },
      routes: [{ path: '/', element: <main data-testid="home" /> }],
      route: '/',
    })
    await vi.waitFor(() => expect(preloads.drawn).toHaveBeenCalled())
    expect(page.getByTestId('home').elements()).toHaveLength(0)
    expect(preloads.other).not.toHaveBeenCalled()
    arrive()
    await expect.element(page.getByTestId('home')).toBeInTheDocument()
  })
})

const contribution = { id: 'test/counter', order: 0 }
