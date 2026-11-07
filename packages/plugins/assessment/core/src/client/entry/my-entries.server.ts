import { Exit } from 'effect'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit } from '@qualy/web-rsc/request'
import { assessmentApi } from '../api.ts'
import { everyPage, WHOLE_LIST_PAGE } from '../every-page.ts'

// The reader's own filings in one round, every one of them, read on the
// server as the page's own query reads them (my-entries.ts): the same
// pages, joined the same way, under the same key - so the page finds the
// whole list it would have walked itself.

export const readMyEntries = (batchId: string) => {
  const key = queryKeyOf('assessment', 'listMyEntries', { params: { batchId }, query: {} })
  const exit = (async (): Promise<Exit.Exit<unknown, unknown>> => {
    // the page that did not end in an answer, which the whole list ends as
    let ended: Exit.Exit<unknown, unknown> | undefined
    try {
      const all = await everyPage(
        async (cursor) => {
          const page = await readApiExit(assessmentApi, (client) =>
            client.assessment.listMyEntries({
              params: { batchId },
              query: { limit: WHOLE_LIST_PAGE, ...(cursor === undefined ? {} : { cursor }) },
            }),
          )
          if (Exit.isSuccess(page)) return page.value
          ended = page
          throw new Error('a page of filings ended without an answer')
        },
        (page) => page.entries,
        (first, entries) => ({ ...first, entries, nextCursor: null }),
      )
      return Exit.succeed(all)
    } catch (error) {
      if (ended !== undefined) return ended
      throw error
    }
  })()
  return { key, exit }
}
