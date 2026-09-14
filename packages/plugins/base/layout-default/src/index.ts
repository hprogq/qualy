import { Plugin } from '@qualy/plugin-kit'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { APP_SHELL, BLANK_SHELL, WORKSPACE_SHELL } from '@qualy/ui-contract'

// A layout plugin ships one thing: implementations behind layout contracts.
// It depends on no business plugin, no business plugin depends on it, and
// the description is the whole entry.

const plugin = Plugin.define(
  '@qualy/plugin-layout-default',
  { dependsOn: ['@qualy/plugin-ui-registry'] },
  Ui.i18n('./client/i18n.ts'),
  Ui.layout({
    contract: APP_SHELL,
    component: Ui.react('./client/AppShell.tsx'),
  }),
  Ui.layout({
    contract: WORKSPACE_SHELL,
    component: Ui.react('./client/WorkspaceShell.tsx'),
  }),
  Ui.layout({
    contract: BLANK_SHELL,
    component: Ui.react('./client/BlankShell.tsx'),
  }),
)

export default plugin
