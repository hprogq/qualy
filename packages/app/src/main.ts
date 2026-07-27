import { pathToFileURL } from 'node:url'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: { path: './cordis.yml' },
})

let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // a second signal forces an immediate exit in case a disposal hangs
    if (closing) process.exit(1)
    closing = true
    ctx.logger.info('received %s, shutting down gracefully', signal)
    const deadline = setTimeout(() => {
      ctx.logger.warn('graceful shutdown timed out, forcing exit')
      process.exit(1)
    }, 5_000)
    // disposing the root fiber cascades through every plugin's effects
    ctx.fiber.dispose().then(
      () => {
        clearTimeout(deadline)
        process.exit(0)
      },
      (error) => {
        ctx.logger.error(error)
        process.exit(1)
      },
    )
  })
}
