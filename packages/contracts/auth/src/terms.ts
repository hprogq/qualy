import { message } from '@qualy/i18n-contract'
import { defineSettingCategory, defineTerm } from '@qualy/settings-contract'

// The words the identity domain lets a tenant choose.
//
// Declared in the contract rather than in auth's own client, because the
// person's identifier is named on screens auth does not own: assessment
// searches by it, records against it, and heads a workbook column with it.
// One token here is what keeps "the tenant calls it 工号" true everywhere at
// once instead of once per plugin.

export const authTermCategories = {
  identity: defineSettingCategory({
    id: 'auth/identity',
    label: message('auth/settings/category/identity', 'People and sign-in'),
    order: 20,
  }),
} as const

export const authTerms = {
  /**
   * What a person's business identifier is called: a student number at a
   * school, a staff number at an office, a unified identifier somewhere
   * else. The field stays `businessNo` in every table and every api; only
   * the word a reader sees is the tenant's.
   */
  businessNumber: defineTerm({
    id: 'auth/business-number',
    categoryId: authTermCategories.identity.id,
    label: message('auth/settings/term/business-number', 'Person identifier'),
    description: message(
      'auth/settings/term/business-number-description',
      'The business identifier assigned to a person in this tenant.',
    ),
    defaults: {
      'zh-CN': '学工号',
      'en-US': 'Student or staff ID',
    },
    order: 10,
  }),
} as const
