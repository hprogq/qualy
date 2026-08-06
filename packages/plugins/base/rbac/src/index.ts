import { Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Postgres } from '@qualy/plugin-database/plugin'
import { ReactUi, legacySurfaceLayer } from '@qualy/plugin-ui-registry/plugin'
import { Access, legacyPermissionLayer } from '@qualy/rbac-contract/plugin'
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
  Postgres.entities(entities),
  ReactUi.surfaces(
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
  Api.group(accessApiGroup, accessApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// legacy bridge until the descriptor assembler takes over the host; the
// handlers stay a direct export because their precise type is load-bearing
// in the generated composition
export { accessApiHandlers as apiHandlers } from './server/index.ts'

// provideMerge, not merge: the permission bridge declares into the registry
// this very service provides, so the declarations build above it
export const layer = Layer.mergeAll(legacySurfaceLayer(plugin), legacyPermissionLayer(plugin)).pipe(
  Layer.provideMerge(serviceLayer),
)
