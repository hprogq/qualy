import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import {
  APP_SHELL,
  PUBLIC,
  USER_DETAIL_SHELL,
  navigationGroups,
  permissionOf,
  userDetailNavigation,
} from '@qualy/ui-contract'
import { auditApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { auditApiHandlers, serviceLayer } from './server/index.ts'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

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
  Ui.page({
    id: 'audit/events',
    path: '/organization/audit',
    component: Ui.react('./client/AuditEventsPage'),
    layout: APP_SHELL,
    visibility: permissionOf('audit.event.read'),
    navigation: {
      label: text(m.navigation_events),
      icon: 'clipboard-list',
      order: 60,
      group: 'audit/records',
    },
  }),
  // One person's part of the trail, as a section of their record: filed
  // into the user-detail shell the way any plugin that keeps something per
  // person files one, for whoever may read the trail
  Ui.page({
    id: 'audit/user-events',
    path: '/organization/users/:userId/audit',
    component: Ui.react('./client/UserAuditPage'),
    layout: USER_DETAIL_SHELL,
    title: text(m.userEvents_title),
    visibility: permissionOf('audit.event.read'),
  }),
  // A heading of its own inside the organization application: reading what
  // was done is a different errand from arranging who may do it. The parent
  // is named by id - a group nobody registered leaves this one top-level.
  Ui.surfaces({
    collections: [
      {
        collection: userDetailNavigation,
        id: 'audit/user-detail/events',
        value: {
          id: 'audit/user-detail/events',
          label: text(m.userEvents_title),
          target: { kind: 'page', pageId: 'audit/user-events' },
          icon: 'clipboard-list',
          // after every section about who the person is and what they hold
          order: 40,
        },
        visibility: permissionOf('audit.event.read'),
      },
      {
        collection: navigationGroups,
        id: 'audit/records',
        value: {
          id: 'audit/records',
          label: text(m.navGroup_records),
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
