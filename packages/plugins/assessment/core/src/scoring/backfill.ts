/**
 * Compiling the plans of revisions that predate plans.
 *
 * Every item revision saved from now on carries its compiled arithmetic;
 * the ones written before the column existed carry null. They are filled in
 * here, through the same compiler a save uses - the alternative was a SQL
 * translation of canonicalisation and hashing, which is a second
 * implementation of the very identity a plan exists to freeze.
 *
 * Two rules keep this from becoming a migration engine. It only ever fills
 * in a NULL: a plan already written is the arithmetic some score was
 * explained by, and rewriting it would silently restate history. And it runs
 * at the assembled barrier, before the port opens, so no request can meet a
 * revision whose plan has not been compiled yet.
 */

import { Data, Effect } from 'effect'
import { sql } from 'kysely'
import type { BatchContext, ItemTypeDriver, ScoringDriver } from '../plugin.ts'
import { compileScoringPlan, recognitionSourceOf } from './plan.ts'
import { db } from '../server/db.ts'
import { policyModeOf } from '../review/chain.ts'

const RANGE = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/

/** the daterange as postgres prints it, back into its two dates */
const parseRange = (text: string) => {
  const match = RANGE.exec(text)
  if (!match) throw new Error(`unreadable material range: ${text}`)
  return { start: match[1]!, end: match[2]! }
}

interface PendingRevision {
  readonly id: string
  readonly itemType: string
  readonly entrySource: 'student' | 'administrative'
  readonly formConfig: unknown
  readonly scoringConfig: unknown
  readonly reviewPolicy: unknown
  /** the daterange as postgres prints it: [start,end) */
  readonly materialRange: string
}

/** an already-stored question whose arithmetic no longer compiles */
export class ScoringPlanBackfillFailed extends Data.TaggedError(
  'ASSESSMENT_SCORING_PLAN_BACKFILL_FAILED',
)<{
  readonly revisionId: string
  readonly issues: readonly string[]
}> {
  override get message() {
    return `item revision ${this.revisionId} has no compilable scoring plan: ${this.issues.join(', ')}`
  }
}

/** a stored plan depends on a driver this assembly no longer provides */
export class StoredScoringDriverMissing extends Data.TaggedError(
  'ASSESSMENT_STORED_SCORING_DRIVER_MISSING',
)<{
  readonly missing: readonly { kind: string; ref: string; revisionId: string }[]
}> {
  override get message() {
    return this.missing
      .map(
        (entry) =>
          `stored plans depend on ${entry.kind} "${entry.ref}" which this assembly does not provide (e.g. item revision ${entry.revisionId})`,
      )
      .join('; ')
  }
}

export interface BackfillDeps {
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
  readonly calculators: ReadonlyMap<string, ScoringDriver>
  readonly aggregators: ReadonlyMap<string, ScoringDriver>
}

/** how many rows one pass reads at a time */
const BATCH = 200

/**
 * Compile every revision still missing a plan. Idempotent by construction:
 * the query only ever finds rows without one.
 *
 * A revision whose configuration no longer compiles STOPS THE BOOT. This is
 * upgrade debt, not user input: the whole reason the work runs at the
 * barrier is that a started server means every stored question can be
 * scored, and an assembly that serves requests while holding an item
 * revision guaranteed to fail on sight is worse than one that refuses to
 * start and says which revision to fix.
 *
 * Must be called inside a transaction: the advisory lock below is
 * transaction-scoped, so without one it would be released the instant its
 * own statement finished and two booting processes would compile the same
 * rows against each other.
 */
export const sweepScoringPlans = (deps: BackfillDeps) =>
  Effect.gen(function* () {
    // one process at a time across the deployment; a second one finds
    // nothing left to do rather than fighting for the same rows
    yield* db.query((k) =>
      sql`select pg_advisory_xact_lock(('x' || substr(md5('assessment:scoring-plan-backfill'), 1, 16))::bit(64)::bigint)`.execute(
        k,
      ),
    )
    let compiled = 0
    for (;;) {
      const found = yield* db.query((k) =>
        sql<PendingRevision>`
          select r.id as "id",
                 i.item_type as "itemType",
                 r.entry_source as "entrySource",
                 r.form_config as "formConfig",
                 r.scoring_config as "scoringConfig",
                 r.review_policy as "reviewPolicy",
                 b.material_range::text as "materialRange"
          from assessment_item_revisions r
          join assessment_items i on i.tenant_id = r.tenant_id and i.id = r.item_id
          join assessment_batches b on b.tenant_id = i.tenant_id and b.id = i.batch_id
          where r.scoring_plan is null
          order by r.id
          limit ${BATCH}
        `.execute(k),
      )
      const pending = found.rows
      if (pending.length === 0) break
      for (const revision of pending) {
        const batch: BatchContext = { materialRange: parseRange(revision.materialRange) }
        const outcome = yield* compileScoringPlan({
          calculators: deps.calculators,
          aggregators: deps.aggregators,
          itemType: deps.itemTypes.get(revision.itemType),
          formConfig: revision.formConfig,
          scoringConfig: revision.scoringConfig,
          batch,
          recognitionSource: recognitionSourceOf({
            interaction: deps.itemTypes.get(revision.itemType)?.interaction,
            entrySource: revision.entrySource,
            reviewMode: policyModeOf(revision.reviewPolicy),
          }),
        })
        if ('issues' in outcome) {
          return yield* new ScoringPlanBackfillFailed({
            revisionId: revision.id,
            issues: outcome.issues.map((issue) => `${issue.path} ${issue.reason}`),
          })
        }
        yield* db.query((k) =>
          sql`update assessment_item_revisions
              set scoring_plan = ${sql.val(JSON.stringify(outcome.plan))}::jsonb
              where id = ${revision.id} and scoring_plan is null`.execute(k),
        )
        compiled += 1
      }
      // every row this pass found was compiled - a refusal returns above -
      // so the next read starts from what is genuinely left
      if (pending.length < BATCH) break
    }
    if (compiled > 0) {
      yield* Effect.logInfo(`scoring plans compiled for ${compiled} item revision(s)`)
    }
  })

interface StoredRef {
  readonly ref: string
  readonly revisionId: string
}

/**
 * Whether every driver the STORED plans name is one this assembly provides.
 *
 * The backfill above only meets revisions without a plan; a revision whose
 * plan already exists is never recompiled, so unplugging the plugin that
 * provided its calculator would pass boot silently and fail on the first
 * results page. Frozen review contracts keep old revisions judgeable long
 * after a question moves on, so every stored plan counts, not just the
 * current ones. Refusing ready is the honest answer: it names what to
 * reinstall - or which questions to retire - before anybody is served.
 */
export const auditStoredPlanDrivers = (deps: BackfillDeps) =>
  Effect.gen(function* () {
    const storedRefs = (path: string) =>
      Effect.map(
        db.query((k) =>
          sql<StoredRef>`
            select r.scoring_plan->${sql.raw(`'${path}'`)}->>'ref' as "ref",
                   min(r.id::text) as "revisionId"
            from assessment_item_revisions r
            where r.scoring_plan is not null
            group by 1
          `.execute(k),
        ),
        (result) => result.rows,
      )
    const missing: { kind: string; ref: string; revisionId: string }[] = []
    for (const row of yield* storedRefs('calculator')) {
      if (!deps.calculators.has(row.ref)) {
        missing.push({ kind: 'calculator', ref: row.ref, revisionId: row.revisionId })
      }
    }
    for (const row of yield* storedRefs('aggregator')) {
      if (!deps.aggregators.has(row.ref)) {
        missing.push({ kind: 'aggregator', ref: row.ref, revisionId: row.revisionId })
      }
    }
    if (missing.length > 0) {
      return yield* new StoredScoringDriverMissing({ missing })
    }
  })
