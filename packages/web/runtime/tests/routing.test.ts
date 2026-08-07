import { definePage } from '@qualy/ui-contract'
import { describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { buildPageHref, sessionDestinationHref } from '../src/pages.ts'

// url construction from a page reference: the one place a path becomes a
// string, so its encoding rules are pinned here
describe('page hrefs', () => {
  const page = definePage({ id: 'demo/page', path: '/admin/demo' })

  it('builds a plain path when there is nothing to add', () => {
    expect(buildPageHref(page)).toBe('/admin/demo')
    expect(buildPageHref(page, {})).toBe('/admin/demo')
  })

  it('encodes search values and omits undefined ones', () => {
    expect(buildPageHref(page, { search: { method: 'local', page: 2, active: true } })).toBe(
      '/admin/demo?method=local&page=2&active=true',
    )
    // an absent value contributes no key at all
    expect(buildPageHref(page, { search: { method: undefined } })).toBe('/admin/demo')
    // reserved characters survive a round trip
    const href = buildPageHref(page, { search: { q: 'a b&c=d' } })
    expect(href).toBe('/admin/demo?q=a+b%26c%3Dd')
    expect(new URL(href, 'https://x.invalid').searchParams.get('q')).toBe('a b&c=d')
  })

  it('repeats a key for array values', () => {
    const href = buildPageHref(page, { search: { tag: ['a', 'b'] } })
    expect(href).toBe('/admin/demo?tag=a&tag=b')
    expect(new URL(href, 'https://x.invalid').searchParams.getAll('tag')).toEqual(['a', 'b'])
  })

  it('appends a hash last', () => {
    expect(buildPageHref(page, { search: { a: 1 }, hash: 'section' })).toBe(
      '/admin/demo?a=1#section',
    )
  })
})

// the regression this pins: signing in used to leave the browser on the
// login page, because a transition without a destination navigated nowhere
describe('session transitions', () => {
  const pages = [{ id: 'auth/login', path: '/login' }]

  it('always resolves a destination to navigate to', () => {
    // signing in goes to the host root, which picks the first page the new
    // manifest actually authorizes
    expect(sessionDestinationHref({ kind: 'home' }, pages)).toBe('/')
    // signing out names the login page by id; the path is the manifest's
    expect(sessionDestinationHref({ kind: 'page', page: 'auth/login' }, pages)).toBe('/login')
    // a destination the current manifest cannot resolve falls back to home
    expect(sessionDestinationHref({ kind: 'page', page: 'auth/gone' }, pages)).toBe('/')
  })

  // This used to assert only that the cache was emptied, which the previous
  // implementation did, while the mounted manifest query went on answering
  // with the signed-out projection, so a fresh administrator saw one page.
  // Emptying is half the job; the other half is that the observers notice.
  it('drops the previous identity data and refetches under the new one', async () => {
    let identity = 'anonymous'
    let fetches = 0
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // what a mounted useQuery is: an observer subscribed to the cache
    const manifest = new QueryObserver(queryClient, {
      queryKey: ['app', 'manifest'],
      queryFn: async () => {
        fetches += 1
        return identity
      },
    })
    manifest.subscribe(() => {})
    queryClient.setQueryData(['org', 'tree'], { nodes: ['from the previous user'] })
    await settle()
    expect(manifest.getCurrentResult().data).toBe('anonymous')

    identity = 'administrator'
    await queryClient.resetQueries()
    queryClient.removeQueries({ type: 'inactive' })
    await settle()

    // the signed-out page set is gone from the screen, not merely from a map
    expect(manifest.getCurrentResult().data).toBe('administrator')
    expect(fetches).toBe(2)
    // nothing of the previous identity is left behind: asserting only that
    // the data reads undefined cannot tell an emptied entry from a removed
    // one, and reset alone leaves the emptied entries there for the life of
    // the tab because it clears their collection timers
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([['app', 'manifest']])
    manifest.destroy()
  })
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
