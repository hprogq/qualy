import { definePage } from '@qualy/ui-contract'

// shared page references: the plugin entry registers them and any plugin's
// client navigates by naming them, so no path string is ever repeated
export const loginPage = definePage({ id: 'auth/login', path: '/login' })

export const usersPage = definePage({ id: 'auth/users', path: '/admin/users' })
export const userTypesPage = definePage({ id: 'auth/user-types', path: '/admin/user-types' })
