import { Effect, Fiber, Stream } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { DatabaseNotifications, transaction } from '@qualy/plugin-database/server'
import { Assessment } from '../src/server/index.ts'
import { ASSESSMENT_LIVE_CHANNEL, announce } from '../src/live/events.ts'
import { ok, run, runningBatch, seed } from './support/round.ts'

// The one property the live channel is built on: an announcement rides its
// transaction. Committed writes are heard, rolled-back writes never were.
// Everything above this - the fan-out, the SSE filter, the browser's
// invalidations - assumes it and adds nothing to it.

describe.runIf(postgresAvailable)('the live announcement channel', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-live')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('delivers what commits and never what rolls back', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('lv-commit')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f)
          const notifications = yield* DatabaseNotifications

          const heard: { kind: string; batchId: string; subjectUserId: string | null }[] = []
          const collector = yield* Effect.forkChild(
            notifications
              .listen(ASSESSMENT_LIVE_CHANNEL)
              .pipe(
                Stream.runForEach((payload) =>
                  Effect.sync(() => heard.push(JSON.parse(payload) as (typeof heard)[number])),
                ),
              ),
          )
          // LISTEN registers when the collector's stream starts; the write
          // below must not race it
          yield* Effect.sleep('500 millis')

          // a real mutation announces as part of its own transaction
          yield* assessment.createEntry(
            f.t,
            { itemId: g.item.id, participantId: g.p1, payload: {} },
            f.principal(f.s1),
          )

          // an announcement inside a transaction that fails goes nowhere:
          // the sentinel batch id below must never be heard
          const refused = yield* Effect.result(
            transaction(
              Effect.gen(function* () {
                yield* announce(f.t, 'rolled-back-sentinel', [{ kind: 'item-changed' }])
                return yield* Effect.fail('abort' as const)
              }),
            ),
          )

          // deliveries are post-commit and asynchronous; wait them out
          yield* Effect.gen(function* () {
            for (let waited = 0; waited < 100 && heard.length === 0; waited += 1) {
              yield* Effect.sleep('50 millis')
            }
          })
          yield* Effect.sleep('300 millis')
          yield* Fiber.interrupt(collector)
          return { heard, refused: refused._tag, subject: f.s1 }
        }),
      ),
    )

    expect(result.refused).toBe('Failure')
    const kinds = result.heard.map((event) => event.kind)
    expect(kinds).toContain('entries-changed')
    const filed = result.heard.find((event) => event.kind === 'entries-changed')!
    expect(filed.subjectUserId).toBe(result.subject)
    expect(result.heard.filter((event) => event.batchId === 'rolled-back-sentinel')).toEqual([])
  })
})
