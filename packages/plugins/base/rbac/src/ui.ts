import { ADMIN_SHELL, defineSurfaces, definePage, permissionOf } from '@qualy/ui-contract'
import { rbacNavigation } from './messages.ts'

export const rolesPage = definePage({ id: 'rbac/roles', path: '/admin/roles' })

export const surfaces = defineSurfaces({
  pages: [
    {
      page: rolesPage,
      component: 'rbac/RolesPage',
      layout: ADMIN_SHELL,
      visibility: permissionOf('iam.role.read'),
      navigation: { label: rbacNavigation.rolesNav, order: 32 },
    },
  ],
})
