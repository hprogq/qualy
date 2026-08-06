import { Layer } from 'effect'
import { ADMIN_SHELL, defineSurfaces, permissionOf } from '@qualy/ui-contract'
import { registerSurfaces } from '@qualy/plugin-ui-registry/server/registry'
import { rbacNavigation } from './messages.ts'
import { serviceLayer } from './server/index.ts'
import { rolesPage } from './pages.ts'

// The plugin: authorization itself, and the one screen that administers it.
// Its own permission codes are declared inside the service layer rather than
// here, because the registry they go into is the service's to provide.

export { accessApiHandlers as apiHandlers } from './server/index.ts'

export const layer = serviceLayer.pipe(
  Layer.merge(
    registerSurfaces(
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
  ),
)
