import { Plugin } from '@qualy/plugin-kit'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { siteRegistrationContext } from './server/site-registration.ts'
import {
  ACCOUNT_SHELL,
  accountHeader,
  APP_SHELL,
  BLANK_SHELL,
  drawerAccount,
  drawerIdentity,
  drawerSignOut,
  headerActions,
  sidebarUser,
  USER_DETAIL_SHELL,
  userDetailHeader,
  userDetailNavigationBadge,
  WORKSPACE_SHELL,
  workspaceContext,
  workspaceNavigationBadge,
} from '@qualy/ui-contract'

// A layout plugin ships one thing: implementations behind layout contracts.
// It depends on no business plugin, no business plugin depends on it, and
// the description is the whole entry. The four application shells come
// from one module (see client/shells.ts), so they load as one, and each
// names the slots it renders so the runtime fetches them beside it: the top
// bar's two, and for the rail shells the drawer's three - mounted ahead of
// being opened - with the strip above the rail and the live badges in it.

const TOP_BAR = [headerActions, sidebarUser]
const RAIL = [...TOP_BAR, drawerIdentity, drawerAccount, drawerSignOut]

const plugin = Plugin.define(
  '@qualy/plugin-layout-default',
  { dependsOn: ['@qualy/plugin-ui-registry'] },
  Ui.documentContext(siteRegistrationContext),
  Ui.layout({
    contract: APP_SHELL,
    component: Ui.react('./client/shells', 'AppShell'),
    slots: TOP_BAR,
  }),
  Ui.layout({
    contract: WORKSPACE_SHELL,
    component: Ui.react('./client/shells', 'WorkspaceShell'),
    slots: [...RAIL, workspaceContext, workspaceNavigationBadge],
  }),
  Ui.layout({
    contract: USER_DETAIL_SHELL,
    component: Ui.react('./client/shells', 'UserDetailShell'),
    slots: [...RAIL, userDetailHeader, userDetailNavigationBadge],
  }),
  Ui.layout({
    contract: ACCOUNT_SHELL,
    component: Ui.react('./client/shells', 'AccountShell'),
    slots: [...RAIL, accountHeader],
  }),
  Ui.layout({
    contract: BLANK_SHELL,
    component: Ui.react('./client/BlankShell'),
  }),
)

export default plugin
