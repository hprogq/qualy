import { describe, expect, it } from 'vitest'
import { matchRoutes } from 'react-router'
import { buildManifestRoutes } from '../src/route-builder.tsx'
import type { Manifest } from '../src/index.tsx'
import type { RouteSlots } from '../src/route-builder.tsx'

// The route tree is the projection of an authorized manifest, so its rules
// are asserted here rather than in a browser: which pages hang under which
// shell, where the origin goes, and — the part that regressed — that the
// screens for "nothing here" are inside a shell rather than floating above
// the whole tree with no navigation and no way back.

// sentinels rather than the host's real copy: this pins the shape of the
// tree, not the wording, which is the i18n catalog's business
const slots: RouteSlots = {
  pageLoading: 'page-loading',
  layoutLoading: 'layout-loading',
  pageError: () => 'page-error',
  layoutError: () => 'layout-error',
  componentMissing: (id) => `missing:${id}`,
  notFound: 'NOT_FOUND',
  empty: 'EMPTY',
}

const ADMIN = 'admin-shell/v1'
const BLANK = 'blank-shell/v1'

const manifest = (pages: Manifest['pages'], layouts = [ADMIN, BLANK]): Manifest => ({
  layouts: layouts.map((contract) => ({
    contract,
    provider: 'layout-default/provider',
    component: `layout-default/${contract}`,
  })),
  pages,
  collections: {},
  slots: {},
})

const page = (id: string, path: string, layout = ADMIN): Manifest['pages'][number] => ({
  id,
  path,
  layout,
  component: `${id}/Component`,
})

// what the router would actually render for a url, innermost element last
const render = (routes: ReturnType<typeof buildManifestRoutes>, url: string) =>
  matchRoutes(routes, url)?.map((match) => match.route.element)

describe('manifest route projection', () => {
  const pages = [page('ping/page', '/ping'), page('auth/login', '/login', BLANK)]

  it('groups pages under the layout contract each one names', () => {
    const routes = buildManifestRoutes({ manifest: manifest(pages), registry: {}, slots })
    const paths = routes.map((route) => route.children?.map((child) => child.path))
    expect(paths).toEqual([['/ping', undefined, '*'], ['/login']])
  })

  it('drops a page whose layout contract nobody provides', () => {
    const orphan = [page('ping/page', '/ping'), page('ghost/page', '/ghost', 'ghost-shell/v1')]
    const routes = buildManifestRoutes({ manifest: manifest(orphan, [ADMIN]), registry: {}, slots })
    expect(routes.flatMap((route) => route.children ?? []).map((child) => child.path)).toEqual([
      '/ping',
      undefined,
      '*',
    ])
  })

  it('renders the not-found screen inside the shell the home page lives in', () => {
    const routes = buildManifestRoutes({
      manifest: manifest(pages),
      registry: {},
      homePath: '/ping',
      slots,
    })
    // a layout matched first, the not-found screen nested within it: a
    // mistyped address keeps the navigation and the header
    expect(render(routes, '/nope/at/all')).toEqual([expect.anything(), 'NOT_FOUND'])
  })

  it('picks the shell of the home page, not of whichever page came first', () => {
    // the login page is listed first and lives in the chrome-less shell; the
    // home page is the one that decides where a stray address lands
    const routes = buildManifestRoutes({
      manifest: manifest([page('auth/login', '/login', BLANK), page('ping/page', '/ping')]),
      registry: {},
      homePath: '/ping',
      slots,
    })
    const matched = matchRoutes(routes, '/nope')
    const admin = routes.find((route) =>
      route.children?.some((child) => child.path === '/ping'),
    )
    expect(matched?.[0]?.route.element).toBe(admin?.element)
    expect(matched?.[1]?.route.element).toBe('NOT_FOUND')
  })

  it('never lets the catch-all outrank a real page in another shell', () => {
    const routes = buildManifestRoutes({
      manifest: manifest([...pages, page('auth/user-detail', '/admin/users/:userId')]),
      registry: {},
      homePath: '/ping',
      slots,
    })
    // the catch-all now lives inside the admin shell, so every page — the
    // one beside it, the one in the other shell, the parameterized one —
    // has to keep winning against it
    expect(matchRoutes(routes, '/ping')?.at(-1)?.route.path).toBe('/ping')
    expect(matchRoutes(routes, '/login')?.at(-1)?.route.path).toBe('/login')
    const detail = matchRoutes(routes, '/admin/users/abc')
    expect(detail?.at(-1)?.route.path).toBe('/admin/users/:userId')
    expect(detail?.at(-1)?.params).toEqual({ userId: 'abc' })
  })

  it('never sends the origin to a page whose layout has no provider', () => {
    // the manifest lists it, but it never becomes a route, so redirecting
    // there would land on the not-found screen by way of a page that read
    // as perfectly available
    const routes = buildManifestRoutes({
      manifest: manifest([page('ghost/page', '/ghost', 'ghost-shell/v1'), ...pages], [ADMIN, BLANK]),
      registry: {},
      homePath: '/ghost',
      slots,
    })
    const landing = matchRoutes(routes, '/')?.at(-1)?.route.element as { props: { to: string } }
    expect(landing.props.to).toBe('/ping')
  })

  it('keeps a catch-all when no layout provider serves the visible pages', () => {
    // the registry drops such pages, so the viewer would otherwise reach a
    // tree with no terminal route at all
    const routes = buildManifestRoutes({
      manifest: manifest([page('ghost/page', '/ghost', 'ghost-shell/v1')], []),
      registry: {},
      slots,
    })
    expect(render(routes, '/ghost')).toEqual(['NOT_FOUND'])
  })

  it('still answers when the viewer can see nothing at all', () => {
    const routes = buildManifestRoutes({ manifest: manifest([], []), registry: {}, slots })
    // no shell exists to nest into, so the screens stand on their own
    expect(render(routes, '/anything')).toEqual(['NOT_FOUND'])
    expect(render(routes, '/')).toEqual(['EMPTY'])
  })

  it('redirects the origin to a page that exists, not to a stale navigation target', () => {
    // the navigation entry outlived the page it named; sending the viewer
    // there would bounce the origin onto the not-found screen
    const routes = buildManifestRoutes({
      manifest: manifest(pages),
      registry: {},
      homePath: '/withdrawn',
      slots,
    })
    const landing = matchRoutes(routes, '/')?.at(-1)?.route.element as { props: { to: string } }
    expect(landing.props.to).toBe('/ping')
  })

  it('sends the origin to the home page when there is one', () => {
    const routes = buildManifestRoutes({
      manifest: manifest(pages),
      registry: {},
      homePath: '/ping',
      slots,
    })
    const matched = matchRoutes(routes, '/')
    expect(matched?.at(-1)?.route.index).toBe(true)
    expect(matched?.at(-1)?.route.element).not.toBe('EMPTY')
  })

  it('mounts exactly one index and one catch-all however many layouts there are', () => {
    const routes = buildManifestRoutes({
      manifest: manifest(pages),
      registry: {},
      homePath: '/ping',
      slots,
    })
    const all = [...routes, ...routes.flatMap((route) => route.children ?? [])]
    expect(all.filter((route) => route.index === true)).toHaveLength(1)
    expect(all.filter((route) => route.path === '*')).toHaveLength(1)
  })
})
