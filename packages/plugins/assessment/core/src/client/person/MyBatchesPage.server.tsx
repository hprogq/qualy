import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { readApiExit, renderRequest } from '@qualy/web-rsc/request'
import { answersOf } from '@qualy/web-rsc/queries'
import { assessmentApi } from '../api.ts'
import { MEMBERSHIPS_PAGE, membershipPageKey, membershipPageOf } from './membership-reads.ts'
import MyBatchesPage from './MyBatchesPage.tsx'

// The reader's rounds as a server draws them (docs/adr/0012-rsc-data-mode.md):
// the page of them the address names, read as the reader and handed to the
// list, which goes on paging through them itself.

export default async function MyBatches() {
  const page = membershipPageOf(renderRequest().url.searchParams.get(MEMBERSHIPS_PAGE))
  const key = membershipPageKey(queryKeyOf('assessment', 'listMyBatches', { query: {} }), page)
  const handed = await answersOf([
    {
      key,
      exit: readApiExit(
        assessmentApi,
        (client) => client.assessment.listMyBatches({ query: { page: String(page) } }),
        { key },
      ),
    },
  ])
  return (
    <QueryHydration {...handed}>
      <MyBatchesPage />
    </QueryHydration>
  )
}
