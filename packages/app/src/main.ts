import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import { verifyAssembly } from './verify-assembly.ts'

// anchor at the host package instead of cwd, so the entry works no matter
// where the process is launched from
const appRoot = fileURLToPath(new URL('../', import.meta.url))
// deployments point QUALY_CONFIG at an external manifest (e.g. a mounted
// /etc/qualy/qualy.yml); it can only toggle plugins the image ships with
const configPath = path.resolve(process.env.QUALY_CONFIG ?? path.join(appRoot, 'qualy.yml'))

const ctx = new Context()
ctx.baseUrl = pathToFileURL(appRoot).href

// the manifest is a product selection; what the loader consumes is the entry
// list resolved from it, which lives beside it
// console, not ctx.logger: this runs before the loader, so no logging
// transport has been configured yet
const runtimePlanPath = verifyAssembly(configPath, (message) => console.warn(message))

await ctx.plugin(Loader)
// the assembly lives with the host: include re-anchors ctx.baseUrl to the
// plan's directory, so plugin packages resolve from the host's own
// dependencies rather than the repo root
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: { path: runtimePlanPath },
})

// Readiness may only pass once the manifest has actually been applied.
//
// The server binds its port early in assembly, so the window between
// "listening" and "every plugin loaded" would otherwise answer ready with an
// empty probe set, and a load balancer would send traffic to an instance
// whose database had not started. Marking completion from inject(['server'])
// did not close that window: it fires the moment the server service appears,
// which is during assembly, not after it. Measured on this manifest, the
// first answer was ready with no checks at all while four more plugins were
// still loading.
//
// The loader answers the question directly: it tracks every entry's init task
// and fiber inertia, and `await()` returns once none are outstanding, having
// rechecked after each batch so entries created by earlier ones are caught
// too. Measured here, it resolves 300ms after the server service appears.
//
// It has to be awaited after the include entry exists; with an empty tree
// there is nothing outstanding and it returns at once. A manifest that never
// settles never resolves it, which leaves readiness closed, the truthful
// answer for an instance that never finished starting. Liveness still
// responds, so an orchestrator can tell the difference.
const SETTLE_WARN_MS = 60_000
const slow = setTimeout(() => {
  ctx.logger.error(
    'assembly has not settled after %ds; readiness stays closed',
    SETTLE_WARN_MS / 1000,
  )
}, SETTLE_WARN_MS).unref()

void ctx.loader.await().then(() => {
  clearTimeout(slow)
  ctx.inject(['server'], (host) => {
    host.server.markAssemblyComplete()
  })
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
