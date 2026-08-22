import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { Api, type ApiDocumentation } from '@qualy/api-kit/plugin'
import { NodeServer } from '@qualy/api-kit/node'
import { AssemblyInfo, assembledBarrier, assembledLayer } from '@qualy/api-kit/assembled'
import { readinessLayer } from '@qualy/api-kit/readiness'
import { Plugin } from '@qualy/plugin-kit'
import { lockFromResolution, type Resolution } from '@qualy/assembly'
import { loadAssembly } from './assembly.ts'
import { ServerConfig, apiReferenceEnabled } from './config.ts'
import { accessLog } from './access-log.ts'
import type { LoggingSettings } from './logging.ts'
import { healthApi, healthHandlers } from './health.ts'

// The composition root.
//
// Everything the process owns hangs off one layer, so shutting down is
// closing one scope rather than a cascade of disposers whose order was a
// property of the manifest. The port is bound by a layer built after the
// barrier, so an instance never serves a partially assembled application: the
// bind itself happens a moment earlier, inside the platform layer, and answers
// 503 until the routes exist (see nodeServerLayer).
//
// The plugins arrive as descriptors, imported by the assembler from the
// verified resolution - there is no generated composition module any more,
// and this file still names no plugin.

/**
 * The host itself, as a descriptor.
 *
 * It owns the two extension points every api-bearing plugin contributes to:
 * the group aggregate - with the documentation exposure the host decides -
 * and the raw routes beside it.
 */
const hostPlugin = Plugin.define(
  '@qualy/app',
  Api.provider({
    documentation: Effect.map(apiReferenceEnabled, (documented): ApiDocumentation =>
      documented
        ? { spec: `${QUALY_API_PREFIX}/openapi.json`, reference: `${QUALY_API_PREFIX}/docs` }
        : {},
    ),
  }),
  Api.routesProvider,
)

/**
 * The Node server, created here rather than inside the platform layer.
 *
 * `NodeHttpServer.layer` takes a thunk and the `HttpServer` service it builds
 * exposes an address and a serve function, not the instance. Owning the
 * instance is what lets Vite attach to it in development, which is how its
 * hot-reload websocket ends up on this process's port instead of a second one.
 *
 * It also lets the port answer during the build window. Upstream binds inside
 * `NodeHttpServer.make` but attaches the request handler later, in `serve`,
 * after the whole route layer - in development, the entire Vite dev server -
 * has been built. A request landing in between reached a server with no
 * 'request' listener at all: accepted, parsed, never answered, and the browser
 * tab simply hung. Worse, the connection never went idle, so a route layer
 * that then failed to build left the un-timeboxed close finalizer waiting on
 * it. This listener is registered before the bind and answers 503 until the
 * real handler exists; it retires itself the moment that handler appears,
 * which is safe because Node runs 'request' listeners in registration order.
 */
const nodeServerLayer = Layer.sync(NodeServer, () => {
  const server = createServer()
  const starting = (_request: IncomingMessage, response: ServerResponse) => {
    if (server.listenerCount('request') > 1) {
      server.off('request', starting)
      return
    }
    response.writeHead(503, {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '1',
      // the assembly is still building; a kept-alive connection would
      // outlive this state and delay the close finalizer
      connection: 'close',
    })
    response.end('qualy is starting\n')
  }
  server.on('request', starting)
  // A stopping process must not let its clients decide when the drain ends.
  // A browser tab alone holds idle keep-alive sockets, and a live event
  // stream is never idle at all - either pins `server.close` for the whole
  // upstream drain cap, which read as a hung Ctrl+C. From the first stop
  // signal idle sockets are swept as they free up, and after a short grace
  // whatever is still open is cut: in-flight responses get the grace, and
  // cut streams are the client runtime's reconnect case, not an error.
  const hurry = () => {
    server.closeIdleConnections()
    const sweep = setInterval(() => server.closeIdleConnections(), 250)
    sweep.unref()
    setTimeout(() => {
      clearInterval(sweep)
      server.closeAllConnections()
    }, 2_000).unref()
  }
  process.once('SIGINT', hurry)
  process.once('SIGTERM', hurry)
  return server
})

/**
 * The whole application, from a verified resolution.
 *
 * The plugins were imported by resolution; the one type narrowing of the
 * composition root is the return: the assembled layers carry erased channels,
 * and whether the assembly closes is the boot's answer - dev boots on every
 * run, and CI boots against a real database.
 */
export async function makeApplication(
  resolution: Resolution,
  logging: LoggingSettings,
): Promise<Layer.Layer<never>> {
  const { prepared, services, above, configs } = loadAssembly(resolution, {
    host: [hostPlugin],
  })

  const routes = Layer.mergeAll(
    // what the plugins put on the router: the api aggregate with its
    // handlers, and every raw route
    above,
    // Health is the host's, and plugin-free: readiness reads whatever
    // registered a probe, so an assembly with nothing to probe serves it too.
    // It sits outside the prefix and outside the document, which is the shape
    // orchestrators already depend on.
    HttpApiBuilder.layer(healthApi).pipe(Layer.provide(healthHandlers)),
  )

  // The barrier between the plugins and the port: boot hooks - rbac mirroring
  // the catalog its contributors declared - run once every layer is built,
  // and the server layer is built after them, so the port never accepts a
  // request against a half-assembled application.
  const booted = assembledBarrier.pipe(Layer.provide(services), Layer.provide(prepared))

  const server = Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* ServerConfig
      const instance = yield* NodeServer
      // the services are provided inside the serve composition: the router
      // discharges request-time requirements only for layers inside its
      // argument, and requests find their services in the built context
      return HttpRouter.serve(routes.pipe(Layer.provide(services), Layer.provide(prepared)), {
        // the upstream logger prints every response at Info and every failed
        // exit's cause - interrupted requests included; ours speaks in levels
        disableLogger: true,
        middleware: accessLog(logging.access),
      }).pipe(Layer.provide(NodeHttpServer.layer(() => instance, { port: config.port })))
    }),
  ).pipe(Layer.provideMerge(nodeServerLayer), Layer.provide(ServerConfig.layer))

  return server.pipe(
    Layer.provide(booted),
    Layer.provide(services),
    Layer.provide(prepared),
    // the registry a plugin puts its own probe into, and the health handler
    // reads: it belongs to the server base, not to whoever happens to own a
    // resource in this assembly
    Layer.provideMerge(readinessLayer),
    // the boot hooks those plugins registered, run by `booted` above
    Layer.provideMerge(assembledLayer),
    // the logger is the root's, installed in main.ts before anything speaks
    // each plugin's own block of the manifest, turned into a service by the
    // plugin that reads it rather than by this file
    Layer.provide(configs),
    // which assembly this is, for artifacts built outside the process to be
    // checked against - the same hash the lock records
    Layer.provide(
      Layer.succeed(
        AssemblyInfo,
        AssemblyInfo.of({ resolutionHash: lockFromResolution(resolution).resolutionHash }),
      ),
    ),
  ) as unknown as Layer.Layer<never>
}
