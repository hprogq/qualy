import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { Settings } from '@qualy/settings-contract/plugin'
import { message } from '@qualy/i18n-contract'
import { APP_SHELL, navigationGroups, permissionOf } from '@qualy/ui-contract'
import { settingsActions } from './actions.ts'
import { settingsApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { serviceLayer, settingsApiHandlers } from './server/index.ts'

// Tenant settings as one description: the table overrides land in, the
// catalog every declaring plugin compiles into, the one manage permission,
// the terminology screen, and the api the screen and every `useTerm` read.
//
// Owning `Settings.provider` makes this a mandatory base capability for any
// plugin that declares a term: an assembly with the declaration and without
// this plugin fails at boot rather than showing a word nobody can change.

const plugin = Plugin.define(
  '@qualy/plugin-settings',
  {
    dependsOn: [
      '@qualy/plugin-audit',
      '@qualy/plugin-database',
      '@qualy/plugin-rbac',
      '@qualy/plugin-ui-registry',
    ],
  },
  // org for the tenant edge; overrides belong to the tenant and leave with it
  Db.entities(entities, { dependsOn: ['@qualy/plugin-org'] }),
  Settings.provider,
  Access.permissions('settings', permissions),
  Audit.actions('settings', settingsActions),
  Ui.i18n('./client/i18n'),
  Ui.page({
    id: 'settings/terminology',
    path: '/settings/terminology',
    component: Ui.react('./client/TerminologyPage'),
    layout: APP_SHELL,
    visibility: permissionOf('settings.terminology.manage'),
    navigation: {
      label: message('settings/navigation/terminology', 'Terminology'),
      order: 10,
      group: 'settings/system',
    },
  }),
  Ui.surfaces({
    collections: [
      {
        collection: navigationGroups,
        id: 'settings/system',
        value: {
          id: 'settings/system',
          label: message('settings/nav-group/system', 'System settings'),
          order: 90,
          icon: 'settings',
        },
        visibility: permissionOf('settings.terminology.manage'),
      },
    ],
  }),
  Api.group(settingsApiGroup, settingsApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layer stays a named export beside the descriptor: tests build
// single groups from it, and a value export costs nothing
export { settingsApiHandlers as apiHandlers } from './server/index.ts'
