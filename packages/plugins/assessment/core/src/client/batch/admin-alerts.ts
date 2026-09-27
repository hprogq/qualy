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
// from the roster, the routes and the organization as they are now (§32.95).

/** how long a count stands before another look, on every screen of the batch */
const FRESH_FOR = 60_000

export interface AdminAlerts {
  /** review stopped for want of a reviewer, unit by unit */
  readonly gaps: readonly ReviewGap[]
  /** people some question's route finds nowhere to be reviewed */
  readonly unreachable: {
    readonly cannotSubmit: number
    readonly cannotAppeal: number
    /** the questions concerned, ordinary routes first, each named once */
    readonly items: readonly string[]
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
 * What the batch's administrators owe it, for a reader who is one.
 *
 * `enabled` is the batch's own word that this reader administers it: the
 * reads are refused to anybody else, and a desk that asked anyway would
 * only collect refusals.
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

  const reach = alerts.data?.unreachable
  // a question named once however many of its routes are concerned, and the
  // ones people cannot file into before the ones they cannot appeal
  const items = [
    ...new Set(
      [...(reach?.routes ?? [])]
        .sort((a, b) => (a.route === b.route ? 0 : a.route === 'normal' ? -1 : 1))
        .map((route) => route.itemTitle),
    ),
  ]
  const reads = [alerts, placements, access]
  return {
    gaps: alerts.data?.groups ?? [],
    unreachable: {
      cannotSubmit: reach?.cannotSubmit ?? 0,
      cannotAppeal: reach?.cannotAppeal ?? 0,
      items,
    },
    placements: {
      changed: placements.data?.changedTotal ?? 0,
      unavailable: placements.data?.unavailableTotal ?? 0,
    },
    accessPending: access.data?.pendingTotal ?? 0,
    pending: enabled && reads.some((read) => read.isPending),
    // what was read once and failed on a later look still stands
    failed: reads.some((read) => read.isError && read.data === undefined),
    retry: () => {
      for (const read of reads) if (read.isError) void read.refetch()
    },
    retrying: reads.some((read) => read.isError && read.isFetching),
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
