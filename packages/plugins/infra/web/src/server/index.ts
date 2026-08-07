import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Config, Context, Data, Effect, Layer, Queue, Schema } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import sirv from 'sirv'
import type { Logger as ViteLogger } from 'vite'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { AssemblyInfo } from '@qualy/api-kit/assembled'
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
 * What this plugin accepts in `qualy.yml`.
 *
 * The two roots are paths, and a path in a manifest is relative to the
 * manifest - which is the whole reason the assembly hands `manifestDir` over.
 * Resolving them here rather than in the host is what keeps the host from
 * knowing this plugin serves files at all.
 */
export const WebManifestConfig = Schema.Struct({
  sourceRoot: Schema.optional(Schema.String),
  assetRoot: Schema.optional(Schema.String),
})
export type WebManifestConfig = typeof WebManifestConfig.Type

/**
 * How the browser application is served.
 *
 * `auto` follows NODE_ENV, the same rule the cordis config expressed. Which
 * mode this is decides whether the process owns a Vite server or a static file
 * handler, so it is a deployment fact and stays in the environment; where the
 * files are is an assembly fact and comes from the manifest.
 */
export const config = (
  // the block as the manifest parses it: unknown until the schema says
  manifest: unknown,
  context: { readonly manifestDir: string },
): Layer.Layer<WebConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    WebConfig,
    Effect.gen(function* () {
      const declared = yield* Schema.decodeUnknownEffect(WebManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
      const mode = yield* Config.literals(
        ['auto', 'development', 'production'],
        'QUALY_WEB_MODE',
      ).pipe(Config.withDefault('auto' as const))
      const environment = yield* Config.string('NODE_ENV').pipe(Config.withDefault('development'))
      const anchored = (declared: string | undefined) =>
        declared === undefined ? undefined : path.resolve(context.manifestDir, declared)
      return WebConfig.of({
        mode:
          mode === 'auto' ? (environment === 'production' ? 'production' : 'development') : mode,
        ...(anchored(declared.sourceRoot) === undefined
          ? {}
          : { sourceRoot: anchored(declared.sourceRoot) }),
        ...(anchored(declared.assetRoot) === undefined
          ? {}
          : { assetRoot: anchored(declared.assetRoot) }),
      })
    }),
  )

/**
 * The two ways enabling this plugin can turn out to be a lie.
 *
 * Tagged rather than bare Errors: both are died on immediately, but an untagged
 * Error in the failure channel merges with every other one, and the project
 * gate says so out loud rather than leaving it to review.
 */
class WebUnservable extends Data.TaggedError('WebUnservable')<{ readonly message: string }> {}

/** the api owns everything under its mount, matched or not */
const insideApi = (url: string) =>
  url === QUALY_API_PREFIX ||
  url.startsWith(`${QUALY_API_PREFIX}/`) ||
  url.startsWith(`${QUALY_API_PREFIX}?`)

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
  // The bundle names the assembly it was built from; this process knows the
  // assembly it runs. Serving assets built from a different one means the
  // browser registry, the typed client and the served api may each be a
  // different selection - a mismatch neither half can notice alone, so it is
  // refused before the port binds.
  const fingerprintFile = path.join(assetRoot, '.qualy-assembly.json')
  if (!fs.existsSync(fingerprintFile)) {
    return yield* Effect.die(
      new WebUnservable({
        message: `${assetRoot} carries no .qualy-assembly.json, so nothing says which assembly built it; run 'pnpm build' to stage assets with their fingerprint`,
      }),
    )
  }
  const staged = JSON.parse(fs.readFileSync(fingerprintFile, 'utf8')) as {
    resolutionHash?: string
  }
  const info = yield* AssemblyInfo
  if (staged.resolutionHash !== info.resolutionHash) {
    return yield* Effect.die(
      new WebUnservable({
        message: `web assets were built from assembly ${staged.resolutionHash}, but this process runs ${info.resolutionHash}; run 'pnpm build' so the bundle matches the assembly`,
      }),
    )
  }
  yield* Effect.logInfo(`serving web assets from ${assetRoot}`)
  return assets(assetRoot)
})

/**
 * Vite's log lines, in the application's own logger.
 *
 * Vite calls its logger synchronously from its own work, so the adapter cannot
 * `yield*` and there is no caller fiber for it to belong to. It offers onto a
 * queue instead and a forked fiber logs what it finds, which keeps the
 * timestamp, the level, the fiber id and the colours identical to everything
 * else the process says - with no `Effect.run*` inside a layer.
 *
 * The message is passed through as vite wrote it, colours and `[vite]` prefix
 * included. Vite's own timestamp is never asked for, because ours is already
 * in front of it.
 */
export const viteLogger = Effect.gen(function* () {
  const lines = yield* Queue.make<Effect.Effect<void>>()
  yield* Effect.forkScoped(Effect.forever(Effect.flatten(Queue.take(lines))))
  const emit = (line: Effect.Effect<void>) => {
    Queue.offerUnsafe(lines, line.pipe(Effect.annotateLogs({ source: 'web:vite' })))
  }
  // vite reads this back to decide whether a run "had warnings", so it is
  // state the adapter owns rather than something it can forward
  const state = { warned: false }
  const seen = new Set<string>()
  // Vite's own logger remembers which Error values it has printed and asks
  // through hasErrorLogged before printing again; an adapter that always
  // answered false invited the same error twice
  const loggedErrors = new WeakSet<Error>()
  return {
    info: (message: string) => emit(Effect.logInfo(message)),
    warn: (message: string) => {
      state.warned = true
      emit(Effect.logWarning(message))
    },
    warnOnce: (message: string) => {
      if (seen.has(message)) return
      seen.add(message)
      state.warned = true
      emit(Effect.logWarning(message))
    },
    error: (message: string, options?: { error?: Error | null }) => {
      // upstream's logger counts an error as "warned" too
      state.warned = true
      if (options?.error) loggedErrors.add(options.error)
      emit(Effect.logError(message))
    },
    // the screen is shared with the application's own output, so clearing it
    // would take that away; vite is started with clearScreen off for the same
    // reason
    clearScreen: () => {},
    hasErrorLogged: (error: Error) => loggedErrors.has(error),
    get hasWarned() {
      return state.warned
    },
  } satisfies ViteLogger
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

  const customLogger = yield* viteLogger

  const devServer = yield* Effect.acquireRelease(
    Effect.promise(() =>
      vite.createServer({
        configFile: path.join(sourceRoot, 'vite.config.ts'),
        root: sourceRoot,
        appType: 'spa',
        clearScreen: false,
        server: { middlewareMode: { server: httpServer } },
        customLogger,
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
export const routes: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | WebConfig | NodeServer | AssemblyInfo
> =
  HttpRouter.use(
    Effect.fnUntraced(function* (router) {
      const config = yield* WebConfig
      const middleware =
        config.mode === 'production'
          ? yield* production(config.assetRoot ?? defaultAssetRoot)
          : yield* development(config.sourceRoot ?? defaultSourceRoot)
      yield* router.add(
        '*',
        '/*',
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          // An unmatched path inside the api prefix is a 404, never the browser
          // shell. Serving html there answers 200 to a mistyped endpoint, which
          // is how a doubled prefix looked like a working request until the
          // page tried to parse the shell as json.
          if (insideApi(request.url)) return HttpServerResponse.empty({ status: 404 })
          return yield* fromConnect(middleware)
        }),
      )
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
