import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { answersOf, settle } from '@qualy/web-rsc/queries'
import { batchIdOf, keyed, readBatch } from './batch/batch-reads.server.ts'
import { holdsStanding } from './batch/capabilities.ts'
import BatchPhasesPage from './BatchPhasesPage.tsx'

// The stage plan as a server draws it (docs/adr/0012-rsc-data-mode.md): the
// plan, and the questions and groups a stage's scope names, read for a
// reader the batch says manages it, as the editor reads them, and handed to
// the page, which edits them from there.

export default async function BatchPhases({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return <BatchPhasesPage />
  const subject = settle(await readBatch(batchId).exit)
  if (subject.kind !== 'answer' || !holdsStanding(subject.value.batch.capabilities, 'manage')) {
    return <BatchPhasesPage />
  }
  const batch = { params: { batchId } }
  const handed = await answersOf([
    keyed('getPhases', batch, (client) => client.assessment.getPhases(batch)),
    keyed('listItems', batch, (client) => client.assessment.listItems(batch)),
    keyed('listScoreGroups', batch, (client) => client.assessment.listScoreGroups(batch)),
  ])
  return (
    <QueryHydration {...handed}>
      <BatchPhasesPage />
    </QueryHydration>
  )
}
