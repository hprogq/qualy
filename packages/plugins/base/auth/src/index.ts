import { Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Login } from '@qualy/auth-contract/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import {
  ADMIN_SHELL,
  BLANK_SHELL,
  PUBLIC,
  defineSurfaces,
  headerActions,
  permissionOf,
} from '@qualy/ui-contract'
import { config } from './server/auth-config.ts'
import { identityApiGroup, sessionApiGroup } from './api.ts'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { iamMessages } from './iam/messages.ts'
import { permissions } from './permissions.ts'
import { identityApiHandlers, serviceLayer, sessionApiHandlers } from './server/index.ts'
import { loginPage, userDetailPage, userTypesPage, usersPage } from './pages.ts'

// The plugin, as one description: identity itself, its tables, four screens,
// a header slot, its permission codes, and its two api groups.

const plugin = Plugin.define(
  '@qualy/plugin-auth',
  {
    dependsOn: ['@qualy/plugin-database', '@qualy/plugin-rbac', '@qualy/plugin-ui-registry'],
    config,
  },
  Db.entities(entities, { compositeForeignKeys, dependsOn: ['@qualy/plugin-org'] }),
  Ui.surfaces(
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
  Access.permissions('auth', permissions),
  // auth owns the sign-in registry: drivers declare, this interprets
  Login.provider,
  Api.group(identityApiGroup, identityApiHandlers),
  Api.group(sessionApiGroup, sessionApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export const apiHandlers = Layer.mergeAll(identityApiHandlers, sessionApiHandlers)
