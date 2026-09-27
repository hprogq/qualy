import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'
import type { ReviewGap } from '../items/ReviewGapNotice.tsx'

// What a batch's administrators owe it, gathered for the places that only
// point at it: the overview's desk and the dots beside the rail entries.
//
// Each count is read from the page that settles it, with the same query that
// page asks, so the desk, the dot and the page agree and refresh together.
// Only the totals are asked for - the rows are the pages' own to list.
// Nothing here is stored or swept for: every count is worked out when read,
// from the roster, the routes and the organization as they are now (§32.97).

/** how long a count stands before another look, on every screen of the batch */
const FRESH_FOR = 60_000

/** one question a route misses somebody on, named */
export interface AlertedQuestion {
  readonly id: string
  readonly title: string
}

export interface AdminAlerts {
  /** review stopped for want of a reviewer, unit by unit */
  readonly gaps: readonly ReviewGap[]
  /**
   * People some question's route finds nowhere to be reviewed, told apart
   * by the route: an ordinary route that misses somebody stops them filing
   * into that question, an escalation route only stops them appealing what
   * it concluded. The same question can stand in both.
   */
  readonly unreachable: {
    readonly cannotSubmit: number
    readonly cannotAppeal: number
    /** the questions whose ordinary route misses somebody, in the order the server lists them */
    readonly submitItems: readonly AlertedQuestion[]
    /** the questions whose escalation route misses somebody */
    readonly appealItems: readonly AlertedQuestion[]
  }
  /** people the organization now places somewhere the roster does not */
  readonly placements: { readonly changed: number; readonly unavailable: number }
  /** changes to the organization's appointments this batch has yet to take */
  readonly accessPending: number
  /** some count has not arrived yet */
  readonly pending: boolean
  /** some count could not be read, and none of what follows is known for it */
  readonly failed: boolean
  readonly retry: () => void
  readonly retrying: boolean
}

/** which rail entries have something waiting behind them, by what the desk says */
export const ALERTED_ENTRIES = {
  items: 'assessment/batch-items/rail',
  roster: 'assessment/batch-results/rail',
  access: 'assessment/batch-access/rail',
} as const

/**
 * Whether this batch owes its administrators anything the desk and the
 * rail would list, by the batch's own word on the reader and on itself.
 *
 * Only for whoever manages it: the reads are refused to anybody else, and
 * a desk that asked anyway would only collect refusals. And not once it is
 * archived: an archived batch takes no appointment, no roster change and no
 * change to its questions (§9, §32.90①), so nothing listed there could be
 * mended - the staff page counts no pending organization change there for
 * the same reason.
 */
export const owesAdministration = (batch: {
  readonly status: 'draft' | 'active' | 'archived'
  readonly capabilities: { readonly manage: boolean }
}): boolean => batch.capabilities.manage && batch.status !== 'archived'

/**
 * What the batch's administrators owe it, for a reader who is one.
 *
 * `enabled` is `owesAdministration` of the batch: with it off nothing is
 * asked, and the answer is that nothing is owed.
 */
export function useAdminAlerts(batchId: string, enabled: boolean): AdminAlerts {
  const query = useApiQuery(assessmentApi)
  const alerts = useQuery({
    ...query.assessment.reviewAlerts.queryOptions({ params: { batchId } }),
    staleTime: FRESH_FOR,
    enabled,
  })
  // the totals ride on the first page, so one row is all either has to fetch
  const placements = useQuery({
    ...query.assessment.listParticipantPlacements.queryOptions({
      params: { batchId },
      query: { limit: '1' },
    }),
    staleTime: FRESH_FOR,
    enabled,
  })
  const access = useQuery({
    ...query.assessment.previewAccessSync.queryOptions({
      params: { batchId },
      query: { limit: '1' },
    }),
    staleTime: FRESH_FOR,
    enabled,
  })

  // a count kept from before the batch was archived is not owed either
  const owed = <T>(data: T | undefined): T | undefined => (enabled ? data : undefined)
  const reach = owed(alerts.data)?.unreachable
  // each route's questions on their own: a question whose appeal cannot be
  // heard is not one that cannot be filed into
  const questionsOn = (route: 'normal' | 'escalation'): AlertedQuestion[] =>
    (reach?.routes ?? [])
      .filter((one) => one.route === route)
      .map((one) => ({ id: one.itemId, title: one.itemTitle }))
  const reads = [alerts, placements, access]
  return {
    gaps: owed(alerts.data)?.groups ?? [],
    unreachable: {
      cannotSubmit: reach?.cannotSubmit ?? 0,
      cannotAppeal: reach?.cannotAppeal ?? 0,
      submitItems: questionsOn('normal'),
      appealItems: questionsOn('escalation'),
    },
    placements: {
      changed: owed(placements.data)?.changedTotal ?? 0,
      unavailable: owed(placements.data)?.unavailableTotal ?? 0,
    },
    accessPending: owed(access.data)?.pendingTotal ?? 0,
    pending: enabled && reads.some((read) => read.isPending),
    // what was read once and failed on a later look still stands; nothing
    // asked has nothing to have failed
    failed: enabled && reads.some((read) => read.isError && read.data === undefined),
    retry: () => {
      for (const read of reads) if (read.isError) void read.refetch()
    },
    retrying: enabled && reads.some((read) => read.isError && read.isFetching),
  }
}

/** whether the desk has something for this rail entry's page, the way the desk says it */
export function entryAlerted(alerts: AdminAlerts, navigationId: string): boolean {
  switch (navigationId) {
    case ALERTED_ENTRIES.items:
      return (
        alerts.gaps.length > 0 ||
        alerts.unreachable.cannotSubmit > 0 ||
        alerts.unreachable.cannotAppeal > 0
      )
    case ALERTED_ENTRIES.roster:
      return alerts.placements.changed > 0 || alerts.placements.unavailable > 0
    case ALERTED_ENTRIES.access:
      return alerts.accessPending > 0
    default:
      return false
  }
}
