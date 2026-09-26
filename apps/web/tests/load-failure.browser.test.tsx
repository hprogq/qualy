import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { lazy, useState } from 'react'
import { Outlet } from 'react-router'
import { Effect } from 'effect'
import { useQuery } from '@tanstack/react-query'
import { AsyncSection } from '@qualy/ui/admin'
import {
  emptyComponentRegistry,
  LoadFailure,
  ManifestRoutes,
  useLoadFailure,
  type RouteSlots,
} from '@qualy/web-runtime'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// A reading that failed, told by what the reader can do about it: not
// there or not theirs - no retry, the way back; the network or the server -
// a retry. Asserted on the kind the state names and on the ways out it
// offers, never on its words, which are the catalog's.

const manifest = () => ({
  ...emptyManifest(),
  layouts: [{ contract: 'app-shell/v1' }],
  pages: [{ id: 'auth/users', path: '/organization/users', layout: 'app-shell/v1' }],
})

/** the screen, once the runtime under it has its manifest */
const mount = async (children: React.ReactNode) => {
  const screen = await renderScreen({
    client: fakeClient({ app: { getManifest: () => Effect.succeed(manifest()) } }),
    children: <div data-testid="mounted">{children}</div>,
  })
  await expect.element(page.getByTestId('mounted')).toBeInTheDocument()
  return screen
}

/** a reading that failed with `error`, worded by the runtime */
function Reading({ error, missing }: { error: unknown; missing?: readonly string[] }) {
  const describe = useLoadFailure()
  const [retried, setRetried] = useState(0)
  return (
    <div data-testid="reading" data-retried={retried}>
      <LoadFailure
        failure={describe.of(error, missing === undefined ? {} : { missing })}
        onRetry={() => setRetried((count) => count + 1)}
        back={{ page: 'auth/users', label: 'back to the roster' }}
      />
    </div>
  )
}

const kindShown = () =>
  page.getByTestId('reading').element().querySelector<HTMLElement>('[data-slot="resource-state"]')

describe('a page whose reading failed', () => {
  it('offers no retry for what another try cannot change, and the way back instead', async () => {
    for (const [error, missing, kind] of [
      [apiError('USER_NOT_FOUND'), ['USER_NOT_FOUND'], 'missing'],
      [apiError('ACCESS_DENIED'), [], 'denied'],
    ] as const) {
      const { unmount } = await mount(<Reading error={error} missing={missing} />)
      await expect.element(kindShown()).toHaveAttribute('data-state', kind)
      expect(page.getByRole('button', { name: '重试' }).elements()).toHaveLength(0)
      await expect
        .element(page.getByRole('link', { name: 'back to the roster' }))
        .toHaveAttribute('href', '/organization/users')
      // the page's heading is where a reader who cannot see it is taken
      const heading = page.getByRole('heading', { level: 1 })
      await vi.waitFor(() => expect(document.activeElement).toBe(heading.element()))
      await unmount()
    }
  })

  it('offers a retry for a server that could not answer, and it is pressed once', async () => {
    for (const [error, kind] of [
      [{ _tag: 'HttpClientError', reason: { _tag: 'TransportError' } }, 'offline'],
      [apiError('SERVICE_UNAVAILABLE'), 'unavailable'],
      [apiError('INTERNAL_SERVER_ERROR'), 'failed'],
      // shaped like a missing thing, but not one this owner named
      [apiError('ASSESSMENT_PHASE_NOT_FOUND'), 'failed'],
    ] as const) {
      const { unmount } = await mount(<Reading error={error} missing={['USER_NOT_FOUND']} />)
      await expect.element(kindShown()).toHaveAttribute('data-state', kind)
      await page.getByRole('button', { name: '重试' }).click()
      await expect.element(page.getByTestId('reading')).toHaveAttribute('data-retried', '1')
      // and the way back stays beside it
      await expect.element(page.getByRole('link', { name: 'back to the roster' })).toBeVisible()
      await unmount()
    }
  })

  it('leaves out a way back the reader could not open', async () => {
    function Nowhere() {
      const describe = useLoadFailure()
      return (
        <LoadFailure
          failure={describe.missing()}
          back={{ page: 'rbac/roles', label: 'back to the roles' }}
        />
      )
    }
    await mount(<Nowhere />)
    await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(page.getByRole('link', { name: 'back to the roles' }).elements()).toHaveLength(0)
  })
})

describe('a section whose reading failed', () => {
  it('is worded and classified the runtime way', async () => {
    function Remote() {
      const describe = useLoadFailure()
      const query = useQuery({
        queryKey: ['load-failure', 'denied'],
        queryFn: () => Promise.reject(apiError('ACCESS_DENIED')),
        retry: false,
      })
      return (
        <AsyncSection
          pending={query.isPending}
          error={query.isError ? describe.of(query.error) : null}
          loadingLabel="loading"
          retryLabel="retry"
          onRetry={() => void query.refetch()}
        >
          <p>content</p>
        </AsyncSection>
      )
    }
    await mount(<Remote />)
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
      ).toBe('denied'),
    )
    // a pane in the card or dialog around it, ranked under that one's title
    await expect.element(page.getByRole('heading', { level: 3 })).toBeVisible()
    expect(page.getByRole('button', { name: 'retry' }).elements()).toHaveLength(0)
  })
})

describe('the tab of a page that cannot be shown', () => {
  // A record's page opened at an address that names nothing still matches
  // the page; the tab says what stands there instead of the page's name,
  // and the page's name comes back once the state is gone.
  const slots: RouteSlots = {
    pageLoading: null,
    layoutLoading: null,
    pageError: () => null,
    layoutError: () => null,
    componentMissing: () => null,
    notFound: () => null,
    empty: null,
  }
  function Record() {
    const describe = useLoadFailure()
    const [gone, setGone] = useState(true)
    return gone ? (
      <>
        <LoadFailure
          failure={describe.missing({ copy: { missing: { title: 'no such record' } } })}
        />
        <button type="button" onClick={() => setGone(false)}>
          found
        </button>
      </>
    ) : (
      <p data-testid="record">record</p>
    )
  }
  const shown = {
    ...emptyManifest(),
    layouts: [{ contract: 'app-shell/v1' }],
    pages: [
      {
        id: 'probe/record',
        path: '/records/:recordId',
        layout: 'app-shell/v1',
        title: { kind: 'literal' as const, value: 'Record' },
      },
    ],
  }

  it('names the tab by the state while it stands, and by the page after', async () => {
    const product = document.title
    await renderScreen({
      client: fakeClient({ app: { getManifest: () => Effect.succeed(shown) } }),
      route: '/records/nothing',
      children: (
        <ManifestRoutes
          manifest={shown}
          registry={{
            ...emptyComponentRegistry(),
            layouts: {
              'app-shell/v1': lazy(() => Promise.resolve({ default: () => <Outlet /> })),
            },
            pages: { 'probe/record': lazy(() => Promise.resolve({ default: Record })) },
          }}
          slots={slots}
        />
      ),
    })
    await expect.element(page.getByRole('heading', { name: 'no such record' })).toBeVisible()
    await vi.waitFor(() => expect(document.title).toBe(`no such record - ${product}`))
    await page.getByRole('button', { name: 'found' }).click()
    await expect.element(page.getByTestId('record')).toBeVisible()
    await vi.waitFor(() => expect(document.title).toBe(`Record - ${product}`))
  })
})
