import type { ComponentType, ReactNode } from 'react'
import {
  Outlet,
  redirect,
  type unstable_RSCRouteConfig as RSCRouteConfig,
  type unstable_RSCRouteConfigEntry as RSCRouteConfigEntry,
} from 'react-router'
import type { Manifest } from '@qualy/web-runtime'
import { surfaceLabel, type BrowserSurface, type NamespacedId } from '@qualy/ui-contract'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { pageRevalidation } from '@qualy/web-runtime/revalidation'
import type { DehydratedState } from '@tanstack/query-core'
import { loadPrefetch, loadSurface, renderRequest } from './request.ts'

// The authorized manifest as a route tree the server renders
// (docs/adr/0012-rsc-data-mode.md).
//
// The same rules the browser's route builder applies - pages grouped under
// the layout they name, the origin sent home, an address an anonymous
// viewer cannot place sent to sign in first - with every route named by the
// surface it renders, so a route id is a product identity and never a
// module path. What each route renders is chosen here, on the server, from
// the request's own surface table; the browser is handed the result.

/** the host's client components a route is drawn in; each a client reference */
export interface RouteFrames {
  /** the whole document: providers, the html element, and the routes under it */
  readonly Document: ComponentType<{
    readonly manifest: Manifest
    /** every slot item the viewer may see, by slot and item */
    readonly slots: Readonly<Record<string, Readonly<Record<string, ComponentType<any>>>>>
    readonly locale: SupportedLocale
    readonly releaseId: string
    /** the moment the server drew the document, for the clock reads in it */
    readonly renderedAt: number
    /**
     * What the page's server entry read first, for the query cache every
     * surface of the document reads from - layouts and slots as much as the
     * page - before any of them asks
     */
    readonly hydration?: DehydratedState | undefined
    /** the document's script nonce, when its host sends a policy that asks for one */
    readonly nonce?: string | undefined
    readonly children: ReactNode
  }>
  /** one surface, behind its own boundary and suspense */
  readonly Surface: ComponentType<{
    readonly surface: BrowserSurface
    readonly children: ReactNode
  }>
  /** a surface the manifest named and this build does not carry */
  readonly Missing: ComponentType<{ readonly surface: BrowserSurface }>
  /** an address that leads nowhere for a viewer the server recognised */
  readonly NotFound: ComponentType<{ readonly homePath?: string; readonly standalone: boolean }>
  /** a viewer with no page at all */
  readonly Empty: ComponentType
}

export interface ServerRoutesOptions {
  readonly manifest: Manifest
  readonly frames: RouteFrames
  /** the page the bare origin goes to, by path; the first routable page otherwise */
  readonly homePath?: string
  /** where an anonymous viewer signs in, by page id */
  readonly signInPage?: NamespacedId
}

type Page = Manifest['pages'][number]

/** a matched route, as a server component of the route tree is told about it */
interface RouteMatch {
  readonly id: string
  readonly params: Readonly<Record<string, string | undefined>>
}

const pageHref = (page: Page, next: string) =>
  `${page.path}?${new URLSearchParams({ next }).toString()}`

/**
 * One surface the manifest named, drawn in its frame, or said to be missing.
 * Handed its route's params: a page's server entry reads for the address
 * asked for (`params`), and a page drawn in the browser alone ignores them.
 */
const surfaceRoute = (surface: BrowserSurface, frames: RouteFrames) =>
  async function SurfaceRoute({
    params,
  }: {
    params?: Readonly<Record<string, string | undefined>>
  }) {
    const Implementation = await loadSurface(surface)
    return (
      <frames.Surface surface={surface}>
        {Implementation === undefined ? (
          <frames.Missing surface={surface} />
        ) : (
          <Implementation params={params ?? {}} />
        )}
      </frames.Surface>
    )
  }

/**
 * Every slot item the manifest authorizes, by surface label, as references
 * the browser can render. Slots are not declared per page, so the document
 * carries all the viewer may see; narrowing this to what a page renders is a
 * decision the slice measures rather than one it takes.
 */
const authorizedSlots = async (manifest: Manifest) => {
  const found: Record<string, Record<string, ComponentType<any>>> = {}
  await Promise.all(
    Object.entries(manifest.slots).flatMap(([slot, items]) =>
      (items ?? []).map(async (item) => {
        const implementation = await loadSurface({ kind: 'slot', slot, id: item.id })
        if (implementation !== undefined) (found[slot] ??= {})[item.id] = implementation
      }),
    ),
  )
  return found
}

export const serverRoutes = ({
  manifest,
  frames,
  homePath,
  signInPage,
}: ServerRoutesOptions): RSCRouteConfig => {
  const byLayout = new Map<string, Page[]>()
  for (const page of manifest.pages) {
    byLayout.set(page.layout, [...(byLayout.get(page.layout) ?? []), page])
  }
  const provided = new Set(manifest.layouts.map((layout) => layout.contract))
  const routable = manifest.pages.filter((page) => provided.has(page.layout))
  const home = routable.find((page) => page.path === homePath) ?? routable[0]
  const shell = home?.layout

  const index: RSCRouteConfigEntry = home
    ? { id: 'qualy:home', index: true, loader: () => redirect(home.path) }
    : { id: 'qualy:home', index: true, Component: frames.Empty }
  const signIn =
    manifest.viewer === 'anonymous' && signInPage !== undefined
      ? routable.find((page) => page.id === signInPage)
      : undefined
  const catchAll: RSCRouteConfigEntry =
    signIn !== undefined
      ? {
          id: 'qualy:unplaced',
          path: '*',
          loader: ({ request }) => {
            const url = new URL(request.url)
            return redirect(pageHref(signIn, `${url.pathname}${url.search}${url.hash}`))
          },
        }
      : {
          id: 'qualy:unplaced',
          path: '*',
          Component: function Unplaced() {
            return (
              <frames.NotFound
                {...(home === undefined ? {} : { homePath: home.path })}
                standalone={shell === undefined}
              />
            )
          },
        }

  const layouts: RSCRouteConfigEntry[] = manifest.layouts.map((layout) => ({
    id: surfaceLabel({ kind: 'layout', id: layout.contract }),
    Component: surfaceRoute({ kind: 'layout', id: layout.contract }, frames),
    shouldRevalidate: pageRevalidation,
    children: [
      ...(byLayout.get(layout.contract) ?? []).map((page): RSCRouteConfigEntry => ({
        id: surfaceLabel({ kind: 'page', id: page.id }),
        path: page.path,
        Component: surfaceRoute({ kind: 'page', id: page.id }, frames),
        shouldRevalidate: pageRevalidation,
      })),
      ...(layout.contract === shell ? [index, catchAll] : []),
    ],
  }))

  // which page a matched route draws, by the route's id
  const pageOfRoute = new Map(
    routable.map((page) => [surfaceLabel({ kind: 'page', id: page.id }), page] as const),
  )
  /**
   * What the matched page reads first, read before the document is drawn:
   * the page is not the first to ask - the layout's bar over it reads the
   * same subject - so the answers go to the top of the document, where
   * every surface finds them before it asks.
   */
  const firstReads = async (
    matches: readonly RouteMatch[],
  ): Promise<DehydratedState | undefined> => {
    const match = matches.findLast((candidate) => pageOfRoute.has(candidate.id))
    const page = match === undefined ? undefined : pageOfRoute.get(match.id)
    if (match === undefined || page === undefined) return undefined
    const prefetch = await loadPrefetch({ kind: 'page', id: page.id })
    return prefetch?.({ params: match.params, url: renderRequest().url })
  }

  return [
    {
      id: 'qualy:document',
      path: '',
      shouldRevalidate: pageRevalidation,
      Component: async function DocumentRoute({
        matches = [],
      }: {
        matches?: readonly RouteMatch[]
      }) {
        const [slots, hydration] = await Promise.all([
          authorizedSlots(manifest),
          firstReads(matches),
        ])
        return (
          <frames.Document
            manifest={manifest}
            slots={slots}
            hydration={hydration}
            locale={renderRequest().locale}
            releaseId={renderRequest().release.releaseId}
            renderedAt={renderRequest().renderedAt}
            nonce={renderRequest().nonce}
          >
            <Outlet />
          </frames.Document>
        )
      },
      children: shell === undefined ? [...layouts, index, catchAll] : layouts,
    },
  ]
}
