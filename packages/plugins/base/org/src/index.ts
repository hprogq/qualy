import { Context, Service } from 'cordis'
import type { ApiContext } from '@qualy/plugin-server'
import type {} from '@qualy/plugin-database'
import type {} from '@qualy/plugin-ui-registry'
import type {} from '@qualy/rbac-contract'
import { orgNavigationLabel } from './messages.ts'
import { permissions as orgPermissions } from './permissions.ts'
import { createOrgRouter } from './router.ts'
import { OrgTreeService } from './service.ts'

declare module 'cordis' {
  interface Context {
    org: Org
  }
}

export type { ApiContext }

// composition root: permissions, the tree domain service, the scoped api
// and the management page. Domain logic lives in service.ts, transport in
// router.ts, data access in repo.ts.
export default class Org extends Service {
  static inject = ['db', 'server', 'ui', 'rbac']

  readonly tree: OrgTreeService

  constructor(ctx: Context) {
    super(ctx, 'org')
    ctx.rbac.definePermissions('org', orgPermissions)
    this.tree = new OrgTreeService(ctx)
    ctx.server.contribute('org', createOrgRouter(ctx, this.tree))
    ctx.ui.addPage({
      id: 'org/page',
      path: '/admin/org',
      component: 'org/OrgPage',
      layout: 'admin-shell/v1',
      permission: 'org.tree.read',
      navigation: { label: orgNavigationLabel, order: 20 },
    })
  }
}
