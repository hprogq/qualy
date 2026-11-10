import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type QueryFunction,
  type QueryKey,
} from '@tanstack/react-query'
import { Suspense, lazy, useState, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import {
  QueryHydration,
  useHandedQueryState,
  type Arrival,
} from '@qualy/web-runtime/query-hydration'

// A read the server had not finished when the html went out follows it: the
// page draws it on its way, does not ask for it again, and has it where it
// reads once it lands - or asks for it itself when the server could not
// answer for it.

const KEY: QueryKey = ['assessment', 'listParticipantScores', { params: { batchId: 'b' } }]

/** a read the page makes, counted */
function Reader({ ask }: { ask: QueryFunction<string, QueryKey> }) {
  const read = useQuery({ queryKey: KEY, queryFn: ask })
  return <p data-testid="read">{read.isPending ? 'on its way' : read.data}</p>
}

const drawn = (
  arrival: Promise<Arrival>,
  ask: QueryFunction<string, QueryKey>,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) => {
  const router = createMemoryRouter([
    {
      path: '*',
      element: (
        <QueryHydration
          state={{ queries: [], mutations: [] }}
          coming={[{ queryKey: KEY, arrival }]}
        >
          <Reader ask={ask} />
        </QueryHydration>
      ),
    },
  ])
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

/** a promise and the hand that settles it */
const held = () => {
  let land!: (arrival: Arrival) => void
  const arrival = new Promise<Arrival>((resolve) => {
    land = resolve
  })
  return { arrival, land }
}

describe('a read that follows the html', () => {
  it('refreshes an arrival invalidated while it is in flight', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const ask = vi.fn(() => Promise.resolve('new'))
    const read = held()
    await drawn(read.arrival, ask, client)
    await expect.element(page.getByTestId('read')).toHaveTextContent('on its way')
    void client.invalidateQueries({ queryKey: KEY })
    read.land({ kind: 'answer', value: 'old' })
    await expect.poll(() => client.getQueryData(KEY), { timeout: 1500 }).toBe('new')
    // The second read closes the window in which another invalidation
    // could be coalesced into the first read.
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('revalidates an event that arrives while the fallback read is in flight', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = held()
    let release!: (value: string) => void
    const first = new Promise<string>((resolve) => {
      release = resolve
    })
    const ask = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue('newest')
    await drawn(read.arrival, ask, client)
    void client.invalidateQueries({ queryKey: KEY })
    read.land({ kind: 'answer', value: 'old' })
    await expect.poll(() => ask.mock.calls.length).toBe(1)
    void client.invalidateQueries({ queryKey: KEY })
    release('still-old')
    await expect.poll(() => client.getQueryData(KEY)).toBe('newest')
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('keeps a newer cache write instead of a late server snapshot', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = held()
    const ask = vi.fn(() => Promise.resolve('asked'))
    await drawn(read.arrival, ask, client)
    client.setQueryData(KEY, 'written locally')
    read.land({ kind: 'answer', value: 'old' })
    await expect.element(page.getByTestId('read')).toHaveTextContent('written locally')
    await expect.poll(() => client.getQueryState(KEY)?.fetchStatus).toBe('idle')
    expect(client.getQueryData(KEY)).toBe('written locally')
    expect(ask).not.toHaveBeenCalled()
  })

  it('never invalidates a replacement cache entry after the old cache is cleared', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = held()
    const ask = vi.fn(() => Promise.resolve('asked'))
    await drawn(read.arrival, ask, client)
    void client.invalidateQueries({ queryKey: KEY })
    client.clear()
    client.setQueryData(KEY, 'new identity')
    read.land({ kind: 'answer', value: 'old identity' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.getQueryData(KEY)).toBe('new identity')
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  it('does not start a fallback read after the handed query is cancelled', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = held()
    const ask = vi.fn(() => Promise.resolve('asked'))
    await drawn(read.arrival, ask, client)
    void client.invalidateQueries({ queryKey: KEY })
    await client.cancelQueries({ queryKey: KEY })
    read.land({ kind: 'answer', value: 'old' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(ask).not.toHaveBeenCalled()
    expect(client.getQueryData(KEY)).toBeUndefined()
  })

  it('aborts an active fallback read when its cache is cleared', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = held()
    let aborted = false
    const ask = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          })
        }),
    )
    await drawn(read.arrival, ask, client)
    void client.invalidateQueries({ queryKey: KEY })
    read.land({ kind: 'answer', value: 'old' })
    await expect.poll(() => ask.mock.calls.length).toBe(1)
    client.clear()
    await expect.poll(() => aborted).toBe(true)
    expect(client.getQueryData(KEY)).toBeUndefined()
  })

  it('revalidates an existing cache value after a later server arrival', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(KEY, 'cached')
    const read = held()
    const ask = vi.fn(() => Promise.resolve('asked'))
    await drawn(read.arrival, ask, client)
    read.land({ kind: 'answer', value: 'server' })
    await expect.element(page.getByTestId('read')).toHaveTextContent('asked')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('does not replace a newer local write while a warm handoff is pending', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(KEY, 'cached')
    const read = held()
    const ask = vi.fn(() => Promise.resolve('asked'))
    await drawn(read.arrival, ask, client)
    client.setQueryData(KEY, 'locally updated')
    read.land({ kind: 'answer', value: 'old server' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.getQueryData(KEY)).toBe('locally updated')
    expect(ask).not.toHaveBeenCalled()
  })

  it('retains the original warm snapshot when the boundary is rerendered', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(KEY, 'cached')
    const read = held()
    const ask = vi.fn(() => Promise.resolve('asked'))
    function Parent() {
      const [count, setCount] = useState(0)
      return (
        <>
          <button onClick={() => setCount(count + 1)}>Rerender</button>
          <QueryHydration
            state={{ queries: [], mutations: [] }}
            coming={[{ queryKey: KEY, arrival: read.arrival }]}
          >
            <Reader ask={ask} />
          </QueryHydration>
        </>
      )
    }
    const router = createMemoryRouter([{ path: '*', element: <Parent /> }])
    await render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    client.setQueryData(KEY, 'locally updated')
    await page.getByRole('button', { name: 'Rerender' }).click()
    read.land({ kind: 'answer', value: 'old server' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.getQueryData(KEY)).toBe('locally updated')
    expect(ask).not.toHaveBeenCalled()
  })

  it('does not refresh a replacement query after a warm handoff loses its identity', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(KEY, 'old identity')
    const read = held()
    const ask = vi.fn(() => Promise.resolve('asked'))
    await drawn(read.arrival, ask, client)
    client.clear()
    client.setQueryData(KEY, 'new identity')
    read.land({ kind: 'answer', value: 'old server' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.getQueryData(KEY)).toBe('new identity')
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  it('does not refresh a warm handoff after its boundary unmounts', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(KEY, 'cached')
    const read = held()
    const ask = vi.fn(() => Promise.resolve('asked'))
    const view = await drawn(read.arrival, ask, client)
    await view.unmount()
    read.land({ kind: 'answer', value: 'server' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.getQueryData(KEY)).toBe('cached')
    expect(ask).not.toHaveBeenCalled()
  })

  it('keeps the invalidated query failed when its replacement read fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = held()
    const ask = vi.fn(() => Promise.reject(new Error('offline')))
    await drawn(read.arrival, ask, client)
    void client.invalidateQueries({ queryKey: KEY })
    read.land({ kind: 'answer', value: 'old' })
    await expect.poll(() => client.getQueryState(KEY)?.status).toBe('error')
    expect(client.getQueryData(KEY)).toBeUndefined()
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('marks an arrival invalidated before any reader mounts as stale', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = held()
    const ask = vi.fn(() => Promise.resolve('new'))
    function Later() {
      const [show, setShow] = useState(false)
      return (
        <>
          <button onClick={() => setShow(true)}>Open</button>
          {show && <Reader ask={ask} />}
        </>
      )
    }
    const router = createMemoryRouter([
      {
        path: '*',
        element: (
          <QueryHydration
            state={{ queries: [], mutations: [] }}
            coming={[{ queryKey: KEY, arrival: read.arrival }]}
          >
            <Later />
          </QueryHydration>
        ),
      },
    ])
    await render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    void client.invalidateQueries({ queryKey: KEY })
    read.land({ kind: 'answer', value: 'old' })
    await expect.poll(() => client.getQueryState(KEY)?.fetchStatus).toBe('idle')
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(true)
    await page.getByRole('button', { name: 'Open' }).click()
    await expect.element(page.getByTestId('read')).toHaveTextContent('new')
    expect(ask).toHaveBeenCalledTimes(1)
  })
  it('is drawn on its way, not asked again, and lands where the page reads', async () => {
    const ask = vi.fn(() => Promise.resolve('asked'))
    const read = held()
    await drawn(read.arrival, ask)
    await expect.element(page.getByTestId('read')).toHaveTextContent('on its way')
    read.land({ kind: 'answer', value: 'from the server' })
    await expect.element(page.getByTestId('read')).toHaveTextContent('from the server')
    expect(ask).not.toHaveBeenCalled()
  })

  it("is the page's own asking when the server could not answer for it", async () => {
    const ask = vi.fn(() => Promise.resolve('asked'))
    const read = held()
    await drawn(read.arrival, ask)
    await expect.element(page.getByTestId('read')).toHaveTextContent('on its way')
    read.land({ kind: 'ask' })
    await expect.element(page.getByTestId('read')).toHaveTextContent('asked')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('is on its way in the first frame even when it has already landed', async () => {
    const ask = vi.fn(() => Promise.resolve('asked'))
    const frames: string[] = []
    function Watch() {
      const read = useQuery({ queryKey: KEY, queryFn: ask })
      frames.push(read.isPending ? 'pending' : 'landed')
      return null
    }
    const client = new QueryClient()
    const router = createMemoryRouter([
      {
        path: '*',
        element: (
          <QueryHydration
            state={{ queries: [], mutations: [] }}
            coming={[{ queryKey: KEY, arrival: Promise.resolve({ kind: 'answer', value: 'x' }) }]}
          >
            <Watch />
          </QueryHydration>
        ),
      },
    ])
    await render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    // drawn as the html drew it, then as it is
    await expect.poll(() => frames.at(-1)).toBe('landed')
    expect(frames[0]).toBe('pending')
    expect(ask).not.toHaveBeenCalled()
  })

  it('hydrates a delayed reader from its HTML snapshot after the score has reached the live cache', async () => {
    const ask = vi.fn(() => Promise.resolve('asked'))
    const client = new QueryClient()
    const arrival = held()
    const frames: (string | undefined)[] = []
    function Score() {
      const read = useQuery({ queryKey: KEY, queryFn: ask })
      const handed = useHandedQueryState<string>(KEY)
      const value = (handed === undefined ? read.data : handed?.data) ?? 'on its way'
      frames.push(value)
      return <p data-testid="selective-score">{value}</p>
    }
    const tree = (cache: QueryClient, answer: Promise<Arrival>, score: ReactNode) => (
      <QueryClientProvider client={cache}>
        <RouterProvider
          router={createMemoryRouter([
            {
              path: '*',
              element: (
                <QueryHydration
                  state={{ queries: [], mutations: [] }}
                  coming={[{ queryKey: KEY, arrival: answer }]}
                >
                  <Suspense>{score}</Suspense>
                </QueryHydration>
              ),
            },
          ])}
        />
      </QueryClientProvider>
    )
    const host = document.createElement('div')
    host.innerHTML = renderToString(tree(new QueryClient(), new Promise(() => {}), <Score />))
    document.body.append(host)
    const original = host.querySelector('p')
    frames.length = 0
    let resume!: (component: { default: typeof Score }) => void
    const DelayedScore = lazy(
      () =>
        new Promise<{ default: typeof Score }>((resolve) => {
          resume = resolve
        }),
    )
    const errors: unknown[] = []
    const root = hydrateRoot(host, tree(client, arrival.arrival, <DelayedScore />), {
      onRecoverableError: (error) => errors.push(error),
    })
    try {
      await expect.poll(() => resume).toBeTypeOf('function')
      arrival.land({ kind: 'answer', value: '3.00' })
      await expect.poll(() => client.getQueryData(KEY)).toBe('3.00')
      expect(original?.textContent).toBe('on its way')
      resume({ default: Score })
      await expect.poll(() => host.querySelector('p')?.textContent).toBe('3.00')
      expect(frames[0]).toBe('on its way')
      expect(host.querySelector('p')).toBe(original)
      expect(errors).toEqual([])
      expect(ask).not.toHaveBeenCalled()
    } finally {
      root.unmount()
      host.remove()
    }
  })
})
