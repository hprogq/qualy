/**
 * The formula@1 calculator: a published FormulaVersion, bound to a question.
 *
 * The administrator's whole configuration is one exact UUID. Compiling
 * resolves that immutable version and - for a NEW binding - proves it
 * bindable inside the batch's management boundary; a compile that carries
 * the previous plan's own runtime identity is a continuation of an
 * existing binding and is never re-gated, so archiving a function or
 * moving its owner cannot strand a question that already runs it.
 *
 * Neither compile nor verify ever contacts the sandbox: a published
 * version's contract was extracted, tested and frozen at publication, and
 * boot readiness must not require an execution process to be online.
 * Prepare re-proves the whole frozen fact in ONE resolution and captures
 * the exact artifact that resolution returned; evaluate hands it to the
 * sandbox under the scoring budget and reads the answer with the strict
 * envelope decoder.
 *
 * Every failure carries its kind. Integrity means a frozen promise broke;
 * a refusal is the calculator lawfully saying no; an invariant is the host
 * contradicting itself - a batch the save already locked reported missing,
 * or a version this compile just resolved reported nonexistent.
 */

import { Effect, Schema } from 'effect'
import {
  CalculatorContractError,
  CalculatorEvaluationError,
  CalculatorRuntimeError,
  type BoundCalculator,
  type CalculatorCompileContext,
  type CalculatorHostContext,
  type CalculatorRegistration,
  type CompiledCalculator,
  type FrozenCalculatorContract,
} from '@qualy/plugin-assessment/plugin'
import { Sandbox } from '@qualy/plugin-sandbox/service'
import {
  FormulaRuntimeStore,
  type FormulaRuntimeResolutionError,
  type FormulaRuntimeVersion,
} from '../server/runtime-store.ts'
import { BindableFormulaCatalog, type FormulaNotBindable } from '../server/binding-catalog.ts'
import { contractIdentityOf } from '../server/contract-identity.ts'
import { decodeFormulaEnvelope } from '../server/envelope.ts'
import { FORMULA_SCORING_LIMITS } from './limits.ts'

const REF = 'formula@1'
export const RUNTIME_REF_KIND = 'formula-version'
const UUIDV7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface FormulaConfig {
  readonly versionId: string
}

/**
 * The exact raw reading of this calculator's one-field language: a plain
 * object whose own keys are exactly {versionId}, holding a server-minted
 * identity. Shared by the authoring schema below and by the frozen-config
 * decode in resolveFrozen - the two doors a config can arrive through.
 */
export const decodeFormulaConfig = (raw: unknown): FormulaConfig | undefined => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const proto = Object.getPrototypeOf(raw)
  if (proto !== Object.prototype && proto !== null) return undefined
  const keys = Object.keys(raw)
  if (keys.length !== 1 || keys[0] !== 'versionId') return undefined
  const versionId = (raw as Record<string, unknown>)['versionId']
  if (typeof versionId !== 'string' || !UUIDV7_SHAPE.test(versionId)) return undefined
  return { versionId }
}

/**
 * The strict codec the core's generic config decode runs. It judges the RAW
 * object - Schema.Unknown decodes as identity, so the filter sees what the
 * administrator actually submitted, before any projection could strip an
 * unknown key. An excess key therefore refuses the save at the seam; the
 * calculator's own compile never has to see it to say no.
 */
export const formulaConfigSchema = Schema.Unknown.pipe(
  Schema.check(
    Schema.makeFilter((raw) =>
      decodeFormulaConfig(raw) === undefined
        ? 'a formula binding names exactly { versionId }'
        : undefined,
    ),
  ),
)

const contractRefusal = (
  kind: ConstructorParameters<typeof CalculatorContractError>[0],
  code: string,
  reason: string,
) => new CalculatorContractError(kind, reason, code)

/** how a resolution failure reads at compile time: for a continuation the
 *  version's absence is a broken frozen promise; for a new binding it is
 *  the administrator naming a version that does not exist */
const compileResolutionFailure = (error: FormulaRuntimeResolutionError, continuation: boolean) => {
  switch (error._tag) {
    case 'ASSESSMENT_FORMULA_RUNTIME_MISSING':
      return continuation
        ? contractRefusal(
            'integrity',
            'formula-runtime-missing',
            `formula version ${error.versionId} is frozen onto this question but no longer resolvable`,
          )
        : contractRefusal(
            'refusal',
            'formula-version-not-found',
            `formula version ${error.versionId} does not exist for this tenant`,
          )
    case 'ASSESSMENT_FORMULA_RUNTIME_TAMPERED':
      return contractRefusal(
        'integrity',
        'formula-runtime-tampered',
        `formula version ${error.versionId} no longer matches its published ${error.field}`,
      )
    case 'ASSESSMENT_FORMULA_RUNTIME_UNSUPPORTED':
      return contractRefusal(
        'integrity',
        'formula-runtime-unsupported',
        `formula version ${error.versionId} was published under ${String(error.issues[0]?.facet)} this build does not certify`,
      )
  }
}

/** how the bindability answer reads: one lawful refusal, and one answer
 *  that contradicts what this very compile already proved */
const bindabilityFailure = (error: FormulaNotBindable) => {
  switch (error.reason) {
    case 'function-archived':
      return contractRefusal(
        'refusal',
        'formula-function-archived',
        'the formula function is archived; a new binding needs a live one',
      )
    case 'version-not-found':
      // this compile resolved the immutable version moments ago
      return contractRefusal(
        'invariant',
        'formula-version-vanished',
        'a version this compile just resolved is reported nonexistent',
      )
  }
}

const integrity = (reason: string) => new CalculatorRuntimeError('integrity', reason)

/**
 * The one proof behind verify and prepare: strict config decode, exact
 * resolution, and the frozen fact held to it field by field - reference,
 * contract, proving profiles - with the schema semantics carried by the
 * publication's own identity algorithm: contractIdentityOf(frozen schemas)
 * must equal the frozen contractHash, which must equal the row's
 * contractSha256 that the store itself re-proved against the row's schemas.
 * What prepare executes is what THIS resolution returned.
 */
const resolveFrozenWith = (
  store: {
    readonly resolve: (input: {
      readonly tenantId: string
      readonly versionId: string
    }) => Effect.Effect<FormulaRuntimeVersion, FormulaRuntimeResolutionError>
  },
  frozen: FrozenCalculatorContract,
  host: CalculatorHostContext,
): Effect.Effect<FormulaRuntimeVersion, CalculatorRuntimeError> =>
  Effect.gen(function* () {
    const config = decodeFormulaConfig(frozen.config)
    if (config === undefined) {
      return yield* Effect.fail(integrity("the frozen config is not this calculator's language"))
    }
    const resolved = yield* store
      .resolve({ tenantId: host.tenantId, versionId: config.versionId })
      .pipe(
        Effect.mapError((error) =>
          integrity(`formula version ${config.versionId} broke its frozen promise: ${error._tag}`),
        ),
      )
    const reference = frozen.runtimeRef
    if (
      reference === undefined ||
      reference.kind !== RUNTIME_REF_KIND ||
      reference.id !== config.versionId ||
      reference.sha256 !== resolved.runtimeSha256
    ) {
      return yield* Effect.fail(
        integrity('the frozen runtime reference is not this published version'),
      )
    }
    if (frozen.contractHash !== resolved.contractSha256) {
      return yield* Effect.fail(integrity('the frozen contract is not this published contract'))
    }
    if (
      frozen.valueSchemaProfileVersion === undefined ||
      frozen.regexProfileVersion === undefined
    ) {
      return yield* Effect.fail(
        integrity('a stored formula plan names the profiles it was proven under'),
      )
    }
    if (
      frozen.valueSchemaProfileVersion !== resolved.valueSchemaProfileVersion ||
      frozen.regexProfileVersion !== resolved.regexProfileVersion
    ) {
      return yield* Effect.fail(
        integrity("the frozen proving profiles are not this publication's profiles"),
      )
    }
    const identity = yield* Effect.try({
      try: () => contractIdentityOf(frozen.inputSchema, frozen.outputSchema),
      catch: () => integrity('the frozen schemas cannot be read as a contract'),
    })
    if (identity.contractSha256 !== frozen.contractHash) {
      return yield* Effect.fail(integrity('the frozen schemas are not the frozen contract'))
    }
    return resolved
  })

/** the sandbox's refusals, sorted into the failure taxonomy; a tag this
 *  build has never heard of reads as an execution failure - fail closed,
 *  never retried forever */
const evaluationFailure = (error: { readonly _tag: string }): CalculatorEvaluationError => {
  switch (error._tag) {
    case 'SandboxUnavailable':
    case 'SandboxWorkerLost':
      return new CalculatorEvaluationError(
        'unavailable',
        `the sandbox is unavailable: ${error._tag}`,
      )
    case 'SandboxTimeout':
    case 'SandboxMemoryExceeded':
    case 'SandboxStackExceeded':
    case 'SandboxOutputTooLarge':
    case 'SandboxInputTooLarge':
    case 'SandboxEvalFailed':
      return new CalculatorEvaluationError(
        'execution',
        `the formula failed to compute: ${error._tag}`,
      )
    case 'SandboxArtifactMismatch':
      return new CalculatorEvaluationError('integrity', 'the artifact is not its frozen hash')
    case 'SandboxArtifactTooLarge':
      // the scoring budget covers everything publication admits; a published
      // artifact refused here means the host broke publishable-means-executable
      return new CalculatorEvaluationError(
        'invariant',
        'a published artifact exceeded the scoring transport budget',
      )
    default:
      return new CalculatorEvaluationError('execution', `the sandbox refused: ${error._tag}`)
  }
}

export const formula1: CalculatorRegistration<
  FormulaRuntimeStore | BindableFormulaCatalog | Sandbox
> = {
  kind: 'calculator',
  ref: REF,
  configSchema: formulaConfigSchema,
  bind: Effect.gen(function* () {
    const store = yield* FormulaRuntimeStore
    const bindable = yield* BindableFormulaCatalog
    const sandbox = yield* Sandbox

    const compile = (
      config: unknown,
      context: CalculatorCompileContext,
    ): Effect.Effect<CompiledCalculator, CalculatorContractError> =>
      Effect.gen(function* () {
        // the core seam already refused anything outside the language; this
        // is the defensive re-read, not the gate
        const decoded = decodeFormulaConfig(config)
        if (decoded === undefined) {
          return yield* Effect.fail(
            contractRefusal(
              'invariant',
              'formula-config-invalid',
              'a config the strict schema admitted no longer decodes',
            ),
          )
        }
        const previous = context.previousRuntimeRef
        if (previous !== undefined && previous.kind !== RUNTIME_REF_KIND) {
          // another calculator's identity under this calculator's recompile:
          // the plan and its calculator have come apart
          return yield* Effect.fail(
            contractRefusal(
              'integrity',
              'formula-previous-runtime-alien',
              'the previous plan froze a runtime identity that is not a formula version',
            ),
          )
        }
        const continuation = previous !== undefined && previous.id === decoded.versionId
        const resolved = yield* store
          .resolve({ tenantId: context.tenantId, versionId: decoded.versionId })
          .pipe(Effect.mapError((error) => compileResolutionFailure(error, continuation)))
        if (continuation) {
          // the SAME identity, all three fields of it: a matching id with a
          // corrupt historical sha is a broken frozen promise, and a plain
          // resave must never quietly repair it to the current bytes
          if (previous.sha256 !== resolved.runtimeSha256) {
            return yield* Effect.fail(
              contractRefusal(
                'integrity',
                'formula-continuation-corrupt',
                "the previous plan's runtime hash is not this version's published hash",
              ),
            )
          }
        } else {
          yield* bindable
            .requireBindable(context.tenantId, decoded.versionId)
            .pipe(Effect.mapError(bindabilityFailure))
        }
        return {
          inputSchema: resolved.inputSchema,
          outputSchema: resolved.outputSchema,
          contractHash: resolved.contractSha256,
          config: { versionId: decoded.versionId },
          runtimeRef: {
            kind: RUNTIME_REF_KIND,
            id: decoded.versionId,
            sha256: resolved.runtimeSha256,
          },
        }
      })

    const bound: BoundCalculator = {
      ref: REF,
      compile,
      verify: (frozen, context) => resolveFrozenWith(store, frozen, context).pipe(Effect.asVoid),
      prepare: (frozen, context) =>
        resolveFrozenWith(store, frozen, context).pipe(
          Effect.map((resolved) => ({
            evaluate: (input: Record<string, unknown>) =>
              sandbox
                .invoke({
                  artifact: resolved.runtimeJs,
                  artifactHash: resolved.runtimeSha256,
                  entrypoint: '__qualyInvoke',
                  arguments: [JSON.stringify(input)],
                  limits: FORMULA_SCORING_LIMITS,
                })
                .pipe(
                  Effect.mapError(evaluationFailure),
                  Effect.flatMap((answer) => {
                    const read = decodeFormulaEnvelope(answer.output)
                    if (read._tag === 'malformed') {
                      return Effect.fail(
                        new CalculatorEvaluationError(
                          'execution',
                          `malformed formula envelope: ${read.reason}`,
                        ),
                      )
                    }
                    return read.envelope.ok
                      ? Effect.succeed(read.envelope.amount)
                      : Effect.fail(
                          new CalculatorEvaluationError('refusal', read.envelope.failure.message),
                        )
                  }),
                ),
          })),
        ),
    }
    return bound
  }),
}
