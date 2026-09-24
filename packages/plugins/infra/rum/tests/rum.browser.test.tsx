import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { MemoryRouter } from 'react-router'
import { PluginComponent, emptyComponentRegistry, type ComponentRegistry } from '@qualy/web-runtime'
import {
  captureDiagnostic,
  captureException,
  installEarlyListeners,
  installSink,
  observedPageUrl,
  setObservedPage,
  type DiagnosticContext,
  type ExceptionContext,
  type ObservabilitySink,
} from '@qualy/browser-observability'
import { registerRumProvider, resetBrowserRum } from '@qualy/plugin-rum/client'
import { startBrowserRum } from '@qualy/plugin-rum/client/start'
import { startBrowserPlugins } from '@qualy/plugin-kit/browser'
import rumBrowserPlugin from '@qualy/plugin-rum/client/browser'

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
  const sink: ObservabilitySink = {
    captureException: (error, context) => exceptions.push({ error, context }),
    captureDiagnostic: (code, context) => diagnostics.push({ code, context }),
    setPage: (page) => pages.push(page),
  }
  registerRumProvider({ start: over.start ?? (() => Promise.resolve(sink)) })
  return { exceptions, diagnostics, pages, sink }
}

type BrowserRumProviderStart = (
  config: Record<string, unknown>,
  release: { releaseId: string; mode: 'development' | 'production' },
) => Promise<ObservabilitySink | null>

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
    answering({ schema: 2, config: { id: 'x' } })
    const seen = fakeProvider()
    await startBrowserRum(release)
    captureException(new Error('boom'))
    expect(seen.exceptions).toHaveLength(1)
  })

  // An exception is deduped by the identity of its error object; a
  // diagnostic has none, and its hot caller reports from inside a render -
  // so a screen missing a surface reported on every re-render.
  it('reports one fact once, however often it is noticed', async () => {
    answering({ schema: 2, config: { id: 'x' } })
    const seen = fakeProvider()
    await startBrowserRum(release)
    for (let at = 0; at < 5; at++) {
      captureDiagnostic('surface-missing', { surfaceKind: 'page', surface: 'a/b' })
    }
    expect(seen.diagnostics).toHaveLength(1)
    // a different fact is a different report
    captureDiagnostic('surface-missing', { surfaceKind: 'page', surface: 'c/d' })
    captureDiagnostic('release-gone')
    expect(seen.diagnostics).toHaveLength(3)
  })

  it('reports nowhere when the deployment named no provider', async () => {
    answering({ schema: 2, config: null })
    const seen = fakeProvider()
    await startBrowserRum(release)
    captureException(new Error('boom'))
    expect(seen.exceptions).toHaveLength(0)
  })

  it('hands over what failed before any provider existed', async () => {
    // The window this whole queue exists for: a module that throws while the
    // application's own imports evaluate does so before a provider can be up,
    // since bringing one up needs a request and a chunk. The entry arms these
    // two listeners first; the suite arms them the same way, because a reset
    // stood them down after the last case.
    answering({ schema: 2, config: {} })
    const seen = fakeProvider()
    installEarlyListeners()
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('thrown while the graph was evaluating'),
        message: 'thrown while the graph was evaluating',
      }),
    )
    await startBrowserRum(release)
    expect(seen.exceptions.map((one) => (one.error as Error).message)).toContain(
      'thrown while the graph was evaluating',
    )
  })

  it('holds what the application reports while the provider is still starting', async () => {
    // The race the first screen actually runs: nothing awaits `startBrowserRum`
    // - a reporting platform must never hold a render back - so the settings
    // request and the vendor chunk are still in flight while the first
    // components mount. A page that throws there used to report into nothing
    // AND be marked as already reported on the way out, so no later path
    // could report it either. The window listeners do not cover it: a React
    // boundary's report never reaches the window.
    answering({ schema: 2, config: {} })
    let arrive!: (sink: ObservabilitySink) => void
    const onItsWay = new Promise<ObservabilitySink>((resolve) => {
      arrive = resolve
    })
    const seen = fakeProvider({ start: () => onItsWay })
    const starting = startBrowserRum(release)

    const failure = new Error('the first screen exploded')
    captureException(failure, { surface: { kind: 'login', id: 'local' } })
    captureDiagnostic('surface-missing', { surface: 'page:demo/gone' })
    // the same object down a second path, which is what the dedup is for
    captureException(failure)
    expect(seen.exceptions).toHaveLength(0)

    arrive(seen.sink)
    await starting
    // once, with the context it had at the time
    expect(seen.exceptions).toHaveLength(1)
    expect(seen.exceptions[0]?.error).toBe(failure)
    expect(seen.exceptions[0]?.context).toMatchObject({ surface: { kind: 'login', id: 'local' } })
    expect(seen.diagnostics).toEqual([
      { code: 'surface-missing', context: { surface: 'page:demo/gone' } },
    ])
  })

  it('lets go of what it held once the answer is that nobody reports', async () => {
    answering({ schema: 2, config: null })
    captureException(new Error('held for a sink that never comes'))
    await startBrowserRum(release)
    // a sink installed afterwards is the only way to look at what was kept,
    // and it finds nothing: the question was answered, so the queue let go
    // rather than waiting out the life of the page
    const late: Reported[] = []
    installSink({
      captureException: (error, context) => late.push({ error, context }),
      captureDiagnostic: () => undefined,
      setPage: () => undefined,
    })
    expect(late).toEqual([])
  })

  it('treats an assembly without the capability as reporting off, not as a failure', async () => {
    // a deployment without the plugin answers the api's tagged 404
    answering({ _tag: 'API_ROUTE_NOT_FOUND' }, false)
    const seen = fakeProvider()
    await expect(startBrowserRum(release)).resolves.toBeInstanceOf(Function)
    captureException(new Error('boom'))
    expect(seen.exceptions).toHaveLength(0)
  })

  it('survives a provider that fails to start', async () => {
    answering({ schema: 2, config: {} })
    fakeProvider({ start: () => Promise.reject(new Error('the sdk chunk never loaded')) })
    await expect(startBrowserRum(release)).resolves.toBeInstanceOf(Function)
    // and reporting afterwards is a no-op rather than a second failure
    expect(() => captureException(new Error('boom'))).not.toThrow()
  })

  it('survives a sink that throws on every report', async () => {
    answering({ schema: 2, config: {} })
    registerRumProvider({
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
    await expect(startBrowserRum(release)).resolves.toBeInstanceOf(Function)
    expect(seen.exceptions).toHaveLength(0)
  })
})

describe('what a report carries', () => {
  const started = async () => {
    answering({ schema: 2, config: {} })
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
    captureException(error, { surface: { kind: 'page', id: 'a/b' } })
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

  const registryWith = (page: ComponentRegistry['pages']): ComponentRegistry => ({
    ...emptyComponentRegistry(),
    pages: page,
  })

  it('reports the surface a plugin component threw on, and shows the fallback', async () => {
    answering({ schema: 2, config: {} })
    const seen = fakeProvider()
    await startBrowserRum(release)
    await render(
      <MemoryRouter>
        <PluginComponent
          surface={{ kind: 'page', id: 'demo/boom' }}
          registry={registryWith({
            'demo/boom': Boom as unknown as ComponentRegistry['pages'][string],
          })}
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
    // the product address, and nothing about the module behind it
    expect(seen.exceptions[0]?.context).toMatchObject({
      surface: { kind: 'page', id: 'demo/boom' },
    })
    expect(JSON.stringify(seen.exceptions[0]?.context)).not.toContain('Boom')
  })

  it('reports a sign-in renderer by its driver type, like any other surface', async () => {
    answering({ schema: 2, config: {} })
    const seen = fakeProvider()
    await startBrowserRum(release)
    await render(
      <MemoryRouter>
        <PluginComponent
          surface={{ kind: 'login', id: 'local' }}
          registry={{
            ...emptyComponentRegistry(),
            login: { local: Boom as unknown as ComponentRegistry['login'][string] },
          }}
          loading={null}
          fallback={() => <p>this way in is not working</p>}
          missing={null}
        />
      </MemoryRouter>,
    )
    await expect.element(page.getByText('this way in is not working')).toBeVisible()
    expect(seen.exceptions[0]?.context).toMatchObject({ surface: { kind: 'login', id: 'local' } })
  })

  it('reports a surface the manifest promised and the build does not have', async () => {
    answering({ schema: 2, config: {} })
    const seen = fakeProvider()
    await startBrowserRum(release)
    await render(
      <MemoryRouter>
        <PluginComponent
          surface={{ kind: 'slot', slot: 'demo/bar', id: 'demo/gone' }}
          registry={emptyComponentRegistry()}
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
      {
        code: 'surface-missing',
        context: { surfaceKind: 'slot', surface: 'slot:demo/bar:demo/gone' },
      },
    ])
  })
})

describe('reporting ends when the lifetime it was started in ends', () => {
  // What `start` leaves behind outlives the call. The host does not await it,
  // so the teardown the host collected cannot be the one start produced - and
  // for a while nothing kept it at all: a development reload tore the
  // provider's registration down and left its sink installed in the platform,
  // where the next reload installed a second one beside it.
  const context = { release: { releaseId: 'test-release', clientProtocol: 2 } }

  /** a provider whose sink is handed over when the test says so */
  const reporting = () => {
    const exceptions: Reported[] = []
    let hold: ((sink: ObservabilitySink) => void) | undefined
    const state = {
      exceptions,
      asked: false,
      /** resolves this provider's start, as an answer arriving late would */
      handOver: () => hold?.(sink),
    }
    const sink: ObservabilitySink = {
      captureException: (error, context) => exceptions.push({ error, context }),
      captureDiagnostic: () => undefined,
      setPage: () => undefined,
    }
    registerRumProvider({
      start: () =>
        new Promise<ObservabilitySink>((resolve) => {
          state.asked = true
          hold = resolve
        }),
    })
    return state
  }

  /** what the host does, minus the awaiting it deliberately does not do */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('takes the sink down with it', async () => {
    const seen = reporting()
    answering({ schema: 2, config: {} })

    const stop = startBrowserPlugins([rumBrowserPlugin], context)
    await vi.waitFor(() => expect(seen.asked).toBe(true))
    seen.handOver()
    await settle()

    captureException(new Error('while reporting'))
    expect(seen.exceptions).toHaveLength(1)

    stop()
    captureException(new Error('after the lifetime ended'))
    expect(seen.exceptions).toHaveLength(1)
  })

  it('disposes a sink that arrives after the lifetime already ended', async () => {
    // the race every reload runs: the answer is still in flight when the
    // lifetime ends, and the sink that lands afterwards belongs to nobody
    const seen = reporting()
    answering({ schema: 2, config: {} })

    const stop = startBrowserPlugins([rumBrowserPlugin], context)
    await vi.waitFor(() => expect(seen.asked).toBe(true))
    stop()
    seen.handOver()
    await settle()

    captureException(new Error('into a torn-down page'))
    expect(seen.exceptions).toHaveLength(0)
  })
})
