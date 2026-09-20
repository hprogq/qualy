import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { Settings } from '@qualy/settings-contract/plugin'
import { message } from '@qualy/i18n-contract'
import { APP_SHELL, permissionOf } from '@qualy/ui-contract'
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
  // Filed in the library beside the formulas rather than in a settings
  // section of its own: what a tenant calls a thing is material the product
  // is assembled from, like a formula, not a switch on how the system runs.
  // The group belongs to whoever declared it, exactly as the user and role
  // pages sit in the organization group they did not declare.
  Ui.page({
    id: 'settings/terminology',
    path: '/library/terminology',
    component: Ui.react('./client/TerminologyPage'),
    layout: APP_SHELL,
    visibility: permissionOf('settings.terminology.manage'),
    navigation: {
      label: message('settings/navigation/terminology', 'Terminology'),
      icon: 'book-a',
      order: 40,
      group: 'library/main',
    },
  }),
  Api.group(settingsApiGroup, settingsApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layer stays a named export beside the descriptor: tests build
// single groups from it, and a value export costs nothing
export { settingsApiHandlers as apiHandlers } from './server/index.ts'
