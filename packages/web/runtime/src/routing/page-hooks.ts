import { useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { NamespacedId } from '@qualy/ui-contract'
import { buildPageHref, type PageHrefOptions } from './pages.ts'
import { useManifest } from '../runtime-context.tsx'

// the manifest entry for a page reference, or undefined when the viewer
// cannot see it in this deployment. In development a path that disagrees
// with the shared reference is a loud failure: it means the server and the
// browser bundle were built from different sources.
// development-only diagnostics: the bundler replaces this at build time and
// the guard keeps the package free of both node and vite typings
declare const process: { env?: Record<string, string | undefined> } | undefined
const isDev = () => typeof process === 'undefined' || process.env?.['NODE_ENV'] !== 'production'

// The url of a page, or undefined when it is not part of this manifest.
// Client code names a page by id; the path is the manifest's alone, so a
// browser bundle can never disagree with the server about where a page is.
// navigate by naming a page instead of repeating its path; navigating to a
// page the viewer cannot see is a bug, so it fails loudly in development
// and does nothing in production rather than landing on a dead route
export function usePageNavigate() {
  const navigate = useNavigate()
  const manifest = useManifest()
  return useCallback(
    (page: NamespacedId, options: PageHrefOptions & { replace?: boolean } = {}) => {
      const entry = manifest.pages.find((candidate) => candidate.id === page)
      if (!entry) {
        const message = `cannot navigate to ${page}: not visible in the current manifest`
        if (isDev()) throw new Error(message)
        console.error(`[qualy] ${message}`)
        return
      }
      void navigate(buildPageHref(entry, options), { replace: options.replace })
    },
    [navigate, manifest],
  )
}

// One piece of screen state that belongs in the address bar: which record is
// selected, what was searched for, which anchor is in view. Keeping it here
// rather than in useState is what makes an administration screen linkable and
// survivable across a reload.
export function usePageQueryState(
  key: string,
  fallback = '',
  options?: {
    /**
     * Whether changing it is somewhere to come back to.
     *
     * A filter is not: nobody presses back expecting the search box to empty
     * one letter at a time. Opening a record is - the reader went somewhere,
     * and back is how anybody leaves.
     */
    history?: 'replace' | 'push'
  },
): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? fallback
  const history = options?.history ?? 'replace'
  const set = useCallback(
    (next: string) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next === '' || next === fallback) updated.delete(key)
          else updated.set(key, next)
          return updated
        },
        { replace: history === 'replace' },
      )
    },
    [key, fallback, history, setParams],
  )
  return [value, set]
}

/**
 * Several address keys written in one navigation.
 *
 * The router's functional updater reads the location the component rendered
 * with, not the result of an earlier call in the same tick - so two
 * usePageQueryState writes from one click race, and the second silently
 * drops the first. A handler that has to move two layers at once - open
 * this question AND start writing a claim on it - says so in one write.
 */
export function usePageQueryUpdate(): (
  changes: Record<string, string>,
  options?: { history?: 'replace' | 'push' },
) => void {
  const [, setParams] = useSearchParams()
  return useCallback(
    (changes, options) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          for (const [key, next] of Object.entries(changes)) {
            if (next === '') updated.delete(key)
            else updated.set(key, next)
          }
          return updated
        },
        { replace: (options?.history ?? 'replace') === 'replace' },
      )
    },
    [setParams],
  )
}

// The named `:name` segments of the route this screen is mounted at. The
// caller says which names it expects, and a missing one is a loud failure:
// a screen quietly reading undefined out of the router is a link bug that
// would otherwise surface as a broken api call three layers later.
export function usePageRouteParams<const Name extends string>(
  ...names: readonly Name[]
): Record<Name, string> {
  const params = useParams()
  const out = {} as Record<Name, string>
  for (const name of names) {
    const value = params[name]
    if (value === undefined) {
      throw new Error(`the current route provides no :${name} parameter`)
    }
    out[name] = value
  }
  return out
}

// items of a collection surface, already authorized and path-resolved by
// the server; the token carries the item type
