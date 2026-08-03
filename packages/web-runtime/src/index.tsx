import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
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
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type {
  PageParams,
  PageRef,
  ParamsOption,
  UiCollectionToken,
  UiSlotToken,
} from '@qualy/ui-contract'
import { Button } from '@qualy/ui/button'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { LoadingScreen } from '@qualy/ui/spinner'
import type { AppClient } from '@qualy/api-client'
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

export type Manifest = Awaited<ReturnType<AppClient['app']['getManifest']>>
// heterogeneous by design: each page or renderer declares its own props,
// consumers pass whatever the target component expects
export type ComponentRegistry = Record<string, LazyExoticComponent<ComponentType<any>>>

const buildQueryUtils = (client: AppClient) => createTanstackQueryUtils(client)
export type ApiQueryUtils = ReturnType<typeof buildQueryUtils>

export interface Runtime {
  client: AppClient
  orpc: ApiQueryUtils
  manifest: Manifest
  registry: ComponentRegistry
}

const RuntimeContext = createContext<Runtime | null>(null)

export interface RuntimeProviderProps {
  client: AppClient
  registry: ComponentRegistry
  children: ReactNode
}

// the runtime owns the manifest lifecycle: loading renders nothing, failure
// renders a retry prompt instead of a permanently blank shell
export function RuntimeProvider({ client, registry, children }: RuntimeProviderProps) {
  const [queryClient] = useState(() => new QueryClient())
  const [orpc] = useState(() => buildQueryUtils(client))
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeLoader client={client} orpc={orpc} registry={registry}>
        {children}
      </RuntimeLoader>
    </QueryClientProvider>
  )
}

function RuntimeLoader({
  client,
  orpc,
  registry,
  children,
}: Omit<Runtime, 'manifest'> & { children: ReactNode }) {
  const { format } = useI18n()
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
    <RuntimeContext.Provider value={{ client, orpc, registry, manifest: manifest.data }}>
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
      void navigate(sessionDestinationHref(options.destination), {
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

export const useApi = () => useRuntime().client
// resolve one registered component by its namespaced key ('plugin/Component');
// undefined means the owning plugin is not part of this build
export const useComponent = (name: string) => useRuntime().registry[name]
export const useApiQuery = () => useRuntime().orpc
export const useManifest = () => useRuntime().manifest

// the manifest entry for a page reference, or undefined when the viewer
// cannot see it in this deployment. In development a path that disagrees
// with the shared reference is a loud failure: it means the server and the
// browser bundle were built from different sources.
// development-only diagnostics: the bundler replaces this at build time and
// the guard keeps the package free of both node and vite typings
declare const process: { env?: Record<string, string | undefined> } | undefined
const isDev = () => typeof process === 'undefined' || process.env?.['NODE_ENV'] !== 'production'

export function useManifestPage(page: PageRef) {
  const manifest = useManifest()
  const entry = manifest.pages.find((candidate) => candidate.id === page.id)
  if (isDev() && entry && entry.path !== page.path) {
    throw new Error(
      `page ${page.id} is mounted at ${entry.path} but this build references ${page.path}`,
    )
  }
  return entry
}

export const usePageAvailable = (page: PageRef) => useManifestPage(page) !== undefined

// the url of a page, or undefined when it is not part of this manifest
export function usePageHref(page: PageRef, options?: PageHrefOptions): string | undefined {
  const entry = useManifestPage(page)
  return entry ? buildPageHref(page, options) : undefined
}

// navigate by naming a page instead of repeating its path; navigating to a
// page the viewer cannot see is a bug, so it fails loudly in development
// and does nothing in production rather than landing on a dead route
export function usePageNavigate() {
  const navigate = useNavigate()
  const manifest = useManifest()
  return useCallback(
    <const Ref extends PageRef>(
      page: Ref,
      options: Omit<PageHrefOptions, 'params'> &
        ParamsOption<Ref> & { replace?: boolean } = {} as never,
    ) => {
      const available = manifest.pages.some((candidate) => candidate.id === page.id)
      if (!available) {
        const message = `cannot navigate to ${page.id}: not visible in the current manifest`
        if (isDev()) throw new Error(message)
        console.error(`[qualy] ${message}`)
        return
      }
      void navigate(buildPageHref(page, options), { replace: options.replace })
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
): [string, (next: string) => void] {
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

// the `:name` segments of the route this page is mounted at. Typed by the
// page reference, so a screen reads the parameters its own declaration
// promises rather than whatever the router happens to have matched.
export function usePageRouteParams<const Ref extends PageRef>(page: Ref): PageParams<Ref> {
  const params = useParams()
  return params as PageParams<Ref>
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
export function UiSlot({ token, context }: { token: UiSlotToken; context?: unknown }) {
  const manifest = useManifest()
  const registry = useRuntime().registry
  const items = manifest.slots[token.key] ?? []
  return (
    <>
      {items.map((item) => {
        const Renderer = registry[item.component] as ComponentType<{ context?: unknown }> | undefined
        return (
          <PluginComponent
            key={item.id}
            componentId={item.component}
            kind="slot"
            component={
              Renderer ? () => <Renderer context={context} /> : undefined
            }
            loading={null}
            fallback={() => null}
            missing={null}
          />
        )
      })}
    </>
  )
}
