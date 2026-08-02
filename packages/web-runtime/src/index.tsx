import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  Component,
  Suspense,
  createContext,
  useContext,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import type { UiCollectionToken, UiSlotToken } from '@qualy/ui-contract'
import type { AppClient } from '@qualy/api-client'

export type Manifest = Awaited<ReturnType<AppClient['ui']['getManifest']>>
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
  const manifest = useQuery(orpc.ui.getManifest.queryOptions())
  if (manifest.isPending) return null
  if (manifest.isError) {
    return (
      <div>
        <p>界面清单加载失败</p>
        <button onClick={() => void manifest.refetch()}>重试</button>
      </div>
    )
  }
  return (
    <RuntimeContext.Provider value={{ client, orpc, registry, manifest: manifest.data }}>
      {children}
    </RuntimeContext.Provider>
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

// items of a collection surface, already authorized and path-resolved by
// the server; the token carries the item type
export function useUiCollection<T>(token: UiCollectionToken<T>): T[] {
  const manifest = useManifest()
  return (manifest.collections[token.key] ?? []) as T[]
}

// one crashing contribution must never take the shell down with it
class SlotItemBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

// renders every contribution of a slot surface, each item isolated behind
// its own suspense and error boundary; context is runtime state handed down
// by the surrounding layout or page, never serialized into the manifest
export function UiSlot({ token, context }: { token: UiSlotToken; context?: unknown }) {
  const manifest = useManifest()
  const registry = useRuntime().registry
  const items = manifest.slots[token.key] ?? []
  return (
    <>
      {items.map((item) => {
        const Renderer = registry[item.component]
        if (!Renderer) return null
        return (
          <SlotItemBoundary key={item.id}>
            <Suspense fallback={null}>
              <Renderer context={context} />
            </Suspense>
          </SlotItemBoundary>
        )
      })}
    </>
  )
}
