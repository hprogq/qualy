import { Layer } from 'effect'
import { message } from '@qualy/i18n-contract'
import { Plugin } from '@qualy/plugin-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Login } from '@qualy/auth-contract/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import {
  APP_SHELL,
  BLANK_SHELL,
  PUBLIC,
  orgNodePicker,
  peopleImportPicker,
  peoplePicker,
  permissionOf,
  personCard,
  drawerAccount,
  drawerIdentity,
  drawerSignOut,
  sidebarUser,
} from '@qualy/ui-contract'
import { config } from './server/auth-config.ts'
import { identityApiGroup, sessionApiGroup } from './api.ts'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import { identityApiHandlers, serviceLayer, sessionApiHandlers } from './server/index.ts'

// The plugin, as one description: identity itself, its tables, four screens,
// a header slot, its permission codes, and its two api groups.

const plugin = Plugin.define(
  '@qualy/plugin-auth',
  {
    dependsOn: ['@qualy/plugin-database', '@qualy/plugin-rbac', '@qualy/plugin-ui-registry'],
    config,
  },
  Db.entities(entities, { compositeForeignKeys, dependsOn: ['@qualy/plugin-org'] }),
  Ui.i18n('./client/i18n.ts'),
  Ui.page({
    id: 'auth/login',
    path: '/login',
    component: Ui.react('./client/LoginPage.tsx'),
    layout: BLANK_SHELL,
    visibility: PUBLIC,
    // no menu entry to borrow the words from: a page reached before there is
    // anybody to show a menu to
    title: message('auth/navigation/login', 'Sign in'),
  }),
  Ui.page({
    id: 'auth/users',
    path: '/organization/users',
    component: Ui.react('./client/iam/UsersPage.tsx'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.user.read'),
    navigation: {
      label: message('auth/navigation/users', 'Users'),
      order: 20,
      group: 'org/organization',
    },
  }),
  // a detail screen is reachable from the list rather than from the
  // navigation, so it declares no entry
  Ui.page({
    id: 'auth/user-detail',
    path: '/organization/users/:userId',
    component: Ui.react('./client/iam/UserDetailPage.tsx'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.user.read'),
    title: message('auth/navigation/user-detail', 'Person'),
  }),
  Ui.page({
    id: 'auth/user-types',
    path: '/organization/user-types',
    component: Ui.react('./client/iam/UserTypesPage.tsx'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.user-type.read'),
    navigation: {
      label: message('auth/navigation/user-types', 'User types'),
      order: 40,
      group: 'org/organization',
    },
  }),
  Ui.page({
    id: 'auth/login-methods',
    path: '/organization/login-methods',
    component: Ui.react('./client/iam/LoginMethodsPage.tsx'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.provider.read'),
    navigation: {
      label: message('auth/navigation/login-methods', 'Ways in'),
      order: 50,
      group: 'org/organization',
    },
  }),
  // the account at the end of the top bar; it shows a sign-in link to
  // anonymous visitors, so it is public
  Ui.slot({
    key: sidebarUser.key,
    id: 'auth/user-menu',
    component: Ui.react('./client/UserMenu.tsx'),
    visibility: PUBLIC,
  }),
  // the same account, on the narrow shell's navigation drawer: who is in at
  // the head, preferences and the way out at the foot. Public for the same
  // reason the top bar's corner is - the head offers sign-in to anonymous
  // visitors, and the foot's controls are browser preferences.
  Ui.slot({
    key: drawerIdentity.key,
    id: 'auth/drawer-identity',
    component: Ui.react('./client/DrawerIdentity.tsx'),
    visibility: PUBLIC,
  }),
  Ui.slot({
    key: drawerAccount.key,
    id: 'auth/drawer-account',
    component: Ui.react('./client/DrawerAccount.tsx'),
    visibility: PUBLIC,
  }),
  Ui.slot({
    key: drawerSignOut.key,
    id: 'auth/drawer-sign-out',
    component: Ui.react('./client/DrawerSignOut.tsx'),
    visibility: PUBLIC,
  }),
  // A person, wherever another screen names one. Behind the same permission
  // that reading people takes anywhere else, so a screen that lists names
  // gets the plain name when the reader may not learn more than that.
  Ui.slot({
    key: personCard.key,
    id: 'auth/person-card',
    component: Ui.react('./client/iam/PersonCard.tsx'),
    visibility: permissionOf('auth.user.read'),
  }),
  // Choosing people, and choosing a slice of the organization to take people
  // from. Same permission as reading people anywhere else: a screen that
  // needs a picker does not get to see more than its reader may.
  Ui.slot({
    key: peoplePicker.key,
    id: 'auth/people-picker',
    component: Ui.react('./client/iam/PeoplePicker.tsx'),
    visibility: permissionOf('auth.user.read'),
  }),
  Ui.slot({
    key: peopleImportPicker.key,
    id: 'auth/people-import-picker',
    component: Ui.react('./client/iam/PeopleImportPicker.tsx'),
    visibility: permissionOf('auth.user.read'),
  }),
  Ui.slot({
    key: orgNodePicker.key,
    id: 'auth/org-node-picker',
    component: Ui.react('./client/iam/OrgNodePicker.tsx'),
    visibility: permissionOf('auth.user.read'),
  }),
  Access.permissions('auth', permissions),
  // auth owns the sign-in registry: drivers declare, this interprets
  Login.provider,
  Api.group(identityApiGroup, identityApiHandlers),
  Api.group(sessionApiGroup, sessionApiHandlers),
  Plugin.layer(serviceLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export const apiHandlers = Layer.mergeAll(identityApiHandlers, sessionApiHandlers)
