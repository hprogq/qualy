import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Postgres } from '@qualy/plugin-database/plugin'
import { ReactUi } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { ADMIN_SHELL, defineSurfaces, permissionOf } from '@qualy/ui-contract'
import { orgApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { orgNavigationLabel } from './messages.ts'
import { permissions } from './permissions.ts'
import { orgApiHandlers, serviceLayer } from './server/index.ts'
import { orgPage } from './pages.ts'

// The plugin, as one description: its tables, one screen, its permission
// codes, its api group, and the service the rest of the assembly calls.

const plugin = Plugin.define(
  '@qualy/plugin-org',
  {
    dependsOn: [
      '@qualy/plugin-auth',
      '@qualy/plugin-database',
      '@qualy/plugin-rbac',
      '@qualy/plugin-ui-registry',
    ],
  },
  Postgres.entities(entities),
  ReactUi.surfaces(
    defineSurfaces({
      pages: [
        {
          page: orgPage,
          component: 'org/OrgPage',
          layout: ADMIN_SHELL,
          visibility: permissionOf('org.tree.read'),
          navigation: { label: orgNavigationLabel, order: 20 },
        },
      ],
    }),
  ),
  Access.permissions('org', permissions),
  Api.group(orgApiGroup, orgApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export { orgApiHandlers as apiHandlers } from './server/index.ts'
