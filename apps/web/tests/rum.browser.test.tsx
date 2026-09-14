import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { MemoryRouter } from 'react-router'
import { PluginComponent } from '@qualy/web-runtime'
import {
  captureDiagnostic,
  captureException,
  registerRumProvider,
  resetBrowserRum,
  setObservedPage,
  observedPageUrl,
  type BrowserRumSink,
  type DiagnosticContext,
  type ExceptionContext,
} from '@qualy/plugin-rum/client'
import { startBrowserRum } from '@qualy/plugin-rum/client/start'

// Browser failure reporting, from the two seams the runtime reports at to the
// sink a provider hands over.
//
// A fake provider throughout: a suite must never reach a reporting platform,
// and what is being checked here is this repository's half - which failures
// arrive, what they are allowed to carry, and that a platform behaving badly
// changes nothing a viewer sees. The vendor's own behaviour was measured
// separately and is recorded in docs/notes/aegis-web-sdk.md.

interface Reported {
  readonly error: unknown
  readonly context: ExceptionContext | undefined
}

const fakeProvider = (over: { start?: BrowserRumProviderStart } = {}) => {
  const exceptions: Reported[] = []
  const diagnostics: { code: string; context: DiagnosticContext | undefined }[] = []
  const pages: unknown[] = []
  const sink: BrowserRumSink = {
    captureException: (error, context) => exceptions.push({ error, context }),
    captureDiagnostic: (code, context) => diagnostics.push({ code, context }),
    setPage: (page) => pages.push(page),
  }
  registerRumProvider({
    provider: 'fake',
    start: over.start ?? (() => Promise.resolve(sink)),
  })
  return { exceptions, diagnostics, pages }
}

type BrowserRumProviderStart = (
  config: Record<string, unknown>,
  release: { releaseId: string; mode: 'development' | 'production' },
) => Promise<BrowserRumSink | null>

/** the deployment's answer, without a server: this runs before the api runtime exists */
const answering = (body: unknown, ok = true) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: ok ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )

const release = { releaseId: 'test-release', mode: 'production' } as const

afterEach(() => {
  vi.restoreAllMocks()
  resetBrowserRum()
})

describe('starting up', () => {
  it('reports through the provider the deployment selected', async () => {
    answering({ schema: 1, provider: 'fake', config: { id: 'x' } })
    const seen = fakeProvider()
    await startBrowserRum(release)
    captureException(new Error('boom'))
    expect(seen.exceptions).toHaveLength(1)
  })

  it('reports nowhere when the deployment named no provider', async () => {
    answering({ schema: 1, provider: null, config: {} })
    const seen = fakeProvider()
    await startBrowserRum(release)
    captureException(new Error('boom'))
    expect(seen.exceptions).toHaveLength(0)
  })

  it('treats an assembly without the capability as reporting off, not as a failure', async () => {
    // a deployment without the plugin answers the api's tagged 404
    answering({ _tag: 'API_ROUTE_NOT_FOUND' }, false)
    const seen = fakeProvider()
    await expect(startBrowserRum(release)).resolves.toBeUndefined()
    captureException(new Error('boom'))
    expect(seen.exceptions).toHaveLength(0)
  })

  it('survives a provider that fails to start', async () => {
    answering({ schema: 1, provider: 'fake', config: {} })
    fakeProvider({ start: () => Promise.reject(new Error('the sdk chunk never loaded')) })
    await expect(startBrowserRum(release)).resolves.toBeUndefined()
    // and reporting afterwards is a no-op rather than a second failure
    expect(() => captureException(new Error('boom'))).not.toThrow()
  })

  it('survives a sink that throws on every report', async () => {
    answering({ schema: 1, provider: 'fake', config: {} })
    registerRumProvider({
      provider: 'fake',
      start: () =>
        Promise.resolve({
          captureException: () => {
            throw new Error('the platform is having a day')
          },
          captureDiagnostic: () => {
            throw new Error('the platform is having a day')
          },
          setPage: () => {
            throw new Error('the platform is having a day')
          },
        }),
    })
    await startBrowserRum(release)
    expect(() => captureException(new Error('boom'))).not.toThrow()
    expect(() => captureDiagnostic('component-missing')).not.toThrow()
    expect(() => setObservedPage({ pageId: 'x', route: '/x' })).not.toThrow()
  })

  it('survives a deployment that answers with something else entirely', async () => {
    // a proxy's html error page, most often
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('<html>gateway</html>', { status: 200 })),
    )
    const seen = fakeProvider()
    await expect(startBrowserRum(release)).resolves.toBeUndefined()
    expect(seen.exceptions).toHaveLength(0)
  })
})

describe('what a report carries', () => {
  const started = async () => {
    answering({ schema: 1, provider: 'fake', config: {} })
    const seen = fakeProvider()
    await startBrowserRum(release)
    return seen
  }

  it('names the screen, never the row', async () => {
    const seen = await started()
    setObservedPage({ pageId: 'assessment/review', route: '/assessment/batches/:batchId/review' })
    captureException(new Error('boom'))
    expect(seen.exceptions[0]?.context).toMatchObject({
      pageId: 'assessment/review',
      route: '/assessment/batches/:batchId/review',
    })
  })

  it('holds no raw address even before a page has been observed', async () => {
    const seen = await started()
    captureException(new Error('boom'))
    const wire = JSON.stringify(seen.exceptions[0]?.context)
    expect(wire).not.toContain('?')
    expect(wire).not.toContain('http')
  })

  it('reports one error object once, however many paths it travels', async () => {
    const seen = await started()
    const error = new Error('boom')
    captureException(error, { componentId: 'a/B', componentKind: 'page' })
    captureException(error)
    expect(seen.exceptions).toHaveLength(1)
  })

  it('still reports two different failures that read alike', async () => {
    const seen = await started()
    captureException(new Error('boom'))
    captureException(new Error('boom'))
    expect(seen.exceptions).toHaveLength(2)
  })
})

describe('the address a provider is given when no page has matched', () => {
  it('is the route template once one has', () => {
    setObservedPage({ pageId: 'assessment/review', route: '/assessment/batches/:batchId/review' })
    expect(observedPageUrl()).toBe('/assessment/batches/:batchId/review')
  })

  it('is a masked pathname before then, never the real one', () => {
    setObservedPage({})
    // the suite's own address, whatever it is, with nothing identifying left
    expect(observedPageUrl()).not.toContain('?')
    expect(observedPageUrl().startsWith('/')).toBe(true)
  })
})

describe('the seams the runtime reports at', () => {
  const Boom = () => {
    throw new Error('POC component exploded')
  }

  it('reports a plugin component that threw, with its id and kind, and shows the fallback', async () => {
    answering({ schema: 1, provider: 'fake', config: {} })
    const seen = fakeProvider()
    await startBrowserRum(release)
    render(
      <MemoryRouter>
        <PluginComponent
          componentId="demo/Boom"
          kind="page"
          component={Boom}
          loading={null}
          fallback={() => <p>something went wrong</p>}
          missing={null}
        />
      </MemoryRouter>,
    )
    // the viewer still gets the fallback: reporting changed nothing about
    // what the screen does when a component fails
    await expect.element(page.getByText('something went wrong')).toBeVisible()
    expect(seen.exceptions).toHaveLength(1)
    expect(seen.exceptions[0]?.context).toMatchObject({
      componentId: 'demo/Boom',
      componentKind: 'page',
    })
  })

  it('reports a component the manifest promised and the build does not have', async () => {
    answering({ schema: 1, provider: 'fake', config: {} })
    const seen = fakeProvider()
    await startBrowserRum(release)
    render(
      <MemoryRouter>
        <PluginComponent
          componentId="demo/Gone"
          kind="slot"
          component={undefined}
          loading={null}
          fallback={() => null}
          missing={<p>missing</p>}
        />
      </MemoryRouter>,
    )
    await expect.element(page.getByText('missing')).toBeVisible()
    // a diagnostic, not an exception: nothing crashed, the two halves of the
    // deployment disagree
    expect(seen.exceptions).toHaveLength(0)
    expect(seen.diagnostics).toEqual([
      { code: 'component-missing', context: { componentId: 'demo/Gone', componentKind: 'slot' } },
    ])
  })
})
