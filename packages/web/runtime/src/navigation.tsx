import {
  useCallback,
  useEffect,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { NamespacedId } from '@qualy/ui-contract'
import { useRuntime } from './runtime-context.tsx'

// What a link in the shell knows about the navigation it started.
//
// The router moves in a transition: the page that is open stays up until
// the next one's code has arrived, rather than the whole area collapsing to
// a spinner for the length of a chunk download. Right, and useless on its
// own: the address does not change until the transition commits, so
// nothing the address drives - the lit entry, the title - moves either,
// and on a slow network a press looks like a press that missed. The
// transition is therefore started here, where the press happened, so the
// element that was pressed can say it heard: lit at once, marked busy
// after a beat, both for exactly as long as the transition takes.
//
// A plain left click only. A modified click, a middle click and a link
// with a target are the browser's - a new tab has no transition to show.

/** how long a navigation may take before the element that started it says so */
export const PENDING_INDICATOR_AFTER = 150

export interface PendingNavigation {
  /** the navigation this element started has not committed yet */
  readonly pending: boolean
  /** pending for longer than a beat: time to show it */
  readonly indicating: boolean
  /** the click handler, for an anchor that already carries the href */
  readonly onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void
}

const plainLeftClick = (event: ReactMouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  (event.currentTarget.target === '' || event.currentTarget.target === '_self')

export function usePendingNavigation(to: string): PendingNavigation {
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, startTransition] = useTransition()
  const [indicating, setIndicating] = useState(false)

  useEffect(() => {
    if (!pending) {
      setIndicating(false)
      return
    }
    const timer = setTimeout(() => setIndicating(true), PENDING_INDICATOR_AFTER)
    return () => clearTimeout(timer)
  }, [pending])

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || !plainLeftClick(event)) return
      event.preventDefault()
      // one press is one navigation: a second press while the first is on
      // its way would only queue the same move again
      if (pending) return
      // pressing the entry that is already open replaces rather than pushes,
      // as the router's own link does, so back still leaves the page
      const here = `${location.pathname}${location.search}${location.hash}`
      startTransition(() => {
        void navigate(to, { replace: here === to })
      })
    },
    [pending, location, navigate, to, startTransition],
  )

  return { pending, indicating, onClick }
}

/**
 * Fetches a page's code before anybody asks for the page.
 *
 * The registry's components are `preloadable`: fetched once, then handed
 * over on the spot with no fallback. Prefetching turns a press that would
 * have waited for a chunk into a press that waits for nothing, which is the
 * only real cure for the wait above. A page the manifest does not carry,
 * or a page this build has no renderer for, is silently nothing to fetch.
 */
export function usePagePrefetch(): (page: NamespacedId) => void {
  const { manifest, registry } = useRuntime()
  return useCallback(
    (page: NamespacedId) => {
      const entry = manifest.pages.find((candidate) => candidate.id === page)
      if (entry === undefined) return
      void registry.pages[entry.id]?.preload?.()
    },
    [manifest, registry],
  )
}

/**
 * Fetches these pages' code once the browser has nothing better to do.
 *
 * For the pages a shell lists beside the one that is open: after the shell
 * has painted, their chunks arrive in the background, so the next press
 * finds its code already here. Not before the open page has what it asked
 * for: an idle main thread is not an idle network, and on a slow link the
 * neighbours' code - a few hundred kilobytes - went out beside the page's
 * own reads and held one of them up by most of a second, measured on a
 * throttled batch overview. So the wait starts once no query is in flight,
 * and is then idle time when the browser offers it, a short delay where it
 * does not.
 */
export function useIdlePagePrefetch(pages: readonly NamespacedId[]): void {
  const prefetch = usePagePrefetch()
  const queryClient = useQueryClient()
  // the list is rebuilt every render; what matters is which pages it names
  const key = pages.join('\n')
  useEffect(() => {
    const ids = key === '' ? [] : (key.split('\n') as NamespacedId[])
    if (ids.length === 0) return
    const run = () => {
      for (const id of ids) prefetch(id)
    }
    let cancel = () => {}
    const schedule = () => {
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(run, { timeout: 2000 })
        cancel = () => cancelIdleCallback(handle)
      } else {
        const timer = setTimeout(run, 200)
        cancel = () => clearTimeout(timer)
      }
    }
    if (queryClient.isFetching() === 0) {
      schedule()
      return () => cancel()
    }
    // Watched from the cache rather than through a hook: the shell that asks
    // is the whole rail, and drawing it again at every read the page starts
    // and ends is a cost the prefetch has no business adding.
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (queryClient.isFetching() > 0) return
      unsubscribe()
      schedule()
    })
    return () => {
      unsubscribe()
      cancel()
    }
  }, [key, prefetch, queryClient])
}
