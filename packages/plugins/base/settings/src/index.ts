import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { Settings } from '@qualy/settings-contract/plugin'
import { APP_SHELL, PUBLIC, navigationGroups, permissionOf } from '@qualy/ui-contract'
import { settingsActions } from './actions.ts'
import { settingsApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { SettingsStore, serviceLayer, settingsApiHandlers } from './server/index.ts'
import { TERMS_CONTEXT } from './terms-context.ts'
import { Effect } from 'effect'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

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
  // A heading of its own inside the library: the library is one application,
  // and what is filed in it is not all one kind of thing.
  Ui.surfaces({
    collections: [
      {
        collection: navigationGroups,
        id: 'settings/tenant',
        value: {
          id: 'settings/tenant',
          label: text(m.navGroup_tenant),
          order: 90,
          parent: 'library/main',
        },
        visibility: PUBLIC,
      },
    ],
  }),
  Access.permissions('settings', permissions),
  Audit.actions('settings', settingsActions),
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
      label: text(m.navigation_terminology),
      icon: 'book-a',
      order: 40,
      group: 'settings/tenant',
    },
  }),
  Api.group(settingsApiGroup, settingsApiHandlers),
  Plugin.layer(serviceLayer),
  // every page reads the tenant's words with its manifest, already in the
  // page's language, so a screen says a term without asking for it
  Ui.documentContext({
    key: TERMS_CONTEXT,
    bind: Effect.gen(function* () {
      const store = yield* SettingsStore
      return (reader) => store.termsFor(reader.principal?.tenantId, reader.locale)
    }),
  }),
)

export default plugin

// the handler layer stays a named export beside the descriptor: tests build
// single groups from it, and a value export costs nothing
export { settingsApiHandlers as apiHandlers } from './server/index.ts'
