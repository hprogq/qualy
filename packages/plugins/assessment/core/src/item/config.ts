import { Effect, Schema } from 'effect'
import type { ItemTypeDriver, ScoringDriver } from '../plugin.ts'
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
  readonly calculators: ReadonlyMap<string, ScoringDriver>
  readonly aggregators: ReadonlyMap<string, ScoringDriver>
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
