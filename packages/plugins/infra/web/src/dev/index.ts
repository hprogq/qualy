import fs from 'node:fs'
import path from 'node:path'
import { Data, Effect, Queue, Schema } from 'effect'
import type { Logger as ViteLogger } from 'vite'
import type { DevServiceContext } from '@qualy/plugin-kit/dev'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { WebManifestConfig, rootsFrom } from '../config.ts'

// The browser's development server, in its own process
// (docs/runtime-redesign.md §29, §31).
//
// It used to be mounted inside the backend, sharing its http server so the
// hot-reload websocket could sit on one port. The price was that the two had
// one lifetime: every backend restart closed Vite, and with it the websocket,
// the module graph, the React component state and everything the person
// working on the page had on screen. Out here the browser keeps all of that
// while the api behind it is replaced.
//
// So the entry point moves. The browser talks to Vite, and Vite passes the
// api and the health probes through to the backend; everything else it serves
// itself. It is the only thing in front of the developer now, which is why it
// refuses to drift to another port rather than quietly picking one - a proxy
// pointed at nothing looks exactly like a backend that is down.

/** the two ways this service can turn out not to be runnable */
class WebUnservable extends Data.TaggedError('WebUnservable')<{ readonly message: string }> {}

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

export interface PreparedWeb {
  readonly sourceRoot: string
  readonly vite: typeof import('vite')
}

/**
 * Everything that can be decided while the old server is still running.
 *
 * Config parsed, the source root checked, the package that does the work
 * loaded. What it must not do is touch anything the running server owns -
 * and for Vite that is not only the port: running its config writes the
 * generated browser aggregate into `apps/web/.qualy/`, which the running
 * server is reading. So the config file is checked for existence and not
 * executed; `acquire` is what runs it.
 */
export const prepare = Effect.fn('Web.prepare')(function* (context: DevServiceContext) {
  const declared = yield* Schema.decodeUnknownEffect(WebManifestConfig)(context.plugin.config, {
    onExcessProperty: 'error',
  }).pipe(
    Effect.mapError(
      (error) => new WebUnservable({ message: `web configuration is invalid: ${error.message}` }),
    ),
  )
  const { sourceRoot } = rootsFrom(declared, context.plugin.manifestDir)
  for (const required of ['index.html', 'vite.config.ts']) {
    if (!fs.existsSync(path.join(sourceRoot, required))) {
      return yield* new WebUnservable({
        message: `web source at ${sourceRoot} has no ${required}; set sourceRoot or disable @qualy/plugin-web`,
      })
    }
  }
  const vite = yield* Effect.tryPromise({
    try: () => import('vite'),
    catch: () =>
      new WebUnservable({ message: 'vite is not installed; the web dev service requires it' }),
  })
  return { sourceRoot, vite } satisfies PreparedWeb
})

/** the paths the backend owns; everything else is the browser application */
const proxied = [QUALY_API_PREFIX, '/health']

/**
 * The running server, held for as long as this process is.
 *
 * The scope this is called in stays open until the process is asked to stop,
 * so the release below is the service's shutdown rather than the end of this
 * call.
 */
export const acquire = Effect.fn('Web.acquire')(function* (
  prepared: PreparedWeb,
  context: DevServiceContext,
) {
  const customLogger = yield* viteLogger
  const server = yield* Effect.acquireRelease(
    Effect.promise(() =>
      prepared.vite.createServer({
        configFile: path.join(prepared.sourceRoot, 'vite.config.ts'),
        root: prepared.sourceRoot,
        appType: 'spa',
        clearScreen: false,
        customLogger,
        server: {
          // No drifting. This is the address the developer has open, and a
          // second server answering on the next port up is a page that never
          // reloads for reasons nothing explains.
          strictPort: true,
          proxy: Object.fromEntries(
            proxied.map((prefix) => [
              prefix,
              {
                target: context.runtime.origin,
                // The browser's own Host is kept. Rewriting it is the common
                // example and it is wrong here: the backend decides cookie
                // scope, redirect targets and callback urls from the host it
                // was asked for, and a development session behind a public
                // hostname would get answers addressed to 127.0.0.1.
                changeOrigin: false,
                // long-lived responses are the point of half these routes
                timeout: 0,
                proxyTimeout: 0,
              },
            ]),
          ),
        },
      }),
    ),
    // Capped: with the dependency optimizer mid-flight, vite's close has been
    // observed to sit for the whole shutdown window. Whatever has not
    // finished in three seconds dies with the process anyway, and the warning
    // says it was vite that waited.
    (server) =>
      Effect.timeoutOrElse(
        Effect.promise(() => server.close()),
        {
          duration: '3 seconds',
          orElse: () => Effect.logWarning('vite close exceeded 3s; leaving it to process exit'),
        },
      ),
  )
  yield* Effect.promise(() => server.listen())
  const url = server.resolvedUrls?.local[0] ?? '(unknown)'
  yield* Effect.logInfo(
    `web development server on ${url}, api proxied to ${context.runtime.origin}`,
  )
})
