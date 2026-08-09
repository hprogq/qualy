import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { message } from '@qualy/i18n-contract'
import { ADMIN_SHELL, PUBLIC, navigationGroups, permissionOf } from '@qualy/ui-contract'
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
    path: '/admin/org',
    component: Ui.react('./client/OrgPage.tsx'),
    layout: ADMIN_SHELL,
    visibility: permissionOf('org.tree.read'),
    navigation: {
      label: message('org/navigation/organization', 'Organization'),
      order: 20,
      group: 'org/directory',
    },
  }),
  // the sidebar sections this domain anchors: a top-level Administration
  // heading, and inside it one collapsible cluster where auth and rbac also
  // file their pages by id
  Ui.surfaces({
    collections: [
      {
        key: navigationGroups.key,
        id: 'org/admin',
        value: {
          id: 'org/admin',
          label: message('org/nav-group/admin', 'Administration'),
          order: 10,
        },
        visibility: PUBLIC,
      },
      {
        key: navigationGroups.key,
        id: 'org/directory',
        value: {
          id: 'org/directory',
          label: message('org/nav-group/directory', 'Organization & users'),
          order: 10,
          parent: 'org/admin',
          icon: 'users',
        },
        visibility: PUBLIC,
      },
    ],
  }),
  Access.permissions('org', permissions),
  Api.group(orgApiGroup, orgApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export { orgApiHandlers as apiHandlers } from './server/index.ts'
