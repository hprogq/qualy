import { renderRequest } from '@qualy/web-rsc/request'
import { answersOf, settle, within } from '@qualy/web-rsc/queries'
import { batchIdOf, keyed, namesRecord, readBatch } from '../batch/batch-reads.server.ts'
import { holdsStanding } from '../batch/capabilities.ts'
import { queueReadOf } from '../review/inbox-reads.ts'
import { rosterQueryOf, rosterViewOf, type RosterView } from '../roster/roster-place.ts'
import { readParticipantEntries } from './participant-entries.server.ts'
import { ParticipantResultsReady, ParticipantResultsStream } from './ParticipantResultsPage.tsx'

// The roster, or one person on it, as a server draws it
// (docs/adr/0012-rsc-data-mode.md), read for a reader the batch says may see
// the results, as the page reads them, and handed to the page, which goes on
// paging, filtering and keeping them current itself.
//
// The list: the page of people the address names, the units they came from,
// and the page's totals once its rows are known. One person: who they are
// and their account, the questions and groups the account is read against,
// their claims where this reader opens them, the units and kinds that say
// where they stand, the page of the list they stand on in the column beside
// them, and - for a reader who reviews in this round - the queue that marks
// which of their claims wait on that reader.

export default async function ParticipantResults({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  // Fast reads still draw real content in the initial HTML. Only a result
  // beyond the existing HTML wait uses the streamed, read-only outline.
  const prepared = prepareResults(params)
  const first = await within(prepared)
  if (first !== undefined) return <ParticipantResultsReady handed={first} />
  return (
    <ParticipantResultsStream
      response={prepared}
      detail={Boolean(renderRequest().url.searchParams.get('participant'))}
    />
  )
}

async function prepareResults(params: Readonly<Record<string, string | undefined>>) {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return null
  const search = renderRequest().url.searchParams
  const subject = settle(await readBatch(batchId).exit)
  if (subject.kind !== 'answer' || !holdsStanding(subject.value.batch.capabilities, 'results')) {
    return null
  }
  const view = rosterViewOf((key) => search.get(key) ?? '')
  const participantId = search.get('participant') ?? ''
  return participantId === ''
    ? rosterReads(batchId, view)
    : accountReads(batchId, participantId, view, subject.value.batch.capabilities.review)
}

/** the page of the roster the address names, as the list reads it */
const pageOfRoster = (batchId: string, view: RosterView) => {
  const page = { params: { batchId }, query: rosterQueryOf(view) }
  return keyed('listParticipantAccounts', page, (client) =>
    client.assessment.listParticipantAccounts(page),
  )
}

async function rosterReads(batchId: string, view: RosterView) {
  const tree = {
    params: { batchId },
    query: {
      reading: 'accounts' as const,
      status: view.status === '' ? ('all' as const) : view.status,
    },
  }
  const accounts = pageOfRoster(batchId, view)
  const units = keyed('listRosterUnits', tree, (client) => client.assessment.listRosterUnits(tree))
  // the page's totals, asked once its rows are known, as the page asks them;
  // rows that miss the html are the page's to total when they land
  const known = await within(accounts.exit)
  if (known === undefined) {
    // The surrounding Suspense already draws the roster's outline. Keep it
    // until the rows can be handed over in the same snapshot as the real
    // table. A late cache update can otherwise race that table's hydration.
    await accounts.exit
    return answersOf([accounts, units])
  }
  const rows = settle(known)
  const ids = rows.kind === 'answer' ? rows.value.items.map((row) => row.id) : []
  const totals = { params: { batchId }, query: { participantIds: ids } }
  return answersOf([
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
}

async function accountReads(
  batchId: string,
  participantId: string,
  view: RosterView,
  reviews: boolean,
) {
  const batch = { params: { batchId } }
  // the units over everybody the round admitted, as the account reads them
  const tree = {
    params: { batchId },
    query: { reading: 'accounts' as const, status: 'all' as const },
  }
  const around = [
    keyed('listItems', batch, (client) => client.assessment.listItems(batch)),
    keyed('listScoreGroups', batch, (client) => client.assessment.listScoreGroups(batch)),
    keyed('listRosterUnits', tree, (client) => client.assessment.listRosterUnits(tree)),
    keyed('listUserTypeOptions', {}, (client) => client.assessment.listUserTypeOptions({})),
    pageOfRoster(batchId, view),
    ...(reviews
      ? [
          keyed('listReviewInbox', queueReadOf(batchId, {}), (client) =>
            client.assessment.listReviewInbox(queueReadOf(batchId, {})),
          ),
        ]
      : []),
  ]
  // an address that cannot name anybody names nobody, and is not asked about
  if (!namesRecord(participantId)) return answersOf(around)
  const person = { params: { batchId, participantId } }
  const who = keyed('getParticipant', person, (client) => client.assessment.getParticipant(person))
  const account = keyed('getParticipantResult', person, (client) =>
    client.assessment.getParticipantResult(person),
  )
  // the claims only where this reader opens them, which the person says;
  // a person who misses the html leaves the claims to the page
  const known = await within(who.exit)
  const read = known === undefined ? undefined : settle(known)
  const claims =
    read?.kind === 'answer' && read.value.claims
      ? [readParticipantEntries(batchId, participantId)]
      : []
  return answersOf([who, account, ...around, ...claims])
}
