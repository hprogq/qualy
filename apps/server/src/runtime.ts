import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { NodeServer } from '@qualy/api-kit/node'
import { qualyApi } from '@qualy/api'
import { apiHandlers } from '../api-handlers.gen.ts'
import { pluginLayers } from '../runtime.gen.ts'
import {
  ServerConfig,
  apiReferenceEnabled,
  authConfigLayer,
  databaseConfigLayer,
  loginDriversLayer,
  permissionCatalogLayer,
  uiCatalogLayer,
  webConfigLayer,
} from './config.ts'
import { healthApi, healthHandlers } from './health.ts'
import { pluginRoutes } from '../routes.gen.ts'

// The composition root.
//
// Everything the process owns hangs off one layer, so shutting down is closing
// one scope rather than a cascade of disposers whose order was a property of
// the manifest. The port is bound by a layer built after the ones it depends
// on, so an instance either serves a working assembly or never listens at all:
// there is no partially assembled state to observe.

// Two APIs, not one, because they are mounted differently and documented
// differently. The business API lives under the prefix and is what the
// generated document describes. Health probes answer orchestrators rather than
// API clients, so they sit at the root and stay out of that document, which is
// the shape the cordis server already serves and what clients depend on.
const docs = `${QUALY_API_PREFIX}/docs` as const
const spec = `${QUALY_API_PREFIX}/openapi.json` as const

const routes = Layer.unwrap(
  Effect.gen(function* () {
    const documented = yield* apiReferenceEnabled
    return Layer.mergeAll(
      // the document is served only when the reference is: an instance that
      // hides its docs but publishes the spec they render has not hidden
      // anything
      HttpApiBuilder.layer(qualyApi, documented ? { openapiPath: spec } : {}).pipe(
        Layer.provide(apiHandlers),
      ),
      documented ? HttpApiScalar.layer(qualyApi, { path: docs }) : Layer.empty,
  // Health is declared by the host rather than by a plugin, but it is not
  // plugin-free: readiness asks the database, so this assembly does not build
  // without one. That is a real constraint rather than an oversight, and it is
  // stated here because the alternative reading, that an assembly with no
  // plugins can serve, is not true of this composition. Making the probes a
  // contribution is deferred until a second one exists to contribute.
      HttpApiBuilder.layer(healthApi).pipe(Layer.provide(healthHandlers)),
      // Routes that are not api endpoints, and cannot be: the browser shell is
      // a raw handler on the router's wildcard. Every declared path still wins,
      // because the router matches by specificity rather than by order.
      pluginRoutes,
    )
  }),
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

const server = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig
    const instance = yield* NodeServer
    return HttpRouter.serve(routes).pipe(
      Layer.provide(NodeHttpServer.layer(() => instance, { port: config.port })),
    )
  }),
).pipe(Layer.provideMerge(nodeServerLayer), Layer.provide(ServerConfig.layer))

/**
 * The whole application.
 *
 * `pluginLayers` is generated from the lock, so what an assembly contains is
 * decided by resolution and checked by the compiler: a plugin whose package is
 * missing fails the build rather than the boot.
 */
export const application = server.pipe(
  Layer.provide(pluginLayers),
  Layer.provide(
    Layer.mergeAll(
      databaseConfigLayer,
      permissionCatalogLayer,
      loginDriversLayer,
      authConfigLayer,
      uiCatalogLayer,
      webConfigLayer,
    ),
  ),
)
