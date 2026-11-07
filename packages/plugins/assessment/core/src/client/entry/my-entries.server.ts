import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit } from '@qualy/web-rsc/request'
import { assessmentApi } from '../api.ts'
import { WHOLE_LIST_PAGE } from '../every-page.ts'
import { everyPageExit } from '../every-page.server.ts'

// The reader's own filings in one round, every one of them, read on the
// server as the page's own query reads them (my-entries.ts): the same
// pages, joined the same way, under the same key - so the page finds the
// whole list it would have walked itself.

export const readMyEntries = (batchId: string) => {
  const key = queryKeyOf('assessment', 'listMyEntries', { params: { batchId }, query: {} })
  const exit = everyPageExit(
    (cursor) =>
      readApiExit(assessmentApi, (client) =>
        client.assessment.listMyEntries({
          params: { batchId },
          query: { limit: WHOLE_LIST_PAGE, ...(cursor === undefined ? {} : { cursor }) },
        }),
      ),
    (page) => page.entries,
    (first, entries) => ({ ...first, entries, nextCursor: null }),
  )
  return { key, exit }
}
