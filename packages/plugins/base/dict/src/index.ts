import type { Context } from 'cordis'

export const name = 'dict'
// infra gating per p1-tutorial §0.3; domain wiring arrives in later sessions
export const inject = ['db', 'server', 'ui']

// No Effect runtime, deliberately.
//
// Everything this plugin contributes today is a descriptor the assembly reads
// without running it: one database schemaEntry, declared in package.json.
// Giving it a layer would mean translating a cordis Service into a
// Context.Service because there used to be one, not because anything needs to
// be constructed. It gains an entry when it owns a resource or serves a route.
export function apply(ctx: Context) {
  ctx.logger.info('dict plugin scaffold loaded')
}
