import { useMemo, type ComponentType, type ReactNode } from 'react'
import { Navigate, useRoutes, type RouteObject } from 'react-router'
import type { ComponentRegistry, Manifest } from './index.tsx'
import { PluginComponent } from './component-boundary.tsx'

// turns the authorized manifest into react-router route objects. Kept out of
// the host app so the projection rules — layout nesting, the home target,
// the catch-all, per-page isolation — are testable without a browser.

// localized copy the host supplies for every route-level state; it changes
// with the locale, so the builder rebuilds when it does
export interface RouteSlots {
  pageLoading: ReactNode
  layoutLoading: ReactNode
  pageError: (retry: () => void) => ReactNode
  layoutError: (retry: () => void) => ReactNode
  componentMissing: (componentId: string) => ReactNode
  notFound: ReactNode
  empty: ReactNode
}

export interface RouteBuilderOptions {
  manifest: Manifest
  registry: ComponentRegistry
  // the page the bare origin redirects to, resolved from the manifest by the
  // host (normally the first visible primary navigation entry)
  homePath?: string
  slots: RouteSlots
}

export function buildManifestRoutes({
  manifest,
  registry,
  homePath,
  slots,
}: RouteBuilderOptions): RouteObject[] {
  const byLayout = new Map<string, Manifest['pages']>()
  for (const page of manifest.pages) {
    byLayout.set(page.layout, [...(byLayout.get(page.layout) ?? []), page])
  }

  // Both of the screens below belong inside a shell: mistyping an address
  // used to drop the viewer onto a bare page with no navigation and no way
  // back. The shell chosen is the one the viewer's own home page lives in.
  // The host names no layout contract of its own, and a viewer with nothing
  // to see keeps the standalone rendering at the end.
  // Only pages that reach the tree can be a destination. A page whose layout
  // has no provider never becomes a route, so redirecting the origin to one
  // would land on the not-found screen by way of a page that looked fine in
  // the manifest.
  const provided = new Set(manifest.layouts.map((layout) => layout.contract))
  const routable = manifest.pages.filter((page) => provided.has(page.layout))
  const home = routable.find((page) => page.path === homePath) ?? routable[0]
  const shell = home?.layout

  // host-level policy: the origin goes to the home page when there is one,
  // and anything unmatched, including a route that vanished when the
  // viewer's permissions changed, lands on one not-found screen.
  //
  // The redirect follows the resolved page rather than the requested path.
  // A navigation entry can name a page the manifest no longer carries, and
  // sending the viewer to it meant bouncing the origin straight onto the
  // not-found screen instead of onto whatever they can actually open.
  const index: RouteObject = {
    index: true,
    element: home ? <Navigate to={home.path} replace /> : slots.empty,
  }
  const catchAll: RouteObject = { path: '*', element: slots.notFound }

  const routes: RouteObject[] = manifest.layouts.map((layout) => ({
    element: (
      <PluginComponent
        componentId={layout.component}
        kind="layout"
        component={registry[layout.component] as ComponentType | undefined}
        loading={slots.layoutLoading}
        fallback={slots.layoutError}
        missing={slots.componentMissing(layout.component)}
      />
    ),
    children: [
      ...(byLayout.get(layout.contract) ?? []).map((page) => ({
        path: page.path,
        element: (
          <PluginComponent
            componentId={page.component}
            kind="page"
            component={registry[page.component] as ComponentType | undefined}
            loading={slots.pageLoading}
            fallback={slots.pageError}
            missing={slots.componentMissing(page.component)}
          />
        ),
      })),
      // exactly one layout carries them, or the tree would be ambiguous
      ...(layout.contract === shell ? [index, catchAll] : []),
    ],
  }))

  return shell === undefined ? [...routes, index, catchAll] : routes
}

export function ManifestRoutes(options: RouteBuilderOptions) {
  const routes = useMemo(
    () => buildManifestRoutes(options),
    // slots carry localized copy, so a locale switch must rebuild them too;
    // the host memoizes the slot object so this stays cheap
    [options.manifest, options.registry, options.homePath, options.slots],
  )
  return useRoutes(routes)
}
