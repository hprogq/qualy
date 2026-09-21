import { useContext } from 'react'
import type { Effect } from 'effect'
import type { NamespacedId } from '@qualy/ui-contract'
import type { HttpApi } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/local'
import { appApiGroup } from '@qualy/app-contract'
import { sharedContext } from './shared-context.ts'
import { buildPageHref, type PageHrefOptions } from './pages.ts'
import type { ComponentRegistry } from './registry.ts'
import type { ClientOf } from './api.ts'

// What the runtime is, and the hooks that read it - in a module of their own
// rather than in the package's entry.
//
// The entry is a barrel: it exports components, hooks and plain functions
// together, which Fast Refresh cannot update surgically, so an edit anywhere
// beneath it invalidates the whole module. That is survivable. What was not
// is that two modules the entry imports - the page link and the navigation
// observer - imported the entry BACK for two hooks, and a cycle turns an
// invalidation into a full page reload: every edit to anything the runtime
// touches reloaded the tab.
//
// So the few things the cycle was made of live here. The entry re-exports
// them, so nothing outside this package changes.

// The shell's own api: the manifest endpoint, imported as the contract leaf
// it is. The runtime holds no global client - each plugin derives one from
// the definitions it calls - and this is simply the runtime doing the same
// for the one endpoint the runtime itself calls.
export const appApi = Api.local(appApiGroup)

export type Manifest = Effect.Success<ReturnType<ClientOf<typeof appApi>['app']['getManifest']>>

/**
 * Builds the typed client for an api definition.
 *
 * The seam tests replace: production derives a real client per definition
 * (memoised by the definition's identity - plugins declare theirs as module
 * constants); a harness answers with a stub tree instead, at the same place
 * a transport would differ.
 */
export type ClientProvider = (api: HttpApi.Constraint) => unknown

export interface Runtime {
  clientFor: ClientProvider
  utilsFor: (api: HttpApi.Constraint) => unknown
  manifest: Manifest
  registry: ComponentRegistry
}

export const RuntimeContext = sharedContext<Runtime | null>('runtime', null)

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('useRuntime must be used inside a RuntimeProvider')
  return runtime
}

export const useManifest = () => useRuntime().manifest

/**
 * The manifest entry for a page reference, or nothing when the viewer cannot
 * see it in this deployment.
 */
export function useManifestPage(page: NamespacedId) {
  const manifest = useManifest()
  return manifest.pages.find((candidate) => candidate.id === page)
}

export const usePageAvailable = (page: NamespacedId) => useManifestPage(page) !== undefined

/**
 * The url of a page, or nothing when it is not part of this manifest.
 *
 * Client code names a page by id; the path is the manifest's alone, so a
 * browser bundle can never disagree with the server about where a page is.
 */
export function usePageHref(page: NamespacedId, options?: PageHrefOptions): string | undefined {
  const entry = useManifestPage(page)
  return entry ? buildPageHref(entry, options) : undefined
}
