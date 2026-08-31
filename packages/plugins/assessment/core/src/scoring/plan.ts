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
  INTEGER_TO_DECIMAL,
  VALUE_SCHEMA_PROFILE_VERSION,
  assignmentPlan,
  canonicalizeAtomicSchema,
  canonicalizeInputSchema,
  normalizeAtomicSchema,
  normalizeInputSchema,
  validateAtomicProfile,
  validateInputProfile,
  type AssignmentPlan,
  type AtomicSchema,
  type InputSchema,
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { REGEX_PROFILE_VERSION, patternIssues } from '@qualy/value-schema/regex'
import { SCORE_AMOUNT_SCHEMA } from '@qualy/value-schema/score'
import { validateValue } from '@qualy/value-schema/validate'
import { canonicalizeValue } from '@qualy/value-schema/values'
import { canonicalJson, hashCanonicalJson } from '@qualy/value-schema/hash'
import type {
  AggregatorDriver,
  BatchContext,
  CalculatorCompileContext,
  CalculatorContractError,
  CalculatorDefinition,
  CalculatorHostContext,
  CompiledCalculator,
  FrozenCalculatorContract,
  ItemTypeDriver,
  RuntimeRef,
} from '../plugin.ts'

/** how one calculator parameter gets its value at scoring time */
export type ParameterBinding =
  | { readonly kind: 'constant'; readonly value: unknown }
  | {
      readonly kind: 'recognition'
      readonly recognitionId: string
      readonly assignment: AssignmentPlan
    }

/**
 * The frozen arithmetic of one item revision, in the language it was
 * compiled under.
 *
 * `version` is the plan language's own, not the calculator's: a plan already
 * written is never rewritten, so a later version means new revisions compile
 * differently, never that old ones are recompiled. The two languages are
 * genuinely separate: V1 stays byte-for-byte what it always was, and V2 is
 * strict and canonical from its first stored row.
 */
export interface ScoringPlanV1 {
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
    Record<
      string,
      {
        /** the field's identity, for reasoning about compatibility */
        readonly fieldId: string
        /**
         * The frozen payload address the seed reads from.
         *
         * Absent only on plans compiled before the two were told apart;
         * readers fall back to the fieldId, which is what those plans
         * meant. Every new compile writes it.
         */
        readonly payloadKey?: string
        readonly assignment: AssignmentPlan
      }
    >
  >
  readonly aggregator: { readonly ref: string; readonly config: unknown }
  /** the calculator's own input contract, for validating an assembled input */
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
  readonly planHash: string
}

/** a V2 parameter binding: a recognition feeds its parameter directly or not
 *  at all - a refinement is a narrowing of the same fact, never a conversion,
 *  so `convert` lives only on the Evidence side of a default seed */
export type ParameterBindingV2 =
  | { readonly kind: 'constant'; readonly value: unknown }
  | {
      readonly kind: 'recognition'
      readonly recognitionId: string
      readonly assignment: { readonly kind: 'direct' }
    }

/**
 * The V2 plan language. Everything V1 froze, plus the facts 7.1 taught this
 * system to demand: which value-schema and regex profiles the schemas were
 * proven under (hash identity vouches for bytes, never for the semantics
 * that interpreted them), and the exact runtime identity a stored-program
 * calculator bound to. All of it is inside the semantic hash.
 */
export interface ScoringPlanV2 {
  readonly version: 2
  /** the acceptance semantics these schemas were proven under */
  readonly valueSchemaProfileVersion: number
  readonly regexProfileVersion: number
  readonly calculator: {
    readonly ref: string
    readonly config: unknown
    /** the contract this plan was proven against */
    readonly contractHash: string
    /** the exact runtime fact this plan is bound to, when there is one */
    readonly runtimeRef?: RuntimeRef
  }
  /** every parameter the contract requires, bound exactly once */
  readonly parameters: Readonly<Record<string, ParameterBindingV2>>
  /** what each recognition id admits, frozen for the reviewers who fill it */
  readonly recognitionSchemas: Readonly<Record<string, NormalizedAtomicSchema>>
  /** which evidence field seeds a recognition, and how it converts */
  readonly defaultBindings: Readonly<
    Record<
      string,
      {
        readonly fieldId: string
        /** required in V2: the language carries no legacy fallback */
        readonly payloadKey: string
        readonly assignment: AssignmentPlan
      }
    >
  >
  readonly aggregator: { readonly ref: string; readonly config: unknown }
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
  readonly planHash: string
}

export type ScoringPlan = ScoringPlanV1 | ScoringPlanV2

/**
 * A stored plan's shape, as this build will execute it.
 *
 * Structural only: the schemas inside were normalized when the plan was
 * compiled and are re-proven by the hash rather than re-parsed here.
 */
// the execution structure, deep: everything the evaluator dereferences has
// a shape here, so a plan that decodes is a plan that runs. The schemas
// themselves stay Unknown - they were normalized when the plan was compiled,
// the hash covers their bytes, and the validator consumes them as data.
// the converter vocabulary is CLOSED per build: a stored plan naming one
// this build does not implement must be refused at the read, not carried
// to a null lookup that fails as the student's input
const assignmentShape = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('direct') }),
  Schema.Struct({ kind: Schema.Literal('convert'), converter: Schema.Literal(INTEGER_TO_DECIMAL) }),
])

const persistedPlanShape = Schema.Struct({
  version: Schema.Number,
  calculator: Schema.Struct({
    ref: Schema.String,
    config: Schema.Unknown,
    contractHash: Schema.String,
  }),
  parameters: Schema.Record(
    Schema.String,
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('constant'), value: Schema.Unknown }),
      Schema.Struct({
        kind: Schema.Literal('recognition'),
        recognitionId: Schema.String,
        assignment: assignmentShape,
      }),
    ]),
  ),
  recognitionSchemas: Schema.Record(Schema.String, Schema.Unknown),
  defaultBindings: Schema.Record(
    Schema.String,
    Schema.Struct({
      fieldId: Schema.String,
      payloadKey: Schema.optional(Schema.String),
      assignment: assignmentShape,
    }),
  ),
  aggregator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
  inputSchema: Schema.Unknown,
  outputSchema: Schema.Unknown,
  planHash: Schema.String,
})

const runtimeRefShape = Schema.Struct({
  kind: Schema.String,
  id: Schema.String,
  sha256: Schema.String,
})

// the V2 envelope, decoded strictly: an unknown key on any of these structs
// refuses the plan instead of being stripped - a newer build adding a
// semantic field must stop an older one, not be silently projected away.
// calculator.config, aggregator.config and the schema bodies stay Unknown:
// those are their owners' languages, not this envelope's.
const persistedPlanShapeV2 = Schema.Struct({
  version: Schema.Literal(2),
  valueSchemaProfileVersion: Schema.Number,
  regexProfileVersion: Schema.Number,
  calculator: Schema.Struct({
    ref: Schema.String,
    config: Schema.Unknown,
    contractHash: Schema.String,
    runtimeRef: Schema.optional(runtimeRefShape),
  }),
  parameters: Schema.Record(
    Schema.String,
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('constant'), value: Schema.Unknown }),
      Schema.Struct({
        kind: Schema.Literal('recognition'),
        recognitionId: Schema.String,
        // V2 freezes only direct here; convert belongs to evidence seeding
        assignment: Schema.Struct({ kind: Schema.Literal('direct') }),
      }),
    ]),
  ),
  recognitionSchemas: Schema.Record(Schema.String, Schema.Unknown),
  defaultBindings: Schema.Record(
    Schema.String,
    Schema.Struct({
      fieldId: Schema.String,
      payloadKey: Schema.String,
      assignment: assignmentShape,
    }),
  ),
  aggregator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
  inputSchema: Schema.Unknown,
  outputSchema: Schema.Unknown,
  planHash: Schema.String,
})

const SHA256_HEX = /^[0-9a-f]{64}$/
const UUIDV7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * The one lexical guard a runtime reference must pass, shared by the V2
 * writer and the V2 reader: a plan that stores a reference the reader would
 * refuse must never be written in the first place. `id` stays opaque - the
 * core does not know what kind of identity a stored program names - but a
 * field called sha256 has to actually be one.
 */
export const runtimeRefIssues = (ref: RuntimeRef): readonly string[] => [
  ...(ref.kind.length === 0 ? ['kind is empty'] : []),
  ...(ref.id.length === 0 ? ['id is empty'] : []),
  ...(SHA256_HEX.test(ref.sha256) ? [] : ['sha256 is not 64 lowercase hex characters']),
]

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
 * The V2 authoring language, always in its stored form by the time it gets
 * here: normalization already minted identities and resolved handles. The
 * envelope is strict - an unknown key refuses rather than strips - and
 * every recognition carries its label, its refinement (or an explicit
 * null), and its default source. The refinement body itself stays Unknown:
 * it is value-schema's language, proven where the recognition is compiled.
 */
const authoringShapeV2 = Schema.Struct({
  version: Schema.Literal(2),
  calculator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
  aggregator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
  recognitions: Schema.Record(
    Schema.String,
    Schema.Struct({
      label: Schema.String,
      refinement: Schema.NullOr(Schema.Unknown),
      defaultFromFieldId: Schema.NullOr(Schema.String),
    }),
  ),
  bindings: Schema.Record(
    Schema.String,
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('constant'), value: Schema.Unknown }),
      Schema.Struct({ kind: Schema.Literal('recognition'), recognitionId: Schema.String }),
    ]),
  ),
})

/** both authoring languages, seen through one lens once decoded: the
 *  version tells the compiler which proofs the language demands */
interface AuthoringView {
  readonly version: 1 | 2
  readonly calculator: { readonly ref: string; readonly config: unknown }
  readonly aggregator: { readonly ref: string; readonly config: unknown }
  readonly recognitions?: Record<
    string,
    {
      readonly label?: string
      readonly refinement?: unknown
      readonly defaultFromFieldId?: string | null
    }
  >
  readonly bindings?: Record<
    string,
    | { readonly kind: 'constant'; readonly value: unknown }
    | { readonly kind: 'recognition'; readonly recognitionId: string }
  >
}

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
  readonly definitions: {
    readonly calculators: ReadonlyMap<string, CalculatorDefinition>
    readonly aggregators: ReadonlyMap<string, AggregatorDriver>
  }
  /**
   * The runtime catalog's compile, handed in as a closed function: this
   * module proves configurations, it does not hold services. What the
   * calculator freezes - contract, canonical config, runtime identity -
   * comes back through here.
   */
  readonly compile: (
    ref: string,
    config: unknown,
    context: CalculatorCompileContext,
  ) => Effect.Effect<CompiledCalculator, CalculatorContractError>
  /** where this compilation is happening, from the host's own reads - and
   *  the runtime identity the item's previous plan froze, when the SAME
   *  calculator is being recompiled: a compile that keeps it continues an
   *  existing binding, one that names another identity is a new binding */
  readonly host: CalculatorCompileContext
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
/**
 * The bytes a plan's identity is a hash of. Exported so suites can forge
 * hash-consistent bodies and prove the reader judges content, not just
 * integrity.
 */
export const semanticPlanBodyV1 = (plan: Omit<ScoringPlanV1, 'planHash'>) => ({
  version: plan.version,
  calculator: {
    ref: plan.calculator.ref,
    config: plan.calculator.config,
    contractHash: plan.calculator.contractHash,
  },
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

/**
 * The V2 identity adds what V2 froze: the language version, the two profile
 * versions the schemas were proven under, and the runtime identity when the
 * calculator bound one. A runtimeRef change MUST move the hash - the plan's
 * arithmetic lives in those bytes.
 */
export const semanticPlanBodyV2 = (plan: Omit<ScoringPlanV2, 'planHash'>) => ({
  version: plan.version,
  valueSchemaProfileVersion: plan.valueSchemaProfileVersion,
  regexProfileVersion: plan.regexProfileVersion,
  calculator: {
    ref: plan.calculator.ref,
    config: plan.calculator.config,
    contractHash: plan.calculator.contractHash,
    ...(plan.calculator.runtimeRef === undefined ? {} : { runtimeRef: plan.calculator.runtimeRef }),
  },
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

export const semanticPlanBody = (
  plan: Omit<ScoringPlanV1, 'planHash'> | Omit<ScoringPlanV2, 'planHash'>,
) => (plan.version === 1 ? semanticPlanBodyV1(plan) : semanticPlanBodyV2(plan))

const decode = <A>(schema: Schema.Codec<A>, value: unknown) =>
  Effect.option(Schema.decodeUnknownEffect(schema)(value))

// the V2 languages refuse unknown envelope keys instead of stripping them
// (rc.111 default is "ignore"; probed in repos/effect SchemaAST.ts ParseOptions)
const decodeStrict = <A>(schema: Schema.Codec<A>, value: unknown) =>
  Effect.option(Schema.decodeUnknownEffect(schema)(value, { onExcessProperty: 'error' }))

/**
 * Whether a value survives the jsonb column and the hash unchanged.
 *
 * A decoder is allowed to produce anything - a Date, a Map, a BigInt - and
 * the plan is stored as JSON and identified by a hash of JSON. A Date would
 * hash as one thing in memory and come back as another; a Map would land as
 * `{}` and the driver would execute a configuration nobody wrote; a BigInt
 * would blow up the save. So the execution config is held to exactly what
 * the column can say: finite numbers, strings, booleans, null, arrays, and
 * plain objects, all the way down. `undefined` is refused in both positions
 * because stringify erases the key or writes null - either way the stored
 * plan is not the proven one.
 */
const isJsonValue = (value: unknown, walking = new WeakSet<object>()): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  // a cycle is not JSON either, and the answer has to be "no" rather than a
  // stack overflow on the way to saying so
  if (walking.has(value)) return false
  walking.add(value)
  if (Array.isArray(value)) return value.every((one) => isJsonValue(one, walking))
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  return Object.values(value as Record<string, unknown>).every((one) => isJsonValue(one, walking))
}

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
): Effect.Effect<{ readonly plan: ScoringPlan } | { readonly issues: readonly PlanIssue[] }> =>
  Effect.gen(function* () {
    // the same own-property dispatch the plan reader uses: a V2 stored form
    // must never be projected down to the legacy language by a lenient
    // decode, and a version this compiler does not speak is refused even
    // when the database was written to directly
    const config = inputs.scoringConfig
    const configVersion =
      config !== null && typeof config === 'object' && Object.hasOwn(config, 'version')
        ? (config as Record<string, unknown>)['version']
        : undefined
    if (configVersion !== undefined && configVersion !== 2) {
      return {
        issues: [{ path: 'scoringConfig.version', reason: 'authoring-version-unsupported' }],
      }
    }
    const authoring: AuthoringView | undefined = yield* Effect.gen(function* () {
      if (configVersion === 2) {
        const strict = yield* decodeStrict(
          authoringShapeV2 as unknown as Schema.Codec<Omit<AuthoringView, 'version'>>,
          config,
        )
        return strict._tag === 'None' ? undefined : { ...strict.value, version: 2 as const }
      }
      const parsed = yield* decode(
        authoringShape as unknown as Schema.Codec<Omit<AuthoringView, 'version'>>,
        config,
      )
      return parsed._tag === 'None' ? undefined : { ...parsed.value, version: 1 as const }
    })
    if (authoring === undefined) {
      return { issues: [{ path: 'scoringConfig', reason: 'scoring-config-shape' }] }
    }
    const issues: PlanIssue[] = []

    const calculator = inputs.definitions.calculators.get(authoring.calculator.ref)
    if (calculator === undefined) {
      return {
        issues: [{ path: 'scoringConfig.calculator.ref', reason: 'calculator-not-installed' }],
      }
    }
    const aggregator = inputs.definitions.aggregators.get(authoring.aggregator.ref)
    if (aggregator === undefined) {
      issues.push({ path: 'scoringConfig.aggregator.ref', reason: 'aggregator-not-installed' })
    }

    // The compiler proves the driver configs itself rather than trusting
    // that whoever called it already did. Saving a question does validate
    // them first; the boot sweep calls straight in here, and "both paths
    // rest on the same proof" has to be true of this function alone.
    //
    // And what the decoder PRODUCES is what runs. A codec is allowed to
    // transform - fill a default, drop a stray key, normalize a spelling -
    // so handing the driver the raw value after checking the decoded one
    // would execute a configuration nobody proved. The built-in schemas
    // happen to be identity codecs today; the contract must not depend on
    // that staying true.
    const calculatorConfig = yield* decode(
      calculator.configSchema as Schema.Codec<unknown>,
      authoring.calculator.config,
    )
    if (calculatorConfig._tag === 'None') {
      return {
        issues: [
          ...issues,
          { path: 'scoringConfig.calculator.config', reason: 'calculator-config-invalid' },
        ],
      }
    }
    let aggregatorConfig: unknown = authoring.aggregator.config
    if (aggregator !== undefined) {
      const decoded = yield* decode(
        aggregator.configSchema as Schema.Codec<unknown>,
        authoring.aggregator.config,
      )
      if (decoded._tag === 'None') {
        issues.push({
          path: 'scoringConfig.aggregator.config',
          reason: 'aggregator-config-invalid',
        })
      } else {
        aggregatorConfig = decoded.value
      }
    }

    const compiled = yield* inputs
      .compile(authoring.calculator.ref, calculatorConfig.value, inputs.host)
      .pipe(Effect.option)
    if (compiled._tag === 'None') {
      return {
        issues: [
          ...issues,
          { path: 'scoringConfig.calculator.config', reason: 'calculator-contract-unavailable' },
        ],
      }
    }
    const {
      inputSchema,
      outputSchema,
      contractHash,
      config: executionConfig,
      runtimeRef,
    } = compiled.value
    // a runtime identity has no home in the V1 language: dropping it would
    // freeze a plan that cannot cite the program it is bound to, so the
    // calculator's demand for the versioned language is a refusal, never a
    // silent projection
    if (authoring.version === 1 && runtimeRef !== undefined) {
      return {
        issues: [
          { path: 'scoringConfig.calculator', reason: 'calculator-runtime-requires-plan-v2' },
        ],
      }
    }
    // and one the reader would refuse must never be written: the writer
    // holds the reference to the same lexical guard
    if (runtimeRef !== undefined && runtimeRefIssues(runtimeRef).length > 0) {
      return {
        issues: [{ path: 'scoringConfig.calculator', reason: 'calculator-runtime-ref-invalid' }],
      }
    }
    // what goes into the plan must come back out of the column identical
    if (!isJsonValue(executionConfig)) {
      return {
        issues: [
          ...issues,
          { path: 'scoringConfig.calculator.config', reason: 'calculator-config-not-json' },
        ],
      }
    }
    if (!isJsonValue(aggregatorConfig)) {
      issues.push({ path: 'scoringConfig.aggregator.config', reason: 'aggregator-config-not-json' })
    }

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
    const defaultBindings: Record<
      string,
      { fieldId: string; payloadKey: string; assignment: AssignmentPlan }
    > = Object.create(null)

    const bindable = new Map<string, { payloadKey: string; schema: AtomicSchema; always: boolean }>(
      (inputs.itemType?.bindableFields?.(inputs.formConfig, inputs.batch) ?? []).map((field) => [
        field.fieldId,
        { payloadKey: field.payloadKey, schema: field.schema, always: field.always },
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
        // V2 freezes the canonical spelling, so "3.0" and "3.00" are one
        // constant and one planHash; V1 keeps the authored spelling it has
        // always stored - historical hashes never move
        parameters[parameter] = {
          kind: 'constant',
          value: authoring.version === 2 ? canonicalizeValue(schema, binding.value) : binding.value,
        }
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
      // The label an administrator gave the recognition rides in as the
      // schema's own title annotation - the annotation layer exists exactly
      // so presentation never needs a second protocol, and the semantic
      // body strips it, so renaming a recognition moves no hash.
      //
      // In V1 the recognition's own type IS the parameter's. In V2 a
      // refinement may narrow it - the same fact with a tighter admission,
      // proven `direct` into the parameter: a conversion is another type
      // wearing a costume, and it is refused here however convertible.
      // The merged schema - refinement AND label - is validated as one
      // value before normalize ever sees it, so an unlawful label (too
      // long, say) is an issue on this recognition, never a TypeError.
      let recognitionSchema: NormalizedAtomicSchema
      let assignment: AssignmentPlan
      if (authoring.version === 2) {
        const semantic = (declared.refinement ?? schema) as AtomicSchema
        const presented = { ...semantic, title: declared.label }
        const wrongShape = validateAtomicProfile(presented)
        if (wrongShape.length > 0) {
          issues.push({
            path: `scoringConfig.recognitions.${binding.recognitionId}`,
            reason: `recognition-${wrongShape[0]!.reason}`,
          })
          continue
        }
        if (patternIssues(presented).length > 0) {
          issues.push({
            path: `scoringConfig.recognitions.${binding.recognitionId}`,
            reason: 'recognition-pattern-outside-dialect',
          })
          continue
        }
        recognitionSchema = normalizeAtomicSchema(presented)
        const proof = assignmentPlan(recognitionSchema, normalizeAtomicSchema(schema))
        if (proof.kind !== 'direct') {
          issues.push({
            path: `scoringConfig.bindings.${parameter}`,
            reason:
              proof.kind === 'incompatible'
                ? `refinement-${proof.code}`
                : 'refinement-requires-conversion',
          })
          continue
        }
        assignment = proof
      } else {
        recognitionSchema = normalizeAtomicSchema({
          ...schema,
          ...(declared.label === undefined ? {} : { title: declared.label }),
        })
        const proof = assignmentPlan(recognitionSchema, normalizeAtomicSchema(schema))
        if (proof.kind === 'incompatible') {
          issues.push({
            path: `scoringConfig.bindings.${parameter}`,
            reason: `recognition-${proof.code}`,
          })
          continue
        }
        assignment = proof
      }
      parameters[parameter] = {
        kind: 'recognition',
        recognitionId: binding.recognitionId,
        assignment,
      }
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
      // A question that answers to nobody has only its defaults. Seeding one
      // from a field a filing may not carry produces a claim that is
      // approved and cannot be scored - and there is no later moment where
      // anybody would be asked to fill it in.
      if (inputs.recognitionSource === 'automatic' && !evidence.always) {
        issues.push({
          path: `scoringConfig.recognitions.${binding.recognitionId}`,
          reason: 'default-field-not-guaranteed',
        })
        continue
      }
      const seeding = assignmentPlan(evidence.schema, recognitionSchema)
      if (seeding.kind === 'incompatible') {
        issues.push({
          path: `scoringConfig.recognitions.${binding.recognitionId}`,
          reason: `default-${seeding.code}`,
        })
        continue
      }
      defaultBindings[binding.recognitionId] = {
        fieldId,
        // the frozen ADDRESS, not the identity: seeding reads payloads
        payloadKey: evidence.payloadKey,
        assignment: seeding,
      }
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
      // by own property, like every other lookup here: a binding named
      // `constructor` would otherwise find something on Object's prototype
      // and read as a parameter the contract declares, so the binding would
      // be silently ignored rather than refused
      if (!Object.hasOwn(inputSchema.properties, parameter)) {
        issues.push({
          path: `scoringConfig.bindings.${parameter}`,
          reason: 'binding-unknown-parameter',
        })
      }
    }

    if (issues.length > 0) return { issues }

    if (authoring.version === 2) {
      // every proof above ran under exactly these two profiles, and the plan
      // says so - hash identity vouches for bytes, these two facts say which
      // semantics interpreted them. The V2 loop froze only direct recognition
      // assignments and always wrote payloadKey, which is what the casts
      // state.
      const body: Omit<ScoringPlanV2, 'planHash'> = {
        version: 2,
        valueSchemaProfileVersion: VALUE_SCHEMA_PROFILE_VERSION,
        regexProfileVersion: REGEX_PROFILE_VERSION,
        calculator: {
          ref: authoring.calculator.ref,
          config: executionConfig,
          contractHash,
          ...(runtimeRef === undefined ? {} : { runtimeRef }),
        },
        parameters: parameters as Readonly<Record<string, ParameterBindingV2>>,
        recognitionSchemas,
        defaultBindings: defaultBindings as ScoringPlanV2['defaultBindings'],
        aggregator: { ref: authoring.aggregator.ref, config: aggregatorConfig },
        inputSchema,
        outputSchema,
      }
      return { plan: { ...body, planHash: hashCanonicalJson(semanticPlanBodyV2(body)) } }
    }

    const body: Omit<ScoringPlanV1, 'planHash'> = {
      version: 1,
      // what the calculator will execute, not what the administrator typed:
      // the item revision keeps the authored spelling, the plan keeps the
      // meaning, and two spellings of one rule share a planHash
      calculator: { ref: authoring.calculator.ref, config: executionConfig, contractHash },
      parameters,
      recognitionSchemas,
      defaultBindings,
      // the decoded form, for the same reason as the calculator's: the plan
      // stores what will execute, and what will execute is what was proven
      aggregator: { ref: authoring.aggregator.ref, config: aggregatorConfig },
      inputSchema,
      outputSchema,
    }
    return { plan: { ...body, planHash: hashCanonicalJson(semanticPlanBodyV1(body)) } }
  })

/** the two plan languages this build reads: V1 as it always was, V2 strict
 *  and canonical. An unknown version is refused at the read, never cast. */
export const SCORING_PLAN_V1_VERSION = 1
export const SCORING_PLAN_V2_VERSION = 2

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
    // dispatch on the version's OWN property before any decode: a lenient
    // projection could otherwise read a V2 plan as a V1 one by stripping
    // the very fields that make it V2
    const version = Object.hasOwn(stored, 'version')
      ? (stored as Record<string, unknown>)['version']
      : undefined
    if (version === SCORING_PLAN_V1_VERSION) return yield* readPlanV1(revision.id, stored)
    if (version === SCORING_PLAN_V2_VERSION) return yield* readPlanV2(revision.id, stored)
    return yield* new ScoringPlanUnreadable({
      revisionId: revision.id,
      reason: `version ${String(version)}, and this build executes ${SCORING_PLAN_V1_VERSION} or ${SCORING_PLAN_V2_VERSION}`,
    })
  })

/** the V1 read, exactly as it always was: this language never tightens */
const readPlanV1 = (
  revisionId: string,
  stored: object,
): Effect.Effect<ScoringPlanV1, ScoringPlanUnreadable> =>
  Effect.gen(function* () {
    const decoded = yield* decode(
      persistedPlanShape as unknown as Schema.Codec<ScoringPlanV1>,
      stored,
    )
    if (decoded._tag === 'None') {
      return yield* new ScoringPlanUnreadable({
        revisionId,
        reason: 'not a plan this build can read',
      })
    }
    const plan = decoded.value
    // The schemas are data to the hash but a LANGUAGE to the evaluator: a
    // newer build can store a hash-consistent plan whose schemas use a
    // profile feature this build has never heard of, and ajv would judge
    // values by silently ignoring it. Rolling deployments are exactly when
    // that happens, so the read is where it stops.
    const foreign = [
      ...validateInputProfile(plan.inputSchema),
      ...validateAtomicProfile(plan.outputSchema),
      ...Object.values(plan.recognitionSchemas).flatMap((schema) => validateAtomicProfile(schema)),
    ]
    if (foreign.length > 0) {
      return yield* new ScoringPlanUnreadable({
        revisionId,
        reason: `a stored schema is outside this build's value profile: ${foreign[0]!.reason}`,
      })
    }
    const { planHash, ...body } = plan
    // The shape check above is structural, not deep: the nested schemas are
    // whatever was stored. Rehashing walks them, so a plan whose insides are
    // mangled - a null where an input schema belongs - would throw out of
    // the walk. That is still "this build cannot read it", and it still
    // deserves the refusal that names the revision, not a bare TypeError.
    const rehashed = yield* Effect.try({
      try: () => hashCanonicalJson(semanticPlanBodyV1(body)),
      catch: () =>
        new ScoringPlanUnreadable({
          revisionId,
          reason: 'not a plan this build can read',
        }),
    })
    if (rehashed !== planHash) {
      return yield* new ScoringPlanUnreadable({
        revisionId,
        reason: 'the plan and the hash it was stored with disagree',
      })
    }
    return plan
  })

/**
 * The V2 read is a full language check, not an integrity check: the hash can
 * only prove the body matches its own identity, never that the body is a
 * lawful V2 plan. Every proof the compiler made is re-made here - the
 * profile versions it was proven under, the dialect of every stored pattern,
 * the normalized representation of every schema, the identity shape of every
 * recognition, and the assignability of every binding - because a database
 * write is not a compiler.
 */
const readPlanV2 = (
  revisionId: string,
  stored: object,
): Effect.Effect<ScoringPlanV2, ScoringPlanUnreadable> =>
  Effect.gen(function* () {
    const refuse = (reason: string) => new ScoringPlanUnreadable({ revisionId, reason })
    const decoded = yield* decodeStrict(
      persistedPlanShapeV2 as unknown as Schema.Codec<ScoringPlanV2>,
      stored,
    )
    if (decoded._tag === 'None') {
      return yield* refuse('not a plan this build can read')
    }
    const plan = decoded.value
    // acceptance semantics first, 7.1's lesson: schema bytes mean nothing
    // until the profile that interprets them is one this build certifies
    if (plan.valueSchemaProfileVersion !== VALUE_SCHEMA_PROFILE_VERSION) {
      return yield* refuse(
        `value-schema profile ${String(plan.valueSchemaProfileVersion)} is not certified by this build`,
      )
    }
    if (plan.regexProfileVersion !== REGEX_PROFILE_VERSION) {
      return yield* refuse(
        `regex profile ${String(plan.regexProfileVersion)} is not certified by this build`,
      )
    }
    const schemas: readonly (readonly [string, unknown])[] = [
      ['inputSchema', plan.inputSchema],
      ['outputSchema', plan.outputSchema],
      ...Object.entries(plan.recognitionSchemas).map(
        ([id, schema]) => [`recognitionSchemas.${id}`, schema] as const,
      ),
    ]
    const foreign = [
      ...validateInputProfile(plan.inputSchema),
      ...validateAtomicProfile(plan.outputSchema),
      ...Object.values(plan.recognitionSchemas).flatMap((schema) => validateAtomicProfile(schema)),
    ]
    if (foreign.length > 0) {
      return yield* refuse(
        `a stored schema is outside this build's value profile: ${foreign[0]!.reason}`,
      )
    }
    const dialect = schemas.flatMap(([, schema]) => patternIssues(schema))
    if (dialect.length > 0) {
      return yield* refuse(
        `a stored pattern is outside this build's regex profile: ${dialect[0]!.reason}`,
      )
    }
    // V2 schemas are stored in their normalized representation, and the
    // reader proves it rather than trusting it: canonicalization for the
    // hash would forgive a denormalized spelling (a "3.00" decimal bound)
    // that the evaluator would then execute as written
    const denormalized =
      canonicalJson(normalizeInputSchema(plan.inputSchema as unknown as InputSchema)) !==
        canonicalJson(plan.inputSchema) ||
      canonicalJson(normalizeAtomicSchema(plan.outputSchema as unknown as AtomicSchema)) !==
        canonicalJson(plan.outputSchema) ||
      Object.values(plan.recognitionSchemas).some(
        (schema) =>
          canonicalJson(normalizeAtomicSchema(schema as unknown as AtomicSchema)) !==
          canonicalJson(schema),
      )
    if (denormalized) {
      return yield* refuse('a stored schema is not in its normalized representation')
    }
    // identities: recognition ids are server-minted UUIDs, and a runtime
    // reference passes the same guard the writer holds it to
    for (const id of Object.keys(plan.recognitionSchemas)) {
      if (!UUIDV7_SHAPE.test(id)) {
        return yield* refuse('a recognition id is not a server-minted identity')
      }
    }
    if (plan.calculator.runtimeRef !== undefined) {
      const wrong = runtimeRefIssues(plan.calculator.runtimeRef)
      if (wrong.length > 0) {
        return yield* refuse(`the runtime reference is malformed: ${wrong[0]!}`)
      }
    }
    // the binding account: every contract parameter bound exactly once,
    // every recognition read exactly once, every default aimed at a
    // recognition that exists
    const parameterNames = Object.keys(plan.inputSchema.properties)
    const boundNames = Object.keys(plan.parameters)
    if (
      parameterNames.length !== boundNames.length ||
      !parameterNames.every((name) => Object.hasOwn(plan.parameters, name))
    ) {
      return yield* refuse('the bound parameters are not the contract parameters')
    }
    const readBy = new Set<string>()
    for (const [parameter, binding] of Object.entries(plan.parameters)) {
      if (binding.kind === 'constant') {
        const schema = own(plan.inputSchema.properties, parameter)
        if (schema === undefined) {
          return yield* refuse('the bound parameters are not the contract parameters')
        }
        const normalized = normalizeAtomicSchema(schema)
        if (validateValue(normalized, binding.value).length > 0) {
          return yield* refuse('a constant does not fit its parameter')
        }
        if (canonicalizeValue(schema, binding.value) !== binding.value) {
          return yield* refuse('a constant is not in its canonical spelling')
        }
        continue
      }
      const recognition = own(plan.recognitionSchemas, binding.recognitionId)
      if (recognition === undefined) {
        return yield* refuse('a binding names a recognition the plan does not declare')
      }
      if (!UUIDV7_SHAPE.test(binding.recognitionId)) {
        return yield* refuse('a recognition id is not a server-minted identity')
      }
      if (readBy.has(binding.recognitionId)) {
        return yield* refuse('one recognition stands in for two parameters')
      }
      readBy.add(binding.recognitionId)
      // the stored proof is re-made, not believed: a hash-consistent plan
      // can carry a widened recognition schema with its old `direct` label,
      // and only recomputing the assignment catches it. V2 admits nothing
      // but direct here - a refinement narrows, it never converts.
      const parameterSchema = own(plan.inputSchema.properties, parameter)
      if (parameterSchema === undefined) {
        return yield* refuse('the bound parameters are not the contract parameters')
      }
      const actual = assignmentPlan(
        normalizeAtomicSchema(recognition),
        normalizeAtomicSchema(parameterSchema),
      )
      if (actual.kind !== 'direct') {
        return yield* refuse('a recognition no longer proves into its parameter')
      }
    }
    for (const id of Object.keys(plan.recognitionSchemas)) {
      if (!readBy.has(id)) {
        return yield* refuse('a recognition is declared but nothing reads it')
      }
    }
    for (const id of Object.keys(plan.defaultBindings)) {
      if (!Object.hasOwn(plan.recognitionSchemas, id)) {
        return yield* refuse('a default seeds a recognition the plan does not declare')
      }
    }
    // the answer still has to be a score
    const intoScore = assignmentPlan(
      normalizeAtomicSchema(plan.outputSchema as unknown as AtomicSchema),
      normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA),
    )
    if (intoScore.kind !== 'direct') {
      return yield* refuse('the calculator output is no longer a score amount')
    }
    const { planHash, ...body } = plan
    const rehashed = yield* Effect.try({
      try: () => hashCanonicalJson(semanticPlanBodyV2(body)),
      catch: () => refuse('not a plan this build can read'),
    })
    if (rehashed !== planHash) {
      return yield* refuse('the plan and the hash it was stored with disagree')
    }
    return plan
  })

/**
 * Whether every determination one contract can produce is one the other
 * would accept.
 *
 * Not "do these two plans look alike" - the question is about VALUES. A
 * round that opened yesterday judges by yesterday's contract and settles
 * under it; scoring then reads the question's current plan. So the honest
 * test is: could this round determine something the current plan cannot
 * read? It could, unless every recognition it may fill is one the new plan
 * also names, admitting at least everything the old one did.
 *
 * A recognition the new plan adds is just as fatal as one it removes: the
 * old contract will never fill it, and the determination reaches scoring
 * incomplete.
 */
/**
 * The frozen calculator fact of one stored plan, in the shape the runtime
 * half consumes. V1 plans froze neither a runtime reference nor their
 * profile versions, and this projection does not invent them: absent means
 * the plan never said.
 */
export const frozenCalculatorOf = (plan: ScoringPlan): FrozenCalculatorContract =>
  plan.version === 1
    ? {
        config: plan.calculator.config,
        contractHash: plan.calculator.contractHash,
        inputSchema: plan.inputSchema,
        outputSchema: plan.outputSchema,
      }
    : {
        config: plan.calculator.config,
        contractHash: plan.calculator.contractHash,
        ...(plan.calculator.runtimeRef === undefined
          ? {}
          : { runtimeRef: plan.calculator.runtimeRef }),
        inputSchema: plan.inputSchema,
        outputSchema: plan.outputSchema,
        valueSchemaProfileVersion: plan.valueSchemaProfileVersion,
        regexProfileVersion: plan.regexProfileVersion,
      }

/**
 * The identity of the arithmetic alone: would the same already-determined
 * values score the same? Presentation and admission stay out - labels,
 * refinements, default seeding, the schemas themselves - because they shape
 * what MAY be determined, not what a given determination computes. Constants
 * are hashed in canonical spelling whatever the plan language stored, so a
 * V1 plan's "3.00" and a V2 plan's "3" are one arithmetic; `plan.version`
 * itself never enters, and the languages differ only through what they
 * genuinely freeze differently (a V2 recognition identity is a new fact).
 * Computed fresh per call and stored nowhere.
 */
export const evaluationHash = (plan: ScoringPlan): string =>
  hashCanonicalJson({
    calculator: {
      ref: plan.calculator.ref,
      config: plan.calculator.config,
      contractHash: plan.calculator.contractHash,
      ...(plan.version === 2 && plan.calculator.runtimeRef !== undefined
        ? { runtimeRef: plan.calculator.runtimeRef }
        : {}),
    },
    parameters: Object.fromEntries(
      Object.entries(plan.parameters).map(([parameter, binding]) => [
        parameter,
        binding.kind === 'constant'
          ? {
              kind: 'constant',
              value:
                own(plan.inputSchema.properties, parameter) === undefined
                  ? binding.value
                  : canonicalizeValue(plan.inputSchema.properties[parameter]!, binding.value),
            }
          : binding,
      ]),
    ),
    aggregator: plan.aggregator,
  })

export const carriesInto = (
  before: Readonly<Record<string, NormalizedAtomicSchema>>,
  after: Readonly<Record<string, NormalizedAtomicSchema>>,
): boolean => {
  const names = Object.keys(before)
  if (names.length !== Object.keys(after).length) return false
  return names.every((name) => {
    if (!Object.hasOwn(after, name)) return false
    // direct, not convert: nothing converts a stored determination on the
    // way into the arithmetic, so a value that would need converting is a
    // value this plan cannot read
    return assignmentPlan(before[name]!, after[name]!).kind === 'direct'
  })
}
