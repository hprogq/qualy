import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { message } from '@qualy/i18n-contract'
import { APP_SHELL, PUBLIC, navigationGroups, permissionOf } from '@qualy/ui-contract'
import { auditApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { auditApiHandlers, serviceLayer } from './server/index.ts'

// The trail as one description: the table events land in, the writer every
// recording plugin reaches through the contract, the one read permission,
// the screen that reads it, and the action catalog this plugin owns.
//
// Owning `Audit.provider` is what makes audit a mandatory base capability:
// a plugin that declares actions in an assembly without this plugin has an
// unprovided extension point, which is a hard failure at boot - never a
// silently unrecorded operation.

const plugin = Plugin.define(
  '@qualy/plugin-audit',
  { dependsOn: ['@qualy/plugin-database', '@qualy/plugin-ui-registry'] },
  // org for the tenant edge; auth read-only, so the trail can show an
  // actor's current name when the event kept no snapshot
  Db.entities(entities, { dependsOn: ['@qualy/plugin-org', '@qualy/plugin-auth'] }),
  Ui.i18n('./client/i18n'),
  Ui.page({
    id: 'audit/events',
    path: '/organization/audit',
    component: Ui.react('./client/AuditEventsPage'),
    layout: APP_SHELL,
    visibility: permissionOf('audit.event.read'),
    navigation: {
      label: message('audit/navigation/events', 'Audit log'),
      icon: 'clipboard-list',
      order: 60,
      group: 'audit/records',
    },
  }),
  // A heading of its own inside the organization application: reading what
  // was done is a different errand from arranging who may do it. The parent
  // is named by id - a group nobody registered leaves this one top-level.
  Ui.surfaces({
    collections: [
      {
        collection: navigationGroups,
        id: 'audit/records',
        value: {
          id: 'audit/records',
          label: message('audit/nav-group/records', 'Audit'),
          order: 90,
          parent: 'org/organization',
        },
        visibility: PUBLIC,
      },
    ],
  }),
  Access.permissions('audit', permissions),
  Audit.provider,
  Api.group(auditApiGroup, auditApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layer stays a named export beside the descriptor: tests build
// single groups from it, and a value export costs nothing
export { auditApiHandlers as apiHandlers } from './server/index.ts'
