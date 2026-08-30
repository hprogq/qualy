import { Context, Layer } from 'effect'
import type { Effect, Schema } from 'effect'
import type { AtomicSchema, NormalizedAtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
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

/**
 * A calculator states its input contract, then evaluates an input built to
 * that contract - it never reads an entry, a payload or a database.
 *
 * `R` is a type parameter rather than a promise of `never`: the built-in
 * arithmetic needs nothing, but a calculator backed by a stored function has
 * to reach a library and a sandbox. The seam for that already exists and is
 * proven by the kernel suite ("a contribution whose behaviour needs a running
 * service"): a driver whose methods require services is contributed to an
 * `afterServices` channel, whose provider compiles ABOVE the service graph
 * and discharges the requirement there. What must never appear instead is a
 * module-global handle filled in after the fact.
 *
 * The reference format is `name@version` because the promise is replay: a
 * frozen run cites the exact arithmetic it used, and a change that would
 * alter any result is a new version beside the old one, not an edit. Amounts
 * cross this boundary as exact decimal strings and become 1e-4 integers on
 * the host's side; floats never appear.
 */
export interface CalculatorDriver<R = never> {
  readonly kind: 'calculator'
  readonly ref: string
  /** validates the config an item revision stores under this reference */
  readonly configSchema: Schema.Top
  /**
   * Compiles a stored configuration: what typed input it needs, what it
   * answers with, and the canonical form it will execute in.
   *
   * Called once when a question is saved, never per entry. `evaluate` is
   * then handed the compiled config, so the two can never disagree about
   * what the configuration meant.
   */
  readonly compile: (
    config: unknown,
  ) => Effect.Effect<CompiledCalculator, CalculatorContractError, R>
  /** the amount, as an exact decimal string, for one already-validated input */
  readonly evaluate: (
    config: unknown,
    input: Record<string, unknown>,
  ) => Effect.Effect<string, CalculatorEvaluationError, R>
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

export type ScoringDriver = CalculatorDriver | AggregatorDriver

/** every scoring driver this assembly's plugins declare, in plugin order */
export const ScoringDeclarations = ExtensionPoint.make<ScoringDriver>(
  '@qualy/plugin-assessment/scoring-drivers',
  { phase: 'prepare' },
)

export class ScoringCatalog extends Context.Service<
  ScoringCatalog,
  {
    readonly calculators: ReadonlyMap<string, ScoringDriver>
    readonly aggregators: ReadonlyMap<string, ScoringDriver>
  }
>()('@qualy/plugin-assessment/ScoringCatalog') {}

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

export const Scoring = {
  /** declares a calculator or aggregator this plugin's arithmetic will honor */
  driver: (driver: ScoringDriver): PluginFeature => {
    if (!REF_FORMAT.test(driver.ref)) {
      // refused at declaration, where the plugin author is, rather than at
      // resolve where only the assembler is
      throw new Error(`scoring ref "${driver.ref}" is not in name@version form (like "fixed@1")`)
    }
    return Plugin.contribute(ScoringDeclarations, driver)
  },

  provider: Plugin.provideExtension(ScoringDeclarations, {
    compile: (contributions) => {
      const calculators = new Map<string, ScoringDriver>()
      const aggregators = new Map<string, ScoringDriver>()
      const owners = new Map<string, string>()
      for (const contribution of contributions) {
        const driver = contribution.value
        const key = `${driver.kind}:${driver.ref}`
        const existing = owners.get(key)
        if (existing !== undefined) {
          throw new Error(
            `two plugins provide the ${driver.kind} "${driver.ref}": ${existing} and ${contribution.pluginId}`,
          )
        }
        owners.set(key, contribution.pluginId)
        ;(driver.kind === 'calculator' ? calculators : aggregators).set(driver.ref, driver)
      }
      return Layer.succeed(ScoringCatalog, { calculators, aggregators })
    },
  }),
}
