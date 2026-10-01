import { Layer } from 'effect'
import { OrgUsage } from '@qualy/org-contract/plugin'
import { peopleAtNode } from './server/node-usage.ts'
import { Plugin } from '@qualy/plugin-kit'
import { Cli } from '@qualy/plugin-kit/cli'
import { Api } from '@qualy/api-kit/plugin'
import { Db } from '@qualy/plugin-database/plugin'
import { Login } from '@qualy/auth-contract/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { Access } from '@qualy/rbac-contract/plugin'
import { Audit } from '@qualy/audit-contract/plugin'
import { Settings } from '@qualy/settings-contract/plugin'
import { authTermCategories, authTermDefinitions } from './terms.ts'
import { SIGN_IN_PAGE, SIGN_IN_PAGE_PATH } from '@qualy/auth-contract/sign-in-failure'
import { CONFIRM_EMAIL_PATH, RESET_PASSWORD_PATH } from './constants.ts'
import { userActions } from './actions.ts'
import {
  APP_SHELL,
  AUTHENTICATED,
  BLANK_SHELL,
  PUBLIC,
  USER_DETAIL_SHELL,
  orgNodePicker,
  orgNodePickerView,
  peopleImportPicker,
  peoplePicker,
  peoplePickerView,
  permissionOf,
  personCard,
  drawerAccount,
  drawerIdentity,
  drawerSignOut,
  sidebarUser,
  userDetailHeader,
  userDetailNavigation,
  ACCOUNT_SHELL,
  accountHeader,
  accountNavigation,
  primaryNavigation,
} from '@qualy/ui-contract'
import { config } from './server/auth-config.ts'
import { identityApiGroup, loginIconApiGroup, selfApiGroup, sessionApiGroup } from './api.ts'
import { loginIconApiHandlers } from './server/icons.ts'
import { compositeForeignKeys, entities } from './db/entities.ts'
import { permissions } from './permissions.ts'
import {
  identityApiHandlers,
  pluginLayer,
  selfApiHandlers,
  sessionApiHandlers,
} from './server/index.ts'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

// The plugin, as one description: identity itself, its tables, four screens,
// a header slot, its permission codes, and its two api groups.

const plugin = Plugin.define(
  '@qualy/plugin-auth',
  {
    dependsOn: [
      '@qualy/plugin-audit',
      '@qualy/plugin-captcha',
      '@qualy/plugin-database',
      '@qualy/plugin-mail',
      '@qualy/plugin-rbac',
      '@qualy/plugin-secrets',
      '@qualy/plugin-storage',
      '@qualy/plugin-ui-registry',
    ],
    config,
  },
  Db.entities(entities, { compositeForeignKeys, dependsOn: ['@qualy/plugin-org'] }),
  Audit.actions('auth', userActions),
  // an operator's way to give an imported account this deployment's password,
  // run over the assembled services and never by the serving process
  Cli.command({
    namespace: 'auth',
    name: 'set-password',
    summary: "set a person's password from a variable in this process's environment",
    context: 'runtime',
    load: () => import('./cli/set-password.ts'),
  }),
  // the words a tenant may choose for this domain, compiled by the settings plugin
  Settings.definitions({
    categories: Object.values(authTermCategories),
    settings: Object.values(authTermDefinitions),
  }),
  Ui.page({
    // the page the browser sends an anonymous visitor to sign in at, by id
    id: SIGN_IN_PAGE,
    // the address redirect drivers send a failed sign-in back to
    path: SIGN_IN_PAGE_PATH,
    component: Ui.react('./client/LoginPage'),
    layout: BLANK_SHELL,
    visibility: PUBLIC,
    // no menu entry to borrow the words from: a page reached before there is
    // anybody to show a menu to
    title: text(m.navigation_login),
  }),
  Ui.page({
    id: 'auth/users',
    path: '/organization/users',
    component: Ui.react('./client/iam/UsersPage'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.user.read'),
    navigation: {
      label: text(m.navigation_users),
      icon: 'users',
      order: 20,
      group: 'org/organization',
    },
  }),
  // a detail screen is reachable from the list rather than from the
  // navigation, so it declares no entry
  // One person, as a record with sections. The shell is the user-detail
  // one: it puts the banner above and the sections down the side, and any
  // plugin that keeps something per person files a section of its own. Auth
  // owns the banner and the three sections the directory itself answers for.
  Ui.page({
    id: 'auth/user-detail',
    path: '/organization/users/:userId',
    component: Ui.react('./client/iam/UserProfilePage'),
    layout: USER_DETAIL_SHELL,
    title: text(m.users_profile),
    visibility: permissionOf('auth.user.read'),
  }),
  Ui.page({
    id: 'auth/user-organization',
    path: '/organization/users/:userId/organization',
    component: Ui.react('./client/iam/UserOrganizationPage'),
    layout: USER_DETAIL_SHELL,
    title: text(m.users_placement),
    visibility: permissionOf('auth.user.read'),
  }),
  Ui.page({
    id: 'auth/user-identities',
    path: '/organization/users/:userId/identities',
    component: Ui.react('./client/iam/UserIdentitiesPage'),
    layout: USER_DETAIL_SHELL,
    title: text(m.person_tabIdentities),
    visibility: permissionOf('auth.user.read'),
  }),
  // where they are signed in and every attempt to come in as them: security
  // data, so read by whoever administers their account, and only them
  Ui.page({
    id: 'auth/user-activity',
    path: '/organization/users/:userId/activity',
    component: Ui.react('./client/iam/UserActivityPage'),
    layout: USER_DETAIL_SHELL,
    title: text(m.activity_title),
    visibility: permissionOf('auth.user.manage'),
  }),
  Ui.slot({
    key: userDetailHeader.key,
    id: 'auth/user-detail-header',
    component: Ui.react('./client/iam/UserDetailHeader'),
    visibility: permissionOf('auth.user.read'),
  }),
  Ui.surfaces({
    collections: [
      {
        collection: userDetailNavigation,
        id: 'auth/user-detail/profile',
        value: {
          id: 'auth/user-detail/profile',
          label: text(m.users_profile),
          target: { kind: 'page', pageId: 'auth/user-detail' },
          icon: 'id-card',
          order: 0,
        },
        visibility: permissionOf('auth.user.read'),
      },
      {
        collection: userDetailNavigation,
        id: 'auth/user-detail/organization',
        value: {
          id: 'auth/user-detail/organization',
          label: text(m.users_placement),
          target: { kind: 'page', pageId: 'auth/user-organization' },
          icon: 'building-2',
          order: 10,
        },
        visibility: permissionOf('auth.user.read'),
      },
      {
        collection: userDetailNavigation,
        id: 'auth/user-detail/identities',
        value: {
          id: 'auth/user-detail/identities',
          label: text(m.person_tabIdentities),
          target: { kind: 'page', pageId: 'auth/user-identities' },
          icon: 'key-round',
          order: 20,
        },
        visibility: permissionOf('auth.user.read'),
      },
      {
        collection: userDetailNavigation,
        id: 'auth/user-detail/activity',
        value: {
          id: 'auth/user-detail/activity',
          label: text(m.activity_title),
          target: { kind: 'page', pageId: 'auth/user-activity' },
          icon: 'calendar-clock',
          // after the ways in, before the roles another plugin files at 30
          order: 25,
        },
        visibility: permissionOf('auth.user.manage'),
      },
    ],
  }),
  // The reader's own account: who they are, and how they sign in. An entry
  // of its own at the end of the top bar for anybody signed in; the pages
  // are about the reader and nobody else, so a session is all they ask for.
  Ui.page({
    id: 'auth/account-profile',
    path: '/account',
    component: Ui.react('./client/account/AccountProfilePage'),
    layout: ACCOUNT_SHELL,
    title: text(m.account_profile),
    visibility: AUTHENTICATED,
  }),
  Ui.page({
    id: 'auth/account-logins',
    path: '/account/logins',
    component: Ui.react('./client/account/AccountLoginsPage'),
    layout: ACCOUNT_SHELL,
    title: text(m.account_logins),
    visibility: AUTHENTICATED,
  }),
  Ui.page({
    id: 'auth/account-security',
    path: '/account/security',
    component: Ui.react('./client/account/AccountSecurityPage'),
    layout: ACCOUNT_SHELL,
    title: text(m.account_security),
    visibility: AUTHENTICATED,
  }),
  // what happened to the reader's account: sign-ins and changes, a page of
  // its own, apart from the security page's state of things now
  Ui.page({
    id: 'auth/account-activity',
    path: '/account/activity',
    component: Ui.react('./client/account/AccountActivityPage'),
    layout: ACCOUNT_SHELL,
    title: text(m.activity_title),
    visibility: AUTHENTICATED,
  }),
  // where the links mail sends land: public, because the person following
  // one may be signed out, or on another device
  Ui.page({
    id: 'auth/reset-password',
    path: RESET_PASSWORD_PATH,
    component: Ui.react('./client/recovery/ResetPasswordPage'),
    layout: BLANK_SHELL,
    title: text(m.reset_title),
    visibility: PUBLIC,
  }),
  Ui.page({
    id: 'auth/email-confirmation',
    path: CONFIRM_EMAIL_PATH,
    component: Ui.react('./client/recovery/ConfirmEmailPage'),
    layout: BLANK_SHELL,
    title: text(m.confirm_title),
    visibility: PUBLIC,
  }),
  Ui.slot({
    key: accountHeader.key,
    id: 'auth/account-header',
    component: Ui.react('./client/account/AccountHeader'),
    visibility: AUTHENTICATED,
  }),
  Ui.surfaces({
    collections: [
      {
        collection: primaryNavigation,
        id: 'auth/account',
        value: {
          id: 'auth/account',
          label: text(m.navigation_account),
          target: { kind: 'page', pageId: 'auth/account-profile' },
          icon: 'user-round',
          // after every application, whatever they are numbered
          order: 10_000,
        },
        visibility: AUTHENTICATED,
      },
      {
        collection: accountNavigation,
        id: 'auth/account/profile',
        value: {
          id: 'auth/account/profile',
          label: text(m.account_profile),
          target: { kind: 'page', pageId: 'auth/account-profile' },
          icon: 'id-card',
          order: 0,
        },
        visibility: AUTHENTICATED,
      },
      {
        collection: accountNavigation,
        id: 'auth/account/security',
        value: {
          id: 'auth/account/security',
          label: text(m.account_security),
          target: { kind: 'page', pageId: 'auth/account-security' },
          icon: 'shield-check',
          order: 20,
        },
        visibility: AUTHENTICATED,
      },
      {
        collection: accountNavigation,
        id: 'auth/account/activity',
        value: {
          id: 'auth/account/activity',
          label: text(m.activity_title),
          target: { kind: 'page', pageId: 'auth/account-activity' },
          icon: 'calendar-clock',
          order: 25,
        },
        visibility: AUTHENTICATED,
      },
      {
        collection: accountNavigation,
        id: 'auth/account/logins',
        value: {
          id: 'auth/account/logins',
          label: text(m.account_logins),
          target: { kind: 'page', pageId: 'auth/account-logins' },
          icon: 'key-round',
          order: 10,
        },
        visibility: AUTHENTICATED,
      },
    ],
  }),
  Ui.page({
    id: 'auth/user-types',
    path: '/organization/user-types',
    component: Ui.react('./client/iam/UserTypesPage'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.user-type.read'),
    navigation: {
      label: text(m.navigation_userTypes),
      icon: 'id-card',
      order: 40,
      group: 'org/organization',
    },
  }),
  // one user type's own page: reached from its row, so it files no entry
  Ui.page({
    id: 'auth/user-type',
    path: '/organization/user-types/:typeId',
    component: Ui.react('./client/iam/UserTypePage'),
    layout: APP_SHELL,
    title: text(m.userTypes_edit),
    visibility: permissionOf('auth.user-type.read'),
  }),
  Ui.page({
    id: 'auth/login-methods',
    path: '/organization/login-methods',
    component: Ui.react('./client/iam/LoginMethodsPage'),
    layout: APP_SHELL,
    visibility: permissionOf('auth.provider.read'),
    navigation: {
      label: text(m.navigation_loginMethods),
      icon: 'key-round',
      order: 50,
      group: 'org/organization',
    },
  }),
  // the account at the end of the top bar; it shows a sign-in link to
  // anonymous visitors, so it is public
  Ui.slot({
    key: sidebarUser.key,
    id: 'auth/user-menu',
    component: Ui.react('./client/UserMenu'),
    visibility: PUBLIC,
  }),
  // the same account, on the narrow shell's navigation drawer: who is in at
  // the head, preferences and the way out at the foot. Public for the same
  // reason the top bar's corner is - the head offers sign-in to anonymous
  // visitors, and the foot's controls are browser preferences.
  Ui.slot({
    key: drawerIdentity.key,
    id: 'auth/drawer-identity',
    component: Ui.react('./client/DrawerIdentity'),
    visibility: PUBLIC,
  }),
  Ui.slot({
    key: drawerAccount.key,
    id: 'auth/drawer-account',
    component: Ui.react('./client/DrawerAccount'),
    visibility: PUBLIC,
  }),
  Ui.slot({
    key: drawerSignOut.key,
    id: 'auth/drawer-sign-out',
    component: Ui.react('./client/DrawerSignOut'),
    visibility: PUBLIC,
  }),
  // A person, wherever another screen names one. Behind the same permission
  // that reading people takes anywhere else, so a screen that lists names
  // gets the plain name when the reader may not learn more than that.
  Ui.slot({
    key: personCard.key,
    id: 'auth/person-card',
    component: Ui.react('./client/iam/PersonCard'),
    visibility: permissionOf('auth.user.read'),
  }),
  // Choosing people, and choosing a slice of the organization to take people
  // from. Same permission as reading people anywhere else: a screen that
  // needs a picker does not get to see more than its reader may.
  Ui.slot({
    key: peoplePicker.key,
    id: 'auth/people-picker',
    component: Ui.react('./client/iam/PeoplePicker'),
    visibility: permissionOf('auth.user.read'),
  }),
  // The same drawing with nobody in it, for a screen whose population is
  // narrower than the directory and differently authorized. It fetches
  // nothing and decides nothing about who may be seen, so it asks for no
  // permission of its own - the caller has already proved its own page.
  Ui.slot({
    key: peoplePickerView.key,
    id: 'auth/people-picker-view',
    component: Ui.react('./client/iam/PeoplePickerView'),
    visibility: AUTHENTICATED,
  }),
  Ui.slot({
    key: peopleImportPicker.key,
    id: 'auth/people-import-picker',
    component: Ui.react('./client/iam/PeopleImportPicker'),
    visibility: permissionOf('auth.user.read'),
  }),
  Ui.slot({
    key: orgNodePicker.key,
    id: 'auth/org-node-picker',
    component: Ui.react('./client/iam/OrgNodePicker'),
    visibility: permissionOf('auth.user.read'),
  }),
  // The same tree over units the caller supplies: it reads nothing, so like
  // the people drawing above it asks for no permission of its own.
  Ui.slot({
    key: orgNodePickerView.key,
    id: 'auth/org-node-picker-view',
    component: Ui.react('./client/iam/OrgNodePickerView'),
    visibility: AUTHENTICATED,
  }),
  OrgUsage.reporter(peopleAtNode),
  Access.permissions('auth', permissions),
  // auth owns the sign-in registry: drivers declare, this interprets
  Login.provider,
  Api.group(identityApiGroup, identityApiHandlers),
  Api.group(sessionApiGroup, sessionApiHandlers),
  Api.group(selfApiGroup, selfApiHandlers),
  Api.group(loginIconApiGroup, loginIconApiHandlers),
  Plugin.layer(pluginLayer),
)

export default plugin

// the handler layers stay named exports beside the descriptor: tests build
// single groups from them, and a value export costs nothing
export const apiHandlers = Layer.mergeAll(identityApiHandlers, sessionApiHandlers, selfApiHandlers)
