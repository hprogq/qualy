import { Plugin } from '@qualy/plugin-kit'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { ADMIN_SHELL, BLANK_SHELL } from '@qualy/ui-contract'

// A layout plugin ships one thing: implementations behind layout contracts.
// It depends on no business plugin, no business plugin depends on it, and
// the description is the whole entry.

const plugin = Plugin.define(
  '@qualy/plugin-layout-default',
  { dependsOn: ['@qualy/plugin-ui-registry'] },
  Ui.layout({
    contract: ADMIN_SHELL,
    provider: 'layout-default/admin',
    component: Ui.react('./client/AdminShell.tsx'),
  }),
  Ui.layout({
    contract: BLANK_SHELL,
    provider: 'layout-default/blank',
    component: Ui.react('./client/BlankShell.tsx'),
  }),
)

export default plugin
