import { Context, Layer } from 'effect'
import type { Effect, Schema } from 'effect'
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
  readonly attachmentRefs: (config: unknown, payload: unknown) => readonly AttachmentRef[]
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
 * A named, versioned piece of scoring arithmetic.
 *
 * The reference format is `name@version` because the promise is replay: a
 * frozen run cites the exact arithmetic it used, and a change that would
 * alter any result is a new version beside the old one, not an edit.
 *
 * Only the declaration lives here - ref, role and the shape of acceptable
 * configuration. The functions arrive with the scoring engine; until then
 * this catalog exists to validate an item's scoring_config against the
 * references that are actually installed.
 */
export interface ScoringDriver {
  readonly kind: 'calculator' | 'aggregator'
  readonly ref: string
  /** validates the config an item revision stores under this reference */
  readonly configSchema: Schema.Top
}

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
