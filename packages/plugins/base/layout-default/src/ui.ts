import { ADMIN_SHELL, BLANK_SHELL, defineSurfaces } from '@qualy/ui-contract'

// A layout plugin ships implementations of layout contracts and nothing else:
// it depends on no business plugin, and no business plugin depends on it.

export const surfaces = defineSurfaces({
  layouts: [
    { contract: ADMIN_SHELL, provider: 'layout-default/admin', component: 'layout-default/AdminShell' },
    { contract: BLANK_SHELL, provider: 'layout-default/blank', component: 'layout-default/BlankShell' },
  ],
})
