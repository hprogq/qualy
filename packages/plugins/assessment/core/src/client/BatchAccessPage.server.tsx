import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { renderRequest } from '@qualy/web-rsc/request'
import { answersOf, settle } from '@qualy/web-rsc/queries'
import { accessQueryOf, accessViewOf } from './access/access-place.ts'
import { batchIdOf, keyed, readBatch } from './batch/batch-reads.server.ts'
import { holdsStanding } from './batch/capabilities.ts'
import BatchAccessPage from './BatchAccessPage.tsx'

// Who may work on a batch, as a server draws it
// (docs/adr/0012-rsc-data-mode.md): the page of staff the address names and
// what an access sync would change, read for a reader the batch says
// manages it, as the panel reads them, and handed to the page, which pages,
// narrows and edits from there.

export default async function BatchAccess({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return <BatchAccessPage />
  const subject = settle(await readBatch(batchId).exit)
  if (subject.kind !== 'answer' || !holdsStanding(subject.value.batch.capabilities, 'manage')) {
    return <BatchAccessPage />
  }
  const search = renderRequest().url.searchParams
  const staff = {
    params: { batchId },
    query: accessQueryOf(accessViewOf((key) => search.get(key) ?? '')),
  }
  const sync = { params: { batchId }, query: { limit: '1' } }
  const handed = await answersOf([
    keyed('listAccess', staff, (client) => client.assessment.listAccess(staff)),
    keyed('previewAccessSync', sync, (client) => client.assessment.previewAccessSync(sync)),
  ])
  return (
    <QueryHydration {...handed}>
      <BatchAccessPage />
    </QueryHydration>
  )
}
