import { Layer } from 'effect'
import {
  ADMIN_SHELL,
  BLANK_SHELL,
  PUBLIC,
  defineSurfaces,
  headerActions,
  permissionOf,
} from '@qualy/ui-contract'
import { registerSurfaces } from '@qualy/plugin-ui-registry/server/registry'
import { declarePermissions } from '@qualy/rbac-contract/effect'
import { iamMessages } from './iam/messages.ts'
import { permissions } from './permissions.ts'
import { identityApiHandlers, serviceLayer, sessionApiHandlers } from './server/index.ts'
import { loginPage, userDetailPage, userTypesPage, usersPage } from './pages.ts'

// The plugin: identity itself, plus what it puts where - four screens, a
// header slot, its permission codes, and the handlers behind its two groups.

export { config } from './server/auth-config.ts'

/** both groups, under the one name every entry exports its handlers as */
export const apiHandlers = Layer.mergeAll(identityApiHandlers, sessionApiHandlers)

export const layer = serviceLayer.pipe(
  Layer.merge(
    registerSurfaces(
      defineSurfaces({
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
      }),
    ),
  ),
  Layer.merge(declarePermissions('auth', permissions)),
)
