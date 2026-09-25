import {
  defaultScheduler,
  MutationCache,
  notifyManager,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import {
  lazy,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import {
  appApi,
  RuntimeContext,
  useManifest,
  useRuntime,
  type ClientProvider,
  type Manifest,
  type Runtime,
} from './runtime-context.tsx'
import { Effect } from 'effect'
import type { ClientUnsupportedReason } from '@qualy/release-contract'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { UiCollectionToken, UiSlotToken } from '@qualy/ui-contract'
import { Toaster } from '@qualy/ui/toast'
import { isAuthenticationError, useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { LoadingScreen } from '@qualy/ui/spinner'
import { afterFlight } from '@qualy/ui/flight'
import { clientFor, type ClientIdentity, type ClientOf, type TransportOptions } from './api.ts'
import { signingOut } from './identity.ts'
import { type ComponentRegistry } from './registry.ts'
import {
  createQueryUtils,
  retryDelay,
  retryManifest,
  retryQuery,
  runMutation,
  type QueryUtils,
} from './api-query.ts'
import type { HttpApi } from 'effect/unstable/httpapi'
import type { NamespacedId } from '@qualy/ui-contract'
import {
  buildPageHref,
  sessionDestinationHref,
  type PageHrefOptions,
  type SessionDestination,
} from './pages.ts'
import { PluginComponent, type PluginComponentProps } from './component-boundary.tsx'
import { Failure } from './failure.tsx'

export { Failure } from './failure.tsx'
export {
  buildPageHref,
  sessionDestinationHref,
  type PageHrefOptions,
  type SessionDestination,
} from './pages.ts'
export {
  emptyComponentRegistry,
  resolveSurface,
  type ComponentRegistry,
  type RegisteredComponent,
} from './registry.ts'
export {
  PluginComponent,
  PluginComponentBoundary,
  type PluginComponentProps,
} from './component-boundary.tsx'
export {
  buildManifestRoutes,
  ManifestRoutes,
  type RouteBuilderOptions,
  type RouteSlots,
} from './route-builder.tsx'
export { cursorPages } from './api-query.ts'
export { useApiStream } from './api-stream.ts'
export { PageLink } from './links.tsx'
export {
  PENDING_INDICATOR_AFTER,
  useIdlePagePrefetch,
  usePagePrefetch,
  usePendingNavigation,
  type PendingNavigation,
} from './navigation.tsx'
export { ThemeProvider, useTheme, type ThemeChoice } from './theme.tsx'

/**
 * A lazy component whose module can be fetched ahead of time, and which
 * then renders without suspending.
 *
 * React reveals a retried Suspense boundary no sooner than 300ms after the
 * last fallback it committed, so a lazy component whose chunk takes 10ms
 * still holds its fallback for 300. That is fine for a page, whose
 * indicator waits 300ms before appearing anyway; it is not fine for the
 * layout, which the cold start's flight waits on. `React.lazy` reads its
 * thunk's result synchronously if the thenable calls back synchronously,
 * so once the module is here the component is handed over on the spot
 * and no fallback is ever committed.
 */
export function preloadable<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> & { preload: () => Promise<void> } {
  let loaded: { default: T } | undefined
  let loading: Promise<{ default: T }> | undefined
  const fetch = () =>
    (loading ??= load().then((module) => {
      loaded = module
      return module
    }))
  const component = lazy(() =>
    loaded === undefined
      ? fetch()
      : // the synchronous thenable React's initializer reads in one step
        // eslint-disable-next-line unicorn/no-thenable -- a thenable is the point
        ({ then: (resolve: (value: { default: T }) => void) => resolve(loaded!) } as Promise<{
          default: T
        }>),
  )
  return Object.assign(component, { preload: () => fetch().then(() => undefined) })
}

/** real clients, one per definition, over one transport carrying the page's identity */
const clientProviderFor = (transport: TransportOptions): ClientProvider => {
  const cache = new WeakMap<object, unknown>()
  return (api: HttpApi.Constraint) => {
    const cached = cache.get(api)
    if (cached) return cached
    const client = Effect.runSync(
      clientFor(api as Parameters<typeof clientFor>[0], undefined, transport),
    )
    cache.set(api, client)
    return client
  }
}

export {
  RuntimeContext,
  useManifest,
  useManifestPage,
  usePageAvailable,
  usePageHref,
  useRuntime,
  type ClientProvider,
  type Manifest,
  type Runtime,
} from './runtime-context.tsx'

export interface RuntimeProviderProps {
  /** replaced by harnesses; production derives real clients per definition */
  clientFor?: ClientProvider
  /**
   * who the page is, named on every api request. The composition root hands
   * it in from the bundle's own identity; this package imports no virtual
   * module. A harness may leave it out.
   */
  clientIdentity?: ClientIdentity
  /** the server refused this page's protocol: told to whoever blocks the page */
  onClientUnsupported?: (reason: ClientUnsupportedReason) => void
  registry: ComponentRegistry
  children: ReactNode
}

// the runtime owns the manifest lifecycle: loading renders nothing, failure
// renders a retry prompt instead of a permanently blank shell
// the two screens the runtime draws itself, before a manifest exists to say
// what a page looks like
/**
 * What to do when a request says the session this page was built for is gone.
 *
 * Any query or mutation may be the one that finds out - an expired session
 * is noticed by whatever asks next - so it is handled here, once, rather
 * than by every page. Only the two codes that mean "no usable session" count
 * (a refused password is also a 401 and is nothing of the kind), and only
 * while the manifest in hand is a signed-in one: an anonymous visitor is
 * told the same codes as a matter of course.
 *
 * What it does is what a sign-out does to the cache: nothing the previous
 * identity was shown stays readable, and the manifest is asked again. It
 * does not decide where the reader goes. The anonymous manifest that comes
 * back either still places the address (a public page stays where it is) or
 * does not, and the router sends them to sign in with the way back - the
 * same rule as any other address an anonymous visitor cannot place.
 *
 * Many requests find out at once, so it runs once at a time; a manifest that
 * comes back still signed in (the session was renewed in another tab) ends it
 * there rather than asking everything again into the same refusal.
 */
function identityLostHandler(client: () => QueryClient, manifestKey: () => QueryKey) {
  let settling = false
  return (error: unknown) => {
    if (settling || !isAuthenticationError(error)) return
    const key = manifestKey()
    if (client().getQueryData<Manifest>(key)?.viewer !== 'authenticated') return
    settling = true
    const queries = client()
    void (async () => {
      try {
        await queries.cancelQueries()
        const manifestHash = queries.getQueryCache().find({ queryKey: key, exact: true })?.queryHash
        // the manifest keeps its answer until the new one arrives: every
        // route stands under it, and a pending one takes them all down
        notifyManager.batch(() => {
          for (const query of queries.getQueryCache().getAll()) {
            if (query.queryHash !== manifestHash) query.reset()
          }
        })
        await queries.refetchQueries({ queryKey: key, exact: true })
        queries.removeQueries({ type: 'inactive' })
        if (queries.getQueryData<Manifest>(key)?.viewer === 'authenticated') return
        // a page the anonymous manifest still has asks again as nobody; the
        // manifest has just been answered
        await queries.refetchQueries({
          type: 'active',
          predicate: (query) => query.queryHash !== manifestHash,
        })
      } finally {
        settling = false
      }
    })()
  }
}

export function RuntimeProvider({
  clientFor: provided,
  clientIdentity,
  onClientUnsupported,
  registry,
  children,
}: RuntimeProviderProps) {
  const [manifestKey] = useState(() => ({ current: undefined as QueryKey | undefined }))
  const [queryClient] = useState(() => {
    // The page's first answers wait for the wordmark to land: a render in
    // the middle of its flight froze it mid-air (see @qualy/ui/flight).
    notifyManager.setScheduler((callback) => defaultScheduler(() => afterFlight(callback)))
    const lost = identityLostHandler(
      () => made,
      () => manifestKey.current ?? [],
    )
    const made: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError: lost }),
      mutationCache: new MutationCache({ onError: lost }),
      defaultOptions: {
        queries: { retry: retryQuery, retryDelay },
        // Never, and stated rather than inherited. A write whose response
        // was lost is indistinguishable here from one that never arrived,
        // so retrying it is a second write nobody asked for - and the
        // window this repeats in is exactly the one where the backend is
        // being replaced mid-request.
        mutations: { retry: false },
      },
    })
    return made
  })
  const [runtime] = useState(() => {
    const provider =
      provided ??
      clientProviderFor({
        ...(clientIdentity === undefined ? {} : { identity: clientIdentity }),
        ...(onClientUnsupported === undefined ? {} : { onClientUnsupported }),
      })
    const utils = new WeakMap<object, unknown>()
    const utilsFor = (api: HttpApi.Constraint) => {
      const cached = utils.get(api)
      if (cached) return cached
      const built = createQueryUtils(provider(api) as Record<string, never>)
      utils.set(api, built)
      return built
    }
    manifestKey.current = (
      utilsFor(appApi) as QueryUtils<ClientOf<typeof appApi>>
    ).app.getManifest.queryOptions().queryKey
    return {
      clientFor: provider,
      utilsFor,
    }
  })
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeLoader clientFor={runtime.clientFor} utilsFor={runtime.utilsFor} registry={registry}>
        {children}
      </RuntimeLoader>
      {/* mounted once, above every screen: a plugin that wants to say
          something did not have to arrange for somewhere to say it */}
      <Toaster />
    </QueryClientProvider>
  )
}

function RuntimeLoader({
  clientFor,
  utilsFor,
  registry,
  children,
}: Omit<Runtime, 'manifest'> & { children: ReactNode }) {
  const { format } = useI18n()
  const query = utilsFor(appApi) as QueryUtils<ClientOf<typeof appApi>>
  const manifest = useQuery({
    ...query.app.getManifest.queryOptions(),
    // the whole application is behind this one, so it waits out a backend
    // replacement rather than dropping the reader onto a retry button
    retry: retryManifest,
    retryDelay,
  })
  // the layouts this manifest names are fetched before the routes render,
  // so the shell is drawn in the same commit the manifest arrives in rather
  // than behind a fallback React holds for 300ms; the loading screen keeps
  // standing meanwhile, the same element in the same place
  const layouts = manifest.data?.layouts
  const [warm, setWarm] = useState<typeof layouts>(undefined)
  useEffect(() => {
    if (layouts === undefined) return
    let cancelled = false
    void Promise.all(
      layouts.map((layout) => registry.layouts[layout.contract]?.preload?.() ?? Promise.resolve()),
    ).then(() => {
      if (!cancelled) setWarm(layouts)
    })
    return () => {
      cancelled = true
    }
  }, [layouts, registry])
  // Only a page that never had a manifest is stopped by not getting one. It
  // is asked again in the background - a reader coming back to the tab may
  // have been signed out, or had their access changed, meanwhile - and one of
  // those asks failing on a poor connection leaves the manifest in hand
  // standing: it still describes this identity, and the page's own requests
  // say for themselves that they cannot reach the server.
  const known = manifest.data
  if (known === undefined) {
    if (manifest.isError) {
      return (
        <Failure
          message={format(commonMessages.manifestLoadFailed)}
          onRetry={() => void manifest.refetch()}
          fullscreen
        />
      )
    }
    return <LoadingScreen />
  }
  if (warm !== layouts) return <LoadingScreen />
  return (
    <RuntimeContext.Provider value={{ clientFor, utilsFor, registry, manifest: known }}>
      {children}
    </RuntimeContext.Provider>
  )
}

// Identity changes must not leave one user's data reachable by the next.
// Nothing in the cache is keyed by session, so the honest move is to drop
// all of it and let the manifest and page queries refetch under the new
// identity — a session-partitioned key scheme would be more surgical and
// far easier to get subtly wrong.
export function useSessionTransition() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const manifest = useManifest()
  const runtime = useRuntime()
  return useCallback(
    async (options: { destination: SessionDestination; replace?: boolean }) => {
      // Leaving somebody who was signed in: whatever a plugin kept in this
      // browser for them goes before the next person can find it. Signing
      // in from nobody leaves nobody.
      if (manifest.viewer === 'authenticated') signingOut()
      const manifestKey = (
        runtime.utilsFor(appApi) as QueryUtils<ClientOf<typeof appApi>>
      ).app.getManifest.queryOptions().queryKey
      const go = (pages: typeof manifest.pages) =>
        void navigate(sessionDestinationHref(options.destination, pages), {
          replace: options.replace ?? true,
        })
      // Where the change of identity leads decides the order.
      //
      // Leaving - signing out, to a page this manifest already has - the
      // page goes at once, before anything is dropped: the manifest about to
      // arrive no longer has the page being left.
      //
      // Arriving - signing in, to a home that only the new identity can see
      // - the page stays until the new manifest is in. Routed under the one
      // it had, home is the sign-in page, and the reader was sent straight
      // back to it.
      const destination = options.destination
      const known =
        destination.kind === 'page' && manifest.pages.some((page) => page.id === destination.page)
      if (!known) {
        await queryClient.cancelQueries()
        // what nobody watches is dropped; what the page in hand watches is
        // asked again with the new session, the manifest among it
        queryClient.removeQueries({ type: 'inactive' })
        await queryClient.refetchQueries({ type: 'active' })
        const next = queryClient.getQueryData<Manifest>(manifestKey)
        go(next?.pages ?? manifest.pages)
        return
      }
      go(manifest.pages)
      // Every answer is dropped, and nothing is asked again on the spot.
      //
      // A reset that refetched what was being watched asked again for the
      // page being left: a navigation is a transition, and the old page stays
      // on screen until the new one has rendered - with a lazily loaded page,
      // for as long as its code takes - so its queries were still watched,
      // and were asked for with the session just ended and answered 401.
      // Reset in place instead: the data goes through the observers, which
      // show pending rather than serve the last identity's rows, and each
      // query is asked for again by whatever mounts it next.
      //
      // The manifest is the exception: every page stands under it, and a
      // manifest gone pending takes the routes down with it, so the page being
      // left would mount again and ask again. It keeps its answer until the
      // new one arrives, asked for now.
      const manifestHash = queryClient
        .getQueryCache()
        .find({ queryKey: manifestKey, exact: true })?.queryHash
      await queryClient.cancelQueries()
      notifyManager.batch(() => {
        for (const query of queryClient.getQueryCache().getAll()) {
          if (query.queryHash !== manifestHash) query.reset()
        }
      })
      await queryClient.refetchQueries({ queryKey: manifestKey, exact: true })
      // entries nobody is watching would otherwise outlive the tab
      queryClient.removeQueries({ type: 'inactive' })
    },
    // manifest identity ties the callback to the active session
    [queryClient, navigate, manifest, runtime],
  )
}

/** the typed client for an api definition a plugin declares as a constant */
export function useApi<Api extends HttpApi.Constraint>(api: Api): ClientOf<Api> {
  return useRuntime().clientFor(api) as ClientOf<Api>
}

/**
 * Turns one call into a promise, for a mutation.
 *
 * TanStack needs a promise from `mutationFn`, and this is the only crossing a
 * component is offered: doing it inline would spread `Effect.runPromise`
 * through the whole ui and throw away each endpoint's failure type at every
 * one of those lines.
 */
export const useRunApi = () => runMutation()
/**
 * One surface of this build, rendered: isolated, reported, and drawn with the
 * caller's own states for loading, failing and not being here at all.
 *
 * The same component the route tree and the slots use, resolved against the
 * runtime's registry instead of one passed in - which is what a plugin has.
 * There is deliberately no way to get the raw component out: a caller that
 * rendered it itself would be outside the boundary, so a renderer that threw
 * would take the screen with it and nothing would report which surface it
 * was. That is exactly what the sign-in screen used to do.
 */
export function PluginSurface(props: Omit<PluginComponentProps, 'registry'>) {
  return <PluginComponent {...props} registry={useRuntime().registry} />
}
/** query utilities for an api definition, memoised per definition */
export function useApiQuery<Api extends HttpApi.Constraint>(api: Api): QueryUtils<ClientOf<Api>> {
  return useRuntime().utilsFor(api) as QueryUtils<ClientOf<Api>>
}
// the manifest entry for a page reference, or undefined when the viewer
// cannot see it in this deployment. In development a path that disagrees
// with the shared reference is a loud failure: it means the server and the
// browser bundle were built from different sources.
// development-only diagnostics: the bundler replaces this at build time and
// the guard keeps the package free of both node and vite typings
declare const process: { env?: Record<string, string | undefined> } | undefined
const isDev = () => typeof process === 'undefined' || process.env?.['NODE_ENV'] !== 'production'

// The url of a page, or undefined when it is not part of this manifest.
// Client code names a page by id; the path is the manifest's alone, so a
// browser bundle can never disagree with the server about where a page is.
// navigate by naming a page instead of repeating its path; navigating to a
// page the viewer cannot see is a bug, so it fails loudly in development
// and does nothing in production rather than landing on a dead route
export function usePageNavigate() {
  const navigate = useNavigate()
  const manifest = useManifest()
  return useCallback(
    (page: NamespacedId, options: PageHrefOptions & { replace?: boolean } = {}) => {
      const entry = manifest.pages.find((candidate) => candidate.id === page)
      if (!entry) {
        const message = `cannot navigate to ${page}: not visible in the current manifest`
        if (isDev()) throw new Error(message)
        console.error(`[qualy] ${message}`)
        return
      }
      void navigate(buildPageHref(entry, options), { replace: options.replace })
    },
    [navigate, manifest],
  )
}

// One piece of screen state that belongs in the address bar: which record is
// selected, what was searched for, which anchor is in view. Keeping it here
// rather than in useState is what makes an administration screen linkable and
// survivable across a reload.
export function usePageQueryState(
  key: string,
  fallback = '',
  options?: {
    /**
     * Whether changing it is somewhere to come back to.
     *
     * A filter is not: nobody presses back expecting the search box to empty
     * one letter at a time. Opening a record is - the reader went somewhere,
     * and back is how anybody leaves.
     */
    history?: 'replace' | 'push'
  },
): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? fallback
  const history = options?.history ?? 'replace'
  const set = useCallback(
    (next: string) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next === '' || next === fallback) updated.delete(key)
          else updated.set(key, next)
          return updated
        },
        { replace: history === 'replace' },
      )
    },
    [key, fallback, history, setParams],
  )
  return [value, set]
}

/**
 * Several address keys written in one navigation.
 *
 * The router's functional updater reads the location the component rendered
 * with, not the result of an earlier call in the same tick - so two
 * usePageQueryState writes from one click race, and the second silently
 * drops the first. A handler that has to move two layers at once - open
 * this question AND start writing a claim on it - says so in one write.
 */
export function usePageQueryUpdate(): (
  changes: Record<string, string>,
  options?: { history?: 'replace' | 'push' },
) => void {
  const [, setParams] = useSearchParams()
  return useCallback(
    (changes, options) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          for (const [key, next] of Object.entries(changes)) {
            if (next === '') updated.delete(key)
            else updated.set(key, next)
          }
          return updated
        },
        { replace: (options?.history ?? 'replace') === 'replace' },
      )
    },
    [setParams],
  )
}

// The named `:name` segments of the route this screen is mounted at. The
// caller says which names it expects, and a missing one is a loud failure:
// a screen quietly reading undefined out of the router is a link bug that
// would otherwise surface as a broken api call three layers later.
export function usePageRouteParams<const Name extends string>(
  ...names: readonly Name[]
): Record<Name, string> {
  const params = useParams()
  const out = {} as Record<Name, string>
  for (const name of names) {
    const value = params[name]
    if (value === undefined) {
      throw new Error(`the current route provides no :${name} parameter`)
    }
    out[name] = value
  }
  return out
}

// items of a collection surface, already authorized and path-resolved by
// the server; the token carries the item type
export function useUiCollection<TContribution, TResolved>(
  token: UiCollectionToken<TContribution, TResolved>,
): TResolved[] {
  const manifest = useManifest()
  return (manifest.collections[token.key] ?? []) as TResolved[]
}

// renders every contribution of a slot surface, each item isolated behind
// its own suspense and error boundary; context is runtime state handed down
// by the surrounding layout or page, never serialized into the manifest.
// A failing or missing slot item takes no layout space but is always
// reported — silence here used to hide broken contributions completely.
export function UiSlot({
  token,
  context,
  fallback,
  loading,
}: {
  token: UiSlotToken
  context?: unknown
  /**
   * What to show when nobody contributes here.
   *
   * A surface is empty for two ordinary reasons - the plugin that fills it is
   * not installed, or the viewer may not see what it offers - and a slot that
   * a screen depends on for meaning (a person's name, say) must not leave a
   * hole in either case. Absent by design for decorative surfaces.
   */
  fallback?: ReactNode
  /**
   * What stands there while the contribution's chunk is in flight.
   *
   * Defaults to the fallback, which is right when the fallback is the same
   * thing drawn plainly - a person's name, say. It is wrong when the fallback
   * says "you may not see this", because for a moment that is what a reader
   * who may see it is told. Anything with a fallback like that passes a
   * skeleton here instead.
   */
  loading?: ReactNode
}) {
  const manifest = useManifest()
  const registry = useRuntime().registry
  const items = manifest.slots[token.key] ?? []
  if (items.length === 0) return <>{fallback ?? null}</>
  // While the contribution's chunk is in flight the fallback holds its place.
  // Rendering nothing there is what made a table of names appear a beat after
  // the rest of the row and push everything sideways when it arrived: the
  // fallback is the same person drawn the plain way, so the swap is invisible.
  return (
    <>
      {items.map((item) => (
        <PluginComponent
          key={item.id}
          surface={{ kind: 'slot', slot: token.key, id: item.id }}
          registry={registry}
          props={{ context }}
          loading={loading ?? fallback ?? null}
          fallback={() => null}
          missing={null}
        />
      ))}
    </>
  )
}
export {
  WorkspaceCapabilityScope,
  useWorkspaceCapabilities,
  usePublishWorkspaceCapabilities,
  type WorkspaceCapabilities,
} from './workspace-capabilities.tsx'
export { ScreenFootScope, useScreenFootClaimed, useClaimScreenFoot } from './screen-foot.tsx'
export { ScreenFillScope, useScreenFillClaimed, useClaimScreenFill } from './screen-fill.tsx'
export { PageTitleScope, usePageTitle, usePageTitleClaim } from './page-title.tsx'
