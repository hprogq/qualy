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
    children: (byLayout.get(layout.contract) ?? []).map((page) => ({
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
  }))

  // host-level policy lives at the top of the tree rather than inside one
  // privileged layout contract: the origin goes to the home page when there
  // is one, and anything unmatched — including a route that vanished when
  // the viewer's permissions changed — lands on one not-found screen
  return [
    ...routes,
    { index: true, element: homePath ? <Navigate to={homePath} replace /> : slots.empty },
    { path: '*', element: slots.notFound },
  ]
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
