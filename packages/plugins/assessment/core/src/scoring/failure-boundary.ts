/**
 * What a calculator's failure means at the boundary that met it.
 *
 * The failure kind says what happened inside the arithmetic; it does not
 * say what to do about it. That is decided by where the host was standing:
 * a rule lawfully refusing these values is an answer to whoever is trying
 * to determine them, and a defect once they already stand as a fact.
 * So the two sources of failure - preparing the arithmetic and running it -
 * are mapped separately, and never share a table. A refusal on the way in
 * (a runtime declining to prepare) is not the rule refusing anybody's
 * determination, whatever kind it wore.
 */

import { Data, Effect, Result } from 'effect'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import { boundedCounter } from '@qualy/telemetry/metrics'
import type {
  CalculatorFailureKind,
  CalculatorRuntimeError,
  ScoringRuntimeCatalog,
} from '../plugin.ts'
import { DeterminationRefused, ScoringUnavailable } from '../errors.ts'
import { evaluateRecognition, type ScoringEvaluationFailed } from './evaluate.ts'
import { frozenCalculatorOf, type ScoringPlan } from './plan.ts'

/**
 * Every evaluation, counted by where it was asked and how it ended.
 *
 * Two bounded labels and nothing else: the outcome is the calculator's own
 * word for it, the operation is the host's. Which rule, which question,
 * which determination stay in the log - a metric carrying them would
 * carry a label per formula.
 */
const evaluationCount = boundedCounter('qualy.assessment.scoring.evaluation', {
  operation: ['result', 'settlement', 'impact'],
  outcome: ['success', 'refusal', 'unavailable', 'execution', 'integrity', 'invariant'],
})

/** counts how one evaluation ended, whichever half of the arithmetic said so */
export const countEvaluation =
  (operation: 'result' | 'settlement' | 'impact') =>
  <A, E extends { readonly kind: CalculatorFailureKind }, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.tap(() => evaluationCount({ operation, outcome: 'success' })),
      Effect.tapError((error) => evaluationCount({ operation, outcome: error.kind })),
    )

/** where the host stood when the arithmetic failed */
export type FailureBoundary = 'settlement' | 'result' | 'impact-current' | 'impact-candidate'

/** what a log line needs to name the arithmetic, and nothing a person wrote */
export interface FailureSite {
  readonly tenantId: string
  readonly batchId: string
  readonly itemId: string
  readonly plan: ScoringPlan
}

const annotated = (site: FailureSite, kind: string, reason: string) => ({
  tenantId: site.tenantId,
  batchId: site.batchId,
  itemId: site.itemId,
  calculatorRef: site.plan.calculator.ref,
  runtimeRef:
    site.plan.version === 2 && site.plan.calculator.runtimeRef !== undefined
      ? site.plan.calculator.runtimeRef
      : null,
  kind,
  reason,
})

/** a failure that is nobody's decision: named in the log, then a defect */
export const defectAt = (
  site: FailureSite,
  error: { readonly kind: string; readonly reason: string },
): Effect.Effect<never> =>
  Effect.logError('scoring failed', annotated(site, error.kind, error.reason)).pipe(
    Effect.andThen(Effect.die(error)),
  )

/**
 * Preparing the arithmetic failed.
 *
 * Only an outage is anybody's to retry; every other kind - a frozen promise
 * broken, a state proven impossible, and a runtime that declines - is the
 * host's fault or the assembly's, at every boundary alike.
 */
export const mapRuntimeFailure = (
  _boundary: FailureBoundary,
  site: FailureSite,
  error: CalculatorRuntimeError,
): Effect.Effect<never, ScoringUnavailable> =>
  error.kind === 'unavailable' ? Effect.fail(new ScoringUnavailable()) : defectAt(site, error)

/**
 * Running the arithmetic failed.
 *
 * At settlement a lawful refusal is the rule's answer to the person
 * determining, so it goes back to them in the rule's own words. Reading an
 * account, the same refusal is a defect: what stands as a fact was proven
 * against the rule before it stood, so a refusal there means a state this
 * process should never have allowed.
 */
export const mapEvaluationFailure = (
  boundary: FailureBoundary,
  site: FailureSite,
  error: ScoringEvaluationFailed,
): Effect.Effect<never, DeterminationRefused | ScoringUnavailable> => {
  if (error.kind === 'unavailable') return Effect.fail(new ScoringUnavailable())
  if (error.kind === 'refusal' && boundary === 'settlement') {
    return Effect.fail(new DeterminationRefused({ itemId: site.itemId, reason: error.reason }))
  }
  return defectAt(site, error)
}

/**
 * Running the arithmetic failed while an account was being read.
 *
 * The same rule as above, said with the type the reader can honour: only
 * an outage comes back as a failure; a refusal here is a state that was
 * proven impossible before it stood, and dies with everything else.
 */
export const mapResultFailure = (
  site: FailureSite,
  error: ScoringEvaluationFailed,
): Effect.Effect<never, ScoringUnavailable> =>
  error.kind === 'unavailable' ? Effect.fail(new ScoringUnavailable()) : defectAt(site, error)

/**
 * A determination the writer is about to make a fact, and what the proof
 * of it depends on.
 *
 * `identity` is the writer's own summary of every fact the probe's answer
 * rests on - which plan, which values, which round standing where - so
 * that a proof carried across the gap between two transactions can be
 * told from one that has stopped applying.
 */
export interface SettlementProbe extends FailureSite {
  readonly identity: string
  /** the item revision whose plan this is: what a conflict names when it moved */
  readonly revisionId: string
  readonly recognition: Readonly<Record<string, unknown>>
}

/** the fields a settlement's proof rests on, spelled one way */
export const probeIdentity = (fields: Record<string, unknown>): string => hashCanonicalJson(fields)

/**
 * Raised by a writer that reached the point of writing a determination
 * without a proof for it - or with one that no longer applies.
 *
 * Raised inside the transaction on purpose: failing it rolls back whatever
 * the writer had already done on the way (a sitting constituted, a seat
 * taken), so a probe is met with nothing written, and the writer runs
 * again once there is a proof.
 */
export class ProbeNeeded extends Data.TaggedError('ProbeNeeded')<{
  readonly probe: SettlementProbe
}> {}

/** proves one determination against the arithmetic, outside any transaction */
export const proveSettlement = (
  runtime: ScoringRuntimeCatalog['Service'],
  probe: SettlementProbe,
): Effect.Effect<void, DeterminationRefused | ScoringUnavailable> =>
  Effect.gen(function* () {
    const prepared = yield* runtime
      .prepare(probe.plan.calculator.ref, frozenCalculatorOf(probe.plan), {
        tenantId: probe.tenantId,
        batchId: probe.batchId,
      })
      .pipe(Effect.catch((error) => mapRuntimeFailure('settlement', probe, error)))
    yield* evaluateRecognition(prepared, {
      itemId: probe.itemId,
      plan: probe.plan,
      recognition: probe.recognition,
    }).pipe(
      countEvaluation('settlement'),
      Effect.catch((error) => mapEvaluationFailure('settlement', probe, error)),
    )
  })

/**
 * Runs a writer that may ask for a proof, and gives it one.
 *
 * The writer is run once with no proof. If it reaches a determination it
 * would write, it fails with what to prove and the transaction it was in
 * rolls back; the proof is made here, outside any transaction, and the
 * writer runs again carrying the identity it was proven for. A writer
 * that asks a second time has found the facts moved between the two runs,
 * and says so with the conflict of its own domain.
 */
export const settleWithProbe = <A, E, R, Moved>(
  runtime: ScoringRuntimeCatalog['Service'],
  attempt: (proven: string | null) => Effect.Effect<A, E | ProbeNeeded, R>,
  moved: (first: SettlementProbe, again: SettlementProbe) => Moved,
): Effect.Effect<A, E | Moved | DeterminationRefused | ScoringUnavailable, R> =>
  Effect.gen(function* () {
    // sorted by instance rather than by tag: the writer's own errors are a
    // type parameter here, and a tag cannot be told apart from an unknown one
    const first = yield* Effect.result(attempt(null))
    if (Result.isSuccess(first)) return first.success
    if (!(first.failure instanceof ProbeNeeded)) return yield* Effect.fail(first.failure as E)
    const probe = first.failure.probe
    yield* proveSettlement(runtime, probe)
    const second = yield* Effect.result(attempt(probe.identity))
    if (Result.isSuccess(second)) return second.success
    if (second.failure instanceof ProbeNeeded) {
      return yield* Effect.fail(moved(probe, second.failure.probe))
    }
    return yield* Effect.fail(second.failure as E)
  })

/**
 * Proves many determinations against one question's arithmetic, at once.
 *
 * A bulk administrative act cannot be a loop over `settleWithProbe`: that
 * shape runs the writer, rolls it back, proves, and runs it again - once per
 * row, each attempt taking the batch lock. Two thousand of those is a lock
 * held for the length of two thousand sandbox runs, which is how a scoring
 * boundary becomes an outage.
 *
 * So the order is inverted. Everything is proven FIRST, outside any
 * transaction, and the write that follows carries identities it already
 * has. Three things make that affordable:
 *
 *   - the runtime is prepared once. Every row of one import answers the same
 *     question version, so it is the same calculator and the same plan.
 *   - determinations are deduplicated by what they say. A hundred students
 *     recorded at the same level are one piece of arithmetic.
 *   - the concurrency is the one the rest of scoring already uses, because
 *     the sandbox is the same sandbox.
 *
 * What comes back is per distinct determination: an identity to carry into
 * the write, or the refusal that determination earned. A refusal belongs to
 * the rows that asked for it and does not stop the others being reported -
 * the caller decides what to do with a partial answer, and for an import
 * that decision is "show every bad row at once". An outage is different and
 * is raised: nothing can be proven, so nothing can be written.
 */
export const proveSettlements = (
  runtime: ScoringRuntimeCatalog['Service'],
  site: FailureSite & { readonly revisionId: string },
  recognitions: readonly Readonly<Record<string, unknown>>[],
): Effect.Effect<
  ReadonlyMap<string, { readonly identity: string } | { readonly refused: DeterminationRefused }>,
  ScoringUnavailable
> =>
  Effect.gen(function* () {
    // one determination per distinct thing said, keyed by the hash the
    // writer's own identity is built from
    const distinct = new Map<string, Readonly<Record<string, unknown>>>()
    for (const values of recognitions) {
      const key = hashCanonicalJson(values)
      if (!distinct.has(key)) distinct.set(key, values)
    }
    const out = new Map<
      string,
      { readonly identity: string } | { readonly refused: DeterminationRefused }
    >()
    if (distinct.size === 0) return out

    // prepared once for the whole import: same question version, same plan
    const prepared = yield* runtime
      .prepare(site.plan.calculator.ref, frozenCalculatorOf(site.plan), {
        tenantId: site.tenantId,
        batchId: site.batchId,
      })
      .pipe(Effect.catch((error) => mapRuntimeFailure('settlement', site, error)))

    const judged = yield* Effect.forEach(
      [...distinct.entries()],
      ([key, values]) =>
        evaluateRecognition(prepared, {
          itemId: site.itemId,
          plan: site.plan,
          recognition: values,
        }).pipe(
          countEvaluation('settlement'),
          Effect.catch((error) =>
            mapEvaluationFailure('settlement', site, error).pipe(
              // a refusal is this determination's answer, not the import's:
              // the reader is owed every bad row, not the first one
              Effect.catchTag('ASSESSMENT_DETERMINATION_REFUSED', (refused) =>
                Effect.succeed({ key, refused }),
              ),
            ),
          ),
          Effect.map((result) =>
            result !== undefined && typeof result === 'object' && 'refused' in result
              ? (result as { key: string; refused: DeterminationRefused })
              : { key, identity: identityOf(site, key, values) },
          ),
        ),
      { concurrency: PROOF_CONCURRENCY },
    )
    for (const one of judged) {
      out.set(one.key, 'refused' in one ? { refused: one.refused } : { identity: one.identity })
    }
    return out
  })

/** the same summary a single write proves itself against */
const identityOf = (
  site: FailureSite & { readonly revisionId: string },
  recognitionHash: string,
  _values: Readonly<Record<string, unknown>>,
): string =>
  probeIdentity({
    revisionId: site.revisionId,
    planHash: site.plan.planHash,
    recognition: recognitionHash,
  })

/** the sandbox is the same sandbox the rest of scoring bounds at four */
const PROOF_CONCURRENCY = 4
