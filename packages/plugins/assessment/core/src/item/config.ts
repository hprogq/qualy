import { Effect, Schema } from 'effect'
import { SUMMARY_FIELDS_MOST, summaryFieldIdsOf } from '../entry/summary.ts'
import type { AggregatorDriver, CalculatorDefinition, ItemTypeDriver } from '../plugin.ts'
import { validateReviewPolicy, type PolicyIssue } from './policy.ts'
import { isEntryChannel, type EntryChannel } from './channels.ts'

// One saved configuration, checked against everything it cites.
//
// A configuration is only as real as the machinery it names: a driver that is
// not installed, a calculator nobody registered, a form the driver cannot
// read - each would sit in the database looking fine until the first student
// opened the item. So the whole set is checked at save, and the answer is a
// list of issues rather than the first one found: an administrator fixing a
// form should not discover the scoring reference next.

export interface ItemConfigInput {
  /** the doors open on this question; a derived question names none */
  readonly entryChannels: readonly EntryChannel[]
  readonly formConfig: unknown
  readonly scoringConfig: unknown
  readonly reviewPolicy: unknown
  readonly displayConfig?: unknown
}

/** the shape scoring_config stores: two named references, each with a config */
const scoringShape = Schema.Struct({
  calculator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
  aggregator: Schema.Struct({ ref: Schema.String, config: Schema.Unknown }),
})

export interface Catalogs {
  readonly itemTypes: ReadonlyMap<string, ItemTypeDriver>
  readonly calculators: ReadonlyMap<string, CalculatorDefinition>
  readonly aggregators: ReadonlyMap<string, AggregatorDriver>
}

/**
 * The most one saved configuration may weigh, as the JSON it is stored as.
 *
 * Every revision is served whole to everybody who can see the batch, and a
 * participant's page asks for the list again on every change - so the size
 * of a configuration is paid by every reader, as often as they look. The
 * driver schemas bound what they read, not what else rides along with it;
 * this bounds all of it at once, whatever the driver.
 */
export const CONFIG_BYTES_MOST = 256 * 1024

/** the question's own words, as the participant reads them above the form */
export const DESCRIPTION_MOST = 2000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** the stored weight of a configuration, or null when it cannot be written as JSON at all */
const weightOf = (input: ItemConfigInput): number | null => {
  try {
    const text = JSON.stringify([
      input.formConfig,
      input.scoringConfig,
      input.reviewPolicy,
      input.displayConfig,
    ])
    return new TextEncoder().encode(text).length
  } catch {
    // nested deeper than the serializer can walk
    return null
  }
}

/**
 * A configuration too large to keep, said the way a save refuses it; empty
 * when it fits. Asked first, before anything reads, normalizes or compiles
 * what was submitted.
 */
export const weightIssues = (input: ItemConfigInput): readonly PolicyIssue[] => {
  const weight = weightOf(input)
  return weight === null || weight > CONFIG_BYTES_MOST
    ? [{ path: 'config', reason: 'config-too-large' }]
    : []
}

/**
 * What the question shows about itself: its description, and the fields
 * that identify a claim. Nothing else is read from it, so nothing else is
 * kept - an unknown key would be stored and served to every reader for
 * nobody to read.
 */
const displayIssues = (displayConfig: unknown): PolicyIssue[] => {
  if (displayConfig === undefined || displayConfig === null) return []
  if (!isRecord(displayConfig)) return [{ path: 'displayConfig', reason: 'display-not-an-object' }]
  const issues: PolicyIssue[] = []
  for (const key of Object.keys(displayConfig)) {
    if (key !== 'description' && key !== 'entrySummary') {
      issues.push({ path: `displayConfig.${key}`, reason: 'display-unknown-key' })
    }
  }
  const description = displayConfig['description']
  if (
    description !== undefined &&
    (typeof description !== 'string' || description.length > DESCRIPTION_MOST)
  ) {
    issues.push({ path: 'displayConfig.description', reason: 'display-description-invalid' })
  }
  const summary = displayConfig['entrySummary']
  if (summary !== undefined) {
    const ids = isRecord(summary) ? summary['fieldIds'] : undefined
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      issues.push({ path: 'displayConfig.entrySummary', reason: 'summary-invalid' })
    }
    for (const key of isRecord(summary) ? Object.keys(summary) : []) {
      if (key !== 'fieldIds') {
        issues.push({ path: `displayConfig.entrySummary.${key}`, reason: 'display-unknown-key' })
      }
    }
  }
  return issues
}

const decodeIssues = (path: string, reason: string, schema: Schema.Top, value: unknown) =>
  Effect.match(Schema.decodeUnknownEffect(schema as Schema.Codec<unknown>)(value), {
    onSuccess: (): readonly PolicyIssue[] => [],
    onFailure: (): readonly PolicyIssue[] => [{ path, reason }],
  })

/**
 * Every issue this configuration has, or none.
 *
 * The compatibility trial over live entries is not here: it needs rows, and
 * this module deliberately has none. The service runs it after this comes
 * back clean.
 */
export const validateItemConfig = (
  catalogs: Catalogs,
  itemType: string,
  input: ItemConfigInput,
): Effect.Effect<readonly PolicyIssue[]> =>
  Effect.gen(function* () {
    // weighed before anything is read: past the ceiling, nothing else in it
    // is worth decoding
    const heavy = weightIssues(input)
    if (heavy.length > 0) return heavy

    const issues: PolicyIssue[] = [...displayIssues(input.displayConfig)]

    // the elected identity fields (§32.74): each must name a form field
    // that can identify a claim - present, not an attachment - and three
    // is the cap the surfaces lay rows out for
    const elected = summaryFieldIdsOf(input.displayConfig)
    if (elected.length > SUMMARY_FIELDS_MOST) {
      issues.push({ path: 'displayConfig.entrySummary', reason: 'summary-too-many-fields' })
    }
    if (new Set(elected).size !== elected.length) {
      issues.push({ path: 'displayConfig.entrySummary', reason: 'summary-duplicate-field' })
    }
    if (elected.length > 0) {
      const fields = (input.formConfig as { fields?: unknown } | null | undefined)?.fields
      const known = new Map<string, string>()
      if (Array.isArray(fields)) {
        for (const field of fields as readonly { id?: string; key?: string; type?: string }[]) {
          const identity = typeof field.id === 'string' ? field.id : field.key
          if (typeof identity === 'string' && !known.has(identity)) {
            known.set(identity, typeof field.type === 'string' ? field.type : '')
          }
        }
      }
      for (const id of elected) {
        const type = known.get(id)
        if (type === undefined) {
          issues.push({ path: 'displayConfig.entrySummary', reason: 'summary-field-unknown' })
        } else if (type === 'attachment' || type === 'boolean') {
          issues.push({ path: 'displayConfig.entrySummary', reason: 'summary-field-attachment' })
        }
      }
    }

    const driver = catalogs.itemTypes.get(itemType)
    if (driver === undefined) {
      issues.push({ path: 'itemType', reason: 'item-type-not-installed' })
    } else {
      // The doors, held to the kind of question: a filed question needs at
      // least one open, a derived question - nobody files it - has none. A
      // door named twice, or one this build does not know, is refused
      // rather than read as the doors it happens to contain.
      const channels = input.entryChannels
      if (!Array.isArray(channels) || !channels.every(isEntryChannel)) {
        issues.push({ path: 'entryChannels', reason: 'entry-channels-invalid' })
      } else if (new Set(channels).size !== channels.length) {
        issues.push({ path: 'entryChannels', reason: 'entry-channels-invalid' })
      } else if (driver.interaction === 'derived' ? channels.length > 0 : channels.length === 0) {
        issues.push({ path: 'entryChannels', reason: 'entry-channels-required' })
      }
      issues.push(
        ...(yield* decodeIssues(
          'formConfig',
          'form-config-invalid',
          driver.configSchema,
          input.formConfig,
        )),
      )
    }

    const scoring = yield* Effect.match(
      Schema.decodeUnknownEffect(scoringShape)(input.scoringConfig),
      { onSuccess: (decoded) => decoded, onFailure: () => null },
    )
    if (scoring === null) {
      issues.push({ path: 'scoringConfig', reason: 'scoring-config-shape' })
    } else {
      const calculator = catalogs.calculators.get(scoring.calculator.ref)
      if (calculator === undefined) {
        issues.push({ path: 'scoringConfig.calculator.ref', reason: 'calculator-not-installed' })
      } else {
        issues.push(
          ...(yield* decodeIssues(
            'scoringConfig.calculator.config',
            'calculator-config-invalid',
            calculator.configSchema,
            scoring.calculator.config,
          )),
        )
      }
      const aggregator = catalogs.aggregators.get(scoring.aggregator.ref)
      if (aggregator === undefined) {
        issues.push({ path: 'scoringConfig.aggregator.ref', reason: 'aggregator-not-installed' })
      } else {
        issues.push(
          ...(yield* decodeIssues(
            'scoringConfig.aggregator.config',
            'aggregator-config-invalid',
            aggregator.configSchema,
            scoring.aggregator.config,
          )),
        )
      }
    }

    const policyIssues = validateReviewPolicy(input.reviewPolicy)
    issues.push(...policyIssues)
    // A recorded fact never walks a route on its way in - recording is
    // trusted - so the one route it has is the one its subject's appeal
    // takes, and an appeal walks the escalation route alone (§15, §32.62).
    // A question that records facts with no escalation step leaves every
    // recorded deduction beyond appeal. A question nobody reviews says so
    // with `mode: 'none'` and is not held to this here.
    const channels = input.entryChannels
    const policy = input.reviewPolicy as { mode?: unknown; escalation?: { stages?: unknown } }
    if (
      policyIssues.length === 0 &&
      Array.isArray(channels) &&
      channels.includes('administrative') &&
      policy.mode === undefined &&
      !(Array.isArray(policy.escalation?.stages) && policy.escalation.stages.length > 0)
    ) {
      issues.push({ path: 'reviewPolicy.escalation.stages', reason: 'policy-escalation-required' })
    }
    return issues
  })
