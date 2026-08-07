import { definePage } from '@qualy/ui-contract'
import { message } from '@qualy/i18n-contract'

// This plugin's framework-neutral ui contract: page identities and the text
// declarations the server manifest carries. One leaf, imported by two
// compilation worlds - the descriptor registers pages and navigation labels,
// browser code (this plugin's and anyone else's) links to the same
// identities and translates the same message ids - so it stays free of both
// React and server code.

export const rolesPage = definePage({ id: 'rbac/roles', path: '/admin/roles' })

export const rbacNavigation = {
  rolesNav: message('rbac/navigation/roles', 'Roles'),
}
