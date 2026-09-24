import { useEffect, useMemo, type ReactNode } from 'react'
import { matchPath, Navigate, useLocation, useRoutes, type RouteObject } from 'react-router'
import type { BrowserSurface, NamespacedId } from '@qualy/ui-contract'
import { useI18n } from '@qualy/web-i18n'
import { setObservedPage } from '@qualy/browser-observability'
import type { Manifest } from './runtime-context.tsx'
import type { ComponentRegistry } from './registry.ts'
import { buildPageHref, type PageEntry } from './pages.ts'
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
  /** the surface the manifest named and this build does not carry */
  componentMissing: (surface: BrowserSurface) => ReactNode
  /**
   * the screen for an address that leads nowhere, told the way home as the
   * builder resolved it - the host's preferred page when that is routable,
   * else the first routable one - and whether it stands in a shell or alone
   */
  notFound: (context: { homePath?: string; standalone: boolean }) => ReactNode
  empty: ReactNode
}

export interface RouteBuilderOptions {
  manifest: Manifest
  registry: ComponentRegistry
  // the page the bare origin redirects to, resolved from the manifest by the
  // host (normally the first visible primary navigation entry)
  homePath?: string
  /**
   * the page an anonymous viewer signs in at, by id. An address an anonymous
   * manifest cannot place is sent there, told where it was, rather than
   * called missing: it may be a page only a session shows.
   */
  signInPage?: NamespacedId
  slots: RouteSlots
}

/** to the sign-in page, carrying the address that could not be placed */
function SignInFirst({ page }: { page: PageEntry }) {
  const location = useLocation()
  const next = `${location.pathname}${location.search}${location.hash}`
  return <Navigate to={buildPageHref(page, { search: { next } })} replace />
}

export function buildManifestRoutes({
  manifest,
  registry,
  homePath,
  signInPage,
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
  // Unplaceable, for somebody the server did not recognise, is not the same
  // answer as for somebody it did. Anonymous, the address may well be a page
  // a session shows - one that went away with an expired session - so it is
  // sign in first, for every such address alike: real, forbidden or never
  // there, nothing tells them apart. Only an identity that is known and
  // still cannot place it is told the page cannot be opened.
  const signIn =
    manifest.viewer === 'anonymous' && signInPage !== undefined
      ? routable.find((page) => page.id === signInPage)
      : undefined
  const catchAll: RouteObject = {
    path: '*',
    element:
      signIn !== undefined ? (
        <SignInFirst page={signIn} />
      ) : (
        slots.notFound({ homePath: home?.path, standalone: shell === undefined })
      ),
  }

  const routes: RouteObject[] = manifest.layouts.map((layout) => {
    const shellSurface: BrowserSurface = { kind: 'layout', id: layout.contract }
    return {
      element: (
        <PluginComponent
          surface={shellSurface}
          registry={registry}
          loading={slots.layoutLoading}
          fallback={slots.layoutError}
          missing={slots.componentMissing(shellSurface)}
        />
      ),
      children: [
        ...(byLayout.get(layout.contract) ?? []).map((page) => {
          const surface: BrowserSurface = { kind: 'page', id: page.id }
          return {
            path: page.path,
            element: (
              <PluginComponent
                surface={surface}
                registry={registry}
                loading={slots.pageLoading}
                fallback={slots.pageError}
                missing={slots.componentMissing(surface)}
              />
            ),
          }
        }),
        // exactly one layout carries them, or the tree would be ambiguous
        ...(layout.contract === shell ? [index, catchAll] : []),
      ],
    }
  })

  return shell === undefined ? [...routes, index, catchAll] : routes
}

export function ManifestRoutes(options: RouteBuilderOptions) {
  const { manifest, registry, homePath, signInPage, slots } = options
  const routes = useMemo(
    () =>
      buildManifestRoutes({
        manifest,
        registry,
        slots,
        ...(homePath === undefined ? {} : { homePath }),
        ...(signInPage === undefined ? {} : { signInPage }),
      }),
    // slots carry localized copy, so a locale switch must rebuild them too;
    // the host memoizes the slot object so this stays cheap
    [manifest, registry, homePath, signInPage, slots],
  )
  return (
    <>
      <DocumentTitle pages={options.manifest.pages} />
      <ObservedRoute pages={options.manifest.pages} />
      {useRoutes(routes)}
    </>
  )
}

/**
 * Which screen a browser failure happened on, named the way the manifest
 * names it.
 *
 * A reporting platform must never be told the real address. `/assessment/
 * batches/019a.../review?student=...` identifies a batch and a person and
 * groups into an issue nobody can read; `assessment/review` with its route
 * template identifies a screen, which is the thing anybody would actually
 * ask about. Both come from the authorized manifest, so a page a viewer may
 * not see never names itself here either.
 *
 * Beside `DocumentTitle` and matching the same way on purpose: the two
 * answer the same question - which page is this - and a second way of
 * deciding it would eventually disagree with the first.
 */
function ObservedRoute({ pages }: { pages: Manifest['pages'] }) {
  const { pathname } = useLocation()
  const page = pages.find((candidate) => matchPath({ path: candidate.path, end: true }, pathname))
  const pageId = page?.id
  const route = page?.path
  useEffect(() => {
    setObservedPage(pageId === undefined || route === undefined ? {} : { pageId, route })
  }, [pageId, route])
  return null
}

// Whatever index.html called the product, kept as the suffix every page
// hangs off. Read once, before anything has changed it.
const PRODUCT = typeof document === 'undefined' ? '' : document.title

/**
 * What the browser tab, the history entry and a bookmark call this page.
 *
 * The manifest already carries the words - a page's own title, or the ones
 * its menu entry uses - so the title follows the same authorized projection
 * as everything else, and a page nobody may see never names itself. Pages
 * without either keep the product's own name rather than inventing one from
 * the address.
 */
function DocumentTitle({ pages }: { pages: Manifest['pages'] }) {
  const { pathname } = useLocation()
  const { formatText } = useI18n()
  const named = pages.find(
    (page) => page.title !== undefined && matchPath({ path: page.path, end: true }, pathname),
  )
  const title = named?.title
  useEffect(() => {
    document.title = title === undefined ? PRODUCT : `${formatText(title)} - ${PRODUCT}`
  }, [title, formatText])
  return null
}
