import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { renderRequest } from '@qualy/web-rsc/request'
import { answersOf, settle } from '@qualy/web-rsc/queries'
import { batchIdOf, keyed, readBatch } from '../batch/batch-reads.server.ts'
import { holdsStanding } from '../batch/capabilities.ts'
import { rosterQueryOf, rosterViewOf } from '../roster/roster-place.ts'
import ParticipantResultsPage from './ParticipantResultsPage.tsx'

// The roster as a server draws it (docs/adr/0012-rsc-data-mode.md): the page
// of people the address names, the units they came from, and the page's
// totals once its rows are known - read for a reader the batch says may see
// the results, as the page reads them, and handed to the list, which goes on
// paging, filtering and keeping them current itself. An account opened over
// the list reads for itself.

export default async function ParticipantResults({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  const search = renderRequest().url.searchParams
  if (batchId === undefined || (search.get('participant') ?? '') !== '') {
    return <ParticipantResultsPage />
  }
  const subject = settle(await readBatch(batchId).exit)
  if (subject.kind !== 'answer' || !holdsStanding(subject.value.batch.capabilities, 'results')) {
    return <ParticipantResultsPage />
  }
  const view = rosterViewOf((key) => search.get(key) ?? '')
  const page = { params: { batchId }, query: rosterQueryOf(view) }
  const tree = {
    params: { batchId },
    query: {
      reading: 'accounts' as const,
      status: view.status === '' ? ('all' as const) : view.status,
    },
  }
  const accounts = keyed('listParticipantAccounts', page, (client) =>
    client.assessment.listParticipantAccounts(page),
  )
  const units = keyed('listRosterUnits', tree, (client) => client.assessment.listRosterUnits(tree))
  // the page's totals, asked once its rows are known, as the page asks them
  const rows = settle(await accounts.exit)
  const ids = rows.kind === 'answer' ? rows.value.items.map((row) => row.id) : []
  const totals = { params: { batchId }, query: { participantIds: ids } }
  const state = await answersOf([
    accounts,
    units,
    ...(ids.length === 0
      ? []
      : [
          keyed('listParticipantScores', totals, (client) =>
            client.assessment.listParticipantScores(totals),
          ),
        ]),
  ])
  return (
    <QueryHydration state={state}>
      <ParticipantResultsPage />
    </QueryHydration>
  )
}
