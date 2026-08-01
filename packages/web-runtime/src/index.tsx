import {
  createContext,
  useContext,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import type { AppClient } from '@qualy/api-client'

export type Manifest = Awaited<ReturnType<AppClient['ui']['getManifest']>>
export type ComponentRegistry = Record<string, LazyExoticComponent<ComponentType>>

export interface Runtime {
  client: AppClient
  manifest: Manifest | null
  registry: ComponentRegistry
}

const RuntimeContext = createContext<Runtime | null>(null)

export function RuntimeProvider({ value, children }: { value: Runtime; children: ReactNode }) {
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('useRuntime must be used inside a RuntimeProvider')
  return runtime
}

export const useApi = () => useRuntime().client
export const useManifest = () => useRuntime().manifest

// named extension slots render nothing in P0, widget contributions land in P1
export function Slot(_props: { id: string }) {
  return null
}
