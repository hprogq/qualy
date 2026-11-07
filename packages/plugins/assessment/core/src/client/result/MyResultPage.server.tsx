import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { answersOf } from '@qualy/web-rsc/queries'
import { batchIdOf, keyed } from '../batch/batch-reads.server.ts'
import { readMyEntries } from '../entry/my-entries.server.ts'
import MyResultPage from './MyResultPage.tsx'

// The reader's account as a server draws it (docs/adr/0012-rsc-data-mode.md):
// the three answers the account is laid out from - the account itself, the
// questions, and every claim the reader filed - read as the reader and
// handed to the page, which goes on keeping them current with the batch's
// live channel. The batch and its stages come with the workspace.

export default async function MyResult({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return <MyResultPage />
  const batch = { params: { batchId } }
  const state = await answersOf([
    keyed('getMyResult', batch, (client) => client.assessment.getMyResult(batch)),
    keyed('listItems', batch, (client) => client.assessment.listItems(batch)),
    readMyEntries(batchId),
  ])
  return (
    <QueryHydration state={state}>
      <MyResultPage />
    </QueryHydration>
  )
}
