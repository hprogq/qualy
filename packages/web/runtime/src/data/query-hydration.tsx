'use client'
import { useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  HydrationBoundary,
  hashKey,
  useQueryClient,
  type DehydratedState,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { useHydrating } from '../document/hydrating.ts'
import { sharedContext } from '../shared-context.ts'
import type { Arrival, Coming } from './query-handoff.ts'

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

export const HandedReads = sharedContext<
  ReadonlyMap<string, DehydratedState['queries'][number]['state'] | null>
>('handed-query-reads', new Map())

/** Observer options belong to this response, never to the shared client's defaults. */
export function handedOptions<
  T extends { queryKey?: QueryKey; staleTime?: unknown; retryOnMount?: unknown },
>(options: T, reads: ReadonlyMap<string, unknown>, client: QueryClient): T {
  if (!options.queryKey || !reads.has(hashKey(options.queryKey))) return options
  const defaults = {
    ...client.getDefaultOptions().queries,
    ...client.getQueryDefaults(options.queryKey),
  }
  return {
    ...options,
    ...(options.staleTime === undefined && defaults.staleTime === undefined
      ? { staleTime: HANDED_FRESH_MS }
      : {}),
    ...(options.retryOnMount === undefined && defaults.retryOnMount === undefined
      ? { retryOnMount: false }
      : {}),
  }
}

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
  if (query.state.data !== undefined || query.state.fetchStatus !== 'idle') return () => false
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
      initialPromise: Promise.resolve(arrival).then((landed) => {
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
  return () => {
    if (!active) return false
    active = false
    fallback.abort()
    unsubscribe()
    if (cache.get(query.queryHash) === query) void query.cancel({ revert: true })
    return true
  }
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
  const pending = coming
  const following = useRef(new Map<Promise<Arrival>, Map<string, () => boolean>>())
  const refused = useMemo(() => {
    const cache = client.getQueryCache()
    return state.queries.flatMap((read) => {
      if (read.state.status !== 'error') return []
      const query = cache.get(read.queryHash)
      return query === undefined ? [] : [{ read, query, updates: query.state.dataUpdateCount }]
    })
  }, [client, state])
  useLayoutEffect(() => {
    const cache = client.getQueryCache()
    for (const { read, query, updates } of refused) {
      if (cache.get(read.queryHash) !== query || query.state.dataUpdateCount !== updates) continue
      // A server-side refusal is an authoritative answer for this response.
      // Hydration compares only dataUpdatedAt, which is zero for refusals,
      // and would silently keep a previously successful cache entry.
      void query.cancel({ silent: true })
      query.setState({ ...read.state, data: undefined, fetchStatus: 'idle' })
    }
  }, [client, refused])
  useLayoutEffect(() => {
    let active = true
    const cache = client.getQueryCache()
    for (const [arrival, running] of following.current) {
      for (const [hash, cancel] of running) {
        if (pending.some((read) => read.arrival === arrival && hashKey(read.queryKey) === hash))
          continue
        if (cancel()) checked.current.get(arrival)?.delete(hash)
        running.delete(hash)
      }
      if (running.size === 0) following.current.delete(arrival)
    }
    for (const read of pending) {
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
      if (observed == null) {
        let seen = checked.current.get(read.arrival)
        if (seen === undefined) {
          seen = new Set()
          checked.current.set(read.arrival, seen)
        }
        if (!seen.has(hash)) {
          seen.add(hash)
          let running = following.current.get(read.arrival)
          if (running === undefined) {
            running = new Map()
            following.current.set(read.arrival, running)
          }
          running.set(hash, follow(client, read))
        }
        continue
      }
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
  }, [client, pending])
  useLayoutEffect(
    () => () => {
      for (const [arrival, running] of following.current)
        for (const [hash, cancel] of running)
          if (cancel()) checked.current.get(arrival)?.delete(hash)
      following.current.clear()
    },
    [client],
  )
  const parent = useContext(HandedReads)
  const reads = useMemo(
    () =>
      new Map([
        ...parent,
        ...state.queries.map((read) => [read.queryHash, read.state] as const),
        ...pending.map((read) => [hashKey(read.queryKey), null] as const),
      ]),
    [parent, state, pending],
  )
  return (
    <HandedState value={state}>
      <HandedReads value={reads}>
        <HydrationBoundary state={state}>{children}</HydrationBoundary>
      </HandedReads>
    </HandedState>
  )
}
