import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { answersOf } from '@qualy/web-rsc/queries'
import { batchIdOf, keyed } from '../batch/batch-reads.server.ts'
import ItemSettingsPage from './ItemSettingsPage.tsx'

// The questions of a batch as a server draws them
// (docs/adr/0012-rsc-data-mode.md): the groups, the questions, what a
// question may be set to and the review alerts beside them, read as the
// page reads them and handed to it; a reader the batch refuses them to is
// refused by the page's own reads, as before.

export default async function ItemSettings({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return <ItemSettingsPage />
  const batch = { params: { batchId } }
  const handed = await answersOf([
    keyed('listScoreGroups', batch, (client) => client.assessment.listScoreGroups(batch)),
    keyed('listItems', batch, (client) => client.assessment.listItems(batch)),
    keyed('itemOptions', batch, (client) => client.assessment.itemOptions(batch)),
    keyed('reviewAlerts', batch, (client) => client.assessment.reviewAlerts(batch)),
  ])
  return (
    <QueryHydration {...handed}>
      <ItemSettingsPage />
    </QueryHydration>
  )
}
