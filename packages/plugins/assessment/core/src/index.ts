import { Plugin } from '@qualy/plugin-kit'
import { Db } from '@qualy/plugin-database/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { permissions } from './permissions.ts'

// The assessment bounded context. This session it is tables and permission
// codes; services, api groups, pages and the item-type/calculator extension
// points land with their own milestones.

const plugin = Plugin.define(
  '@qualy/plugin-assessment',
  {
    dependsOn: [
      '@qualy/plugin-auth',
      '@qualy/plugin-database',
      '@qualy/plugin-org',
      '@qualy/plugin-rbac',
      '@qualy/plugin-ui-registry',
    ],
  },
  Db.entities(entities, {
    compositeForeignKeys,
    dependsOn: ['@qualy/plugin-org', '@qualy/plugin-auth'],
  }),
  Access.permissions('assessment', permissions),
)

export default plugin
