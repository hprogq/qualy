import type { Context } from 'cordis'

export const name = 'auth'
// infra gating per p1-tutorial §0.3; domain wiring arrives in later sessions
export const inject = ['db', 'server', 'ui']

export function apply(ctx: Context) {
  ctx.logger.info('auth plugin scaffold loaded')
}
