import { termRef } from '@qualy/settings-contract'

// The words the identity domain lets a tenant choose, by reference.
//
// Here rather than in auth's own client, because the person's identifier is
// named on screens auth does not own: assessment searches by it, records
// against it, and heads a workbook column with it. One reference is what
// keeps "the tenant calls it 工号" true everywhere at once instead of once per
// plugin. What each term is called on the settings screen and the product's
// own word for it are the auth plugin's declaration (its src/terms.ts).

export const authTerms = {
  /**
   * What a person's business identifier is called: a student number at a
   * school, a staff number at an office, a unified identifier somewhere
   * else. The field stays `businessNo` in every table and every api; only
   * the word a reader sees is the tenant's.
   */
  businessNumber: termRef('auth/business-number'),
} as const
