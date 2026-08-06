import { definePage } from '@qualy/ui-contract'

// This plugin's page identities: id and path, nothing else. A leaf module
// with no framework in it, because both sides import it - the entry registers
// the pages, and any plugin's browser code links to them through PageLink; the
// user menu in the header names loginPage from another package entirely.

export const loginPage = definePage({ id: 'auth/login', path: '/login' })

export const usersPage = definePage({ id: 'auth/users', path: '/admin/users' })
// the first page with a route parameter: a user detail screen needs one
// identity in the url, and PageLink demands the value at every call site
export const userDetailPage = definePage({
  id: 'auth/user-detail',
  path: '/admin/users/:userId',
})
export const userTypesPage = definePage({ id: 'auth/user-types', path: '/admin/user-types' })
