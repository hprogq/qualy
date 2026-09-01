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
import type { CalculatorRuntimeError, ScoringRuntimeCatalog } from '../plugin.ts'
import { DeterminationRefused, ScoringUnavailable } from '../server/errors.ts'
import { evaluateRecognition, type ScoringEvaluationFailed } from './evaluate.ts'
import { frozenCalculatorOf, type ScoringPlan } from './plan.ts'

/** where the host stood when the arithmetic failed */
export type FailureBoundary = 'settlement' | 'result'

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
const dies = (site: FailureSite, error: { readonly kind: string; readonly reason: string }) =>
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
  error.kind === 'unavailable' ? Effect.fail(new ScoringUnavailable()) : dies(site, error)

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
  return dies(site, error)
}

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
    }).pipe(Effect.catch((error) => mapEvaluationFailure('settlement', probe, error)))
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
