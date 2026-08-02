import type { Context } from 'cordis'
import { ADMIN_SHELL, BLANK_SHELL } from '@qualy/ui-contract'
import type {} from '@qualy/plugin-ui-registry'

export const name = 'layout-default'
export const inject = ['ui']

// default implementations of the two layout contracts; business plugins only
// ever reference the contract ids, so a replacement layout plugin can take
// over either role without touching them
export function apply(ctx: Context) {
  ctx.ui.registerLayout({
    contract: ADMIN_SHELL,
    provider: 'layout-default/admin',
    component: 'layout-default/AdminShell',
  })
  ctx.ui.registerLayout({
    contract: BLANK_SHELL,
    provider: 'layout-default/blank',
    component: 'layout-default/BlankShell',
  })
}
