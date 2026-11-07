import { QueryClient, QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryHydration, type Arrival } from '@qualy/web-runtime/query-hydration'

// A read the server had not finished when the html went out follows it: the
// page draws it on its way, does not ask for it again, and has it where it
// reads once it lands - or asks for it itself when the server could not
// answer for it.

const KEY: QueryKey = ['assessment', 'listParticipantScores', { params: { batchId: 'b' } }]

/** a read the page makes, counted */
function Reader({ ask }: { ask: () => Promise<string> }) {
  const read = useQuery({ queryKey: KEY, queryFn: ask })
  return <p data-testid="read">{read.isPending ? 'on its way' : read.data}</p>
}

const drawn = (arrival: Promise<Arrival>, ask: () => Promise<string>) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
})
