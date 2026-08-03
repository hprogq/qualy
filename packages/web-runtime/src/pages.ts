import type { PageRef } from '@qualy/ui-contract'

// building an internal url from a page reference. Kept free of react so it
// can be unit tested and reused by non-hook call sites.

export interface PageHrefOptions {
  // query string values; undefined entries are omitted, arrays repeat the key
  search?: Record<string, string | number | boolean | undefined | (string | number)[]>
  hash?: string
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
  return `${page.path}${query ? `?${query}` : ''}${hash}`
}
