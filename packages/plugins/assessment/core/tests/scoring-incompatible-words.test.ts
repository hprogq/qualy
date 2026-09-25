import { describe, expect, it } from 'vitest'
import { errorMessages } from '../src/client/i18n.ts'
import zhCN from '../src/client/locales/zh-CN.ts'

// A question nobody files is tried against its own rule when it is published
// or restored, and a rule that cannot give it a score was said as "the new
// rule cannot handle 1 determination already in force" - about a rule that
// was not new and determinations that did not exist.

const entry = errorMessages['ASSESSMENT_ITEM_SCORING_INCOMPATIBLE'] as unknown as {
  readonly message: { readonly defaultMessage: string }
  readonly values: (data: unknown) => Record<string, unknown>
}

describe('a scoring rule that cannot be carried', () => {
  it('says a derived question failed its own rule, not the claims in force', () => {
    expect(
      entry.values({
        itemId: 'q',
        approved: { total: 0, refused: 0, executionFailed: 0 },
        derived: { refused: true, executionFailed: false },
      }),
    ).toMatchObject({ case: 'derived' })
    expect(
      entry.values({
        itemId: 'q',
        approved: { total: 3, refused: 1, executionFailed: 1 },
        derived: null,
      }),
    ).toEqual({ case: 'standing', affected: 2, refused: 1, executionFailed: 1 })
    // both catalogs have words for each case
    for (const words of [
      entry.message.defaultMessage,
      zhCN['assessment/error/item-scoring-incompatible'],
    ]) {
      expect(words).toMatch(/^\{case, select, derived \{/)
    }
  })
})
