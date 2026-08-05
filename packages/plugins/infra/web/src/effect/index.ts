import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Data, Effect, Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import sirv from 'sirv'
import { NodeServer, fromConnect, type ConnectMiddleware } from '@qualy/api-kit/node'

// The browser application, served by the same process that serves the api.
//
// This is a resource rather than a descriptor, which is why it has a layer at
// all: in development it owns a Vite server with a lifetime, and that server
// has to be handed the process's own `http.Server` so its hot-reload websocket
// shares the port instead of opening a second one.
//
// Enabling this plugin means the ui must actually be served. Missing assets or
// a missing Vite are startup failures, and a headless deployment disables the
// plugin rather than getting a silently degraded one.

// paths anchor at this package, never at the working directory
const defaultAssetRoot = fileURLToPath(new URL('../../client-dist/', import.meta.url))
const defaultSourceRoot = fileURLToPath(new URL('../../../../../../apps/web/', import.meta.url))

export class WebConfig extends Context.Service<
  WebConfig,
  {
    readonly mode: 'development' | 'production'
    readonly sourceRoot?: string
    readonly assetRoot?: string
  }
>()('@qualy/plugin-web/WebConfig') {}

/**
 * The two ways enabling this plugin can turn out to be a lie.
 *
 * Tagged rather than bare Errors: both are died on immediately, but an untagged
 * Error in the failure channel merges with every other one, and the project
 * gate says so out loud rather than leaving it to review.
 */
class WebUnservable extends Data.TaggedError('WebUnservable')<{ readonly message: string }> {}

/** the staged build, with the caching rules a hashed-asset bundle needs */
const assets = (assetRoot: string): ConnectMiddleware =>
  sirv(assetRoot, {
    etag: true,
    // spa fallback: extension-less GET/HEAD navigations get index.html,
    // missing assets with extensions stay 404
    single: true,
    maxAge: 31_536_000,
    immutable: true,
    setHeaders: (response, pathname) => {
      // pathname is the request path, so spa navigations ('/', '/ping') have no
      // extension: those serve the html shell, which must not be cached
      if (pathname.endsWith('.html') || !path.posix.extname(pathname)) {
        response.setHeader('Cache-Control', 'no-cache')
      }
    },
  })

const production = Effect.fn('Web.production')(function* (assetRoot: string) {
  if (!fs.existsSync(path.join(assetRoot, 'index.html'))) {
    return yield* Effect.die(
      new WebUnservable({
        message: `web assets missing at ${assetRoot}; run 'pnpm build' first, or disable @qualy/plugin-web for a headless deployment`,
      }),
    )
  }
  yield* Effect.logInfo(`serving web assets from ${assetRoot}`)
  return assets(assetRoot)
})

const development = Effect.fn('Web.development')(function* (sourceRoot: string) {
  if (!fs.existsSync(path.join(sourceRoot, 'index.html'))) {
    return yield* Effect.die(
      new WebUnservable({
        message: `web source missing at ${sourceRoot}; set sourceRoot or disable @qualy/plugin-web`,
      }),
    )
  }
  // a defect rather than a failure: enabling this plugin is a claim that the ui
  // will be served, so a missing Vite is a broken assembly, not something a
  // caller could handle
  const vite = yield* Effect.tryPromise({
    try: () => import('vite'),
    catch: () =>
      new WebUnservable({
        message: 'vite is not installed; development mode of @qualy/plugin-web requires it',
      }),
  }).pipe(Effect.catch((error) => Effect.die(error)))

  // the server the process is already listening on: attaching to it is what
  // puts the hot-reload websocket on the application's own port
  const httpServer = yield* NodeServer

  const devServer = yield* Effect.acquireRelease(
    Effect.promise(() =>
      vite.createServer({
        configFile: path.join(sourceRoot, 'vite.config.ts'),
        root: sourceRoot,
        appType: 'spa',
        clearScreen: false,
        server: { middlewareMode: { server: httpServer } },
        // Vite keeps its own logger here, where the cordis plugin routed it
        // through the runtime's. Adapting it would need an Effect.run* inside a
        // layer, which the source policy reserves for the process edges, and a
        // uniform dev log is not worth a queue-and-fiber to launder one.
      }),
    ),
    (server) => Effect.promise(() => server.close()),
  )
  yield* Effect.logInfo(`vite middleware mounted from ${sourceRoot}`)
  return devServer.middlewares as ConnectMiddleware
})

/**
 * The fallback route.
 *
 * Registered at the router's wildcard rather than as an api endpoint: the
 * router matches by specificity, so every declared path still wins, and a
 * catch-all endpoint would have put the browser shell in the openapi document.
 *
 * The middleware is built here, once, rather than inside the handler. A route
 * whose handler is an effect runs that effect per request, which would have
 * started a Vite server for every navigation.
 */
export const routes: Layer.Layer<never, never, HttpRouter.HttpRouter | WebConfig | NodeServer> =
  HttpRouter.use(
    Effect.fnUntraced(function* (router) {
      const config = yield* WebConfig
      const middleware =
        config.mode === 'production'
          ? yield* production(config.assetRoot ?? defaultAssetRoot)
          : yield* development(config.sourceRoot ?? defaultSourceRoot)
      yield* router.add('*', '/*', fromConnect(middleware))
    }),
  )

/**
 * No services, deliberately.
 *
 * The dev server this plugin owns is held by the route layer's own scope, so
 * there is nothing for a peer to ask for. The entry exists because the
 * assembly imports the routes from it.
 */
export const layer: Layer.Layer<never> = Layer.empty
