import { Context, Effect, Layer, PubSub, Result, Schedule, Schema, Stream } from 'effect'
import { DatabaseNotifications } from '@qualy/plugin-database/server'
import { Assembled } from '@qualy/api-kit/assembled'
import { ASSESSMENT_LIVE_CHANNEL, liveEventSchema, type AssessmentLiveEvent } from './events.ts'

// The receiving half of the live bus: one dedicated LISTEN session per
// process, fanned out in-process to however many SSE connections are open.
// One connection to the database, not one per browser.
//
// The pubsub is sliding on purpose. These are wake-ups, not records: a
// subscriber too slow to take them must never become back-pressure on the
// pump - and through it on nothing, since the pump only relays - so the bus
// drops the oldest wake-up instead of holding anybody. Whatever a dropped
// wake-up would have said, the next sync or poll says again.

const decodePayload = Schema.decodeUnknownEffect(liveEventSchema)

export class AssessmentLive extends Context.Service<
  AssessmentLive,
  {
    /** every announcement in this tenant's database, as this process hears them */
    readonly events: Stream.Stream<AssessmentLiveEvent>
  }
>()('@qualy/plugin-assessment/AssessmentLive') {
  static readonly layer: Layer.Layer<AssessmentLive, never, DatabaseNotifications | Assembled> =
    Layer.effect(
      AssessmentLive,
      Effect.gen(function* () {
        const scope = yield* Effect.scope
        const notifications = yield* DatabaseNotifications
        const assembled = yield* Assembled
        const pubsub = yield* PubSub.sliding<AssessmentLiveEvent>(1024)

        // one pass over one LISTEN session; ends when the session dies
        const drain = notifications.listen(ASSESSMENT_LIVE_CHANNEL).pipe(
          Stream.runForEach(
            Effect.fn('AssessmentLive.relay')(function* (payload: string) {
              const parsed = yield* Effect.result(
                Effect.flatMap(
                  Effect.try(() => JSON.parse(payload) as unknown),
                  decodePayload,
                ),
              )
              // a payload this schema cannot read is a version skew or a
              // stray writer, not a reason to stop listening
              if (Result.isFailure(parsed)) {
                yield* Effect.logWarning('assessment live payload not understood')
                return
              }
              yield* PubSub.publish(pubsub, parsed.success)
            }),
          ),
        )
        // the session will die - a restarted database, a dropped socket -
        // and every death is the same answer: log, wait, listen again.
        // Notifications missed in between are gone by design; reconnected
        // browsers re-read on their own sync/poll cadence.
        const loop = Effect.repeat(
          drain.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning('assessment live listener interrupted, reconnecting').pipe(
                Effect.andThen(Effect.logDebug(cause)),
              ),
            ),
          ),
          Schedule.spaced('3 seconds'),
        )

        yield* assembled.register({
          name: 'assessment/live-listener',
          run: Effect.gen(function* () {
            yield* Effect.forkIn(loop, scope)
            yield* Effect.logDebug('assessment live listener running')
          }),
        })

        return AssessmentLive.of({ events: Stream.fromPubSub(pubsub) })
      }),
    )
}
