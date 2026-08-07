import type { NamespacedId } from '@qualy/ui-contract'

/** what href building needs of a page: the manifest's wire shape suffices */
export interface PageEntry {
  readonly id: string
  readonly path: string
}

// building an internal url from a page entry. Kept free of react so it can
// be unit tested and reused by non-hook call sites. Client code names pages
// by ID and the path comes from the manifest - the descriptor is the only
// place a path is ever written.

export interface PageHrefOptions {
  // values for the page's `:name` segments
  params?: Record<string, string>
  // query string values; undefined entries are omitted, arrays repeat the key
  search?: Record<string, string | number | boolean | undefined | (string | number)[]>
  hash?: string
}

// a missing parameter is a bug in the caller, not a url with a literal
// ":userId" in it, so it fails loudly rather than navigating somewhere wrong
function fillPath(page: PageEntry, params: Record<string, string> | undefined): string {
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

export function buildPageHref(page: PageEntry, options: PageHrefOptions = {}): string {
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
  { kind: 'home' } | { kind: 'page'; page: NamespacedId; params?: Record<string, string> }

/**
 * Resolved against the pages the CURRENT manifest still shows. Signing out
 * navigates before the refetch, so the target has to be a page every
 * manifest carries - the login page is public precisely for this - and an
 * unresolvable destination falls back to home rather than a dead route.
 */
export function sessionDestinationHref(
  destination: SessionDestination,
  pages: readonly PageEntry[],
): string {
  if (destination.kind === 'home') return '/'
  const entry = pages.find((candidate) => candidate.id === destination.page)
  if (!entry) return '/'
  return buildPageHref(entry, { params: destination.params })
}
