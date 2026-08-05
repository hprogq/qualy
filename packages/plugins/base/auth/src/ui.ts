import {
  ADMIN_SHELL,
  BLANK_SHELL,
  PUBLIC,
  defineSurfaces,
  definePage,
  headerActions,
  permissionOf,
} from '@qualy/ui-contract'
import { iamMessages } from './iam/messages.ts'

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

export const surfaces = defineSurfaces({
  pages: [
    { page: loginPage, component: 'auth/LoginPage', layout: BLANK_SHELL, visibility: PUBLIC },
    {
      page: usersPage,
      component: 'auth/UsersPage',
      layout: ADMIN_SHELL,
      visibility: permissionOf('auth.user.read'),
      navigation: { label: iamMessages.usersNav, order: 30 },
    },
    // a detail screen is reachable from the list rather than from the
    // navigation, so it declares no entry
    {
      page: userDetailPage,
      component: 'auth/UserDetailPage',
      layout: ADMIN_SHELL,
      visibility: permissionOf('auth.user.read'),
    },
    {
      page: userTypesPage,
      component: 'auth/UserTypesPage',
      layout: ADMIN_SHELL,
      visibility: permissionOf('auth.user-type.read'),
      navigation: { label: iamMessages.userTypesNav, order: 31 },
    },
  ],
  slots: [
    // the menu shows a sign-in link to anonymous visitors, so it is public
    {
      key: headerActions.key,
      id: 'auth/user-menu',
      component: 'auth/UserMenu',
      visibility: PUBLIC,
      order: 100,
    },
  ],
})
