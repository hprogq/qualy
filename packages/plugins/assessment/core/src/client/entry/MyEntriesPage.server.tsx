import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { answersOf } from '@qualy/web-rsc/queries'
import { batchIdOf, keyed } from '../batch/batch-reads.server.ts'
import { readMyEntries } from './my-entries.server.ts'
import MyEntriesPage from './MyEntriesPage.tsx'

// The reader's filings as a server draws them (docs/adr/0012-rsc-data-mode.md):
// the questions and how they group, what the round has already granted, and
// every claim the reader filed - read as the reader and handed to the page,
// which goes on keeping them current. What a claim's drawer or the filing
// form opens reads for itself when the reader opens it.

export default async function MyEntries({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return <MyEntriesPage />
  const batch = { params: { batchId } }
  const state = await answersOf([
    keyed('listItems', batch, (client) => client.assessment.listItems(batch)),
    keyed('listScoreGroups', batch, (client) => client.assessment.listScoreGroups(batch)),
    keyed('getMyResult', batch, (client) => client.assessment.getMyResult(batch)),
    readMyEntries(batchId),
  ])
  return (
    <QueryHydration state={state}>
      <MyEntriesPage />
    </QueryHydration>
  )
}
