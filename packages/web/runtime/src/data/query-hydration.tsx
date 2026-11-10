'use client'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  HydrationBoundary,
  hashKey,
  useQueryClient,
  type DehydratedState,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { useHydrating } from '../document/hydrating.ts'
import { sharedContext } from '../shared-context.ts'
import type { Coming } from './query-handoff.ts'

export type { Arrival, Coming } from './query-handoff.ts'

// What a server read on a page's behalf, handed to the page's query cache
// (docs/adr/0012-rsc-data-mode.md).
//
// The answers land under the keys the page reads with (query-key.ts) before
// the page renders, in the server's render and in the browser's alike: the
// html already carries what the page shows, and the page does not ask for it
// again while it is fresh. The browser's cache is the one the page keeps
// across navigations; an answer it already holds that is newer is kept.
//
// A refusal the server held - the subject is not there, or not the
// reader's - is shown as one where it is read, and not asked about again as
// the page takes the html over: a query that failed and has nothing to show
// is otherwise drawn as loading by every reader that mounts it, which would
// make the html a loading screen and the first thing the browser does a
// second asking.
//
// An answer is likewise taken as fresh for a while: the server read it a
// moment ago, and a reader that would otherwise take any answer as stale the
// moment it mounts asked for it again as the page woke - the one read the
// server made for it, made twice. What changes it while the page is open is
// still told the way it always was; the batch's live channel marks it stale.
// A reader that says itself how long an answer stands keeps its own word.
//
// A read the server had not finished when the html went out comes after it,
// down the same response, and is the page's read in the meantime: the page
// draws it as on its way - its own skeleton, the way it always drew a read
// it was waiting on - and does not ask for it again, and it lands where the
// page reads it. A read the server could not answer for the page lands as
// the page's own asking. In the html and in the browser's first frame alike
// it is on its way, whenever it lands, so the two are drawn the same.
//
// All of these are held for as long as the reader stays at the address the
// document was drawn for - a reader behind a lazily loaded part of the page
// is taken over well after the rest - and let go when they go elsewhere:
// mounting such a reader again then asks again, as it always did.

/** how long an answer a server handed over stands before a reader asks again */
const HANDED_FRESH_MS = 30_000

const HandedState = sharedContext<DehydratedState | null>('handed-query-state', null)

/**
 * The response that drew this subtree, not the live cache. A streamed query
 * can land while a descendant is still hydrating. That descendant must draw
 * the response's snapshot once, then subscribe to the already current cache.
 * Null means this response did not hold an answer; undefined means live.
 */
export function useHandedQueryState<T>(key: QueryKey) {
  const hydrating = useHydrating()
  const response = useContext(HandedState)
  if (!hydrating || response === null) return undefined
  const hash = hashKey(key)
  const snapshot = response.queries.find((query) => query.queryHash === hash)?.state
  return snapshot === undefined ? null : { ...snapshot, data: snapshot.data as T | undefined }
}

/**
 * Keep the browser's cache stable until a handoff has committed. This is
 * not a hydration fence for suspended descendants; their first render
 * reads the response snapshot, not the live cache.
 */
let takeOver: () => void = () => {}
const takenOver = new Promise<void>((resolve) => {
  takeOver = resolve
})

/** the page's own asking, for a read the server could not answer for it */
const askedBy = (client: QueryClient, query: Query, signal: AbortSignal) => {
  const ask = query.options.queryFn
  if (typeof ask !== 'function') throw new Error('no reader on the page asks for a handed read')
  return ask({
    client,
    queryKey: query.queryKey,
    meta: query.meta,
    signal,
  })
}

/**
 * A read on its way, made the page's: in flight under its key, so a reader
 * that mounts waits on it rather than asking, ending as the server's read
 * ends. Not for a key the browser already holds or is already asking for.
 */
const follow = (client: QueryClient, { queryKey, arrival }: Coming) => {
  const query = client.getQueryCache().build(client, client.defaultQueryOptions({ queryKey }))
  if (query.state.data !== undefined || query.state.fetchStatus !== 'idle') return
  // invalidateQueries joins a pending initialPromise when no data exists.
  // Remember the invalidation until that fetch settles: Query resets its
  // invalidated bit on success, otherwise losing a live event entirely.
  let invalidated = false
  let active = true
  const fallback = new AbortController()
  const cache = client.getQueryCache()
  const unsubscribe = cache.subscribe((event) => {
    if (event.type === 'removed' && event.query === query) {
      active = false
      fallback.abort()
    }
    if (event.type === 'updated' && event.query === query && event.action.type === 'invalidate') {
      invalidated = true
    }
  })
  void query
    .fetch(undefined, {
      // What crossed from the server is a thenable whose `then` hands back
      // nothing, not a promise; adopted into one first.
      initialPromise: Promise.all([Promise.resolve(arrival), takenOver]).then(([landed]) => {
        if (!active || cache.get(query.queryHash) !== query) {
          throw new Error('handed read was cancelled')
        }
        // A newer local write must not be replaced by the server's late
        // snapshot. If an event preceded the arrival, ask for fresh data
        // instead of presenting an already-known stale snapshot.
        if (query.state.data !== undefined) return query.state.data
        if (
          landed.kind === 'answer' &&
          (!invalidated || typeof query.options.queryFn !== 'function')
        ) {
          return landed.value
        }
        return askedBy(client, query, fallback.signal)
      }),
    })
    .then(() => {
      active = false
      unsubscribe()
      // The in-flight fallback itself can race another event, which Query
      // coalesces while it is invalidated. Revalidate once after it lands.
      // A cleared cache may now belong to a different identity; never touch
      // a replacement query that merely happens to use the same key.
      if (invalidated && cache.get(query.queryHash) === query) {
        void client.invalidateQueries({ queryKey, exact: true })
      }
    })
    .catch(() => {
      active = false
      fallback.abort()
      unsubscribe()
    })
}

export function QueryHydration({
  state,
  coming = [],
  children,
}: {
  state: DehydratedState
  /** the reads that followed the html (@qualy/web-rsc/queries `answersOf`) */
  coming?: readonly Coming[]
  children: ReactNode
}) {
  const client = useQueryClient()
  const checked = useRef(new WeakMap<object, Set<string>>())
  const warm = useRef(new WeakMap<object, Map<string, { query: Query; updates: number } | null>>())
  // set while rendering, before anything under this reads: the html and the
  // browser's first frame are drawn from it
  const [held] = useState(() => [
    ...state.queries.flatMap((query) => {
      if (query.state.status === 'error') {
        client.setQueryDefaults(query.queryKey, { retryOnMount: false })
      } else if (query.state.status === 'success') {
        client.setQueryDefaults(query.queryKey, { staleTime: HANDED_FRESH_MS })
      } else return []
      return [query.queryKey]
    }),
    ...coming.map((read) => {
      // The HTML renderer only draws the pending state. It must not retain
      // a request's cache in a promise that only a browser can resolve.
      if (typeof window !== 'undefined') follow(client, read)
      client.setQueryDefaults(read.queryKey, { staleTime: HANDED_FRESH_MS })
      return read.queryKey
    }),
  ])
  useEffect(() => takeOver(), [])
  useEffect(() => {
    let active = true
    const cache = client.getQueryCache()
    for (const read of coming) {
      const hash = hashKey(read.queryKey)
      let keys = warm.current.get(read.arrival)
      if (keys === undefined) {
        keys = new Map()
        warm.current.set(read.arrival, keys)
      }
      if (!keys.has(hash)) {
        const query = cache.get(hash)
        keys.set(
          hash,
          query?.state.data === undefined ? null : { query, updates: query.state.dataUpdateCount },
        )
      }
      const observed = keys.get(hash)
      if (observed == null) continue
      const { query, updates } = observed
      void Promise.resolve(read.arrival)
        .then(() => {
          if (!active || cache.get(hash) !== query || query.state.dataUpdateCount !== updates)
            return
          let keys = checked.current.get(read.arrival)
          if (keys === undefined) {
            keys = new Set()
            checked.current.set(read.arrival, keys)
          }
          if (keys.has(hash)) return
          keys.add(hash)
          // A streamed answer has no reliable cross-machine timestamp. Do not
          // overwrite the cache with it: re-read under the document's current
          // identity unless a newer local update has already arrived.
          void client.invalidateQueries({ queryKey: read.queryKey, exact: true })
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [client, coming])
  const here = useLocation().key
  const [drawnAt] = useState(here)
  useEffect(() => {
    if (here === drawnAt) return
    for (const key of held) client.setQueryDefaults(key, {})
  }, [client, held, here, drawnAt])
  return (
    <HandedState value={state}>
      <HydrationBoundary state={state}>{children}</HydrationBoundary>
    </HandedState>
  )
}
