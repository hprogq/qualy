import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { assessmentApiGroup } from './api.ts'
import { assessmentApiHandlers, serviceLayer } from './server/index.ts'

// The assessment bounded context: its tables, its permission codes, its api
// group and the service the batch screens talk to. Pages, the item-type and
// calculator extension points and the scheduler fiber land with their own
// milestones.

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
  Api.group(assessmentApiGroup, assessmentApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export { assessmentApiHandlers as apiHandlers } from './server/index.ts'
