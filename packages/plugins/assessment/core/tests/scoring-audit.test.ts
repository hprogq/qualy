import { Duration, Effect, Fiber, Option } from 'effect'
import { sql } from 'kysely'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { CalculatorRuntimeError, ScoringRuntimeCatalog } from '../src/plugin.ts'
import { Assessment } from '../src/server/index.ts'
import { auditScoringState, exitCodeOf, type ScoringAuditReport } from '../src/scoring/audit.ts'
import { catalogLayers, probeGrantTest, probeHold, probeScoring } from './support/catalogs.ts'
import {
  breakGrant,
  GATED,
  ok,
  one,
  run,
  runningBatch,
  seed,
  type Seeded,
} from './support/round.ts'

// What stands, evaluated under the rule it stands under, today.
//
// The settlement gates keep a determination the rule refuses from ever
// becoming a fact - from now on. What was already a fact when the gates
// arrived, and what a rule bound to a granted question makes of its own
// amount, nothing had asked. This is the asking: every determination in
// force and every granted question's own amount, evaluated once under
// its current plan, counted by what the calculator said, and never
// changed. A history that diverged from its rule is what a test has to
// write by hand, because the gates leave no other way to make one.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

const at = (f: Seeded, id: string) => ({
  id,
  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
  quorum: { type: 'any' },
})

const config = (f: Seeded, scoring: unknown) => ({
  entryChannels: ['participant'] as const,
  formConfig: { files: {} },
  scoringConfig: scoring,
  reviewPolicy: { normal: { stages: [at(f, 'class')] }, escalation: { stages: [] } },
})

/** a determination in force: filed, sent for review, approved with these values */
const standing = (
  f: Seeded,
  item: { id: string },
  participantId: string,
  who: string,
  ordinal: number,
) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const as = f.principal(who)
    const entry = yield* assessment.createEntry(
      f.t,
      { itemId: item.id, participantId, payload: { 'claimed-level-slot': 'national' } },
      as,
    )
    const sent = yield* assessment.setEntryStatus(f.t, entry.id, 'in_review', as)
    yield* assessment.decideReview(
      f.t,
      sent.currentReviewInstanceId!,
      {
        decision: 'approve',
        recognition: { values: { 'rec-level': 'national', 'rec-ordinal': ordinal } },
      },
      f.principal(f.reviewer),
    )
    return entry.id
  })

/**
 * History diverging from its rule: the determination's values rewritten
 * where the rule no longer takes them. The gates make this impossible to
 * do through any door, which is exactly why the audit has to exist.
 */
const rewrite = (entryId: string, ordinal: number) =>
  runSql(sql`
    update entry_recognitions
    set values = jsonb_set(values, '{rec-ordinal}', to_jsonb(${ordinal}::int))
    where id = (select current_recognition_id from entries where id = ${entryId})`)

/** a second question of the same round, on the probing rule */
const anotherQuestion = (f: Seeded, batchId: string, title: string, scoring: unknown) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const admin = f.principal(f.admin)
    const groups = yield* assessment.listScoreGroups(f.t, batchId, admin)
    const item = yield* assessment.createItem(
      f.t,
      batchId,
      {
        itemType: 'evidence',
        title,
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: 1,
        config: config(f, scoring),
      },
      admin,
    )
    yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
    return item
  })

/**
 * A granted question, on a rule told what to make of its own amount.
 *
 * Put on the round paying, and broken only afterwards: a rule that cannot
 * pay is refused on its way in, so a broken one in force is a state only a
 * write beneath the service can leave.
 */
const granted = (f: Seeded, batchId: string, fails?: 'refusal' | 'execution' | 'integrity') =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const admin = f.principal(f.admin)
    const groups = yield* assessment.listScoreGroups(f.t, batchId, admin)
    const item = yield* assessment.createItem(
      f.t,
      batchId,
      {
        itemType: 'constant',
        title: '固定加分',
        scoreGroupId: groups.groups[0]!.id,
        maxEntries: null,
        config: {
          entryChannels: [] as const,
          formConfig: {},
          scoringConfig: {
            calculator: { ref: probeGrantTest.ref, config: { amount: '1.00' } },
            aggregator: { ref: 'sum@1', config: {} },
          },
          reviewPolicy: { mode: 'none' },
        },
      },
      admin,
    )
    yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
    if (fails !== undefined) yield* breakGrant(item.id, fails)
    return item
  })

const audit = (filter: { tenantId?: string; batchId?: string }) =>
  auditScoringState(filter).pipe(Effect.provide(catalogLayers))

const counts = (report: ScoringAuditReport) => ({
  items: report.items,
  plans: report.plans,
  recognitions: report.recognitions,
  derivedGrants: report.derivedGrants,
  accepted: report.accepted,
  refused: report.refused,
  executionFailed: report.executionFailed,
  unavailable: report.unavailable,
  integrityFailed: report.integrityFailed,
  invariantFailed: report.invariantFailed,
  unreadable: report.unreadable,
  unprepared: report.unprepared,
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

describe.runIf(postgresAvailable)('the audit of what stands', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-scoring-audit')
  }, 120_000)
  afterAll(async () => {
    await db.dispose()
  })
  afterEach(() => {
    probeHold.until = Promise.resolve()
  })

  it('counts exactly what stands, granted questions included, and names each failure', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sa-count')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const other = yield* anotherQuestion(f, g.batch.id, '第二题', probeScoring())
          // four determinations in force; three of them the rule would not
          // take today, each in its own way
          yield* standing(f, g.item, g.p1, f.s1, 1)
          const refusedEntry = yield* standing(f, g.item, g.p2, f.s2, 2)
          yield* rewrite(refusedEntry, 7)
          const brokenEntry = yield* standing(f, other, g.p1, f.s1, 3)
          yield* rewrite(brokenEntry, 9)
          const goneEntry = yield* standing(f, other, g.p2, f.s2, 4)
          yield* rewrite(goneEntry, 8)
          // a granted question whose rule refuses its own amount: no
          // determination anywhere, and still a violation
          const grant = yield* granted(f, g.batch.id, 'refusal')
          // questions nobody can score by are not evaluated
          const draft = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'evidence',
              title: '草稿题',
              scoreGroupId: (yield* assessment.listScoreGroups(f.t, g.batch.id, admin)).groups[0]!
                .id,
              maxEntries: 1,
              config: config(f, probeScoring()),
            },
            admin,
          )
          const voided = yield* anotherQuestion(f, g.batch.id, '作废题', probeScoring())
          yield* assessment.setItemStatus(
            f.t,
            voided.id,
            { status: 'voided', reason: '不再考核' },
            admin,
          )
          // an archived round still reads its results, so it is still audited
          const past = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, past.item, past.p1, f.s1, 5)
          // a round is archived from its last phase, never mid-way
          const phases = yield* assessment.getPlan(f.t, past.batch.id, admin)
          yield* assessment.advancePhase(
            f.t,
            past.batch.id,
            { to: phases[phases.length - 1]!.id, force: true, reason: 'the round ends' },
            admin,
          )
          yield* assessment.setBatchStatus(f.t, past.batch.id, { status: 'archived' }, admin)

          const report = yield* audit({ tenantId: f.t })
          return {
            report,
            ids: {
              refusedEntry,
              brokenEntry,
              goneEntry,
              grant: grant.id,
              draft: draft.id,
              voided: voided.id,
            },
          }
        }),
      ),
    )
    expect(counts(result.report)).toEqual({
      items: 4,
      plans: 4,
      recognitions: 5,
      derivedGrants: 1,
      accepted: 2,
      refused: 2,
      executionFailed: 1,
      unavailable: 1,
      integrityFailed: 0,
      invariantFailed: 0,
      unreadable: 0,
      unprepared: 0,
    })
    expect(result.report.verdict).toBe('violations')
    expect(exitCodeOf(result.report.verdict)).toBe(2)
    const byEntry = new Map(result.report.failures.map((one) => [one.entryId ?? 'derived', one]))
    expect(byEntry.get(result.ids.refusedEntry)).toMatchObject({
      stage: 'evaluate',
      kind: 'refusal',
      derived: false,
    })
    expect(byEntry.get(result.ids.brokenEntry)).toMatchObject({ kind: 'execution' })
    expect(byEntry.get(result.ids.goneEntry)).toMatchObject({ kind: 'unavailable' })
    expect(byEntry.get('derived')).toMatchObject({
      itemId: result.ids.grant,
      derived: true,
      kind: 'refusal',
    })
    expect(byEntry.get('derived')?.entryId).toBeUndefined()
    // what a report says about a determination is the calculator's word,
    // never the determination itself
    expect(JSON.stringify(result.report)).not.toContain('national')
    const audited = result.report.failures.map((one) => one.itemId)
    expect(audited).not.toContain(result.ids.draft)
    expect(audited).not.toContain(result.ids.voided)
  }, 180_000)

  it('reads an outage alone as inconclusive, not as a violation', async () => {
    const report = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sa-outage')
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const entry = yield* standing(f, g.item, g.p1, f.s1, 1)
          yield* rewrite(entry, 8)
          return yield* audit({ tenantId: f.t })
        }),
      ),
    )
    expect(report.unavailable).toBe(1)
    expect(report.refused + report.executionFailed).toBe(0)
    expect(report.verdict).toBe('inconclusive')
    expect(exitCodeOf(report.verdict)).toBe(3)
  }, 120_000)

  // The counters count things, and an outage of the RULE has nothing to
  // count when nobody has filed against the question yet: the audit named
  // the failure, added zero to every counter, and called the arithmetic
  // clean - exit 0, and the operator hint that says some of it was out of
  // reach stayed quiet too, because that reads the same counter.
  it('never calls itself clean when a rule would not prepare, with nobody standing under it', async () => {
    const report = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sa-prepare-outage')
          const real = yield* ScoringRuntimeCatalog
          // an active question nobody has filed against: the audit takes it,
          // and there is no determination for an outage to leave unproven
          yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          return yield* auditScoringState({ tenantId: f.t }).pipe(
            Effect.provideService(
              ScoringRuntimeCatalog,
              ScoringRuntimeCatalog.of({
                compile: real.compile,
                verify: real.verify,
                prepare: () =>
                  Effect.fail(new CalculatorRuntimeError('unavailable', 'the sandbox is gone')),
              }),
            ),
            Effect.provide(catalogLayers),
          )
        }),
      ),
    )
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]).toMatchObject({ stage: 'prepare', kind: 'unavailable' })
    // the rule itself is the thing left unproven, so the count is not zero
    expect(report.unavailable).toBe(1)
    expect(report.verdict).toBe('inconclusive')
    expect(exitCodeOf(report.verdict)).toBe(3)
  }, 120_000)

  it('fails closed on a plan it cannot read or a promise it finds broken, whatever else it found', async () => {
    // The two faults the audit cannot see past, and neither can be made
    // through any door: the save refuses a malformed runtime identity, so a
    // stored plan is corrupted by hand, and a calculator that finds its
    // frozen promise broken says so at evaluation.
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sa-closed')
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const entry = yield* standing(f, g.item, g.p1, f.s1, 1)
          yield* rewrite(entry, 7)
          const corrupted = yield* anotherQuestion(f, g.batch.id, '坏题', probeScoring())
          yield* runSql(sql`
            update assessment_item_revisions
            set scoring_plan = jsonb_set(scoring_plan, '{calculator,config,maxOrdinal}', '99'::jsonb)
            where id = (select current_revision_id from assessment_items where id = ${corrupted.id})`)
          const broken = yield* granted(f, g.batch.id, 'integrity')
          const report = yield* audit({ tenantId: f.t })
          return { report, corrupted: corrupted.id, broken: broken.id }
        }),
      ),
    )
    expect(result.report.refused).toBe(1)
    expect(result.report.unreadable).toBe(1)
    expect(result.report.integrityFailed).toBe(1)
    expect(result.report.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: result.corrupted, stage: 'plan', kind: 'unreadable' }),
        expect.objectContaining({
          itemId: result.broken,
          stage: 'evaluate',
          kind: 'integrity',
          derived: true,
        }),
      ]),
    )
    expect(result.report.verdict).toBe('fail-closed')
    expect(exitCodeOf(result.report.verdict)).toBe(4)
  }, 120_000)

  it('is clean when every determination is taken, and says so with zero', async () => {
    const report = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sa-clean')
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, g.item, g.p1, f.s1, 1)
          yield* granted(f, g.batch.id)
          return yield* audit({ tenantId: f.t })
        }),
      ),
    )
    expect(report.verdict).toBe('clean')
    expect(exitCodeOf(report.verdict)).toBe(0)
    expect(report.accepted).toBe(2)
    expect(report.derivedGrants).toBe(1)
    expect(report.failures).toEqual([])
  }, 120_000)

  it('narrows to one round when asked', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sa-filter')
          const first = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const second = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, first.item, first.p1, f.s1, 1)
          yield* standing(f, second.item, second.p1, f.s1, 2)
          const narrowed = yield* audit({ tenantId: f.t, batchId: second.batch.id })
          const whole = yield* audit({ tenantId: f.t })
          return { narrowed: counts(narrowed), whole: counts(whole) }
        }),
      ),
    )
    expect(result.narrowed.items).toBe(1)
    expect(result.narrowed.recognitions).toBe(1)
    expect(result.whole.items).toBe(2)
    expect(result.whole.recognitions).toBe(2)
  }, 120_000)

  it('holds no transaction while the arithmetic runs', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('sa-hold')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const entry = yield* standing(f, g.item, g.p1, f.s1, 1)
          // ordinal 6 is the shape of arithmetic still running
          yield* rewrite(entry, 6)
          const release = holding()
          const auditing = yield* Effect.forkChild(Effect.exit(audit({ tenantId: f.t })))
          yield* settle(300)
          // while the arithmetic is stuck, no backend of this database sits
          // in a transaction: the audit read its rows and let go
          const open = one<{ n: number }>(
            yield* runSql(sql`
              select count(*)::int as n from pg_stat_activity
              where datname = current_database() and state = 'idle in transaction'`),
          ).n
          // and a writer still gets its turn at the round
          const meanwhile = yield* finishedMeanwhile(
            assessment.updateItem(f.t, g.item.id, { title: '改个标题' }, admin),
          )
          release()
          const audited = yield* Fiber.join(auditing)
          return { open, meanwhile, audited: audited._tag }
        }),
      ),
    )
    expect(result.open).toBe(0)
    expect(result.meanwhile).toBe(true)
    expect(result.audited).toBe('Success')
  }, 120_000)
})
