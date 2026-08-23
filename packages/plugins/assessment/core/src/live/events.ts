import { Effect, Schema } from 'effect'
import { pgNotify } from '@qualy/plugin-database/server'

// What one part of the assessment announces and another part relays: that
// something a browser may be holding has changed. An announcement carries no
// business data and no resource ids - it is a wake-up, and whoever wakes asks
// the authoritative reads what the world looks like now. That keeps this from
// ever becoming a second read model with its own drift, and it means the
// events themselves cannot leak what their audience was not entitled to ask.

/** the one channel assessment announces on; routing is the payload's job */
export const ASSESSMENT_LIVE_CHANNEL = 'qualy_assessment_live'

const liveKind = Schema.Literals([
  /** something entered or left a reviewer's queues (inbox, awaiting) */
  'review-inbox-changed',
  /** some review round in the batch moved; the open workbench re-reads its own */
  'review-instance-changed',
  /** somebody's filings changed state or content */
  'entries-changed',
  /** the paper itself - items, groups, requirements - was edited */
  'item-changed',
  /** a provisional result moved */
  'result-changed',
  /**
   * the batch entered another phase - by hand, or by the sweep ratifying a
   * boundary the clock crossed. Every capability a screen renders may have
   * flipped, so the reader re-asks everything it stands on
   */
  'phase-changed',
  /**
   * the diary itself was edited: a planned time set, moved or withdrawn, or
   * the plan restructured. Nothing is in effect that was not before - the
   * clock has crossed nothing - but a screen showing the timetable is now
   * showing an old one, and the phase scheduler's alarm is set for an
   * instant that may no longer be the next one
   */
  'plan-changed',
])

export const liveEventSchema = Schema.Struct({
  tenantId: Schema.String,
  batchId: Schema.String,
  kind: liveKind,
  /** whose filings this concerns; null means potentially anybody's */
  subjectUserId: Schema.NullOr(Schema.String),
})

export type AssessmentLiveEvent = typeof liveEventSchema.Type
export type AssessmentLiveKind = AssessmentLiveEvent['kind']

/**
 * Announce changes, inside the transaction that makes them.
 *
 * Delivery rides the transaction: PostgreSQL releases the notifications on
 * COMMIT and drops them on ROLLBACK, so nobody can be told about a state
 * they cannot yet read. Call it beside the writes it describes.
 */
export const announce = Effect.fn('AssessmentLive.announce')(function* (
  tenantId: string,
  batchId: string,
  events: readonly { kind: AssessmentLiveKind; subjectUserId?: string }[],
) {
  for (const event of events) {
    yield* pgNotify(
      ASSESSMENT_LIVE_CHANNEL,
      JSON.stringify({
        tenantId,
        batchId,
        kind: event.kind,
        subjectUserId: event.subjectUserId ?? null,
      } satisfies AssessmentLiveEvent),
    )
  }
})
