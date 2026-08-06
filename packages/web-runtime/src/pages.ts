import type { PageRef } from '@qualy/ui-contract'

// building an internal url from a page reference. Kept free of react so it
// can be unit tested and reused by non-hook call sites.

export interface PageHrefOptions {
  // values for the page's `:name` segments
  params?: Record<string, string>
  // query string values; undefined entries are omitted, arrays repeat the key
  search?: Record<string, string | number | boolean | undefined | (string | number)[]>
  hash?: string
}

// a missing parameter is a bug in the caller, not a url with a literal
// ":userId" in it, so it fails loudly rather than navigating somewhere wrong
function fillPath(page: PageRef, params: Record<string, string> | undefined): string {
  if (!page.path.includes(':')) return page.path
  return page.path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      const name = segment.slice(1)
      const value = params?.[name]
      if (value === undefined || value === '') {
        throw new Error(`page ${page.id} needs a value for :${name}`)
      }
      return encodeURIComponent(value)
    })
    .join('/')
}

export function buildPageHref(page: PageRef, options: PageHrefOptions = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options.search ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry))
    } else {
      params.set(key, String(value))
    }
  }
  const query = params.toString()
  const hash = options.hash ? `#${options.hash}` : ''
  return `${fillPath(page, options.params)}${query ? `?${query}` : ''}${hash}`
}

// where the browser lands after an identity change. 'home' is the host's own
// root, which resolves against the new manifest's navigation — the single
// place a literal path is legitimate, and it lives in the runtime rather
// than in any plugin.
export type SessionDestination =
  { kind: 'home' } | { kind: 'page'; page: PageRef; params?: Record<string, string> }

export function sessionDestinationHref(destination: SessionDestination): string {
  return destination.kind === 'home'
    ? '/'
    : buildPageHref(destination.page, { params: destination.params })
}
