import { definePage } from '@qualy/ui-contract'
import { describe, expect, it } from 'vitest'
import { buildPageHref } from '../src/pages.ts'

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
