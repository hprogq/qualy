import { Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Postgres } from '@qualy/plugin-database/plugin'
import { ReactUi, legacySurfaceLayer } from '@qualy/plugin-ui-registry/plugin'
import { Access, legacyPermissionLayer } from '@qualy/rbac-contract/plugin'
import {
  ADMIN_SHELL,
  BLANK_SHELL,
  PUBLIC,
  defineSurfaces,
  headerActions,
  permissionOf,
} from '@qualy/ui-contract'
import { identityApiGroup, sessionApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { iamMessages } from './iam/messages.ts'
import { permissions } from './permissions.ts'
import { identityApiHandlers, serviceLayer, sessionApiHandlers } from './server/index.ts'
import { loginPage, userDetailPage, userTypesPage, usersPage } from './pages.ts'

// The plugin, as one description: identity itself, its tables, four screens,
// a header slot, its permission codes, and its two api groups.

const plugin = Plugin.define(
  '@qualy/plugin-auth',
  Postgres.entities(entities),
  ReactUi.surfaces(
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
  Api.group(identityApiGroup, identityApiHandlers),
  Api.group(sessionApiGroup, sessionApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// legacy bridge until the descriptor assembler takes over the host; the
// handlers stay direct exports because their precise type is load-bearing in
// the generated composition
export { config } from './server/auth-config.ts'

/** both groups, under the one name every entry exports its handlers as */
export const apiHandlers = Layer.mergeAll(identityApiHandlers, sessionApiHandlers)

export const layer = serviceLayer.pipe(
  Layer.merge(legacySurfaceLayer(plugin)),
  Layer.merge(legacyPermissionLayer(plugin)),
)
