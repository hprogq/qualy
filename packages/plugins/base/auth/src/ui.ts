import { definePage } from '@qualy/ui-contract'

// shared page references: the plugin entry registers them and any plugin's
// client navigates by naming them, so no path string is ever repeated
export const loginPage = definePage({ id: 'auth/login', path: '/login' })
