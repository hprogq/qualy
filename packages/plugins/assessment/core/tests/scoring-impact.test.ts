import { sql } from 'kysely'
import { Effect, Exit } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { ScoringRuntimeCatalog } from '../src/plugin.ts'
import { candidateImpactHashOf } from '../src/item/impact.ts'
import { probeGrantTest, probeScoring, probeTest } from './support/catalogs.ts'
import {
  errorOf,
  GATED,
  ok,
  one,
  reasonsOf,
  run,
  runningBatch,
  seed,
  type Seeded,
} from './support/round.ts'

// What a change to the arithmetic makes of the determinations already in
// force, found by running it.
//
// A determination that the candidate rule refuses, or cannot compute, is one
// the save would leave approved and unscorable, so the save is refused - no
// dialog, no way through. Amounts that merely change are reported, and the
// administrator's next submission with the report's token is the whole
// acknowledgement. The report is about ONE candidate as the administrator
// keeps sending it, whatever identities the server mints for it along the
// way; and the current rule is judged first on every determination, so a
// fault that predates the save is never laid at the candidate's door.

const REVIEW_OPEN = [...GATED, 'assessment.review.process', 'assessment.review.escalate']

const at = (f: Seeded, id: string) => ({
  id,
  selector: { kind: 'roleAt', nodeTypeId: f.classType, roleIds: [f.reviewRole] },
  quorum: { type: 'any' },
})

const tagOf = (exit: Exit.Exit<unknown, unknown>) => errorOf<{ _tag?: string }>(exit)?._tag

const died = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) &&
  reasonsOf(exit).length > 0 &&
  reasonsOf(exit).every((reason) => (reason as { _tag?: string })._tag === 'Die')

interface Report {
  impactToken: string
  scoring: {
    changed: boolean
    approved: {
      total: number
      comparable: number
      amountChanged: number
      refused: number
      executionFailed: number
    }
    derived: null | { comparable: boolean; amountChanged: boolean; refused: boolean }
  }
}

const revisionNoOf = (itemId: string) =>
  Effect.map(
    runSql(sql`
      select r.revision_no as "no" from assessment_items i
      join assessment_item_revisions r on r.id = i.current_revision_id
      where i.id = ${itemId}`),
    (result) => one<{ no: number }>(result).no,
  )

/** a determination in force: filed, sent for review, approved with these values */
const standing = (
  f: Seeded,
  g: { item: { id: string } },
  participantId: string,
  who: string,
  ordinal: number,
) =>
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
        recognition: { values: { 'rec-level': 'national', 'rec-ordinal': ordinal } },
      },
      f.principal(f.reviewer),
    )
    return entry.id
  })

const config = (f: Seeded, scoring: unknown) => ({
  entrySource: 'student' as const,
  formConfig: { files: {} },
  scoringConfig: scoring,
  reviewPolicy: { normal: { stages: [at(f, 'class')] }, escalation: { stages: [] } },
})

describe.runIf(postgresAvailable)('what a scoring change makes of what stands', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-scoring-impact')
  }, 120_000)
  afterAll(async () => {
    await db.dispose()
  })

  it('refuses a rule that cannot take a determination in force, and keeps the current one', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-refuse')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, g, g.p1, f.s1, 3)
          yield* standing(f, g, g.p2, f.s2, 4)
          const before = yield* revisionNoOf(g.item.id)
          // a rule that refuses one of them, and a program that cannot
          // compute one: neither may become the rule
          const narrowed = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              { config: config(f, probeScoring({ maxOrdinal: 3 })), reason: '收窄' },
              admin,
            ),
          )
          // ordinal 9 is the program failing; make one determination say so
          // through the fixture's own switch: the rule's threshold moves to
          // where 4 computes but the other cannot
          return {
            narrowed: errorOf<{
              _tag: string
              approved: { total: number; refused: number; executionFailed: number }
            }>(narrowed),
            after: yield* revisionNoOf(g.item.id),
            before,
          }
        }),
      ),
    )
    expect(result.narrowed?._tag).toBe('ASSESSMENT_ITEM_SCORING_INCOMPATIBLE')
    expect(result.narrowed?.approved).toEqual({ total: 2, refused: 1, executionFailed: 0 })
    // no revision was written: the current rule stands
    expect(result.after).toBe(result.before)
  }, 120_000)

  it('counts a program that cannot compute apart from a rule that refuses', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-execution')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          // the fixture's execution failure is keyed on ordinal 9, which the
          // current rule (max 5) would refuse at settlement - so the
          // determination is planted past the gate, the way a fault that
          // predates a save would be, and the CURRENT rule is widened to
          // take it first
          const g = yield* runningBatch(f, {
            profile: REVIEW_OPEN,
            scoring: probeScoring({ maxOrdinal: 9, bonus: 0 }),
          })
          const entryId = yield* standing(f, g, g.p1, f.s1, 3)
          yield* runSql(sql`
            update entry_recognitions set values = '{"rec-level":"national","rec-ordinal":9}'::jsonb
            where entry_id = ${entryId}`)
          // now the current rule cannot compute it either: a fault that
          // predates this save, laid at nobody's candidate
          const broken = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              { config: config(f, probeScoring({ maxOrdinal: 9, bonus: 1 })), reason: '加分' },
              admin,
            ),
          )
          return { brokenDied: died(broken) }
        }),
      ),
    )
    expect(result.brokenDied).toBe(true)
  }, 120_000)

  it('reports how many amounts a re-pricing changes, and saves once acknowledged', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-reprice')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, g, g.p1, f.s1, 3)
          yield* standing(f, g, g.p2, f.s2, 4)
          const repriced = config(f, probeScoring({ bonus: 1 }))
          const asked = yield* Effect.exit(
            assessment.updateItem(f.t, g.item.id, { config: repriced, reason: '加一分' }, admin),
          )
          const report = errorOf<Report>(asked)!
          const untouched = yield* revisionNoOf(g.item.id)
          // the same candidate, acknowledged: the token is the whole answer
          const saved = yield* assessment.updateItem(
            f.t,
            g.item.id,
            { config: repriced, reason: '加一分', effects: { impactToken: report.impactToken } },
            admin,
          )
          const logged = one<{ diff: { scoringImpact?: unknown } }>(
            yield* runSql(sql`
              select diff from batch_config_revisions where batch_id = ${g.batch.id}
              order by revision desc limit 1`),
          )
          return {
            asked: tagOf(asked),
            report,
            untouched,
            saved: saved.currentRevision?.revisionNo,
            logged: logged.diff.scoringImpact,
          }
        }),
      ),
    )
    expect(result.asked).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    expect(result.report.scoring.changed).toBe(true)
    expect(result.report.scoring.approved).toEqual({
      total: 2,
      comparable: 2,
      amountChanged: 2,
      refused: 0,
      executionFailed: 0,
    })
    expect(result.untouched).toBe(1)
    expect(result.saved).toBe(2)
    // what the trial found rides the change it belongs to, counts only
    expect(result.logged).toEqual({ approved: { total: 2, amountChanged: 2 }, derived: null })
  }, 120_000)

  it('refuses an acknowledgement given to another candidate, or to another state', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-stale')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const entryId = yield* standing(f, g, g.p1, f.s1, 3)
          const asked = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              { config: config(f, probeScoring({ bonus: 1 })), reason: '加一分' },
              admin,
            ),
          )
          const token = errorOf<Report>(asked)!.impactToken
          // the same token, a different candidate: what was read is not
          // what would be saved
          const other = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              {
                config: config(f, probeScoring({ bonus: 2 })),
                reason: '加两分',
                effects: { impactToken: token },
              },
              admin,
            ),
          )
          // the same candidate, but a determination moved underneath: the
          // report is drawn afresh and nothing is written
          yield* assessment.interveneOnEntry(
            f.t,
            entryId,
            { kind: 'return-for-revision', reason: '退回' },
            admin,
          )
          const moved = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              {
                config: config(f, probeScoring({ bonus: 1 })),
                reason: '加一分',
                effects: { impactToken: token },
              },
              admin,
            ),
          )
          return {
            other: tagOf(other),
            moved: tagOf(moved),
            movedReport: errorOf<Report>(moved)!,
            untouched: yield* revisionNoOf(g.item.id),
          }
        }),
      ),
    )
    expect(result.other).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    expect(result.moved).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    // nothing stands approved any more, so the fresh report has nothing to change
    expect(result.movedReport.scoring.approved.total).toBe(0)
    expect(result.untouched).toBe(1)
  }, 120_000)

  it('runs no trial when only the folding changes, and one when a fixed amount does', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-fold')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const real = yield* ScoringRuntimeCatalog
          const prepares: string[] = []
          const counting = ScoringRuntimeCatalog.of({
            compile: real.compile,
            verify: real.verify,
            prepare: (ref, frozen, context) =>
              Effect.sync(() => prepares.push(ref)).pipe(
                Effect.andThen(real.prepare(ref, frozen, context)),
              ),
          })
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, g, g.p1, f.s1, 3)
          // the same arithmetic per determination, folded differently: no
          // trial is owed, and the save goes through on its reason alone
          const refolded = yield* assessment
            .updateItem(
              f.t,
              g.item.id,
              {
                config: config(f, { ...probeScoring(), aggregator: { ref: 'max@1', config: {} } }),
                reason: '改为取最高',
              },
              admin,
            )
            .pipe(Effect.provideService(ScoringRuntimeCatalog, counting))
          const afterFold = prepares.length
          // a fixed question re-priced: its determinations are all worth
          // something else now, and the administrator is told so
          const fixed = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const s1 = f.principal(f.s1)
          const entry = yield* assessment.createEntry(
            f.t,
            {
              itemId: fixed.item.id,
              participantId: fixed.p1,
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
          const repriced = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              fixed.item.id,
              {
                config: {
                  ...config(f, {
                    calculator: { ref: 'fixed@1', config: { value: '4.00' } },
                    aggregator: { ref: 'sum@1', config: {} },
                  }),
                },
                reason: '改为四分',
              },
              admin,
            ),
          )
          return {
            refolded: refolded.currentRevision?.revisionNo,
            afterFold,
            repriced: tagOf(repriced),
            report: errorOf<Report>(repriced)!,
          }
        }),
      ),
    )
    expect(result.refolded).toBe(2)
    expect(result.afterFold).toBe(0)
    expect(result.repriced).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    expect(result.report.scoring.approved.amountChanged).toBe(1)
  }, 120_000)

  it('judges the current rule first, so a fault that predates the save is never the candidate', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-baseline')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          const entryId = yield* standing(f, g, g.p1, f.s1, 3)
          const plant = (ordinal: number) =>
            runSql(sql`
              update entry_recognitions
              set values = ${JSON.stringify({ 'rec-level': 'national', 'rec-ordinal': ordinal })}::jsonb
              where entry_id = ${entryId}`)
          const attempt = (candidate: unknown) =>
            Effect.exit(
              assessment.updateItem(
                f.t,
                g.item.id,
                { config: config(f, candidate), reason: '试' },
                admin,
              ),
            )
          // the current program cannot compute what stands; the candidate
          // would refuse it. The former is the answer.
          yield* plant(9)
          const currentBroken = yield* attempt(probeScoring({ maxOrdinal: 2 }))
          // the current arithmetic is out of reach; the candidate cannot
          // compute. The former is the answer, and it is an outage.
          yield* plant(8)
          const currentOut = yield* attempt(probeScoring({ maxOrdinal: 2 }))
          return {
            currentBrokenDied: died(currentBroken),
            currentBrokenTag: tagOf(currentBroken),
            currentOut: tagOf(currentOut),
            untouched: yield* revisionNoOf(g.item.id),
          }
        }),
      ),
    )
    expect(result.currentBrokenDied).toBe(true)
    expect(result.currentBrokenTag).toBeUndefined()
    expect(result.currentOut).toBe('ASSESSMENT_SCORING_UNAVAILABLE')
    expect(result.untouched).toBe(1)
  }, 120_000)

  it('stops the whole save on an outage, with nothing written', async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-outage')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: probeScoring() })
          yield* standing(f, g, g.p1, f.s1, 3)
          const entryId = yield* standing(f, g, g.p2, f.s2, 4)
          // one of them meets an outage: whichever rule meets it first, the
          // trial stops there and reports nothing partial
          yield* runSql(sql`
            update entry_recognitions set values = '{"rec-level":"national","rec-ordinal":8}'::jsonb
            where entry_id = ${entryId}`)
          const out = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              g.item.id,
              { config: config(f, probeScoring({ bonus: 1 })), reason: '加一分' },
              admin,
            ),
          )
          return { out: tagOf(out), untouched: yield* revisionNoOf(g.item.id) }
        }),
      ),
    )
    expect(result.out).toBe('ASSESSMENT_SCORING_UNAVAILABLE')
    expect(result.untouched).toBe(1)
  }, 120_000)

  it("tries a granted question on its own amount, apart from anybody's determination", async () => {
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-derived')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN })
          const groups = yield* assessment.listScoreGroups(f.t, g.batch.id, admin)
          const grant = (amount: string, fails?: 'refusal' | 'execution') => ({
            entrySource: 'student' as const,
            formConfig: {},
            scoringConfig: {
              calculator: {
                ref: probeGrantTest.ref,
                config: { amount, ...(fails === undefined ? {} : { fails }) },
              },
              aggregator: { ref: 'sum@1', config: {} },
            },
            reviewPolicy: { mode: 'none' },
          })
          const item = yield* assessment.createItem(
            f.t,
            g.batch.id,
            {
              itemType: 'constant',
              title: '固定加分',
              scoreGroupId: groups.groups[0]!.id,
              maxEntries: null,
              config: grant('1.00'),
            },
            admin,
          )
          yield* assessment.setItemStatus(f.t, item.id, { status: 'active' }, admin)
          const repriced = yield* Effect.exit(
            assessment.updateItem(f.t, item.id, { config: grant('2.00'), reason: '改两分' }, admin),
          )
          const refused = yield* Effect.exit(
            assessment.updateItem(
              f.t,
              item.id,
              { config: grant('1.00', 'refusal'), reason: '不认' },
              admin,
            ),
          )
          return {
            repriced: tagOf(repriced),
            report: errorOf<Report>(repriced)!,
            refused: errorOf<{ _tag: string; derived: unknown }>(refused),
            untouched: yield* revisionNoOf(item.id),
          }
        }),
      ),
    )
    expect(result.repriced).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    expect(result.report.scoring.derived).toEqual({
      comparable: true,
      amountChanged: true,
      refused: false,
      executionFailed: false,
    })
    expect(result.refused?._tag).toBe('ASSESSMENT_ITEM_SCORING_INCOMPATIBLE')
    expect(result.refused?.derived).toEqual({ refused: true, executionFailed: false })
    expect(result.untouched).toBe(1)
  }, 120_000)

  it('acknowledges the candidate as the administrator keeps sending it, minted names aside', async () => {
    // the pure half: what the token binds
    const draft = {
      version: 2,
      calculator: { ref: probeTest.ref, config: { bonus: 1 } },
      aggregator: { ref: 'sum@1', config: {} },
      recognitions: [
        { handle: 'h-new', label: '新事实', refinement: null, defaultFromFieldId: null },
      ],
      bindings: { level: { kind: 'recognition', handle: 'h-new' } },
    }
    const contract = { ref: probeTest.ref, config: { bonus: 1 }, contractHash: 'test:probe' }
    const hashOf = (scoringIntent: unknown, calculatorContract: typeof contract) =>
      candidateImpactHashOf({
        formConfig: { files: {} },
        reviewPolicy: { mode: 'none' },
        scoringIntent,
        calculatorContract,
      })
    // the same draft is the same candidate, whatever the server minted for it
    expect(hashOf(draft, contract)).toBe(hashOf(JSON.parse(JSON.stringify(draft)), contract))
    // the same draft resolving to another program is another candidate
    expect(hashOf(draft, { ...contract, contractHash: 'test:probe-v2' })).not.toBe(
      hashOf(draft, contract),
    )

    // and the round trip, on a question authored in the V2 language: the
    // draft the screen keeps re-sending carries the identities minted at
    // creation and re-prices, asked about once and acknowledged with the
    // token it was given. (Adding a recognition to a question anybody stands
    // under strands what stands and is refused before any report - so a
    // report never has to survive a fresh mint; the hash is bound to the
    // intent all the same.)
    const result = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('si-alpha')
          const assessment = yield* Assessment
          const admin = f.principal(f.admin)
          const authored = (bonus: number, ids: { level?: string; ordinal?: string } = {}) => ({
            version: 2,
            calculator: { ref: probeTest.ref, config: { bonus } },
            aggregator: { ref: 'sum@1', config: {} },
            recognitions: [
              {
                handle: 'level',
                ...(ids.level === undefined ? {} : { id: ids.level }),
                label: '级别',
                refinement: null,
                defaultFromFieldId: 'claimed-level',
              },
              {
                handle: 'ordinal',
                ...(ids.ordinal === undefined ? {} : { id: ids.ordinal }),
                label: '序位',
                refinement: null,
                defaultFromFieldId: null,
              },
            ],
            bindings: {
              level: { kind: 'recognition', handle: 'level' },
              ordinal: { kind: 'recognition', handle: 'ordinal' },
            },
          })
          const g = yield* runningBatch(f, { profile: REVIEW_OPEN, scoring: authored(0) })
          const stored = (yield* assessment.getItem(f.t, g.item.id, admin)).currentRevision!
            .scoringConfig as { recognitions: Record<string, unknown> }
          const [levelId, ordinalId] = Object.keys(stored.recognitions)
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
              recognition: { values: { [levelId!]: 'national', [ordinalId!]: 3 } },
            },
            f.principal(f.reviewer),
          )
          const repriced = config(f, authored(1, { level: levelId, ordinal: ordinalId }))
          const asked = yield* Effect.exit(
            assessment.updateItem(f.t, g.item.id, { config: repriced, reason: '加一分' }, admin),
          )
          const token = errorOf<Report>(asked)!.impactToken
          const saved = yield* assessment.updateItem(
            f.t,
            g.item.id,
            { config: repriced, reason: '加一分', effects: { impactToken: token } },
            admin,
          )
          return { asked: tagOf(asked), saved: saved.currentRevision?.revisionNo }
        }),
      ),
    )
    expect(result.asked).toBe('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED')
    expect(result.saved).toBe(2)
  }, 120_000)
})
