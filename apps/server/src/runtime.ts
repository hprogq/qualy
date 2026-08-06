import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, Logger } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { Api, type ApiDocumentation } from '@qualy/api-kit/plugin'
import { NodeServer } from '@qualy/api-kit/node'
import { assembledBarrier, assembledLayer } from '@qualy/api-kit/assembled'
import { readinessLayer } from '@qualy/api-kit/readiness'
import { Plugin } from '@qualy/plugin-kit'
import type { Resolution } from '@qualy/assembly'
import { loadAssembly } from './assembly.ts'
import { ServerConfig, apiReferenceEnabled } from './config.ts'
import { healthApi, healthHandlers } from './health.ts'

// The composition root.
//
// Everything the process owns hangs off one layer, so shutting down is
// closing one scope rather than a cascade of disposers whose order was a
// property of the manifest. The port is bound by a layer built after the
// barrier and the routes, so an instance either serves a working assembly or
// never listens at all: there is no partially assembled state to observe.
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
 */
const nodeServerLayer = Layer.sync(NodeServer, () => createServer())

/**
 * The whole application, from a verified resolution.
 *
 * Async because the plugins are imported here. The one type narrowing of the
 * composition root is the return: the assembled layers carry erased channels,
 * and whether the assembly closes is the boot's answer - dev boots on every
 * run, and CI boots against a real database.
 */
export async function makeApplication(resolution: Resolution): Promise<Layer.Layer<never>> {
  const { prepared, services, above, configs } = await loadAssembly(resolution, {
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
      return HttpRouter.serve(routes.pipe(Layer.provide(services), Layer.provide(prepared))).pipe(
        Layer.provide(NodeHttpServer.layer(() => instance, { port: config.port })),
      )
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
    // One logger for everything the process says, colours included. The
    // default one prints the same layout without them, and a dev terminal
    // that tells an error from a request at a glance is worth the one line.
    Layer.provide(Logger.layer([Logger.consolePretty({ colors: 'auto' })])),
    // each plugin's own block of the manifest, turned into a service by the
    // plugin that reads it rather than by this file
    Layer.provide(configs),
  ) as unknown as Layer.Layer<never>
}
