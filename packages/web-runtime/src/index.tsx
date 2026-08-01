import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import {
  createContext,
  useContext,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import type { AppClient } from '@qualy/api-client'

export type Manifest = Awaited<ReturnType<AppClient['ui']['getManifest']>>
export type ComponentRegistry = Record<string, LazyExoticComponent<ComponentType>>

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
export const useApiQuery = () => useRuntime().orpc
export const useManifest = () => useRuntime().manifest

// named extension slots render nothing in P0, widget contributions land in P1
export function Slot(_props: { id: string }) {
  return null
}
