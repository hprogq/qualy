import { useEffect, useMemo, useRef } from 'react'
import { hashKey, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useApi, useApiQuery, useApiStream, type ApiStreamState } from '@qualy/web-runtime'
import { assessmentApi } from './api.ts'
import type { BatchLiveEvent } from '../api.ts'
import { settler } from './roster/live-settle.ts'

// One batch's live wake-ups, for whichever screen holds it open. The screen
// says what each kind of wake-up refreshes; this hook keeps the channel
// dialled, hands the kinds through - and keeps an alarm clock of its own.
//
// The alarm exists because the server's push can only ever be almost on
// time: the boundary takes effect at its planned second, the sweep that
// announces it runs a beat later, and the announcement rides a connection
// that may be mid-reconnect. But the timetable is not a secret - this
// browser has read it - so at the next planned instant the screen wakes
// itself, exactly as if the announcement had landed. Three layers, weakest
// last: the server gate is always right, the push is fast when it works,
// and the alarm is the reader's own copy of the diary.
//
// Wake-ups arrive in bursts: one review decision announces the round, the
// queue, the claim and the account in one transaction, and a reviewer at
// work sends such a burst every few seconds. So the kinds of a burst are
// gathered and handed over once it has gone quiet (or a while after it
// began, since a busy round never goes quiet), each kind once, with a way
// to mark reads stale that reads each of them once whatever asked for it.
// Without that, every screen read its whole queue once per kind per
// decision, across every reviewer with the batch open.
//
// `live` is the degrade signal - false means the screen should fall back to
// its own polling cadence. For a screen that tells its reader how the line
// stands, the whole answer goes to `liveStateOf` (@qualy/ui/live-mark): the
// one rule every such screen shares.

/** past this horizon no timer is set; a screen open for days re-reads anyway */
const ALARM_HORIZON = 24 * 60 * 60 * 1000

/** a beat after the boundary, so the server clock has certainly crossed it */
const ALARM_MARGIN = 750

/** how long a burst of wake-ups has to be quiet before it is handed over */
export const LIVE_SETTLE = 250

/** how long after a burst began it is handed over, quiet or not */
export const LIVE_MAX_WAIT = 2_000

export type BatchLiveKind = BatchLiveEvent['kind']

/** one burst of wake-ups, as a screen reads it */
export interface BatchWake {
  /** every kind the burst carried, each once */
  readonly kinds: ReadonlySet<BatchLiveKind>
  /** mark a read stale; asked for twice in one burst, it is read once */
  readonly stale: (key: QueryKey) => void
}

export function useBatchLive(batchId: string, onWake: (wake: BatchWake) => void): ApiStreamState {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  // the handler is read through a ref so a screen passing a fresh closure
  // every render neither re-subscribes the stream nor re-arms the alarm
  const handler = useRef(onWake)
  handler.current = onWake

  // one burst, handed over once; the reads it stales are asked for once
  // each, and a read already on its way is joined rather than started over
  const burst = useMemo(
    () =>
      settler<BatchLiveKind>({
        settle: LIVE_SETTLE,
        maxWait: LIVE_MAX_WAIT,
        fire: (gathered) => {
          const pending = new Map<string, QueryKey>()
          // an edited diary is this hook's own concern before any screen's:
          // the alarm below is set from the timetable, and so is every
          // screen that shows it
          if (gathered.includes('plan-changed')) {
            const timetable = query.assessment.getTimeline.key({ params: { batchId } })
            pending.set(hashKey(timetable), timetable)
          }
          try {
            handler.current({
              kinds: new Set(gathered),
              stale: (key) => pending.set(hashKey(key), key),
            })
          } finally {
            // a screen that fails half way through still gets what it asked
            // for before failing, as it did when each kind was read at once
            for (const key of pending.values()) {
              void queryClient.invalidateQueries({ queryKey: key })
            }
          }
        },
      }),
    [queryClient, query.assessment.getTimeline, batchId],
  )
  useEffect(() => () => burst.cancel(), [burst])

  // absent under a stubbed harness that does not fake these endpoints; the
  // hook then stays idle and the screen simply polls
  const streams = typeof api.assessment.watchBatch === 'function'
  const told = typeof api.assessment.getTimeline === 'function'

  const timeline = useQuery(
    told
      ? {
          ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
          staleTime: 30_000,
        }
      : // hooks are unconditional, so the stubbed harness gets a query that
        // never runs rather than no query; the queryFn exists only so the
        // client does not warn about a query it will never call
        {
          queryKey: ['assessment', 'timeline-alarm-idle', batchId],
          queryFn: () => Promise.resolve({ timeline: [] }),
          enabled: false,
        },
  )

  // the next instant the diary commits this batch to, if the browser can see
  // one within the horizon
  const entries = timeline.data?.timeline
  const nextPlannedAt = useMemo(() => {
    let next: number | null = null
    for (const entry of entries ?? []) {
      if (entry.entry.kind !== 'planned' || entry.entry.at === null) continue
      const at = Date.parse(entry.entry.at)
      if (Number.isNaN(at)) continue
      if (next === null || at < next) next = at
    }
    return next
  }, [entries])

  useEffect(() => {
    if (nextPlannedAt === null) return
    const wait = nextPlannedAt + ALARM_MARGIN - Date.now()
    if (wait > ALARM_HORIZON) return
    const timer = setTimeout(
      () => {
        // the same wake-up the announcement would have carried, so the screen
        // refreshes whatever it wired to a phase turning - and the timetable
        // itself, so the alarm re-arms on the next boundary
        burst.wake('phase-changed')
        void queryClient.invalidateQueries({
          queryKey: query.assessment.getTimeline.key({ params: { batchId } }),
        })
      },
      Math.max(wait, 0),
    )
    return () => clearTimeout(timer)
    // the alarm follows the diary and the batch; the client handles are
    // stable for the page's lifetime, so naming them re-arms nothing
  }, [nextPlannedAt, batchId, queryClient, query.assessment.getTimeline, burst])

  return useApiStream(
    streams ? () => api.assessment.watchBatch({ params: { batchId } }) : undefined,
    (event) => {
      // a heartbeat only keeps the line open; it moves nothing on screen
      if (event.kind !== 'heartbeat') burst.wake(event.kind)
    },
    { key: batchId },
  )
}
