import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import {
  CalculatorEvaluationError,
  CalculatorRuntimeError,
  ScoringRuntimeCatalog,
} from '../src/plugin.ts'
import { probeScoring } from './support/catalogs.ts'
import {
  errorOf,
  GATED,
  ok,
  reasonsOf,
  run,
  runningBatch,
  seed,
  type Seeded,
} from './support/round.ts'

// What an account says when its arithmetic will not, or cannot, answer.
//
// Every determination in force was proven against the rule before it
// stood, and the rule was tried against them before it took effect. So the
// only thing a reader can be told is that the arithmetic is out of reach -
// and then they are told, in place of the account, never beside a total.
// A refusal here is a state this process should never have allowed, and it
// is a defect that names the question rather than a zero that hides it.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

const died = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) &&
  reasonsOf(exit).length > 0 &&
  reasonsOf(exit).every((reason) => (reason as { _tag?: string })._tag === 'Die')

/** a determination in force, approved under the probing rule */
const standing = (f: Seeded, g: { item: { id: string } }, participantId: string, who: string) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const as = f.principal(who)
    const entry = yield* assessment.createEntry(
      f.t,
      { itemId: g.item.id, participantId, payload: { 'claimed-level-slot': 'national' } },
      as,
    )
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', as)
    yield* assessment.decideReview(
      f.t,
      sent.currentReviewInstanceId!,
      {
        decision: 'approve',
        recognition: { values: { 'rec-level': 'national', 'rec-ordinal': 3 } },
      },
      f.principal(f.reviewer),
    )
  })

/** a catalog whose arithmetic answers as told, for reading the account only */
const answering = (
  real: ScoringRuntimeCatalog['Service'],
  answer:
    | { kind: 'prepare'; failure: CalculatorRuntimeError['kind'] }
    | { kind: 'evaluate'; failure: CalculatorEvaluationError['kind'] },
) =>
  ScoringRuntimeCatalog.of({
    compile: real.compile,
    verify: real.verify,
    prepare: (ref, frozen, context) =>
      answer.kind === 'prepare'
        ? Effect.fail(new CalculatorRuntimeError(answer.failure, `told to: ${answer.failure}`))
        : real.prepare(ref, frozen, context).pipe(
            Effect.map(() => ({
              evaluate: () =>
                Effect.fail(
                  new CalculatorEvaluationError(answer.failure, `told to: ${answer.failure}`),
                ),
            })),
          ),
  })

describe.runIf(postgresAvailable)('reading an account the arithmetic cannot answer', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-result-failures')
  }, 120_000)
  afterAll(async () => {
    await db.dispose()
  })

  it('says the arithmetic is out of reach in place of the account, never beside a total', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rf-outage')
          const assessment = yield* Assessment
          const real = yield* ScoringRuntimeCatalog
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, g, g.p1, f.s1)
          const read = (catalog: ScoringRuntimeCatalog['Service']) =>
            Effect.exit(
              assessment
                .getMyResult(f.t, g.batch.id, f.principal(f.s1))
                .pipe(Effect.provideService(ScoringRuntimeCatalog, catalog)),
            )
          const healthy = yield* read(real)
          const preparing = yield* read(
            answering(real, { kind: 'prepare', failure: 'unavailable' }),
          )
          const running = yield* read(answering(real, { kind: 'evaluate', failure: 'unavailable' }))
          return {
            healthy: Exit.isSuccess(healthy) ? healthy.value.total : null,
            preparing: errorOf<{ _tag: string }>(preparing)?._tag,
            running: errorOf<{ _tag: string }>(running)?._tag,
          }
        }),
      ),
    )
    expect(result.healthy).toBe('10.00')
    expect(result.preparing).toBe('ASSESSMENT_SCORING_UNAVAILABLE')
    expect(result.running).toBe('ASSESSMENT_SCORING_UNAVAILABLE')
  }, 120_000)

  it('dies on a refusal of what stands, and on everything that is not an outage', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rf-stable')
          const assessment = yield* Assessment
          const real = yield* ScoringRuntimeCatalog
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, g, g.p1, f.s1)
          const read = (catalog: ScoringRuntimeCatalog['Service']) =>
            Effect.exit(
              assessment
                .getMyResult(f.t, g.batch.id, f.principal(f.s1))
                .pipe(Effect.provideService(ScoringRuntimeCatalog, catalog)),
            )
          // the stable state the gates exist to make impossible: what stands
          // is refused by the rule it was proven against
          const refused = yield* read(answering(real, { kind: 'evaluate', failure: 'refusal' }))
          const broken = yield* read(answering(real, { kind: 'evaluate', failure: 'execution' }))
          const tampered = yield* read(answering(real, { kind: 'prepare', failure: 'integrity' }))
          const declined = yield* read(answering(real, { kind: 'prepare', failure: 'refusal' }))
          return {
            refusedDied: died(refused),
            refusedTag: errorOf<{ _tag: string }>(refused)?._tag,
            brokenDied: died(broken),
            tamperedDied: died(tampered),
            declinedDied: died(declined),
          }
        }),
      ),
    )
    // a defect, not a total of zero and not a sentence for the student
    expect(result.refusedDied).toBe(true)
    expect(result.refusedTag).toBeUndefined()
    expect(result.brokenDied).toBe(true)
    expect(result.tamperedDied).toBe(true)
    expect(result.declinedDied).toBe(true)
  }, 120_000)

  it('reads a fixed question exactly as before', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('rf-fixed')
          const assessment = yield* Assessment
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
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
            { decision: 'approve' },
            f.principal(f.reviewer),
          )
          const account = yield* assessment.getMyResult(f.t, g.batch.id, s1)
          return {
            total: account.total,
            lines: account.lines.map((line) => ({ kind: line.kind, value: line.value })),
            groups: account.groups.map((group) => ({ raw: group.raw, final: group.final })),
          }
        }),
      ),
    )
    // fixed@1 pays 3.00, capped at the group's 10.00: byte for byte what it was
    expect(result.total).toBe('3.00')
    expect(result.lines).toEqual([{ kind: 'entry', value: '3.00' }])
    expect(result.groups).toEqual([{ raw: '3.00', final: '3.00' }])
  }, 120_000)
})
