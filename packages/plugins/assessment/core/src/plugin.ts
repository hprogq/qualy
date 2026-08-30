import { Context, Layer } from 'effect'
import type { Effect, Schema } from 'effect'
import type {
  AtomicSchema,
  NormalizedAtomicSchema,
  NormalizedInputSchema,
} from '@qualy/value-schema'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'

// This domain's two faces in the descriptor model: what a plugin writes to
// say "I am a kind of question" and "I am a way of scoring one".
//
// Both mirror the login-driver shape - the protocol family is a driver
// plugin, the instance is a data row. An item type interprets configuration
// and payloads; core owns the tables and never learns what an evidence field
// is. A scoring driver is a named, versioned reference that item
// configuration cites; the reference is declared here and its arithmetic
// arrives with the scoring engine.

/** how a driver refuses a payload; reasons stay structural, never free text */
export class ItemPayloadInvalid extends Error {
  readonly _tag = 'ASSESSMENT_ITEM_PAYLOAD_INVALID'
  // plain fields, not parameter properties: bare node loads this source in
  // strip-only mode when resolution imports descriptors
  readonly issues: readonly { readonly field: string; readonly reason: string }[]
  constructor(issues: readonly { readonly field: string; readonly reason: string }[]) {
    super(`item payload invalid: ${issues.map((issue) => issue.field).join(', ')}`)
    this.issues = issues
  }
}

/**
 * One attachment a payload cites, named so core can enforce the citation.
 *
 * accept and maxFileBytes ride along because core is the one holding the
 * trusted file facts (storage's size, its declared type) and the driver is
 * the one holding the field's rules; neither may read the other's side, so
 * the ref is where they meet.
 */
export interface AttachmentRef {
  readonly field: string
  readonly attachmentId: string
  readonly accept?: readonly string[] | undefined
  readonly maxFileBytes?: number | undefined
}

/** what a payload may know about its batch while being decoded */
export interface BatchContext {
  readonly materialRange: { readonly start: string; readonly end: string }
}

/**
 * A kind of question, as a driver.
 *
 * `decodePayload` is the only place a payload's field structure is
 * understood, and `attachmentRefs` is the one concession the shape makes to
 * core's ownership problem: core owns the attachment relation table but
 * cannot read payloads, so the driver names what the payload cites. Without
 * it, core would have to hard-code every driver's field layout.
 */
export interface ItemTypeDriver {
  readonly id: string
  /** validates an item's form configuration when an administrator saves it */
  readonly configSchema: Schema.Top
  /**
   * Batch-aware configuration problems the schema cannot see, if the driver
   * has any: a date field whose window misses the round's material range
   * entirely is well-formed and unusable, and only the driver knows both.
   */
  readonly configIssues?: (
    config: unknown,
    batch: BatchContext,
  ) => readonly { readonly path: string; readonly reason: string }[]
  /**
   * Issues only a TRANSITION can have: the candidate judged beside the
   * previous revision's configuration. A field identity is what ties
   * historical answers to recognition bindings across revisions, so a rule
   * like "the same identity may not change its value domain" needs both
   * sides in hand - the schema sees one revision at a time.
   */
  readonly transitionIssues?: (
    previous: unknown,
    next: unknown,
    batch: BatchContext,
  ) => readonly { readonly path: string; readonly reason: string }[]
  readonly decodePayload: (
    config: unknown,
    payload: unknown,
    batch: BatchContext,
  ) => Effect.Effect<unknown, ItemPayloadInvalid>
  /**
   * One answer, written under an older configuration, read as an answer to a
   * newer one - by whatever the driver treats as a field's identity.
   *
   * Only for asking whether a stored answer would still be acceptable under
   * a configuration it was not written under. Reading it back raw would call
   * a deleted field an unknown one and a reordered form a broken one, which
   * says a safe edit is unsafe. A driver without one gets its payloads read
   * as they were written.
   */
  readonly projectPayload?: (fromConfig: unknown, toConfig: unknown, payload: unknown) => unknown
  readonly attachmentRefs: (config: unknown, payload: unknown) => readonly AttachmentRef[]
  /**
   * The fields of this question a scoring parameter may be bound to, as
   * schemas - core learns `fieldId` and a shape, never what an evidence text
   * field or a choice field is. A driver without one offers no bindable
   * field, which is every driver in this phase.
   */
  readonly bindableFields?: (
    config: unknown,
    batch: BatchContext,
  ) => readonly {
    /** the field's identity across revisions of the form */
    readonly fieldId: string
    /**
     * Where this revision's payloads keep the field's answer.
     *
     * Identity and address are different questions - a field keeps its id
     * while its key stays pinned to the slot old payloads already use - and
     * nothing here promises the two are ever equal. The plan freezes the
     * address, because seeding reads payloads; compatibility reasons about
     * the identity.
     */
    readonly payloadKey: string
    readonly schema: AtomicSchema
    /**
     * Whether every filing of this question is guaranteed to carry it.
     *
     * A schema says what the value looks like when it is there, which is a
     * different question from whether it is always there. It matters where
     * nobody will be asked afterwards: a question that approves itself has
     * only its defaults, so seeding one from a field a student may leave
     * blank produces a claim that is approved and cannot be scored.
     */
    readonly always: boolean
  }[]
  /** who acts: students filing, staff working a task, or nobody (derived) */
  readonly interaction: 'entry' | 'task' | 'derived'
  /** the scoring references this kind of question defaults to */
  readonly scoring: { readonly calculator: string; readonly aggregator: string }
}

/** every item-type driver this assembly's plugins declare, in plugin order */
export const ItemTypeDeclarations = ExtensionPoint.make<ItemTypeDriver>(
  '@qualy/plugin-assessment/item-types',
  { phase: 'prepare' },
)

/** the one spelling of a driver id; items.item_type carries the same check */
const ITEM_TYPE_FORMAT = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

/** the compiled catalog: which drivers exist, before any layer builds */
export class ItemTypeCatalog extends Context.Service<
  ItemTypeCatalog,
  ReadonlyMap<string, ItemTypeDriver>
>()('@qualy/plugin-assessment/ItemTypeCatalog') {}

/**
 * The immutable runtime fact a compiled calculator executes, by exact
 * identity. Core carries it opaquely - kind, id and content hash - and the
 * calculator that minted it is the only party that interprets it. fixed@1
 * has none; a stored-program calculator names its published program here.
 * A version-1 plan never stores one: persisting it is a plan-language
 * change and belongs to the next plan version.
 */
export interface RuntimeRef {
  readonly kind: string
  readonly id: string
  readonly sha256: string
}

/**
 * What the host tells a calculator about where it is working - and nothing
 * else. Both values come from the host's own row reads or session, never
 * from a stored configuration; a calculator resolving tenant-owned facts
 * must scope by this tenant, so a leaked UUID alone can never cross one.
 */
export interface CalculatorHostContext {
  readonly tenantId: string
  readonly batchId: string
}

export interface CalculatorCompileContext extends CalculatorHostContext {
  /**
   * The runtime identity the item's previous plan froze, if any. A compile
   * that keeps it is a continuation of an existing binding; one that names
   * a different identity is a NEW binding and may be held to stricter
   * eligibility by the calculator.
   */
  readonly previousRuntimeRef?: RuntimeRef
}

export interface CalculatorContract {
  /** the typed input this calculator needs, under this configuration */
  readonly inputSchema: NormalizedInputSchema
  /** what it answers with; a scoring item's must fit the platform amount */
  readonly outputSchema: NormalizedAtomicSchema
  /** the two schemas' semantic identity - annotations never move it */
  readonly contractHash: string
}

export interface CompiledCalculator extends CalculatorContract {
  /**
   * The configuration as this calculator will actually execute it.
   *
   * The host cannot know what any calculator's configuration means, so it
   * cannot tell that `"3.0"` and `"3.00"` are one amount and `{a,b}` and
   * `{b,a}` are one rule. The calculator can, and says so here once, at
   * compile time. The plan stores THIS; the item revision keeps what the
   * administrator wrote. That is what makes a plan's identity semantic:
   * re-saving a question spelled differently must not look like a different
   * arithmetic to anybody reading hashes.
   */
  readonly config: unknown
  /** the exact runtime fact this compilation is bound to, when there is one */
  readonly runtimeRef?: RuntimeRef
}

/** the calculator could not say what it needs, under this configuration */
export class CalculatorContractError extends Error {
  readonly _tag = 'ASSESSMENT_CALCULATOR_CONTRACT_ERROR'
  readonly reason: string
  constructor(reason: string) {
    super(`calculator contract unavailable: ${reason}`)
    this.reason = reason
  }
}

/** the calculator refused, or failed, on an input the host had already proven */
export class CalculatorEvaluationError extends Error {
  readonly _tag = 'ASSESSMENT_CALCULATOR_EVALUATION_ERROR'
  readonly reason: string
  constructor(reason: string) {
    super(`calculator evaluation failed: ${reason}`)
    this.reason = reason
  }
}

/** the frozen runtime fact behind a plan cannot be verified or prepared */
export class CalculatorRuntimeError extends Error {
  readonly _tag = 'ASSESSMENT_CALCULATOR_RUNTIME_ERROR'
  readonly reason: string
  constructor(reason: string) {
    super(`calculator runtime unavailable: ${reason}`)
    this.reason = reason
  }
}

/** one already-bound calculator, prepared for one plan: evaluate many times */
export interface PreparedCalculator {
  /** the amount, as an exact decimal string, for one already-validated input */
  readonly evaluate: (
    input: Record<string, unknown>,
  ) => Effect.Effect<string, CalculatorEvaluationError>
}

/**
 * A calculator with its services already captured, closed over by `bind`.
 *
 * Every method here is `R = never` on purpose: the one seam where a
 * calculator acquires services is its registration's `bind`, and what bind
 * returns must be finished with acquiring. A `prepare` that could still
 * demand services would merely move the old `CalculatorDriver<R>` problem
 * one interface later.
 *
 * `compile` freezes a stored configuration once, when a question is saved -
 * never per entry. `verify` re-proves a frozen plan's runtime fact at boot
 * without contacting any execution process. `prepare` resolves what one
 * plan needs to evaluate - once per plan per request - and hands back the
 * closure that runs per entry.
 */
export interface BoundCalculator {
  readonly ref: string
  readonly compile: (
    config: unknown,
    context: CalculatorCompileContext,
  ) => Effect.Effect<CompiledCalculator, CalculatorContractError>
  readonly verify: (
    config: unknown,
    runtimeRef: RuntimeRef | undefined,
    context: CalculatorHostContext,
  ) => Effect.Effect<void, CalculatorRuntimeError>
  readonly prepare: (
    config: unknown,
    runtimeRef: RuntimeRef | undefined,
    context: CalculatorHostContext,
  ) => Effect.Effect<PreparedCalculator, CalculatorRuntimeError>
}

/**
 * One calculator, registered once, contributed to two channels by
 * `Scoring.calculator`: its declaration (ref and config schema, a prepare
 * value) and its runtime binding.
 *
 * `R` lives here and nowhere else. The built-in arithmetic needs nothing;
 * a calculator backed by a stored function reaches its library and sandbox
 * inside `bind`, whose layer builds in the runtime phase - above the
 * complete service graph, wired by the composition root, never through a
 * module global filled in after the fact.
 *
 * The reference format is `name@version` because the promise is replay: a
 * frozen run cites the exact arithmetic it used, and a change that would
 * alter any result is a new version beside the old one, not an edit. Amounts
 * cross this boundary as exact decimal strings and become 1e-4 integers on
 * the host's side; floats never appear.
 */
export interface CalculatorRegistration<R = never> {
  readonly kind: 'calculator'
  readonly ref: string
  /** validates the config an item revision stores under this reference */
  readonly configSchema: Schema.Top
  readonly bind: Effect.Effect<BoundCalculator, never, R>
}

/** the prepare-phase face of a calculator: what exists, what it stores */
export interface CalculatorDefinition {
  readonly kind: 'calculator'
  readonly ref: string
  readonly configSchema: Schema.Top
}

export interface AggregatorDriver {
  readonly kind: 'aggregator'
  readonly ref: string
  /** validates the config an item revision stores under this reference */
  readonly configSchema: Schema.Top
  /**
   * Folds an item's approved amounts into the item's amount - and says, per
   * entry, whether it counted. The account is the product (§8): a rule like
   * "only the highest office counts" must be able to explain every line it
   * left out, so a bare total is not an acceptable answer.
   */
  readonly aggregate: (
    config: unknown,
    entries: readonly { readonly entryId: string; readonly amount: bigint }[],
  ) => AggregationResult
}

export interface AggregatedEntry {
  readonly entryId: string
  readonly included: boolean
  /** what this entry contributed - 0n when it did not count */
  readonly effectiveAmount: bigint
  /** why it did not count, for the line that explains it */
  readonly reason?: 'not-selected'
}

export interface AggregationResult {
  readonly total: bigint
  /**
   * One decision per entry it was given, each naming its own.
   *
   * The ledger matches these by `entryId`, so an aggregator is free to
   * return them in whatever order suits its own algorithm - and an answer
   * that drops, repeats or invents an entry is refused rather than mapped
   * onto whichever claim happened to sit at that index.
   */
  readonly entries: readonly AggregatedEntry[]
}

/**
 * What the prepare phase knows about scoring: calculator declarations and
 * whole aggregators. An aggregator IS its definition - a pure fold with no
 * services to acquire - which is why it has no runtime half and takes no
 * part in the runtime channel's completeness rule.
 */
export type ScoringDefinition = CalculatorDefinition | AggregatorDriver

/** every scoring definition this assembly's plugins declare, in plugin order */
export const ScoringDefinitions = ExtensionPoint.make<ScoringDefinition>(
  '@qualy/plugin-assessment/scoring-definitions',
  { phase: 'prepare' },
)

/**
 * Every calculator's runtime registration, bound in the runtime phase.
 *
 * The `R` each registration's `bind` carries is erased at the contribution -
 * the provider's layer carries the real requirements, and the composition
 * root discharges them with the running services. That is the one declared
 * erasure of this model, re-proven by the boot.
 */
export const ScoringRuntimes = ExtensionPoint.make<CalculatorRegistration<any>>(
  '@qualy/plugin-assessment/scoring-runtimes',
  { phase: 'runtime' },
)

export class ScoringDefinitionCatalog extends Context.Service<
  ScoringDefinitionCatalog,
  {
    readonly calculators: ReadonlyMap<string, CalculatorDefinition>
    readonly aggregators: ReadonlyMap<string, AggregatorDriver>
  }
>()('@qualy/plugin-assessment/ScoringDefinitionCatalog') {}

/**
 * The bound calculators, addressed by ref. An unknown ref is a defect, not
 * an error: configurations were proven against the installed catalog when
 * saved, and the boot audit refuses to serve with a stored plan whose
 * driver is gone - a miss here means the assembly itself is broken.
 */
export class ScoringRuntimeCatalog extends Context.Service<
  ScoringRuntimeCatalog,
  {
    readonly compile: (
      ref: string,
      config: unknown,
      context: CalculatorCompileContext,
    ) => Effect.Effect<CompiledCalculator, CalculatorContractError>
    readonly verify: (
      ref: string,
      config: unknown,
      runtimeRef: RuntimeRef | undefined,
      context: CalculatorHostContext,
    ) => Effect.Effect<void, CalculatorRuntimeError>
    readonly prepare: (
      ref: string,
      config: unknown,
      runtimeRef: RuntimeRef | undefined,
      context: CalculatorHostContext,
    ) => Effect.Effect<PreparedCalculator, CalculatorRuntimeError>
  }
>()('@qualy/plugin-assessment/ScoringRuntimeCatalog') {}

const REF_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9]\d*$/

export const ItemTypes = {
  /** declares that this plugin provides a kind of question */
  driver: (driver: ItemTypeDriver): PluginFeature => {
    if (!ITEM_TYPE_FORMAT.test(driver.id)) {
      // the same rule the item_type column enforces, refused at declaration -
      // a driver that assembles cleanly and dies on the first item created
      // would point everyone at the wrong file
      throw new Error(
        `item type id "${driver.id}" is not lowercase dot-or-dash words (like "evidence" or "appraisal.teacher")`,
      )
    }
    return Plugin.contribute(ItemTypeDeclarations, driver)
  },

  /**
   * The owner's interpretation: the catalog, refused rather than merged on a
   * duplicate id - which driver a stored item_type meant would otherwise be
   * decided by load order, and the rows cannot be asked.
   */
  provider: Plugin.provideExtension(ItemTypeDeclarations, {
    compile: (contributions) => {
      const drivers = new Map<string, ItemTypeDriver>()
      const owners = new Map<string, string>()
      for (const contribution of contributions) {
        const existing = owners.get(contribution.value.id)
        if (existing !== undefined) {
          throw new Error(
            `two plugins provide the item type "${contribution.value.id}": ${existing} and ${contribution.pluginId}`,
          )
        }
        owners.set(contribution.value.id, contribution.pluginId)
        drivers.set(contribution.value.id, contribution.value)
      }
      return Layer.succeed(ItemTypeCatalog, drivers)
    },
  }),
}

const refuseRefFormat = (ref: string) => {
  if (!REF_FORMAT.test(ref)) {
    // refused at declaration, where the plugin author is, rather than at
    // resolve where only the assembler is
    throw new Error(`scoring ref "${ref}" is not in name@version form (like "fixed@1")`)
  }
}

export const Scoring = {
  /**
   * One calculator, two contributions: its definition for the prepare
   * catalog and its registration for the runtime channel. The pair is
   * returned as a tuple the caller spreads explicitly -
   * `Plugin.define(..., ...Scoring.calculator(fixed1), ...)` - because
   * `Plugin.define` deliberately does not flatten nested feature arrays.
   */
  calculator: <R>(
    registration: CalculatorRegistration<R>,
  ): readonly [PluginFeature, PluginFeature] => {
    refuseRefFormat(registration.ref)
    const definition: CalculatorDefinition = {
      kind: 'calculator',
      ref: registration.ref,
      configSchema: registration.configSchema,
    }
    return [
      Plugin.contribute(ScoringDefinitions, definition),
      Plugin.contribute(ScoringRuntimes, registration as CalculatorRegistration<any>),
    ] as const
  },

  /** declares an aggregator: a pure fold, whole in its definition */
  aggregator: (driver: AggregatorDriver): PluginFeature => {
    refuseRefFormat(driver.ref)
    return Plugin.contribute(ScoringDefinitions, driver)
  },

  definitionProvider: Plugin.provideExtension(ScoringDefinitions, {
    compile: (contributions) => {
      const calculators = new Map<string, CalculatorDefinition>()
      const aggregators = new Map<string, AggregatorDriver>()
      const owners = new Map<string, string>()
      for (const contribution of contributions) {
        const definition = contribution.value
        const key = `${definition.kind}:${definition.ref}`
        const existing = owners.get(key)
        if (existing !== undefined) {
          throw new Error(
            `two plugins provide the ${definition.kind} "${definition.ref}": ${existing} and ${contribution.pluginId}`,
          )
        }
        owners.set(key, contribution.pluginId)
        if (definition.kind === 'calculator') calculators.set(definition.ref, definition)
        else aggregators.set(definition.ref, definition)
      }
      return Layer.succeed(ScoringDefinitionCatalog, { calculators, aggregators })
    },
  }),
}
