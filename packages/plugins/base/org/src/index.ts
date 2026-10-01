import { Plugin } from '@qualy/plugin-kit'
import { OrgUsage } from '@qualy/org-contract/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { orgActions } from './actions.ts'
import { APP_SHELL, PUBLIC, navigationGroups, permissionOf } from '@qualy/ui-contract'
import { orgApiGroup } from './api.ts'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { orgApiHandlers, serviceLayer } from './server/index.ts'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

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
  Ui.page({
    id: 'org/page',
    path: '/organization/tree',
    component: Ui.react('./client/OrgPage'),
    layout: APP_SHELL,
    visibility: permissionOf('org.tree.read'),
    navigation: {
      label: text(m.navigation_organization),
      icon: 'building-2',
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
        collection: navigationGroups,
        id: 'org/organization',
        value: {
          id: 'org/organization',
          label: text(m.navGroup_organization),
          order: 40,
          icon: 'users',
        },
        visibility: PUBLIC,
      },
    ],
  }),
  OrgUsage.provider,
  Access.permissions('org', permissions),
  Audit.actions('org', orgActions),
  Api.group(orgApiGroup, orgApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export { orgApiHandlers as apiHandlers } from './server/index.ts'
