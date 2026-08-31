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
import type {
  AggregatorDriver,
  BatchContext,
  CalculatorCompileContext,
  CalculatorContractError,
  CalculatorDefinition,
  CalculatorHostContext,
  CalculatorRuntimeError,
  CompiledCalculator,
  ItemTypeDriver,
  FrozenCalculatorContract,
} from '../plugin.ts'
import {
  compileScoringPlan,
  frozenCalculatorOf,
  readScoringPlan,
  recognitionSourceOf,
} from './plan.ts'
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
  readonly tenantId: string
  readonly batchId: string
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
  readonly kind: string
  readonly ref: string
  readonly revisionId: string
}> {
  override get message() {
    return `item revision ${this.revisionId} depends on ${this.kind} "${this.ref}" which this assembly does not provide`
  }
}

/** a stored plan this build cannot read; found at boot, never on a results page */
/** a stored plan whose frozen runtime fact its calculator can no longer verify */
export class StoredScoringRuntimeInvalid extends Data.TaggedError(
  'ASSESSMENT_STORED_SCORING_RUNTIME_INVALID',
)<{
  readonly revisionId: string
  readonly calculatorRef: string
  readonly reason: string
}> {}

export class StoredScoringPlanUnreadable extends Data.TaggedError(
  'ASSESSMENT_STORED_SCORING_PLAN_UNREADABLE',
)<{
  readonly revisionId: string
  readonly reason: string
}> {
  override get message() {
    return `item revision ${this.revisionId} holds a scoring plan this build cannot read: ${this.reason}`
  }
}

export interface BackfillDeps {
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
  readonly definitions: {
    readonly calculators: ReadonlyMap<string, CalculatorDefinition>
    readonly aggregators: ReadonlyMap<string, AggregatorDriver>
  }
  /** the runtime catalog's compile, closed over its bound calculators */
  readonly compile: (
    ref: string,
    config: unknown,
    context: CalculatorCompileContext,
  ) => Effect.Effect<CompiledCalculator, CalculatorContractError>
  /**
   * The runtime catalog's verify: does the frozen runtime fact behind a
   * stored plan still hold - the immutable row exists, its hashes match,
   * its profile is one this build interprets. It never contacts an
   * execution process: starting an API server must not require a sandbox
   * to be online (that is request-time availability, not readiness).
   */
  readonly verify: (
    ref: string,
    frozen: FrozenCalculatorContract,
    context: CalculatorHostContext,
  ) => Effect.Effect<void, CalculatorRuntimeError>
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
                 i.tenant_id as "tenantId",
                 i.batch_id as "batchId",
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
          definitions: deps.definitions,
          compile: deps.compile,
          // the trusted host context, from the row itself - never from the
          // stored configuration being compiled
          host: { tenantId: revision.tenantId, batchId: revision.batchId },
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

interface StoredPlanRow {
  readonly id: string
  readonly tenantId: string
  readonly batchId: string
  readonly scoringPlan: unknown
}

/**
 * Whether every frozen plan is one THIS build can actually execute.
 *
 * The backfill above only meets revisions without a plan; a revision whose
 * plan already exists is never recompiled, so ready has to prove the rest:
 * that each stored plan passes the one canonical reader (shape, hash,
 * profile, converter vocabulary) and names drivers this assembly provides.
 * Frozen review contracts keep old revisions judgeable long after a
 * question moves on, so every stored plan counts, not just the current
 * ones. Refusing ready is the honest answer: it names the revision to fix
 * - or the plugin to reinstall - before anybody is served a defect.
 */
export const auditStoredPlans = (deps: BackfillDeps) =>
  Effect.gen(function* () {
    let after: string | null = null
    for (;;) {
      const found = yield* db.query((k) =>
        sql<StoredPlanRow>`
          select r.id as "id",
                 i.tenant_id as "tenantId",
                 i.batch_id as "batchId",
                 r.scoring_plan as "scoringPlan"
          from assessment_item_revisions r
          join assessment_items i on i.tenant_id = r.tenant_id and i.id = r.item_id
          where r.scoring_plan is not null
            and (${after}::uuid is null or r.id > ${after}::uuid)
          order by r.id
          limit ${BATCH}
        `.execute(k),
      )
      const rows = found.rows
      if (rows.length === 0) break
      for (const row of rows) {
        const plan = yield* readScoringPlan({ id: row.id, scoringPlan: row.scoringPlan }).pipe(
          Effect.mapError(
            (unreadable) =>
              new StoredScoringPlanUnreadable({
                revisionId: row.id,
                reason: unreadable.reason,
              }),
          ),
        )
        if (!deps.definitions.calculators.has(plan.calculator.ref)) {
          return yield* new StoredScoringDriverMissing({
            kind: 'calculator',
            ref: plan.calculator.ref,
            revisionId: row.id,
          })
        }
        if (!deps.definitions.aggregators.has(plan.aggregator.ref)) {
          return yield* new StoredScoringDriverMissing({
            kind: 'aggregator',
            ref: plan.aggregator.ref,
            revisionId: row.id,
          })
        }
        // and the runtime fact itself, handed over WHOLE: the frozen
        // contract, the runtime reference and the profile versions the plan
        // was proven under (a V1 plan froze none of the latter, and none
        // are invented for it). fixed@1 verifies trivially; a calculator
        // whose facts live elsewhere re-proves them here, before the port
        // opens, never on a results page
        yield* deps
          .verify(plan.calculator.ref, frozenCalculatorOf(plan), {
            tenantId: row.tenantId,
            batchId: row.batchId,
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new StoredScoringRuntimeInvalid({
                  revisionId: row.id,
                  calculatorRef: plan.calculator.ref,
                  reason: error.reason,
                }),
            ),
          )
      }
      if (rows.length < BATCH) break
      after = rows[rows.length - 1]!.id
    }
  })
