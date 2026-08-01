import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'

// anchor at the host package instead of cwd, so the entry works no matter
// where the process is launched from
const appRoot = fileURLToPath(new URL('../', import.meta.url))
// deployments point QUALY_CONFIG at an external manifest (e.g. a mounted
// /etc/qualy/qualy.yml); it can only toggle plugins the image ships with
const configPath = path.resolve(process.env.QUALY_CONFIG ?? path.join(appRoot, 'qualy.yml'))

const ctx = new Context()
ctx.baseUrl = pathToFileURL(appRoot).href

await ctx.plugin(Loader)
// the assembly manifest lives with the host: include re-anchors ctx.baseUrl
// to the manifest's directory, so plugin packages resolve from the host's
// own dependencies rather than the repo root
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: { path: configPath },
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
