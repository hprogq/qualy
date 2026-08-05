import { ADMIN_SHELL, defineSurfaces, definePage, permissionOf } from '@qualy/ui-contract'
import { orgNavigationLabel } from './messages.ts'

export const orgPage = definePage({ id: 'org/page', path: '/admin/org' })

export const surfaces = defineSurfaces({
  pages: [
    {
      page: orgPage,
      component: 'org/OrgPage',
      layout: ADMIN_SHELL,
      visibility: permissionOf('org.tree.read'),
      navigation: { label: orgNavigationLabel, order: 20 },
    },
  ],
})
