import { definePage } from '@qualy/ui-contract'
import { message } from '@qualy/i18n-contract'

// This plugin's framework-neutral ui contract: page identities and the text
// declarations the server manifest carries. One leaf, imported by two
// compilation worlds - the descriptor registers pages and navigation labels,
// browser code (this plugin's and anyone else's) links to the same
// identities and translates the same message ids - so it stays free of both
// React and server code.

export const loginPage = definePage({ id: 'auth/login', path: '/login' })

export const usersPage = definePage({ id: 'auth/users', path: '/admin/users' })
// the first page with a route parameter: a user detail screen needs one
// identity in the url, and PageLink demands the value at every call site
export const userDetailPage = definePage({
  id: 'auth/user-detail',
  path: '/admin/users/:userId',
})
export const userTypesPage = definePage({ id: 'auth/user-types', path: '/admin/user-types' })

export const iamMessages = {
  usersNav: message('auth/navigation/users', 'Users'),
  userTypesNav: message('auth/navigation/user-types', 'User types'),
}
