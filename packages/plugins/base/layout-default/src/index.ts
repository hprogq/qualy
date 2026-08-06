import type { Layer } from 'effect'
import { registerSurfaces, type Ui } from '@qualy/plugin-ui-registry/server/registry'
import { ADMIN_SHELL, BLANK_SHELL, defineSurfaces } from '@qualy/ui-contract'

// A layout plugin ships one thing to the running application: implementations
// behind layout contracts. It depends on no business plugin, no business
// plugin depends on it, and registering them is the whole entry.
export const layer: Layer.Layer<never, never, Ui> = registerSurfaces(
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
)
