import { definePage } from '@qualy/ui-contract'

// shared page references: the plugin entry registers them and any plugin's
// client navigates by naming them, so no path string is ever repeated
export const loginPage = definePage({ id: 'auth/login', path: '/login' })

export const usersPage = definePage({ id: 'auth/users', path: '/admin/users' })
// the first page with a route parameter: a user detail screen needs one
// identity in the url, and PageLink demands the value at every call site
export const userDetailPage = definePage({
  id: 'auth/user-detail',
  path: '/admin/users/:userId',
})
export const userTypesPage = definePage({ id: 'auth/user-types', path: '/admin/user-types' })
