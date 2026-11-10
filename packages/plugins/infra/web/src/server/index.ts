import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Config, Context, Data, Effect, Layer, Option, Schema, Tracer } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import sirv from 'sirv'
import { apiRouteNotFound, insideApi } from '@qualy/api-kit/route-fallback'
import { RequestContext, WebMetricRoute } from '@qualy/api-kit/request'
import { QUALY_RELEASE_ENDPOINT } from '@qualy/release-contract'
import { releaseProbeOf, type InstalledWebRelease } from '@qualy/release-contract/private'
import { Assembled, AssemblyInfo } from '@qualy/api-kit/assembled'
import { ClientAssembly, type ReleaseStanding } from '@qualy/api-kit/client-assembly'
import type { ShellPolicy } from '@qualy/api-kit/shell-policy'
import { fromConnect, LocalRenderApi, type ConnectMiddleware } from '@qualy/api-kit/node'
import {
  SERVER_BUILD_METADATA,
  SHARED_ASSETS,
  readCurrentWebRelease,
  readInstalledRelease,
  storeAt,
  type CurrentWebRelease,
  type ReleaseStore,
} from '@qualy/web-build/release-store'
import { decodePluginConfig } from '@qualy/plugin-kit/config'
import { renderLogging } from '../render-log.ts'
import { RELEASE_STORE_VARIABLE, WebManifestConfig, rootsFrom, serverRoot } from '../config.ts'
import { addReportRoute } from './csp-reports.ts'
import { relayRenderStream } from './render-stream.ts'
import {
  CSP_HEADER,
  policyLayer,
  REPORT_PATH,
  REPORTING_ENDPOINT,
  ShellPolicyHeader,
  type CspMode,
} from './shell-policy.ts'

// The built browser application, served beside the api.
//
// This half serves files and nothing else. The development server used to
// live here too, mounted into this process's own `http.Server` so its
// hot-reload websocket shared the port - which tied the browser's dev server
// to the backend's lifetime, and made every backend restart take the
// browser's session with it. It runs in its own process now
// (docs/development/runtime.md), declared as this plugin's dev service.
//
// So there is no mode any more. A deployment serves the bundle; a development
// backend serves the api and leaves the browser to Vite, which is in front of
// it. Where the files are is still an assembly fact and comes from the
// manifest.
//
// Enabling this plugin still means the ui must actually be served: missing
// assets are a startup failure, and a headless deployment disables the plugin
// rather than getting a silently degraded one.

export class WebConfig extends Context.Service<
  WebConfig,
  {
    readonly sourceRoot: string
    readonly assetRoot: string
    /**
     * Where the server's half of the build was placed beside the store
     * (`serverRoot` in config.ts): this package's own directory, which only
     * a test that stands a server in its place names otherwise.
     */
    readonly serverRoot: string
    /**
     * The deployment's own release store, when it keeps one apart from the
     * image (RELEASE_STORE_VARIABLE); otherwise the asset root is the store.
     */
    readonly releaseStore?: string | undefined
    /**
     * Whether the shell's content security policy is enforced or only
     * reported. `report` until the reports have been quiet long enough
     * (docs/notes/auth-security.md); switching is a deployment setting,
     * never a code change.
     */
    readonly cspMode: CspMode
  }
>()('@qualy/plugin-web/WebConfig') {}

const CspModeSetting = Schema.Literals(['report', 'enforce'])

/** the manifest block, as the two absolute roots the halves ask for */
export const config = (
  // the block as the manifest parses it: unknown until the schema says
  manifest: unknown,
  context: { readonly manifestDir: string },
): Layer.Layer<WebConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    WebConfig,
    Effect.gen(function* () {
      const declared = yield* decodePluginConfig(WebManifestConfig, manifest)
      // an environment setting rather than a manifest key: it changes per
      // deployment and per day, and the manifest hash must not move with it
      const cspMode = yield* Schema.decodeUnknownEffect(CspModeSetting)(
        yield* Config.String('QUALY_CSP_MODE').pipe(Config.withDefault('report')),
      )
      // the same kind of setting: where this deployment keeps its releases
      const releaseStore = (yield* Config.String(RELEASE_STORE_VARIABLE).pipe(
        Config.withDefault(''),
      )).trim()
      return WebConfig.of({
        ...rootsFrom(declared, context.manifestDir),
        serverRoot,
        releaseStore: releaseStore === '' ? undefined : releaseStore,
        cspMode,
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

/** a document whose render threw rather than answering: a defect, the request's 500 */
class DrawFailed extends Data.TaggedError('DrawFailed')<{ readonly cause: unknown }> {}

const PLUGIN_ID = '@qualy/plugin-web'

/** on everything served: a script is a script and an image an image, never sniffed; a link out says no more than the origin */
const commonHeaders = (response: ServerResponse) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

/**
 * The pinned release's files, served: two file servers behind one middleware.
 *
 * The hashed assets come from the store's shared directory, where every
 * retained release's assets live side by side, so a browser on an earlier
 * release keeps finding its chunks; their names promise their bytes, so
 * they are cached for a year, immutable, and a name the store lacks is a
 * 404. The release's own public files - its icons - come from the pinned
 * release's directory and are never cached: those names do not change when
 * their bytes do. Documents are not files any more: the server draws them
 * (`draw` below). The static middleware writes the node response itself, so
 * the serve chain's headers never reach these bytes: whatever they carry is
 * set here, and only here.
 */
const serve = (store: ReleaseStore, current: CurrentWebRelease) => {
  // Looked up on disk per request, not from a table taken at boot. The
  // store changes under a running host: an installer's collection removes
  // an asset no retained release names, and a host that had listed it at
  // boot went on to open it, and died of the stream's unhandled ENOENT on
  // the next request for it. A file that is not there is a 404.
  const assets = sirv(path.join(store.root, SHARED_ASSETS), {
    dev: true,
    etag: true,
    // The twins the build wrote, served when the request accepts them. Off
    // by default, and the default is what shipped: every visitor downloaded
    // the bundle raw, which is roughly five times the bytes for nothing.
    // A request that accepts neither still gets the original.
    brotli: true,
    gzip: true,
    single: false,
    setHeaders: (response) => {
      commonHeaders(response)
      // a hashed name promises its bytes: cached for a year, never revalidated
      response.setHeader('Cache-Control', 'public,max-age=31536000,immutable')
    },
  })
  const files = sirv(current.root, {
    dev: true,
    etag: false,
    brotli: true,
    gzip: true,
    single: false,
    setHeaders: (response) => {
      commonHeaders(response)
      response.setHeader('Cache-Control', 'no-cache')
    },
  })
  const mount = `/${SHARED_ASSETS}`
  const notFound = (response: ServerResponse) => {
    response.statusCode = 404
    response.end()
  }
  const middleware: ConnectMiddleware = (request, response, next) => {
    const url = request.url ?? '/'
    // a range sirv would mishandle is not honoured at all: the whole file,
    // which a client asking for a range must accept (RFC 9110, section 14.2)
    if (!servableRange(request.headers.range)) delete request.headers.range
    if (url === mount || url.startsWith(`${mount}/`) || url.startsWith(`${mount}?`)) {
      // under the mount, rooted at the shared directory; a miss is a miss
      request.url = url.slice(mount.length) || '/'
      assets(request, response, () => notFound(response))
      return
    }
    files(request, response, next)
  }
  /** whether a request names one of the release's own files, or the assets */
  const names = (url: string): boolean => {
    const pathname = url.split(/[?#]/)[0] ?? url
    if (pathname === mount || pathname.startsWith(`${mount}/`)) return true
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return false
    }
    const file = path.join(current.root, path.normalize(decoded))
    if (!file.startsWith(current.root) || file === current.root) return false
    try {
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  }
  return { middleware, names }
}

/**
 * Whether sirv can serve a Range header as it stands.
 *
 * sirv 3.0.2 reads `bytes=x-y` with parseInt and compares only the start to
 * the file's size. For `bytes=100-50` it wrote a 206 head and then threw from
 * `createReadStream`, whose start lay past its end: the response never
 * finished, the client waited, and every such request logged a 500 with a
 * stack. A suffix range (`bytes=-500`) it read as the first 501 bytes, and a
 * list of ranges as whatever parseInt made of it. One explicit, ordered
 * range is what it gets right, so that is the only kind passed on.
 */
const servableRange = (header: string | undefined): boolean => {
  if (header === undefined) return true
  const parts = /^bytes=(\d+)-(\d*)$/.exec(header.trim())
  if (parts === null) return false
  return parts[2] === '' || Number(parts[1]) <= Number(parts[2])
}

/** a store's current release; a store that cannot be read refuses the start */
const currentOf = (store: ReleaseStore) =>
  Effect.try({
    try: () => readCurrentWebRelease(store),
    catch: (error) =>
      new WebUnservable({
        message: `the web release store at ${store.root} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      }),
  }).pipe(Effect.orDie)

/** the deploy command, as an operator of the shipped compose file runs it */
const DEPLOY_JOB =
  "the deploy job for this image ('docker compose run --rm migrate', which runs 'qualy deploy')"

const production = Effect.fn('Web.production')(function* (roots: {
  readonly assetRoot: string
  readonly serverRoot: string
  readonly releaseStore?: string | undefined
}) {
  // The store's pointer is read once, here, and the release it names is
  // pinned for the life of this process: an installer moving the pointer
  // later changes nothing a running host serves. One process is one api
  // assembly and one web shell, until it is replaced.
  const { assetRoot, releaseStore } = roots
  const carried = yield* currentOf(storeAt(assetRoot))
  if (carried === undefined) {
    return yield* Effect.die(
      new WebUnservable({
        message: `no web release is installed at ${assetRoot}; run 'pnpm build' first, or disable @qualy/plugin-web for a headless deployment`,
      }),
    )
  }
  // A deployment that keeps its releases apart from the image serves from
  // there, and only once the deploy job has made this image's release the
  // current one. Starting anyway would serve whatever release the last deploy
  // left behind - or nothing - and the deploy job is not something a start
  // may do in its place, any more than it may apply a migration.
  let store = storeAt(assetRoot)
  let current = carried
  if (releaseStore !== undefined) {
    if (!path.isAbsolute(releaseStore)) {
      return yield* Effect.die(
        new WebUnservable({
          message: `${RELEASE_STORE_VARIABLE} must be an absolute path, not ${releaseStore}`,
        }),
      )
    }
    store = storeAt(releaseStore)
    const installed = yield* currentOf(store)
    if (installed === undefined) {
      return yield* Effect.die(
        new WebUnservable({
          message: `no web release is installed in the deployment's store at ${releaseStore}; run ${DEPLOY_JOB}`,
        }),
      )
    }
    if (installed.releaseId !== carried.releaseId) {
      return yield* Effect.die(
        new WebUnservable({
          message: `the deployment's web release store at ${releaseStore} serves release ${installed.releaseId}, but this image carries ${carried.releaseId}; run ${DEPLOY_JOB}`,
        }),
      )
    }
    current = installed
  }
  // The release names the assembly it was built from; this process knows the
  // assembly it runs. Serving assets built from a different one means the
  // browser registry, the typed client and the served api may each be a
  // different selection - a mismatch neither half can notice alone, so it is
  // refused before the port binds.
  const info = yield* AssemblyInfo
  if (current.release.resolutionHash !== info.resolutionHash) {
    return yield* Effect.die(
      new WebUnservable({
        message: `web release ${current.releaseId} was built from assembly ${current.release.resolutionHash}, but this process runs ${info.resolutionHash}; run 'pnpm build' so the bundle matches the assembly`,
      }),
    )
  }
  // And the half that hash cannot see. The selection can be identical while
  // ordinary code adds, renames or removes a page, a slot or a login method:
  // the lock records no surface identity, and every workspace plugin's
  // version is 0.0.0. A deployment that updated the server and reused the
  // store's existing release would then serve a bundle with no renderer for
  // a surface its own manifest names - a blank screen, discovered by a user.
  //
  // A release installed before this was recorded cannot be shown to match,
  // and unprovable is refused rather than assumed, the same reading the old
  // tab judgement takes.
  if (current.release.browserContractHash !== info.browserContractHash) {
    return yield* Effect.die(
      new WebUnservable({
        message: `web release ${current.releaseId} carries browser contract ${current.release.browserContractHash ?? '(none recorded)'}, but this process declares ${info.browserContractHash}; run 'pnpm build' so the bundle matches the surfaces this assembly serves`,
      }),
    )
  }
  // The code that draws this release's documents, from where the image put
  // it, and only if it is this release's: its documents name these assets.
  const draw = yield* placedServer(roots.serverRoot, current.releaseId)
  yield* Effect.logInfo(`serving web release ${current.releaseId} from ${current.root}`)
  return {
    current,
    draw,
    files: serve(store, current),
    standingOf: judging(store, current),
  }
})

/** what the server's half of a build exports: a document request in, its answer out */
type Draw = (
  request: Request,
  context: {
    readonly nonce?: string
    readonly apiOrigin?: string
    readonly dispatchApi?: ((request: Request) => Promise<Response>) | undefined
    readonly requestId?: string | undefined
    readonly traceId?: string | undefined
    readonly onRoute?: ((route: string, kind: 'document' | 'rsc') => void) | undefined
  },
) => Promise<Response>

/**
 * The server's half of the build, as staging placed it beside the store
 * (packages/build/web/src/stage.ts), loaded once: executable code is fixed
 * with the image that runs it, never read from a store an installer changes.
 * It names the release whose documents it draws; any other release's assets
 * would not be the ones its documents link, so a mismatch refuses the start.
 */
const placedServer = Effect.fn('Web.placedServer')(function* (
  serverRoot: string,
  releaseId: string,
) {
  const entry = path.join(serverRoot, 'rsc', 'index.js')
  const metadata = path.join(serverRoot, SERVER_BUILD_METADATA)
  if (!fs.existsSync(entry) || !fs.existsSync(metadata)) {
    return yield* Effect.die(
      new WebUnservable({
        message: `no server for the web release is placed at ${serverRoot}; run 'pnpm build'`,
      }),
    )
  }
  const drawn = yield* Effect.try({
    try: () =>
      (JSON.parse(fs.readFileSync(metadata, 'utf8')) as { readonly releaseId?: unknown }).releaseId,
    catch: (error) =>
      new WebUnservable({
        message: `${metadata} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      }),
  }).pipe(Effect.orDie)
  if (drawn !== releaseId) {
    return yield* Effect.die(
      new WebUnservable({
        message: `the server placed at ${serverRoot} draws release ${String(drawn)}, but the store serves ${releaseId}; run 'pnpm build' so the two are one build`,
      }),
    )
  }
  const loaded = yield* Effect.tryPromise({
    try: () => import(pathToFileURL(entry).href) as Promise<{ readonly default: Draw }>,
    catch: (error) =>
      new WebUnservable({
        message: `the server at ${entry} did not load: ${error instanceof Error ? error.message : String(error)}`,
      }),
  }).pipe(Effect.orDie)
  return loaded.default
})

/**
 * One document, drawn: the request handed to the server's half with a nonce
 * made for this response alone and the api it reads through, and its answer
 * sent on under the document's own headers - the policy naming that nonce,
 * the frame refusal, the opener isolation. The render goes on as long as its
 * body is read; a reader who goes away lets the body go, and the render's
 * signal ends with it.
 */
const drawDocument = (
  draw: Draw,
  policyFor: (nonce: string) => string,
  mode: CspMode,
  apiOrigin: string,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    // a request the platform could not read is not one a document answers
    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
    const nonce = randomBytes(16).toString('base64')
    const correlation = Option.getOrUndefined(yield* Effect.serviceOption(RequestContext))
    const dispatchApi = Option.getOrUndefined(yield* Effect.serviceOption(LocalRenderApi))
    const parent = Option.getOrUndefined(yield* Effect.serviceOption(Tracer.ParentSpan))
    const metricRoute = Option.getOrUndefined(yield* Effect.serviceOption(WebMetricRoute))
    let route: string | undefined
    let kind: 'document' | 'rsc' | undefined
    const controller = new AbortController()
    const response = yield* Effect.tryPromise({
      try: () =>
        draw(
          new Request(web.url, {
            method: web.method,
            headers: web.headers,
            signal: controller.signal,
          }),
          {
            nonce,
            apiOrigin,
            dispatchApi,
            requestId: correlation?.requestId,
            traceId: correlation?.traceId,
            onRoute: (matched, matchedKind) => {
              route = matched
              kind = matchedKind
            },
          },
        ),
      catch: (cause) => new DrawFailed({ cause }),
    }).pipe(
      Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
      Effect.orDie,
    )
    // Only the renderer's authorized manifest match may label telemetry.
    // Files and unknown pages keep the wildcard rather than a raw path.
    if (route !== undefined && kind !== undefined) metricRoute?.set(route, kind)
    if (route !== undefined && kind !== undefined && parent?._tag === 'Span') {
      parent.attribute('http.route', route)
      parent.attribute('qualy.web.request_kind', kind)
    }
    const body = response.body
    const relayed = body === null ? null : relayRenderStream(body, controller)
    const headers = new Headers(response.headers)
    if (response.status >= 500)
      yield* Effect.logError('Web render returned a server error', response.status)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('X-Frame-Options', 'DENY')
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set(CSP_HEADER[mode], policyFor(nonce))
    headers.set('Reporting-Endpoints', `${REPORTING_ENDPOINT}="${REPORT_PATH}"`)
    return HttpServerResponse.fromWeb(new Response(relayed, { status: response.status, headers }))
  })

/**
 * What a page's claimed release is to this process, for the serve chain.
 *
 * Only this plugin can answer it: the store is its, and the hash a release
 * was built from is in the release's own metadata beside its shell. The host
 * asks through a registry, the way it asks for readiness, so it names no
 * plugin.
 *
 * Two hashes have to agree, because they answer different questions. The
 * assembly hash says the same plugins were selected; it says nothing about
 * what their browser halves offer, since page ids and slot keys are not part
 * of what a lock records. A release of the same selection can therefore have
 * added, renamed or removed a surface in ordinary code, and an older tab
 * asking for its manifest would be handed one its own bundle cannot render.
 * The browser contract hash is that half. Neither is ever named to the
 * browser, and a difference in either is the same answer.
 *
 * Known answers are remembered - a release id names one build forever, which
 * the store enforces on the way in - and unknown ones are not. A release can
 * be installed while this process runs, and behind a load balancer a page
 * from that release can reach this process; remembering that it was once
 * unknown would refuse it for the rest of this process's life. The cost of
 * not remembering is one failed file read per request naming a release that
 * is not there, which is what serving a missing file costs anyway.
 */
const judging = (
  store: ReleaseStore,
  current: CurrentWebRelease,
): ((releaseId: string) => ReleaseStanding) => {
  const known = new Map<string, ReleaseStanding>()
  return (releaseId) => {
    if (releaseId === current.releaseId) return 'compatible'
    const remembered = known.get(releaseId)
    if (remembered !== undefined) return remembered
    let installed: InstalledWebRelease
    try {
      installed = readInstalledRelease(store, releaseId)
    } catch {
      return 'unknown'
    }
    const standing: ReleaseStanding =
      installed.resolutionHash === current.release.resolutionHash &&
      installed.browserContractHash === current.release.browserContractHash
        ? 'compatible'
        : 'other-assembly'
    known.set(releaseId, standing)
    return standing
  }
}

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
/**
 * Whether a request names something hidden.
 *
 * Nothing hidden is served: the release's own metadata sits beside its
 * shell, and the per-request lookup does not know a dotfile from a file.
 *
 * Decided on the DECODED path, because that is the spelling the file lookup
 * works from. `%2E` is a dot and `%2F` is a separator, so the raw text can
 * name the very file this refuses while carrying neither. An escape that
 * does not decode is refused too - it cannot name a servable file either.
 */
/**
 * The router's request for the routes behind a set of addresses, which a
 * page makes as the reader moves around (React Router's RSC route discovery
 * asks `/.manifest?paths=...`). A path the renderer answers, never a file.
 */
const ROUTE_MANIFEST_PATH = '/.manifest'

const asksRouteManifest = (url: string): boolean =>
  (url.split(/[?#]/)[0] ?? url) === ROUTE_MANIFEST_PATH

export const namesHiddenPath = (url: string): boolean => {
  const raw = url.split(/[?#]/)[0] ?? url
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return true
  }
  return /(?:^|\/)\./.test(decoded)
}

export const routes: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | WebConfig | AssemblyInfo | ShellPolicyHeader | ClientAssembly
> = HttpRouter.use(
  Effect.fnUntraced(function* (router) {
    const config = yield* WebConfig
    // the report endpoint, in every mode: a browser only posts to it
    // when a shell with a policy told it to, and a development backend
    // serves no such shell
    yield* addReportRoute(router, { source: PLUGIN_ID })
    // A development backend serves the api and nothing else: the browser is
    // asking Vite, which proxies the api back here. Registering a wildcard
    // would answer navigations this process is not the entry point for.
    // a NODE_ENV that cannot be read is a broken process, not a case a
    // caller could handle
    const deployed = yield* Config.String('NODE_ENV').pipe(
      Config.withDefault('development'),
      Effect.orDie,
    )
    if (deployed !== 'production') {
      yield* Effect.logDebug('serving the api only; the browser is served by the dev service')
      return
    }
    // built after the barrier, so the frozen policy is there to read
    const policy = yield* ShellPolicyHeader
    const { current, draw, files, standingOf } = yield* production(config)
    yield* renderLogging
    // The address of the API, also used when the host dispatches it locally.
    const port = yield* Config.Port('PORT').pipe(Config.withDefault(3000), Effect.orDie)
    const document = drawDocument(
      draw,
      policy.forDocument,
      config.cspMode,
      `http://127.0.0.1:${String(port)}`,
    )
    // The serve chain asks this of every request that names a release, and
    // nothing else can answer it: a page built from another plugin selection
    // must not go on talking to this api, and neither half can tell alone.
    yield* (yield* ClientAssembly).register(standingOf)
    // Which release this process serves, for the page asking whether the
    // server has moved on. Outside the api mount on purpose: it is the
    // page's way of recovering when the api may already refuse it, so it
    // depends on nothing typed. The answer is the pinned release, read
    // once at boot, never the pointer on disk; it is public, and it is
    // never cached.
    const probe = JSON.stringify(releaseProbeOf(current.release))
    yield* router.add(
      'GET',
      QUALY_RELEASE_ENDPOINT,
      HttpServerResponse.text(probe, {
        contentType: 'application/json; charset=utf-8',
        headers: {
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'cross-origin-resource-policy': 'same-origin',
        },
      }),
    )
    yield* router.add(
      '*',
      '/*',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        // An unmatched path inside the api prefix is the api's tagged 404,
        // never the browser shell. Serving html there answers 200 to a
        // mistyped endpoint, which is how a doubled prefix looked like a
        // working request until the page tried to parse the shell as json.
        if (insideApi(request.url)) return yield* apiRouteNotFound
        // nothing hidden is served: the release's own metadata sits beside
        // its public files. The one dotted path that is not a file is the
        // router's own question about which routes a set of addresses has,
        // asked of the renderer as the page is used.
        if (namesHiddenPath(request.url) && !asksRouteManifest(request.url)) {
          return HttpServerResponse.empty({ status: 404 })
        }
        // a file - an asset, an icon - is a file; anything else is a document
        // the server draws, or the answer its renderer gives a path it has no
        // page for
        if (files.names(request.url)) return yield* fromConnect(files.middleware)
        return yield* document
      }),
    )
  }),
)

/**
 * The one service this half runs: the shell policy, frozen at the barrier.
 *
 * Everything else here is a file handler with no lifetime. The policy is a
 * service because its value is decided by every other plugin's layer having
 * built, and the routes above read it once they build after that moment.
 */
export const layer: Layer.Layer<ShellPolicyHeader, never, ShellPolicy | Assembled> = policyLayer
