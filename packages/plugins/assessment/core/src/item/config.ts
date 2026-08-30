import { Effect, Schema } from 'effect'
import { SUMMARY_FIELDS_MOST, summaryFieldIdsOf } from '../entry/summary.ts'
import type { AggregatorDriver, CalculatorDefinition, ItemTypeDriver } from '../plugin.ts'
import { validateReviewPolicy, type PolicyIssue } from './policy.ts'

// One saved configuration, checked against everything it cites.
//
// A configuration is only as real as the machinery it names: a driver that is
// not installed, a calculator nobody registered, a form the driver cannot
// read - each would sit in the database looking fine until the first student
// opened the item. So the whole set is checked at save, and the answer is a
// list of issues rather than the first one found: an administrator fixing a
// form should not discover the scoring reference next.

export interface ItemConfigInput {
  readonly entrySource: 'student' | 'administrative'
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
    const issues: PolicyIssue[] = []

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
        } else if (type === 'attachment') {
          issues.push({ path: 'displayConfig.entrySummary', reason: 'summary-field-attachment' })
        }
      }
    }

    const driver = catalogs.itemTypes.get(itemType)
    if (driver === undefined) {
      issues.push({ path: 'itemType', reason: 'item-type-not-installed' })
    } else {
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

    issues.push(...validateReviewPolicy(input.entrySource, input.reviewPolicy))
    return issues
  })
