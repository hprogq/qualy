import type { ComponentType, ReactNode } from 'react'
import {
  Outlet,
  redirect,
  type unstable_RSCRouteConfig as RSCRouteConfig,
  type unstable_RSCRouteConfigEntry as RSCRouteConfigEntry,
} from 'react-router'
import type { Manifest } from '@qualy/web-runtime'
import {
  surfaceLabel,
  type BrowserSurface,
  type NamespacedId,
  type SlotSurface,
} from '@qualy/ui-contract'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { pageRevalidation } from '@qualy/web-runtime/revalidation'
import { SurfaceScope } from '@qualy/web-runtime/surface-scope'
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
    /** authorized slot items declared by the current layout */
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
    readonly initialWorkspaceCapabilities?: readonly string[] | undefined
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

const authorizedSlots = async (manifest: Manifest, references: readonly SlotSurface[]) => {
  const found: Record<string, Record<string, ComponentType<any>>> = {}
  await Promise.all(
    references.map(async (surface) => {
      const { slot, id } = surface
      if (!manifest.slots[slot]?.some((item) => item.id === id)) return
      const implementation = await loadSurface(surface)
      if (implementation !== undefined) (found[slot] ??= {})[id] = implementation
    }),
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
  const firstReads = async (matches: readonly RouteMatch[], slotKeys: readonly string[]) => {
    const match = matches.findLast((candidate) => pageOfRoute.has(candidate.id))
    const page = match === undefined ? undefined : pageOfRoute.get(match.id)
    const { url } = renderRequest()
    const address = { params: match?.params ?? {}, url, manifest }
    const slotReads = slotKeys.flatMap((slot) =>
      (manifest.slots[slot] ?? []).map(async ({ id }) => {
        const prefetch = await loadPrefetch({ kind: 'slot', slot, id })
        return prefetch?.(address)
      }),
    )
    const [fromPage, ...fromSlots] = await Promise.all([
      page === undefined
        ? undefined
        : loadPrefetch({ kind: 'page', id: page.id }).then((prefetch) => prefetch?.(address)),
      ...slotReads,
    ])
    const states = [fromPage, ...fromSlots].flatMap((result) =>
      result === undefined ? [] : [result.hydration],
    )
    return {
      hydration:
        states.length === 0
          ? undefined
          : {
              queries: states.flatMap((state) => state.queries),
              mutations: states.flatMap((state) => state.mutations),
            },
      // who the reader is in the open workspace, from whichever surface
      // prepares the workspace - its bar, usually - rather than from
      // whichever page happens to be open under it
      workspaceCapabilities: [fromPage, ...fromSlots].find(
        (result) => result?.workspaceCapabilities !== undefined,
      )?.workspaceCapabilities,
      slotReferences: fromPage?.slotReferences ?? [],
    }
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
        const layout = manifest.layouts.find(({ contract }) =>
          matches.some(({ id }) => id === surfaceLabel({ kind: 'layout', id: contract })),
        )
        const slotKeys =
          layout === undefined ? [] : (renderRequest().surfaces.layoutSlots[layout.contract] ?? [])
        const layoutReferences = slotKeys.flatMap((slot) =>
          (manifest.slots[slot] ?? []).map(({ id }): SlotSurface => ({ kind: 'slot', slot, id })),
        )
        const [slots, first] = await Promise.all([
          authorizedSlots(manifest, layoutReferences),
          firstReads(matches, slotKeys),
        ])
        const pageSlots = await authorizedSlots(manifest, first.slotReferences)
        return (
          <frames.Document
            manifest={manifest}
            slots={slots}
            hydration={first.hydration}
            initialWorkspaceCapabilities={first.workspaceCapabilities}
            locale={renderRequest().locale}
            releaseId={renderRequest().release.releaseId}
            renderedAt={renderRequest().renderedAt}
            nonce={renderRequest().nonce}
          >
            <SurfaceScope surfaces={{ slots: pageSlots }}>
              <Outlet />
            </SurfaceScope>
          </frames.Document>
        )
      },
      children: shell === undefined ? [...layouts, index, catchAll] : layouts,
    },
  ]
}
