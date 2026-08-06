import { Plugin } from '@qualy/plugin-kit'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { ADMIN_SHELL, BLANK_SHELL, defineSurfaces } from '@qualy/ui-contract'

// A layout plugin ships one thing: implementations behind layout contracts.
// It depends on no business plugin, no business plugin depends on it, and
// the description is the whole entry.

const plugin = Plugin.define(
  '@qualy/plugin-layout-default',
  { dependsOn: ['@qualy/plugin-ui-registry'] },
  Ui.surfaces(
    defineSurfaces({
      layouts: [
        {
          contract: ADMIN_SHELL,
          provider: 'layout-default/admin',
          component: 'layout-default/AdminShell',
        },
        {
          contract: BLANK_SHELL,
          provider: 'layout-default/blank',
          component: 'layout-default/BlankShell',
        },
      ],
    }),
  ),
)

export default plugin
