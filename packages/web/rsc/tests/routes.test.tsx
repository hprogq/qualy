import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { matchRoutes, RouterContextProvider, type RouteObject } from 'react-router'
import type { Manifest } from '@qualy/web-runtime'
import { serverRoutes, type RouteFrames } from '../src/routes.tsx'
import { withRenderRequest, type RenderRequest } from '../src/request.ts'

const Frame = () => null
const frames: RouteFrames = {
  Html: Frame,
  Document: Frame,
  DocumentError: Frame,
  PageError: Frame,
  LayoutError: Frame,
  Surface: Frame,
  Missing: Frame,
  NotFound: Frame,
  Empty: Frame,
}
const page = (id: string, path: string, layout = 'shell/v1') => ({ id, path, layout })
const pages = [page('probe/home', '/home'), page('auth/login', '/login', 'blank/v1')]
const manifest = (
  entries: Manifest['pages'] = pages,
  layouts = ['shell/v1', 'blank/v1'],
  viewer: Manifest['viewer'] = 'authenticated',
): Manifest => ({
  viewer,
  pages: entries,
  layouts: layouts.map((contract) => ({ contract })),
  slots: {},
  collections: {},
  context: {},
})
const routes = (shown = manifest(), homePath?: string) =>
  serverRoutes({
    manifest: shown,
    frames,
    ...(homePath === undefined ? {} : { homePath }),
    signInPage: 'auth/login',
  })
type Route = ReturnType<typeof routes>[number]
const childrenOf = (route: Route) => ('children' in route ? (route.children ?? []) : [])
const draw = (component: unknown, props: Record<string, unknown> = {}) =>
  (component as (props: Record<string, unknown>) => ReactElement)(props)
const all = (tree: readonly Route[]): Route[] =>
  tree.flatMap((route) => [route, ...all('children' in route ? (route.children ?? []) : [])])
// Matching uses only id, path and nesting. Components may be async in RSC.
const match = (tree: ReturnType<typeof routes>, address: string) =>
  matchRoutes(tree as unknown as RouteObject[], address)!
const last = (tree: ReturnType<typeof routes>, address: string) =>
  all(tree).find((route) => route.id === match(tree, address).at(-1)?.route.id)!
const redirectTo = async (tree: ReturnType<typeof routes>, address: string) => {
  const loader = last(tree, address).loader
  if (typeof loader !== 'function') throw new Error('Expected a redirect loader')
  const response = (await loader({
    request: new Request(`http://localhost${address}`),
    url: new URL(`http://localhost${address}`),
    pattern: '*',
    params: {},
    context: new RouterContextProvider(),
  })) as Response
  return response.headers.get('location')
}

describe('server-owned plugin route assembly', () => {
  it('groups pages under their declared layout and names routes by surface identity', () => {
    const tree = routes()
    expect(
      childrenOf(tree[0]!).map((route) => [route.id, childrenOf(route).map((child) => child.path)]),
    ).toEqual([
      ['layout:shell/v1', ['/home', undefined, '*']],
      ['layout:blank/v1', ['/login']],
    ])
    expect(last(tree, '/home').id).toBe('page:probe/home')
  })

  it('drops pages whose layout has no provider and never chooses them as home', async () => {
    const tree = routes(manifest([page('ghost/page', '/ghost', 'ghost/v1'), ...pages]), '/ghost')
    expect(all(tree).some((route) => route.path === '/ghost')).toBe(false)
    expect(await redirectTo(tree, '/')).toBe('/home')
  })

  it('places an unknown address under the selected home shell', () => {
    const tree = routes(manifest([pages[1]!, pages[0]!]), '/home')
    expect(match(tree, '/not-here').map(({ route }) => route.id)).toEqual([
      'qualy:document',
      'layout:shell/v1',
      'qualy:unplaced',
    ])
  })

  it('keeps real pages and parameterized pages ahead of the fallback', () => {
    const tree = routes(manifest([...pages, page('probe/record', '/records/:id')]))
    for (const address of ['/home', '/login', '/records/123'])
      expect(last(tree, address).id).toMatch(/^page:/)
    expect(match(tree, '/records/123').at(-1)?.params).toEqual({ id: '123' })
  })

  it('sends an unknown anonymous address to sign-in with its original query', async () => {
    const tree = routes(manifest([pages[1]!], ['blank/v1'], 'anonymous'))
    for (const address of ['/home?tab=one', '/not-here']) {
      const redirect = new URL((await redirectTo(tree, address))!, 'http://localhost')
      expect(redirect.pathname).toBe('/login')
      expect(redirect.searchParams.get('next')).toBe(address)
    }
  })

  it.each(['authenticated', 'anonymous'] as const)(
    'keeps a not-found component for %s when there is no sign-in target',
    (viewer) => {
      const tree = routes(manifest([pages[0]!], ['shell/v1'], viewer))
      const element = draw(last(tree, '/nope').Component)
      expect(element.type).toBe(frames.NotFound)
    },
  )

  it('uses a standalone fallback when no visible layout exists', () => {
    const tree = routes(manifest([page('ghost/page', '/ghost', 'ghost/v1')], []))
    const element = draw(last(tree, '/ghost').Component) as ReactElement<{ standalone: boolean }>
    expect(element.type).toBe(frames.NotFound)
    expect(element.props.standalone).toBe(true)
  })

  it('still answers the origin and unknown addresses with an empty manifest', () => {
    const tree = routes(manifest([], []))
    expect(last(tree, '/').Component).toBe(frames.Empty)
    expect(last(tree, '/anything').Component).toBeTypeOf('function')
  })

  it.each(['/home', '/removed'])(
    'redirects the origin to a real home for preferred path %s',
    async (home) => {
      expect(await redirectTo(routes(manifest(), home), '/')).toBe('/home')
    },
  )

  it('defines exactly one origin and fallback for every layout combination', () => {
    const tree = all(routes())
    expect(tree.filter((route) => 'index' in route && route.index)).toHaveLength(1)
    expect(tree.filter((route) => route.path === '*')).toHaveLength(1)
  })

  it('registers document, layout and page error boundaries at the corresponding level', () => {
    const tree = routes()
    expect(tree[0]?.ErrorBoundary).toBe(frames.DocumentError)
    expect(tree[0]?.Layout).toBeTypeOf('function')
    expect(
      childrenOf(tree[0]!).every((layout) => layout.ErrorBoundary === frames.LayoutError),
    ).toBe(true)
    expect(last(tree, '/home').ErrorBoundary).toBe(frames.PageError)
  })

  it('uses the same request-local HTML layout for success and failure', () => {
    const scope: RenderRequest = {
      url: new URL('http://localhost/home'),
      locale: 'en-US',
      renderedAt: 123,
      release: { releaseId: 'release-a', clientProtocol: 5 },
      nonce: 'request-nonce',
      cookie: undefined,
      apiOrigin: 'http://localhost',
      signal: new AbortController().signal,
      surfaces: {
        pageComponents: {},
        layoutComponents: {},
        layoutSlots: {},
        slotComponents: {},
        loginComponents: {},
      },
    }
    const layout = routes(
      manifest([
        { ...page('probe/dynamic', '/:page'), title: 'Other page' },
        { ...pages[0]!, title: 'Home screen' },
      ]),
    )[0]!.Layout!
    const element = withRenderRequest(scope, () => draw(layout, { children: 'failed or healthy' }))
    expect(isValidElement(element)).toBe(true)
    expect(element.type).toBe(frames.Html)
    expect(element.props).toEqual({
      locale: 'en-US',
      releaseId: 'release-a',
      title: 'Home screen',
      nonce: 'request-nonce',
      children: 'failed or healthy',
    })
  })
})
