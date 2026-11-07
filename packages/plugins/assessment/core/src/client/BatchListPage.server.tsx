import { Schema } from 'effect'
import { pageNumber } from '@qualy/api-kit/schema'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { isSessionRefusal, serverQueries, settle } from '@qualy/web-rsc/queries'
import { batchListQuery } from '../api.ts'
import { assessmentApi } from './api.ts'
import { batchListRead, batchStandingRead, batchStatusOf } from './batch-list-reads.ts'

export { default } from './BatchListPage.tsx'

const validQuery = Schema.is(batchListQuery)

export const prefetch: SurfacePrefetch = async ({ url }) => {
  const query = url.searchParams
  const list = batchListRead(
    query.get('q') ?? '',
    batchStatusOf(query.get('status')),
    pageNumber(query.get('page') ?? undefined),
  )
  // A malformed address stays a page the browser can edit, with its own
  // query error, instead of aborting the whole document during prefetch.
  if (!validQuery(list.query)) return undefined
  const [batches, standing] = await Promise.all([
    readApiExit(assessmentApi, (client) => client.assessment.listBatches(list)),
    readApiExit(assessmentApi, (client) => client.assessment.listMyStanding(batchStandingRead)),
  ])
  const queries = serverQueries()
  for (const [key, read] of [
    [queryKeyOf('assessment', 'listBatches', list), settle(batches)],
    [queryKeyOf('assessment', 'listMyStanding', batchStandingRead), settle(standing)],
  ] as const) {
    if (read.kind === 'answer') queries.hold(key, read.value)
    else if (read.kind === 'refused' && !isSessionRefusal(read.error)) {
      queries.holdRefusal(key, read.error)
    }
  }
  return { hydration: queries.dehydrated() }
}
