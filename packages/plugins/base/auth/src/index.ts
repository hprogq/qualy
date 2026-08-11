import { Layer } from 'effect'
import { message } from '@qualy/i18n-contract'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Login } from '@qualy/auth-contract/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { APP_SHELL, BLANK_SHELL, PUBLIC, permissionOf, sidebarUser } from '@qualy/ui-contract'
import { config } from './server/auth-config.ts'
import { identityApiGroup, sessionApiGroup } from './api.ts'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { identityApiHandlers, serviceLayer, sessionApiHandlers } from './server/index.ts'

// The plugin, as one description: identity itself, its tables, four screens,
// a header slot, its permission codes, and its two api groups.

const plugin = Plugin.define(
  '@qualy/plugin-auth',
  {
    dependsOn: ['@qualy/plugin-database', '@qualy/plugin-rbac', '@qualy/plugin-ui-registry'],
    config,
  },
  Db.entities(entities, { compositeForeignKeys, dependsOn: ['@qualy/plugin-org'] }),
  Ui.i18n('./client/i18n.ts'),
  Ui.page({
    id: 'auth/login',
    path: '/login',
    component: Ui.react('./client/LoginPage.tsx'),
    layout: BLANK_SHELL,
    visibility: PUBLIC,
  }),
  Ui.page({
    id: 'auth/users',
    path: '/organization/users',
    component: Ui.react('./client/iam/UsersPage.tsx'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.user.read'),
    navigation: {
      label: message('auth/navigation/users', 'Users'),
      order: 20,
      group: 'org/organization',
    },
  }),
  // a detail screen is reachable from the list rather than from the
  // navigation, so it declares no entry
  Ui.page({
    id: 'auth/user-detail',
    path: '/organization/users/:userId',
    component: Ui.react('./client/iam/UserDetailPage.tsx'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.user.read'),
  }),
  Ui.page({
    id: 'auth/user-types',
    path: '/organization/user-types',
    component: Ui.react('./client/iam/UserTypesPage.tsx'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.user-type.read'),
    navigation: {
      label: message('auth/navigation/user-types', 'User types'),
      order: 40,
      group: 'org/organization',
    },
  }),
  // the account at the end of the top bar; it shows a sign-in link to
  // anonymous visitors, so it is public
  Ui.slot({
    key: sidebarUser.key,
    id: 'auth/user-menu',
    component: Ui.react('./client/UserMenu.tsx'),
    visibility: PUBLIC,
  }),
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
