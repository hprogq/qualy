import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useApiStream } from '@qualy/web-runtime'
import { assessmentApi } from './api.ts'
import type { BatchLiveEvent } from '../api.ts'

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
// `live` is the degrade signal - false means the screen should fall back to
// its own polling cadence.

/** past this horizon no timer is set; a screen open for days re-reads anyway */
const ALARM_HORIZON = 24 * 60 * 60 * 1000

/** a beat after the boundary, so the server clock has certainly crossed it */
const ALARM_MARGIN = 750

export function useBatchLive(
  batchId: string,
  onEvent: (kind: BatchLiveEvent['kind']) => void,
): { live: boolean } {
  const api = useApi(assessmentApi)
  const orpc = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  // the handler is read through a ref so a screen passing a fresh closure
  // every render neither re-subscribes the stream nor re-arms the alarm
  const handler = useRef(onEvent)
  handler.current = onEvent

  // absent under a stubbed harness that does not fake these endpoints; the
  // hook then stays idle and the screen simply polls
  const streams = typeof api.assessment.watchBatch === 'function'
  const told = typeof api.assessment.getTimeline === 'function'

  const timeline = useQuery(
    told
      ? {
          ...orpc.assessment.getTimeline.queryOptions({ params: { batchId } }),
          staleTime: 30_000,
        }
      : // hooks are unconditional, so the stubbed harness gets a query that
        // never runs rather than no query
        { queryKey: ['assessment', 'timeline-alarm-idle', batchId], enabled: false },
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
        handler.current('phase-changed')
        void queryClient.invalidateQueries({
          queryKey: orpc.assessment.getTimeline.key({ params: { batchId } }),
        })
      },
      Math.max(wait, 0),
    )
    return () => clearTimeout(timer)
    // the alarm follows the diary and the batch; the client handles are
    // stable for the page's lifetime
  }, [nextPlannedAt, batchId])

  return useApiStream(
    streams ? () => api.assessment.watchBatch({ params: { batchId } }) : undefined,
    (event) => handler.current(event.kind),
    { key: batchId },
  )
}
