import { Duration, Effect, Fiber, Option } from 'effect'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { probeHold, probeScoring } from './support/catalogs.ts'
import { errorOf, GATED, ok, run, runningBatch, seed, type Seeded } from './support/round.ts'

// The arithmetic never runs inside a database transaction.
//
// A calculator may take seconds - it is a program in a sandbox, or a service
// away - and every writer that asks it holds a batch lock while it writes.
// Holding that lock for the duration of the arithmetic would let one slow
// determination stall every other change to the round. So the proof is
// made between two transactions, and the way to see that it is: while a
// proof is stuck, another writer takes the same batch lock and finishes.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

const at = (f: Seeded, id: string) => ({
  id,
  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
  quorum: { type: 'any' },
})

/** holds every probe with ordinal 6 until the suite lets go */
const holding = () => {
  let release: () => void = () => undefined
  probeHold.until = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => release()
}

const settle = (ms: number) => Effect.promise(() => new Promise((r) => setTimeout(r, ms)))

/** whether an act finished on its own, without waiting on whoever holds the proof */
const finishedMeanwhile = <A, E, R>(act: Effect.Effect<A, E, R>) =>
  Effect.timeoutOption(act, Duration.seconds(3)).pipe(Effect.map(Option.isSome))

const config = (f: Seeded, scoring: unknown) => ({
  entrySource: 'student' as const,
  formConfig: { files: {} },
  scoringConfig: scoring,
  reviewPolicy: { normal: { stages: [at(f, 'class')] }, escalation: { stages: [] } },
})

describe.runIf(postgresAvailable)('where the arithmetic runs', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-probe-boundary')
  }, 120_000)
  afterAll(async () => {
    await db.dispose()
  })
  afterEach(() => {
    probeHold.until = Promise.resolve()
  })

  it('lets the round move on while a determination is being proven', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pb-settle')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            {
              itemId: g.item.id,
              participantId: g.p1,
              payload: { 'claimed-level-slot': 'national' },
            },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)

          const release = holding()
          const proving = yield* Effect.forkChild(
            Effect.exit(
              assessment.decideReview(
                f.t,
                sent.currentReviewInstanceId!,
                {
                  decision: 'approve',
                  recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 6 } },
                },
                f.principal(f.reviewer),
              ),
            ),
          )
          yield* settle(300)
          // another writer needs the batch lock the settlement would hold if
          // it were proving inside its transaction: a change to the round's
          // own question, which locks the batch first
          const meanwhile = yield* finishedMeanwhile(
            assessment.updateItem(f.t, g.item.id, { title: '改个标题' }, admin),
          )
          release()
          const settled = yield* Fiber.join(proving)
          return { meanwhile, settled: settled._tag }
        }),
      ),
    )
    expect(result.meanwhile).toBe(true)
    expect(result.settled).toBe('Success')
  }, 120_000)

  it('lets the round move on while a candidate rule is being tried, and while a report is redrawn', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('pb-trial')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          // a determination in force whose probe the suite can hold
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            {
              itemId: g.item.id,
              participantId: g.p1,
              payload: { 'claimed-level-slot': 'national' },
            },
            s1,
          )
          const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', s1)
          yield* assessment.decideReview(
            f.t,
            sent.currentReviewInstanceId!,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 6 } },
            },
            f.principal(f.reviewer),
          )
          // a sibling question on the same round, for the other writer
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const sibling = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '另一题',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: 1,
              config: config(f, {
                calculator: { ref: 'fixed@1', config: { value: '1.00' } },
                aggregator: { ref: 'sum@1', config: {} },
              }),
            },
            admin,
          )

          // the trial, held
          let release = holding()
          const repriced = config(f, probeScoring({ bonus: 1 }))
          const trying = yield* Effect.forkChild(
            Effect.exit(
              assessment.updateItem(f.t, g.item.id, { config: repriced, reason: '加一分' }, admin),
            ),
          )
          yield* settle(300)
          const duringTrial = yield* finishedMeanwhile(
            assessment.updateItem(f.t, sibling.id, { title: '改个标题' }, admin),
          )
          release()
          const asked = yield* Fiber.join(trying)
          const token = errorOf<{ impactToken?: string }>(asked)?.impactToken ?? null

          // the report redrawn for a stale answer: the state moves, the
          // stale token is offered, and the second trial is held too
          yield* assessment.interveneOnEntry(
            f.t,
            entry.id,
            { kind: 'return-for-revision', reason: '退回' },
            admin,
          )
          // the returned claim stands no more, so the redraw tries nothing;
          // give it something held to try: a fresh determination
          const again = yield* assessment.createEntry(
            f.t,
            {
              itemId: g.item.id,
              participantId: g.p2,
              payload: { 'claimed-level-slot': 'national' },
            },
            f.principal(f.s2),
          )
          const sentAgain = yield* assessment.setEntryStatus(
            f.t,
            again.id,
            'in_review',
            f.principal(f.s2),
          )
          yield* assessment.decideReview(
            f.t,
            sentAgain.currentReviewInstanceId!,
            {
              decision: 'approve',
              recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 6 } },
            },
            f.principal(f.reviewer),
          )
          release = holding()
          const redrawing = yield* Effect.forkChild(
            Effect.exit(
              assessment.updateItem(
                f.t,
                g.item.id,
                { config: repriced, reason: '加一分', effects: { impactToken: token ?? 'stale' } },
                admin,
              ),
            ),
          )
          yield* settle(300)
          const duringRedraw = yield* finishedMeanwhile(
            assessment.updateItem(f.t, sibling.id, { title: '再改一次' }, admin),
          )
          release()
          const redrawn = yield* Fiber.join(redrawing)
          const redrawnTag = errorOf<{ _tag?: string }>(redrawn)?._tag ?? null
          return { duringTrial, asked: asked._tag, duringRedraw, redrawnTag }
        }),
      ),
    )
    expect(result.duringTrial).toBe(true)
    expect(result.asked).toBe('Failure')
    expect(result.duringRedraw).toBe(true)
    expect(result.redrawnTag).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
  }, 120_000)
})
