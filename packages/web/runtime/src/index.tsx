import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import { Effect } from 'effect'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type {
  PageParams,
  PageRef,
  ParamsOption,
  UiCollectionToken,
  UiSlotToken,
} from '@qualy/ui-contract'
import { Button } from '@qualy/ui/button'
import { Toaster } from '@qualy/ui/toast'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { LoadingScreen } from '@qualy/ui/spinner'
import { clientFor, type ClientOf } from './api.ts'
import { createQueryUtils, runMutation, type QueryUtils } from './api-query.ts'
import { Api } from '@qualy/api-kit/plugin'
import { appApiGroup } from '@qualy/plugin-ui-registry/api'
import type { HttpApi } from 'effect/unstable/httpapi'
import type { NamespacedId } from '@qualy/ui-contract'
import {
  buildPageHref,
  sessionDestinationHref,
  type PageHrefOptions,
  type SessionDestination,
} from './pages.ts'
import { PluginComponent } from './component-boundary.tsx'

export {
  buildPageHref,
  sessionDestinationHref,
  type PageHrefOptions,
  type SessionDestination,
} from './pages.ts'
export {
  PluginComponent,
  PluginComponentBoundary,
  type PluginComponentKind,
} from './component-boundary.tsx'
export {
  buildManifestRoutes,
  ManifestRoutes,
  type RouteBuilderOptions,
  type RouteSlots,
} from './route-builder.tsx'
export { PageLink } from './links.tsx'
export { ThemeProvider, useTheme, type ThemeChoice } from './theme.tsx'

// The shell's own api: the manifest endpoint, imported as the contract leaf
// it is. The runtime holds no global client - each plugin derives one from
// the definitions it calls - and this is simply the runtime doing the same
// for the one endpoint the runtime itself calls.
const appApi = Api.local(appApiGroup)
export type Manifest = Effect.Success<ReturnType<ClientOf<typeof appApi>['app']['getManifest']>>
// heterogeneous by design: each page or renderer declares its own props,
// consumers pass whatever the target component expects
export type ComponentRegistry = Record<string, LazyExoticComponent<ComponentType<any>>>

/**
 * Builds the typed client for an api definition.
 *
 * The seam tests replace: production derives a real client per definition
 * (memoised by the definition's identity - plugins declare theirs as module
 * constants); a harness answers with a stub tree instead, at the same place
 * a transport would differ.
 */
export type ClientProvider = (api: HttpApi.Constraint) => unknown

const defaultClientFor: ClientProvider = (() => {
  const cache = new WeakMap<object, unknown>()
  return (api: HttpApi.Constraint) => {
    const cached = cache.get(api)
    if (cached) return cached
    const client = Effect.runSync(clientFor(api as Parameters<typeof clientFor>[0]))
    cache.set(api, client)
    return client
  }
})()

export interface Runtime {
  clientFor: ClientProvider
  utilsFor: (api: HttpApi.Constraint) => unknown
  manifest: Manifest
  registry: ComponentRegistry
}

const RuntimeContext = createContext<Runtime | null>(null)

export interface RuntimeProviderProps {
  /** replaced by harnesses; production derives real clients per definition */
  clientFor?: ClientProvider
  registry: ComponentRegistry
  children: ReactNode
}

// How long a failed read waits before it says so.
//
// The library retries three times with a growing delay, which is right for a
// screen that has no other answer to a failure. Every screen here does: a
// failed section renders what went wrong and a retry button, so the ladder
// only buys seven seconds of a spinner in front of a message the reader could
// have had at once, and a refusal the server means (a 4xx, a typed domain
// error) is not going to answer differently the third time.
//
// One retry is kept for the case the reader cannot see: a connection that
// dropped between here and the server, where the second attempt genuinely may
// succeed and nothing has been decided yet.
const retry = (attempt: number, error: unknown) =>
  attempt < 1 && !(typeof error === 'object' && error !== null && '_tag' in error)

// the runtime owns the manifest lifecycle: loading renders nothing, failure
// renders a retry prompt instead of a permanently blank shell
export function RuntimeProvider({ clientFor: provided, registry, children }: RuntimeProviderProps) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry } } }))
  const [runtime] = useState(() => {
    const provider = provided ?? defaultClientFor
    const utils = new WeakMap<object, unknown>()
    return {
      clientFor: provider,
      utilsFor: (api: HttpApi.Constraint) => {
        const cached = utils.get(api)
        if (cached) return cached
        const built = createQueryUtils(provider(api) as Record<string, never>)
        utils.set(api, built)
        return built
      },
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
  const orpc = utilsFor(appApi) as QueryUtils<ClientOf<typeof appApi>>
  const manifest = useQuery(orpc.app.getManifest.queryOptions())
  if (manifest.isPending) return <LoadingScreen />
  if (manifest.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">{format(commonMessages.manifestLoadFailed)}</p>
        <Button variant="outline" onClick={() => void manifest.refetch()}>
          {format(commonMessages.retry)}
        </Button>
      </div>
    )
  }
  return (
    <RuntimeContext.Provider value={{ clientFor, utilsFor, registry, manifest: manifest.data }}>
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
  return useCallback(
    async (options: { destination: SessionDestination; replace?: boolean }) => {
      void navigate(sessionDestinationHref(options.destination, manifest.pages), {
        replace: options.replace ?? true,
      })
      // resetQueries, not clear: clear evicts the cache entries but leaves
      // every mounted useQuery bound to the query it already resolved, so
      // the manifest kept answering with the previous identity's pages and
      // the following refetch had nothing left to refetch. Reset drops the
      // data through the observers, which go pending rather than serving a
      // stale row, and refetches the active ones under the new identity.
      await queryClient.resetQueries()
      // reset also clears each entry's collection timer and only re-arms it
      // on the next fetch, so entries nobody is watching would outlive the
      // tab. Removing them once the active ones have refetched restores what
      // clear did without giving up the notification that reset provides.
      queryClient.removeQueries({ type: 'inactive' })
    },
    // manifest identity ties the callback to the active session
    [queryClient, navigate, manifest],
  )
}

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('useRuntime must be used inside a RuntimeProvider')
  return runtime
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
// resolve one registered component by its namespaced key ('plugin/Component');
// undefined means the owning plugin is not part of this build
export const useComponent = (name: string) => useRuntime().registry[name]
/** query utilities for an api definition, memoised per definition */
export function useApiQuery<Api extends HttpApi.Constraint>(api: Api): QueryUtils<ClientOf<Api>> {
  return useRuntime().utilsFor(api) as QueryUtils<ClientOf<Api>>
}
export const useManifest = () => useRuntime().manifest

// the manifest entry for a page reference, or undefined when the viewer
// cannot see it in this deployment. In development a path that disagrees
// with the shared reference is a loud failure: it means the server and the
// browser bundle were built from different sources.
// development-only diagnostics: the bundler replaces this at build time and
// the guard keeps the package free of both node and vite typings
declare const process: { env?: Record<string, string | undefined> } | undefined
const isDev = () => typeof process === 'undefined' || process.env?.['NODE_ENV'] !== 'production'

export function useManifestPage(page: NamespacedId) {
  const manifest = useManifest()
  return manifest.pages.find((candidate) => candidate.id === page)
}

export const usePageAvailable = (page: NamespacedId) => useManifestPage(page) !== undefined

// The url of a page, or undefined when it is not part of this manifest.
// Client code names a page by id; the path is the manifest's alone, so a
// browser bundle can never disagree with the server about where a page is.
export function usePageHref(page: NamespacedId, options?: PageHrefOptions): string | undefined {
  const entry = useManifestPage(page)
  return entry ? buildPageHref(entry, options) : undefined
}

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
export function usePageQueryState(key: string, fallback = ''): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? fallback
  const set = useCallback(
    (next: string) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next === '' || next === fallback) updated.delete(key)
          else updated.set(key, next)
          return updated
        },
        // navigating a filter is not a place in history to go back to
        { replace: true },
      )
    },
    [key, fallback, setParams],
  )
  return [value, set]
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
      {items.map((item) => {
        const Renderer = registry[item.component] as
          ComponentType<Record<string, unknown>> | undefined
        return (
          <PluginComponent
            key={item.id}
            componentId={item.component}
            kind="slot"
            component={Renderer}
            props={{ context }}
            loading={loading ?? fallback ?? null}
            fallback={() => null}
            missing={null}
          />
        )
      })}
    </>
  )
}
