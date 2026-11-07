'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { HydrationBoundary, useQueryClient, type DehydratedState } from '@tanstack/react-query'
import { useLocation } from 'react-router'

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
// Both are held for as long as the reader stays at the address the
// document was drawn for - a reader behind a lazily loaded part of the page
// is taken over well after the rest - and let go when they go elsewhere:
// mounting such a reader again then asks again, as it always did.

/** how long an answer a server handed over stands before a reader asks again */
const HANDED_FRESH_MS = 30_000

export function QueryHydration({
  state,
  children,
}: {
  state: DehydratedState
  children: ReactNode
}) {
  const client = useQueryClient()
  // set while rendering, before anything under this reads: the html and the
  // browser's first frame are drawn from it
  const [held] = useState(() =>
    state.queries.flatMap((query) => {
      if (query.state.status === 'error') {
        client.setQueryDefaults(query.queryKey, { retryOnMount: false })
      } else if (query.state.status === 'success') {
        client.setQueryDefaults(query.queryKey, { staleTime: HANDED_FRESH_MS })
      } else return []
      return [query.queryKey]
    }),
  )
  const here = useLocation().key
  const [drawnAt] = useState(here)
  useEffect(() => {
    if (here === drawnAt) return
    for (const key of held) client.setQueryDefaults(key, {})
  }, [client, held, here, drawnAt])
  return <HydrationBoundary state={state}>{children}</HydrationBoundary>
}
