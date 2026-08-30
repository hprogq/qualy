/**
 * The one place a scoring configuration becomes an execution plan.
 *
 * An administrator writes intent: which arithmetic, which aggregation, and -
 * once the language grows them - which recognized facts feed which of its
 * parameters. Compiling turns that into something a scoring run can execute
 * without deciding anything: every parameter bound exactly once, every
 * binding PROVEN assignable against the calculator's own contract, every
 * conversion recorded by name. The result is frozen onto the item revision,
 * so what an entry was scored by is a fact rather than a re-derivation.
 *
 * Nothing here knows what a competition, an evidence field or a formula is.
 * It knows parameters, schemas and assignability - the vocabulary of
 * @qualy/value-schema, which is the only type language this system has.
 */

import { Data, Effect, Schema } from 'effect'
import {
  assignmentPlan,
  canonicalizeAtomicSchema,
  canonicalizeInputSchema,
  normalizeAtomicSchema,
  type AssignmentPlan,
  type AtomicSchema,
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { SCORE_AMOUNT_SCHEMA } from '@qualy/value-schema/score'
import { validateValue } from '@qualy/value-schema/validate'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import type { BatchContext, ItemTypeDriver, ScoringDriver } from '../plugin.ts'

/** how one calculator parameter gets its value at scoring time */
export type ParameterBinding =
  | { readonly kind: 'constant'; readonly value: unknown }
  | {
      readonly kind: 'recognition'
      readonly recognitionId: string
      readonly assignment: AssignmentPlan
    }

/**
 * The frozen arithmetic of one item revision.
 *
 * `version` is the plan language's own, not the calculator's: a plan already
 * written is never rewritten, so a later version means new revisions compile
 * differently, never that old ones are recompiled.
 */
export interface ScoringPlan {
  readonly version: 1
  readonly calculator: {
    readonly ref: string
    readonly config: unknown
    /** the contract this plan was proven against */
    readonly contractHash: string
  }
  /** every parameter the contract requires, bound exactly once */
  readonly parameters: Readonly<Record<string, ParameterBinding>>
  /** what each recognition id admits, frozen for the reviewers who fill it */
  readonly recognitionSchemas: Readonly<Record<string, NormalizedAtomicSchema>>
  /** which evidence field seeds a recognition, and how it converts */
  readonly defaultBindings: Readonly<
    Record<string, { readonly fieldId: string; readonly assignment: AssignmentPlan }>
  >
  readonly aggregator: { readonly ref: string; readonly config: unknown }
  /** the calculator's own input contract, for validating an assembled input */
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
  readonly planHash: string
}

/**
 * A stored plan's shape, as this build will execute it.
 *
 * Structural only: the schemas inside were normalized when the plan was
 * compiled and are re-proven by the hash rather than re-parsed here.
 */
const persistedPlanShape = Schema.Struct({
  version: Schema.Number,
  calculator: Schema.Struct({
    ref: Schema.String,
    config: Schema.Unknown,
    contractHash: Schema.String,
  }),
  parameters: Schema.Record(Schema.String, Schema.Unknown),
  recognitionSchemas: Schema.Record(Schema.String, Schema.Unknown),
  defaultBindings: Schema.Record(Schema.String, Schema.Unknown),
  aggregator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
  inputSchema: Schema.Unknown,
  outputSchema: Schema.Unknown,
  planHash: Schema.String,
})

/** what a compile refuses, in the same shape item configuration issues take */
export interface PlanIssue {
  readonly path: string
  readonly reason: string
}

/**
 * The authoring language, as this phase reads it.
 *
 * `recognitions` and `bindings` are accepted and compiled but no production
 * calculator has parameters yet, so every stored configuration compiles to
 * the empty plan. The shapes are here so the compiler is general from the
 * start - a machinery written for the empty case is a machinery that has to
 * be rewritten for the first non-empty one.
 */
const authoringShape = Schema.Struct({
  calculator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
  aggregator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
  recognitions: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        label: Schema.optional(Schema.String),
        defaultFromFieldId: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  bindings: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal('constant'), value: Schema.Unknown }),
        Schema.Struct({ kind: Schema.Literal('recognition'), recognitionId: Schema.String }),
      ]),
    ),
  ),
})

/**
 * Who, if anyone, can determine a recognised fact for this question.
 *
 * The compiler needs this to answer one question honestly: can a recognition
 * with no evidence default ever be filled in? A reviewer can be asked for
 * one, and so can the member of staff recording an administrative fact - the
 * whole point of a reviewer-only field is that the student never claims it.
 * Nobody can be asked on a question that answers to nobody, and a derived
 * question has no filing and no determiner at all.
 */
export type RecognitionSource =
  /** a reviewer determines it while judging the claim */
  | 'review'
  /** the member of staff recording the fact determines it as they record */
  | 'administrative'
  /** the submission is the decision: whatever cannot be seeded is unfillable */
  | 'automatic'
  /** nobody files and nobody judges: a recognised fact has no author */
  | 'none'

/**
 * Who determines this question's recognised facts, from how it is filed and
 * how it is judged. Derived questions come first: nobody files them at all.
 */
export const recognitionSourceOf = (input: {
  readonly interaction: 'entry' | 'task' | 'derived' | undefined
  readonly entrySource: 'student' | 'administrative'
  readonly reviewMode: 'none' | 'workflow'
}): RecognitionSource =>
  input.interaction === 'derived'
    ? 'none'
    : input.entrySource === 'administrative'
      ? 'administrative'
      : input.reviewMode === 'none'
        ? 'automatic'
        : 'review'

export interface CompileInputs {
  readonly calculators: ReadonlyMap<string, ScoringDriver>
  readonly aggregators: ReadonlyMap<string, ScoringDriver>
  readonly itemType: ItemTypeDriver | undefined
  readonly formConfig: unknown
  readonly scoringConfig: unknown
  readonly batch: BatchContext
  readonly recognitionSource: RecognitionSource
}

/**
 * The body a plan's identity is taken over.
 *
 * Semantic only: recognition schemas go in as their canonical forms, so
 * renaming a label - which is what an administrator does most - leaves the
 * hash exactly where it was. What must move it is anything that changes what
 * the plan computes or admits.
 */
const semanticPlanBody = (plan: Omit<ScoringPlan, 'planHash'>) => ({
  version: plan.version,
  calculator: { ref: plan.calculator.ref, config: plan.calculator.config, contractHash: plan.calculator.contractHash },
  parameters: plan.parameters,
  recognitionSchemas: Object.fromEntries(
    Object.entries(plan.recognitionSchemas).map(([id, schema]) => [
      id,
      canonicalizeAtomicSchema(schema),
    ]),
  ),
  defaultBindings: plan.defaultBindings,
  aggregator: plan.aggregator,
  inputSchema: canonicalizeInputSchema(plan.inputSchema),
  outputSchema: canonicalizeAtomicSchema(plan.outputSchema),
})

const decode = <A>(schema: Schema.Codec<A>, value: unknown) =>
  Effect.option(Schema.decodeUnknownEffect(schema)(value))

/**
 * A lookup that only ever finds what somebody actually wrote.
 *
 * Configuration keys are chosen by administrators, and plain property access
 * answers `constructor` and `toString` from the prototype - so a recognition
 * named `constructor` would read as declared without anybody declaring it.
 */
const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

/**
 * Compile one item revision's scoring configuration, or say why not.
 *
 * The order is the order of proof: what the calculator needs, then that its
 * answer fits a score, then each parameter's binding, then how a reviewer's
 * form is seeded. A failure at any step is an issue on the path it belongs
 * to, and the caller collects them all.
 */
export const compileScoringPlan = (
  inputs: CompileInputs,
): Effect.Effect<
  { readonly plan: ScoringPlan } | { readonly issues: readonly PlanIssue[] }
> =>
  Effect.gen(function* () {
    const parsed = yield* decode(authoringShape as unknown as Schema.Codec<{
      calculator: { ref: string; config: unknown }
      aggregator: { ref: string; config: unknown }
      recognitions?: Record<string, { label?: string; defaultFromFieldId?: string | null }>
      bindings?: Record<
        string,
        { kind: 'constant'; value: unknown } | { kind: 'recognition'; recognitionId: string }
      >
    }>, inputs.scoringConfig)
    if (parsed._tag === 'None') {
      return { issues: [{ path: 'scoringConfig', reason: 'scoring-config-shape' }] }
    }
    const authoring = parsed.value
    const issues: PlanIssue[] = []

    const calculator = inputs.calculators.get(authoring.calculator.ref)
    if (calculator === undefined || calculator.kind !== 'calculator') {
      return { issues: [{ path: 'scoringConfig.calculator.ref', reason: 'calculator-not-installed' }] }
    }
    const aggregator = inputs.aggregators.get(authoring.aggregator.ref)
    if (aggregator === undefined || aggregator.kind !== 'aggregator') {
      issues.push({ path: 'scoringConfig.aggregator.ref', reason: 'aggregator-not-installed' })
    }

    // The compiler proves the driver configs itself rather than trusting
    // that whoever called it already did. Saving a question does validate
    // them first; the boot sweep calls straight in here, and "both paths
    // rest on the same proof" has to be true of this function alone.
    if ((yield* decode(calculator.configSchema as Schema.Codec<unknown>, authoring.calculator.config))._tag === 'None') {
      return {
        issues: [...issues, { path: 'scoringConfig.calculator.config', reason: 'calculator-config-invalid' }],
      }
    }
    if (
      aggregator !== undefined &&
      (yield* decode(aggregator.configSchema as Schema.Codec<unknown>, authoring.aggregator.config))._tag === 'None'
    ) {
      issues.push({ path: 'scoringConfig.aggregator.config', reason: 'aggregator-config-invalid' })
    }

    const compiled = yield* calculator.compile(authoring.calculator.config).pipe(Effect.option)
    if (compiled._tag === 'None') {
      return {
        issues: [...issues, { path: 'scoringConfig.calculator.config', reason: 'calculator-contract-unavailable' }],
      }
    }
    const { inputSchema, outputSchema, contractHash, config: executionConfig } = compiled.value

    // an item's amount has to be carryable by the platform's own amount, or
    // this question can never contribute a score to anybody
    const intoScore = assignmentPlan(outputSchema, normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA))
    if (intoScore.kind !== 'direct') {
      issues.push({ path: 'scoringConfig.calculator', reason: 'output-not-a-score-amount' })
    }

    const recognitions = authoring.recognitions ?? {}
    const bindings = authoring.bindings ?? {}
    // a derived question is granted to everyone on the roster: nobody files
    // it, nobody judges it, and there is no determination to be made
    if (inputs.recognitionSource === 'none' && Object.keys(recognitions).length > 0) {
      issues.push({ path: 'scoringConfig.recognitions', reason: 'recognition-without-determiner' })
    }
    // Every map below is keyed by strings out of a stored configuration.
    // A plain object literal would hand `__proto__` and `constructor` to JS
    // prototype semantics - assignment that does not create an own property,
    // and lookups that find something nobody wrote. A null-prototype object
    // has no such keys to reach, and `Object.hasOwn` is the only membership
    // question worth asking about one.
    const parameters: Record<string, ParameterBinding> = Object.create(null)
    const recognitionSchemas: Record<string, NormalizedAtomicSchema> = Object.create(null)
    const defaultBindings: Record<string, { fieldId: string; assignment: AssignmentPlan }> =
      Object.create(null)

    const bindable = new Map<string, AtomicSchema>(
      (inputs.itemType?.bindableFields?.(inputs.formConfig, inputs.batch) ?? []).map((field) => [
        field.fieldId,
        field.schema,
      ]),
    )

    for (const [parameter, schema] of Object.entries(inputSchema.properties)) {
      const binding = own(bindings, parameter)
      if (binding === undefined) {
        issues.push({ path: `scoringConfig.bindings.${parameter}`, reason: 'binding-missing' })
        continue
      }
      if (binding.kind === 'constant') {
        const wrong = validateValue(normalizeAtomicSchema(schema), binding.value)
        if (wrong.length > 0) {
          issues.push({
            path: `scoringConfig.bindings.${parameter}`,
            reason: `constant-${wrong[0]!.reason}`,
          })
          continue
        }
        parameters[parameter] = { kind: 'constant', value: binding.value }
        continue
      }
      const declared = own(recognitions, binding.recognitionId)
      if (declared === undefined) {
        issues.push({ path: `scoringConfig.bindings.${parameter}`, reason: 'recognition-unknown' })
        continue
      }
      // One determination answers one parameter. Two parameters reading the
      // same recognition would each prove their own type against it and the
      // last one written would decide what reviewers are actually validated
      // against - a plan that contradicts the proof that produced it. If a
      // question ever genuinely needs one fact in two places, that wants a
      // common schema proven into both, not a silent overwrite.
      if (Object.hasOwn(recognitionSchemas, binding.recognitionId)) {
        issues.push({
          path: `scoringConfig.bindings.${parameter}`,
          reason: 'recognition-reused',
        })
        continue
      }
      // the recognition's own type IS the parameter's, until the language
      // grows refinements: a question may narrow what a reviewer may
      // determine, never widen it past what the arithmetic accepts
      const recognitionSchema = normalizeAtomicSchema(schema)
      const assignment = assignmentPlan(recognitionSchema, normalizeAtomicSchema(schema))
      if (assignment.kind === 'incompatible') {
        issues.push({
          path: `scoringConfig.bindings.${parameter}`,
          reason: `recognition-${assignment.code}`,
        })
        continue
      }
      parameters[parameter] = { kind: 'recognition', recognitionId: binding.recognitionId, assignment }
      recognitionSchemas[binding.recognitionId] = recognitionSchema

      const fieldId = declared.defaultFromFieldId ?? null
      if (fieldId === null) {
        // nobody seeds it, so somebody has to be able to determine it from
        // the material itself. A reviewer can; so can the member of staff
        // recording an administrative fact. On a question that answers to
        // nobody, or one nobody files at all, this recognition could never
        // be filled in and the item would fail to score every time.
        if (inputs.recognitionSource === 'none' || inputs.recognitionSource === 'automatic') {
          issues.push({
            path: `scoringConfig.recognitions.${binding.recognitionId}`,
            reason: 'recognition-unattainable',
          })
        }
        continue
      }
      const evidence = bindable.get(fieldId)
      if (evidence === undefined) {
        issues.push({
          path: `scoringConfig.recognitions.${binding.recognitionId}`,
          reason: 'default-field-unknown',
        })
        continue
      }
      const seeding = assignmentPlan(evidence, recognitionSchema)
      if (seeding.kind === 'incompatible') {
        issues.push({
          path: `scoringConfig.recognitions.${binding.recognitionId}`,
          reason: `default-${seeding.code}`,
        })
        continue
      }
      defaultBindings[binding.recognitionId] = { fieldId, assignment: seeding }
    }

    // a recognition nobody's parameter reads is a field reviewers would be
    // asked to determine for nothing
    for (const recognitionId of Object.keys(recognitions)) {
      if (!Object.hasOwn(recognitionSchemas, recognitionId)) {
        issues.push({
          path: `scoringConfig.recognitions.${recognitionId}`,
          reason: 'recognition-unbound',
        })
      }
    }
    for (const parameter of Object.keys(bindings)) {
      if (inputSchema.properties[parameter] === undefined) {
        issues.push({ path: `scoringConfig.bindings.${parameter}`, reason: 'binding-unknown-parameter' })
      }
    }

    if (issues.length > 0) return { issues }

    const body: Omit<ScoringPlan, 'planHash'> = {
      version: 1,
      // what the calculator will execute, not what the administrator typed:
      // the item revision keeps the authored spelling, the plan keeps the
      // meaning, and two spellings of one rule share a planHash
      calculator: { ref: authoring.calculator.ref, config: executionConfig, contractHash },
      parameters,
      recognitionSchemas,
      defaultBindings,
      aggregator: { ref: authoring.aggregator.ref, config: authoring.aggregator.config },
      inputSchema,
      outputSchema,
    }
    return { plan: { ...body, planHash: hashCanonicalJson(semanticPlanBody(body)) } }
  })

/** the only plan version this build knows how to execute */
export const SCORING_PLAN_VERSION = 1

export class ScoringPlanUnreadable extends Data.TaggedError('ASSESSMENT_SCORING_PLAN_UNREADABLE')<{
  readonly revisionId: string
  readonly reason: string
}> {
  override get message() {
    return `scoring plan of item revision ${this.revisionId} cannot be executed: ${this.reason}`
  }
}

/**
 * The one way a stored plan becomes an executable one.
 *
 * A plan is a frozen promise, and reading it back with a cast is trusting
 * that nothing has ever written this column but this build. That is exactly
 * what stops being true during a rolling deployment: a newer server compiles
 * a plan in a shape this one does not know, and a cast would run it anyway -
 * silently, against a student's score. So the version is checked, the body
 * is checked against the hash it was stored with, and anything else is a
 * refusal naming the revision.
 *
 * Rehashing is not paranoia about the database: it is what makes `planHash`
 * a fact rather than a decorative column, and it is the same function that
 * produced it, so a mismatch means the body and its identity have come
 * apart - which is a thing to stop on, never to score through.
 *
 * Callers turn this into a defect rather than surfacing it: nothing a
 * student or a reviewer did produced it, and there is no answer they could
 * give that would help. It reaches an operator, naming the revision.
 */
export const readScoringPlan = (revision: {
  readonly id: string
  readonly scoringPlan: unknown
}): Effect.Effect<ScoringPlan, ScoringPlanUnreadable> =>
  Effect.gen(function* () {
    const stored = revision.scoringPlan
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      return yield* new ScoringPlanUnreadable({
        revisionId: revision.id,
        reason: 'no compiled plan; the assembly boot backfill has not run',
      })
    }
    const decoded = yield* decode(
      persistedPlanShape as unknown as Schema.Codec<ScoringPlan>,
      stored,
    )
    if (decoded._tag === 'None') {
      return yield* new ScoringPlanUnreadable({
        revisionId: revision.id,
        reason: 'not a plan this build can read',
      })
    }
    const plan = decoded.value
    if (plan.version !== SCORING_PLAN_VERSION) {
      return yield* new ScoringPlanUnreadable({
        revisionId: revision.id,
        reason: `version ${String(plan.version)}, and this build executes ${SCORING_PLAN_VERSION}`,
      })
    }
    const { planHash, ...body } = plan
    if (hashCanonicalJson(semanticPlanBody(body)) !== planHash) {
      return yield* new ScoringPlanUnreadable({
        revisionId: revision.id,
        reason: 'the plan and the hash it was stored with disagree',
      })
    }
    return plan
  })
