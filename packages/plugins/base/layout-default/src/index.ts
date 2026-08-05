import type { Context } from 'cordis'
import type {} from '@qualy/plugin-ui-registry'
import { surfaces } from './ui.ts'

export const name = 'layout-default'
export const inject = ['ui']

// default implementations of the two layout contracts; business plugins only
// ever reference the contract ids, so a replacement layout plugin can take
// over either role without touching them
export function apply(ctx: Context) {
  ctx.ui.applySurfaces(surfaces)
}
