import { implement } from '@orpc/server'
import type { Context } from 'cordis'
import { z } from 'zod'
import type { ApiContext } from '@qualy/plugin-server'
import { pingContract } from './contract.ts'
import { pingLogs } from './db/schema.ts'

export const name = 'ping'
export const inject = ['db', 'server']

export const Config = z
  .object({
    greeting: z.string().default('hi'),
  })
  .prefault({})

export function apply(ctx: Context, config: z.infer<typeof Config>) {
  ctx.logger.info('ping plugin loaded: %s', config.greeting)
  ctx.effect(() => {
    const timer = setInterval(() => ctx.logger.info('heartbeat'), 30_000)
    return () => clearInterval(timer)
  }, 'heartbeat-timer')

  const impl = implement(pingContract).$context<ApiContext>()
  ctx.server.contribute(
    'ping',
    impl.router({
      // services are reached through the plugin's own ctx (inject-checked);
      // ApiContext.cordis carries request plumbing, not service access
      hello: impl.hello.handler(async ({ input }) => {
        const visitor = input.name ?? 'world'
        await ctx.db.drizzle.insert(pingLogs).values({ name: visitor })
        return { msg: `${config.greeting}, ${visitor}` }
      }),
    }),
  )
}
