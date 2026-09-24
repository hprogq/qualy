import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { message } from '@qualy/i18n-contract'
import { permissionOf, usersPageActions } from '@qualy/ui-contract'
import { directoryImportActions } from './actions.ts'
import { directoryApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { directoryApiHandlers, serviceLayer } from './server/index.ts'

// People in bulk, as one description: the history tables, the two screens,
// the button on the users screen that leads to them, the audit actions and
// the api. No permission of its own: creating people is `auth.user.manage`
// where they will stand, taking them away again is `auth.user.delete`, and
// making units is `org.tree.manage` - the same words the single acts use.
//
// A thin plugin over auth, org and storage on purpose: it orchestrates,
// and asks each owner through the port that owner publishes.

const plugin = Plugin.define(
  '@qualy/plugin-directory-import',
  {
    dependsOn: [
      '@qualy/plugin-audit',
      '@qualy/plugin-auth',
      '@qualy/plugin-database',
      '@qualy/plugin-org',
      '@qualy/plugin-rbac',
      '@qualy/plugin-settings',
      '@qualy/plugin-storage',
      '@qualy/plugin-ui-registry',
    ],
  },
  // history points at the tenant; people and units it names are read from
  // their owners' tables, never pinned
  Db.entities(entities, {
    dependsOn: ['@qualy/plugin-org', '@qualy/plugin-auth', '@qualy/plugin-rbac'],
  }),
  Audit.actions('directory', directoryImportActions),
  Ui.i18n('./client/i18n'),
  // no page of its own: importing is a dialog over the roster it adds to, and
  // what was imported before is a sheet beside it
  Ui.surfaces({
    slots: [
      {
        key: usersPageActions.key,
        id: 'directory-import/users-action',
        component: Ui.react('./client/ImportUsersAction'),
        visibility: permissionOf('auth.user.manage'),
        order: 10,
      },
    ],
  }),
  Api.group(directoryApiGroup, directoryApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

export { directoryApiHandlers as apiHandlers } from './server/index.ts'
