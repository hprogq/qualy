import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer, Logger } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { NodeServer } from '@qualy/api-kit/node'
import { assembledBarrier, assembledLayer } from '@qualy/api-kit/assembled'
import { readinessLayer } from '@qualy/api-kit/readiness'
import { qualyApi } from '@qualy/api'
import { apiHandlers, capabilityLayers, pluginConfig, pluginLayers } from '../runtime.gen.ts'
import { ServerConfig, apiReferenceEnabled } from './config.ts'
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
      // Every entry exports its group implementations as `apiHandlers`, and
      // the generated runtime module composes them; a group nobody implements
      // is a missing service in this composition rather than a file a
      // generator forgot to pair. Composed here, above every plugin's
      // services, because a group's middleware is implemented by OTHER
      // plugins - the viewer arrives through auth's - and the library
      // resolves middleware where the groups are provided.
      HttpApiBuilder.layer(qualyApi, documented ? { openapiPath: spec } : {}).pipe(
        Layer.provide(apiHandlers),
      ),
      documented ? HttpApiScalar.layer(qualyApi, { path: docs }) : Layer.empty,
      // Health is the host's, and now plugin-free: readiness reads whatever
      // registered a probe, so an assembly with nothing to probe serves it
      // too. Which is the only honest reading - ready has never claimed the
      // assembly is complete, only that what is loaded is healthy.
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
 *
 * The barrier between the plugins and the port is what makes boot-time
 * registries readable: a plugin registers work to run "once every layer is
 * built" - rbac mirroring the permission catalog its contributors declared -
 * and the server layer is built after the barrier, so the port never accepts
 * a request against a half-assembled application. `Layer.provide` builds its
 * argument first whether or not anything is consumed, and layers are
 * memoized, so `pluginLayers` here and below is one build.
 */
const booted = assembledBarrier.pipe(Layer.provide(pluginLayers))

export const application = server.pipe(
  Layer.provide(booted),
  Layer.provide(pluginLayers),
  // the registry a plugin puts its own probe into, and the health handler
  // reads: it belongs to the server base, not to whoever happens to own a
  // resource in this assembly
  Layer.provideMerge(readinessLayer),
  // the boot hooks those plugins registered, run by `booted` above
  Layer.provideMerge(assembledLayer),
  // One logger for everything the process says, colours included. The default
  // one prints the same layout without them, and a dev terminal that tells an
  // error from a request at a glance is worth the one line.
  Layer.provide(Logger.layer([Logger.consolePretty({ colors: 'auto' })])),
  // each plugin's own block of the manifest, turned into a service by the
  // plugin that reads it rather than by this file
  Layer.provide(pluginConfig),
  // and what the capabilities derived: a service this host never names, which
  // is what lets an assembly without that capability build at all. Below the
  // config, because a config layer may one day read a derived service, never
  // the other way around.
  Layer.provide(capabilityLayers),
)
