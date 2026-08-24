import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { orgActions } from './actions.ts'
import { message } from '@qualy/i18n-contract'
import { APP_SHELL, PUBLIC, navigationGroups, permissionOf } from '@qualy/ui-contract'
import { orgApiGroup } from './api.ts'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { orgApiHandlers, serviceLayer } from './server/index.ts'

// The plugin, as one description: its tables, one screen, its permission
// codes, its api group, and the service the rest of the assembly calls.

const plugin = Plugin.define(
  '@qualy/plugin-org',
  {
    dependsOn: [
      '@qualy/plugin-audit',
      '@qualy/plugin-auth',
      '@qualy/plugin-database',
      '@qualy/plugin-rbac',
      '@qualy/plugin-ui-registry',
    ],
  },
  Db.entities(entities, { compositeForeignKeys, baselineDir: 'db/baseline' }),
  Ui.i18n('./client/i18n.ts'),
  Ui.page({
    id: 'org/page',
    path: '/organization/tree',
    component: Ui.react('./client/OrgPage.tsx'),
    layout: APP_SHELL,
    visibility: permissionOf('org.tree.read'),
    navigation: {
      label: message('org/navigation/organization', 'Organization tree'),
      order: 10,
      group: 'org/organization',
    },
  }),
  // The application this domain anchors, which auth and rbac also file their
  // pages under: the tree, the people in it, and what they are allowed to do
  // are one subject, and calling it "administration" said only who was
  // allowed in rather than what it was about.
  Ui.surfaces({
    collections: [
      {
        key: navigationGroups.key,
        id: 'org/organization',
        value: {
          id: 'org/organization',
          label: message('org/nav-group/organization', 'Organization & access'),
          order: 40,
          icon: 'users',
        },
        visibility: PUBLIC,
      },
    ],
  }),
  Access.permissions('org', permissions),
  Audit.actions('org', orgActions),
  Api.group(orgApiGroup, orgApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export { orgApiHandlers as apiHandlers } from './server/index.ts'
