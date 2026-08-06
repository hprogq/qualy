import { Layer } from 'effect'
import { ADMIN_SHELL, defineSurfaces, permissionOf } from '@qualy/ui-contract'
import { registerSurfaces } from '@qualy/plugin-ui-registry/server/registry'
import { declarePermissions } from '@qualy/rbac-contract/effect'
import { orgNavigationLabel } from './messages.ts'
import { permissions } from './permissions.ts'
import { serviceLayer } from './server/index.ts'
import { orgPage } from './pages.ts'

// The plugin: its service, and what it puts where. The organization screen
// into the shell, its permission codes into the catalog, the handlers behind
// its api group, and the service the rest of the assembly calls.

export { orgApiHandlers as apiHandlers } from './server/index.ts'

export const layer = serviceLayer.pipe(
  Layer.merge(
    registerSurfaces(
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
  ),
  Layer.merge(declarePermissions('org', permissions)),
)
