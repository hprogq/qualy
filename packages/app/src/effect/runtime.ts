import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { qualyApi } from '@qualy/api'
import { apiHandlers } from '../../api-handlers.gen.ts'
import { pluginLayers } from '../../runtime.gen.ts'
import { ServerConfig, databaseConfigLayer } from './config.ts'
import { healthApi, healthHandlers } from './health.ts'

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

const routes = Layer.mergeAll(
  HttpApiBuilder.layer(qualyApi, { openapiPath: spec }).pipe(Layer.provide(apiHandlers)),
  HttpApiScalar.layer(qualyApi, { path: docs }),
  // health is declared by the host rather than a plugin because it must answer
  // for an assembly that contains no plugins at all
  HttpApiBuilder.layer(healthApi).pipe(Layer.provide(healthHandlers)),
)

const server = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig
    return HttpRouter.serve(routes).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port: config.port })),
    )
  }),
).pipe(Layer.provide(ServerConfig.layer))

/**
 * The whole application.
 *
 * `pluginLayers` is generated from the lock, so what an assembly contains is
 * decided by resolution and checked by the compiler: a plugin whose package is
 * missing fails the build rather than the boot.
 */
export const application = server.pipe(
  Layer.provide(pluginLayers),
  Layer.provide(databaseConfigLayer),
)
