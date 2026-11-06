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
import { loadSurface, renderRequest } from './request.ts'

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

const pageHref = (page: Page, next: string) =>
  `${page.path}?${new URLSearchParams({ next }).toString()}`

/** one surface the manifest named, drawn in its frame, or said to be missing */
const surfaceRoute = (surface: BrowserSurface, frames: RouteFrames) =>
  async function SurfaceRoute() {
    const Implementation = await loadSurface(surface)
    return (
      <frames.Surface surface={surface}>
        {Implementation === undefined ? <frames.Missing surface={surface} /> : <Implementation />}
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

  return [
    {
      id: 'qualy:document',
      path: '',
      Component: async function DocumentRoute() {
        return (
          <frames.Document
            manifest={manifest}
            slots={await authorizedSlots(manifest)}
            locale={renderRequest().locale}
            releaseId={renderRequest().release.releaseId}
          >
            <Outlet />
          </frames.Document>
        )
      },
      children: shell === undefined ? [...layouts, index, catchAll] : layouts,
    },
  ]
}
