import type { ItemScoringIncompatible } from '../../errors.ts'

export const scoringIncompatibleValues = (
  data: Pick<ItemScoringIncompatible, 'approved' | 'derived'>,
) => {
  const refused = data.approved.refused + (data.derived?.refused === true ? 1 : 0)
  const executionFailed =
    data.approved.executionFailed + (data.derived?.executionFailed === true ? 1 : 0)
  return {
    // a question nobody files has no determinations in force: what
    // failed is its own rule, tried as it is published or restored
    case: data.derived !== null && data.approved.total === 0 ? 'derived' : 'standing',
    affected: refused + executionFailed,
    refused,
    executionFailed,
  }
}
