import { Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Postgres } from '@qualy/plugin-database/plugin'
import { ReactUi, legacySurfaceLayer } from '@qualy/plugin-ui-registry/plugin'
import { Access, legacyPermissionLayer } from '@qualy/rbac-contract/plugin'
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

// legacy bridge until the descriptor assembler takes over the host; the
// handlers stay a direct export because their precise type is load-bearing
// in the generated composition
export { orgApiHandlers as apiHandlers } from './server/index.ts'

export const layer = serviceLayer.pipe(
  Layer.merge(legacySurfaceLayer(plugin)),
  Layer.merge(legacyPermissionLayer(plugin)),
)
