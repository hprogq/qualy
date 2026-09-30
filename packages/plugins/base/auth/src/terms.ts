import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import { defineSettingCategory, defineTerm } from '@qualy/settings-contract'
import { authTerms } from '@qualy/auth-contract/terms'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

// The words the identity domain lets a tenant choose, as the settings screen
// shows them: where each sits, what it is called there, and the product's own
// word until a tenant chooses another. Other plugins and every screen name a
// term only by the reference in @qualy/auth-contract/terms.

export const authTermCategories = {
  identity: defineSettingCategory({
    id: 'auth/identity',
    label: text(m.settings_category_identity),
    order: 20,
  }),
} as const

export const authTermDefinitions = {
  businessNumber: defineTerm({
    id: authTerms.businessNumber.id,
    categoryId: authTermCategories.identity.id,
    label: text(m.settings_term_businessNumber),
    description: text(m.settings_term_businessNumberDescription),
    default: text(m.settings_term_businessNumberDefault),
    order: 10,
  }),
} as const
