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
// second asking. Held for as long as the reader stays at the address the
// document was drawn for - a reader behind a lazily loaded part of the page
// is taken over well after the rest - and let go when they go elsewhere:
// mounting such a reader again then asks again, as it always did.

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
  const [held] = useState(() => {
    const refused = state.queries
      .filter((query) => query.state.status === 'error')
      .map((query) => query.queryKey)
    for (const key of refused) client.setQueryDefaults(key, { retryOnMount: false })
    return refused
  })
  const here = useLocation().key
  const [drawnAt] = useState(here)
  useEffect(() => {
    if (here === drawnAt) return
    for (const key of held) client.setQueryDefaults(key, {})
  }, [client, held, here, drawnAt])
  return <HydrationBoundary state={state}>{children}</HydrationBoundary>
}
