import { MAX_PAGE_SIZE } from '@qualy/api-kit'

/** the largest page the api hands out, so a whole list costs the fewest trips */
export const WHOLE_LIST_PAGE = String(MAX_PAGE_SIZE)

/**
 * Every page of one keyset list, read in turn and joined into the first
 * page's shape with no next cursor left.
 *
 * For the lists a screen has to hold whole because it counts, groups,
 * searches or resolves an address against them: a person's own filings in
 * a round, a reviewer's queue. Their size is bounded by the round, not by
 * time, and a screen that drew only the first page would be answering for
 * the oldest rows as if they were all of them.
 *
 * A cursor the server hands back twice ends the walk rather than looping on
 * it; everything else about the page (its counts, its gates) is the first
 * page's, which every page repeats.
 */
export async function everyPage<Page extends { readonly nextCursor: string | null }, Row>(
  read: (cursor: string | undefined) => Promise<Page>,
  rowsOf: (page: Page) => readonly Row[],
  join: (first: Page, rows: Row[]) => Page,
  signal?: AbortSignal,
): Promise<Page> {
  const first = await read(undefined)
  const rows = [...rowsOf(first)]
  const walked = new Set<string>()
  let cursor = first.nextCursor
  while (cursor !== null && !walked.has(cursor)) {
    signal?.throwIfAborted()
    walked.add(cursor)
    const next = await read(cursor)
    rows.push(...rowsOf(next))
    cursor = next.nextCursor
  }
  return join(first, rows)
}
