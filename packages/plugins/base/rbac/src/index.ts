import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { ADMIN_SHELL, defineSurfaces, permissionOf } from '@qualy/ui-contract'
import { accessApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { rbacNavigation } from './messages.ts'
import { permissions } from './permissions.ts'
import { accessApiHandlers, serviceLayer } from './server/index.ts'
import { rolesPage } from './pages.ts'

// The plugin, as one description: authorization itself, its tables, its own
// codes - declared like any contributor's, into the registry its service
// provides - the one screen that administers it, and its api group.

const plugin = Plugin.define(
  '@qualy/plugin-rbac',
  { dependsOn: ['@qualy/plugin-database', '@qualy/plugin-ui-registry'] },
  Db.entities(entities),
  Ui.surfaces(
    defineSurfaces({
      pages: [
        {
          page: rolesPage,
          component: 'rbac/RolesPage',
          layout: ADMIN_SHELL,
          visibility: permissionOf('iam.role.read'),
          navigation: { label: rbacNavigation.rolesNav, order: 32 },
        },
      ],
    }),
  ),
  Access.permissions('rbac', permissions),
  // rbac owns the catalog: contributors declare, this compiles the value
  Access.provider,
  Api.group(accessApiGroup, accessApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export { accessApiHandlers as apiHandlers } from './server/index.ts'
