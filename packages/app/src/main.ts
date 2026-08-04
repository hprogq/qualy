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
// The loader offers no settled promise, so completion is observed from fiber
// state instead: cordis reports every transition, and assembly is done when
// nothing is pending or loading and stays that way. A manifest that never
// settles leaves readiness closed, which is the truthful answer for an
// instance that never finished starting; liveness still responds, so an
// orchestrator can tell the difference.
const FIBER_PENDING = 0
const FIBER_LOADING = 1
const SETTLE_QUIET_MS = 50
const SETTLE_TIMEOUT_MS = 60_000

const loading = new Set<unknown>()
ctx.on('internal/status', (fiber) => {
  if (fiber.state === FIBER_PENDING || fiber.state === FIBER_LOADING) loading.add(fiber)
  else loading.delete(fiber)
})

void (async () => {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  let quiet = 0
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_QUIET_MS))
    // two consecutive quiet observations, so a fiber that is between states
    // when the first one lands does not read as settled
    quiet = loading.size === 0 ? quiet + 1 : 0
    if (quiet < 2) continue
    ctx.inject(['server'], (host) => {
      host.server.markAssemblyComplete()
    })
    return
  }
  ctx.logger.error(
    'assembly did not settle within %ds; readiness stays closed',
    SETTLE_TIMEOUT_MS / 1000,
  )
})()

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
