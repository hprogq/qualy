/**
 * What stands, evaluated under the rule it stands under, today.
 *
 * The settlement gates keep a determination the rule refuses from becoming
 * a fact - from now on. What was a fact before the gates, and what a rule
 * bound to a granted question makes of its own amount, nothing asks until
 * a student opens the results page. This asks, for every question anybody
 * can be scored by: the plan is read, prepared once, and every
 * determination in force is evaluated under it - plus, for a granted
 * question, the empty determination its amount is read from - and the
 * calculator's own word for each answer is counted. Nothing is written,
 * nothing is retried, and no failure is died on: a report with every
 * failure named is the whole point.
 *
 * Outside any transaction, and never holding a connection across the
 * arithmetic: each read is one statement, and the rule runs only once the
 * rows are in hand. Bounded in concurrency the way the impact trial is.
 */

import { Effect, Result } from 'effect'
import type { QueryFailed, Orm } from '@qualy/plugin-database/server'
import {
  ItemTypeCatalog,
  ScoringRuntimeCatalog,
  type CalculatorFailureKind,
  type PreparedCalculator,
} from '../plugin.ts'
import { liveEntryPayloads, revisionOf } from '../item/db.ts'
import { auditableItems, type AuditableItem } from './db.ts'
import { evaluateRecognition, type ScoringEvaluationFailed } from './evaluate.ts'
import { EVALUATION_CONCURRENCY } from './impact-probe.ts'
import { frozenCalculatorOf, readScoringPlan, type ScoringPlan } from './plan.ts'

export interface ScoringAuditFilter {
  readonly tenantId?: string
  readonly batchId?: string
}

/** what a calculator said, or that the plan could not be read at all */
export type ScoringAuditFailureKind = CalculatorFailureKind | 'unreadable'

export interface ScoringAuditFailure {
  readonly tenantId: string
  readonly batchId: string
  readonly itemId: string
  /** the determination, when the failure is one determination's */
  readonly entryId?: string
  /** a granted question's own amount, rather than anybody's determination */
  readonly derived: boolean
  readonly stage: 'plan' | 'prepare' | 'evaluate'
  readonly kind: ScoringAuditFailureKind
  /** the calculator's own words, never the determination */
  readonly reason: string
}

/**
 * The verdict, in the order it is decided.
 *
 * A plan that cannot be read or prepared, a frozen promise broken or a
 * state proven impossible is a fault this audit cannot see past, so it
 * closes on it before counting anything else. A determination the rule
 * refuses or cannot compute is history that diverged from its rule. An
 * outage proves nothing either way: not a violation, and not a clean bill.
 */
export type ScoringAuditVerdict = 'clean' | 'violations' | 'inconclusive' | 'fail-closed'

export interface ScoringAuditReport {
  /** questions evaluated: active, configured, in any round */
  readonly items: number
  /** plans read and prepared, one per question */
  readonly plans: number
  /** determinations in force under those questions */
  readonly recognitions: number
  /** granted questions, each evaluated on its own amount */
  readonly derivedGrants: number
  readonly accepted: number
  readonly refused: number
  readonly executionFailed: number
  readonly unavailable: number
  readonly integrityFailed: number
  readonly invariantFailed: number
  /** plans that could not be read */
  readonly unreadable: number
  /** plans whose calculator would not prepare, for any reason but an outage */
  readonly unprepared: number
  readonly failures: readonly ScoringAuditFailure[]
  readonly verdict: ScoringAuditVerdict
}

const PAGE = 200

type Tally = Omit<ScoringAuditReport, 'failures' | 'verdict'>

/**
 * The counters decide which verdict, and the failures decide whether there
 * can be a clean one at all.
 *
 * The second half is the floor rather than a second opinion: every counter is
 * a count of things, and a count can be zero for a failure that still
 * happened. A report that names a failure and calls itself clean is a report
 * nobody can act on, whichever counter did not move.
 */
const verdictOf = (tally: Tally, failures: readonly ScoringAuditFailure[]): ScoringAuditVerdict =>
  tally.integrityFailed + tally.invariantFailed + tally.unreadable + tally.unprepared > 0
    ? 'fail-closed'
    : tally.refused + tally.executionFailed > 0
      ? 'violations'
      : tally.unavailable > 0 || failures.length > 0
        ? 'inconclusive'
        : 'clean'

const EXIT_CODES: Record<ScoringAuditVerdict, 0 | 2 | 3 | 4> = {
  clean: 0,
  violations: 2,
  inconclusive: 3,
  'fail-closed': 4,
}

/** what a process ends with: only a clean audit lets a deployment go on */
export const exitCodeOf = (verdict: ScoringAuditVerdict): 0 | 2 | 3 | 4 => EXIT_CODES[verdict]

export const auditScoringState = (
  filter: ScoringAuditFilter,
): Effect.Effect<ScoringAuditReport, QueryFailed, Orm | ScoringRuntimeCatalog | ItemTypeCatalog> =>
  Effect.gen(function* () {
    const runtime = yield* ScoringRuntimeCatalog
    const itemTypes = yield* ItemTypeCatalog
    const tally = {
      items: 0,
      plans: 0,
      recognitions: 0,
      derivedGrants: 0,
      accepted: 0,
      refused: 0,
      executionFailed: 0,
      unavailable: 0,
      integrityFailed: 0,
      invariantFailed: 0,
      unreadable: 0,
      unprepared: 0,
    }
    const failures: ScoringAuditFailure[] = []

    const count = (kind: CalculatorFailureKind) => {
      switch (kind) {
        case 'refusal':
          tally.refused += 1
          return
        case 'execution':
          tally.executionFailed += 1
          return
        case 'unavailable':
          tally.unavailable += 1
          return
        case 'integrity':
          tally.integrityFailed += 1
          return
        case 'invariant':
          tally.invariantFailed += 1
          return
      }
    }

    const auditItem = (item: AuditableItem) =>
      Effect.gen(function* () {
        tally.items += 1
        const site = { tenantId: item.tenantId, batchId: item.batchId, itemId: item.id }
        const revision = yield* revisionOf(item.tenantId, item.currentRevisionId)
        if (revision === null) {
          tally.unreadable += 1
          failures.push({
            ...site,
            derived: false,
            stage: 'plan',
            kind: 'unreadable',
            reason: 'the current revision is missing',
          })
          return
        }
        const read = yield* Effect.result(readScoringPlan(revision))
        if (Result.isFailure(read)) {
          tally.unreadable += 1
          failures.push({
            ...site,
            derived: false,
            stage: 'plan',
            kind: 'unreadable',
            reason: read.failure.reason,
          })
          return
        }
        const plan: ScoringPlan = read.success
        tally.plans += 1
        const derived = itemTypes.get(item.itemType)?.interaction === 'derived'
        // the rows before the rule: an outage of the rule still has to say
        // how many determinations it left unproven
        const rows = (yield* liveEntryPayloads(item.tenantId, item.id)).filter(
          (row) => row.status === 'approved' && row.recognition !== null,
        )
        tally.recognitions += rows.length
        if (derived) tally.derivedGrants += 1

        const prepared = yield* Effect.result(
          runtime.prepare(plan.calculator.ref, frozenCalculatorOf(plan), {
            tenantId: item.tenantId,
            batchId: item.batchId,
          }),
        )
        if (Result.isFailure(prepared)) {
          const error = prepared.failure
          if (error.kind === 'unavailable') {
            // at least the rule itself. Counting only the determinations it
            // left unproven made an outage on a question nobody has filed
            // against add nothing at all, and a tally of nothing reads as a
            // clean bill: the audit named the failure and then said the
            // arithmetic was sound, and exited 0.
            tally.unavailable += Math.max(1, rows.length + (derived ? 1 : 0))
          } else {
            tally.unprepared += 1
          }
          failures.push({
            ...site,
            derived: false,
            stage: 'prepare',
            kind: error.kind,
            reason: error.reason,
          })
          return
        }
        const calculator: PreparedCalculator = prepared.success

        const record = (
          outcome: Result.Result<unknown, ScoringEvaluationFailed>,
          entryId: string | undefined,
          isDerived: boolean,
        ) => {
          if (Result.isSuccess(outcome)) {
            tally.accepted += 1
            return
          }
          count(outcome.failure.kind)
          failures.push({
            ...site,
            ...(entryId === undefined ? {} : { entryId }),
            derived: isDerived,
            stage: 'evaluate',
            kind: outcome.failure.kind,
            reason: outcome.failure.reason,
          })
        }

        const outcomes = yield* Effect.forEach(
          rows,
          (row) =>
            Effect.result(
              evaluateRecognition(calculator, {
                itemId: item.id,
                plan,
                recognition: row.recognition!,
              }),
            ),
          // each row is a round trip to whatever runs the arithmetic
          { concurrency: EVALUATION_CONCURRENCY },
        )
        rows.forEach((row, index) => record(outcomes[index]!, row.entryId, false))
        // a granted question's amount, whether or not anybody stands under it:
        // the empty determination is exactly what the results page reads
        if (derived) {
          record(
            yield* Effect.result(
              evaluateRecognition(calculator, { itemId: item.id, plan, recognition: {} }),
            ),
            undefined,
            true,
          )
        }
      })

    let after: string | undefined
    for (;;) {
      const page = yield* auditableItems({
        ...(after === undefined ? {} : { after }),
        ...(filter.tenantId === undefined ? {} : { tenantId: filter.tenantId }),
        ...(filter.batchId === undefined ? {} : { batchId: filter.batchId }),
        limit: PAGE,
      })
      if (page.length === 0) break
      for (const item of page) yield* auditItem(item)
      after = page[page.length - 1]!.id
      if (page.length < PAGE) break
    }

    return { ...tally, failures, verdict: verdictOf(tally, failures) }
  })
