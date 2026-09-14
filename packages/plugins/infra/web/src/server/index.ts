import fs from 'node:fs'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { Config, Context, Data, Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import sirv from 'sirv'
import { apiRouteNotFound, insideApi } from '@qualy/api-kit/route-fallback'
import {
  QUALY_RELEASE_ENDPOINT,
  releaseProbeOf,
  type InstalledWebRelease,
} from '@qualy/release-contract'
import { Assembled, AssemblyInfo } from '@qualy/api-kit/assembled'
import { ClientAssembly, type ReleaseStanding } from '@qualy/api-kit/client-assembly'
import type { ShellPolicy } from '@qualy/api-kit/shell-policy'
import { fromConnect, type ConnectMiddleware } from '@qualy/api-kit/node'
import {
  SHARED_ASSETS,
  readCurrentWebRelease,
  readInstalledRelease,
  storeAt,
  type CurrentWebRelease,
  type ReleaseStore,
} from '@qualy/web-build/release-store'
import { decodePluginConfig } from '@qualy/plugin-kit/config'
import { WebManifestConfig, rootsFrom } from '../config.ts'
import { addReportRoute } from './csp-reports.ts'
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
// (docs/runtime-redesign.md §29), declared as this plugin's dev service.
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
        yield* Config.string('QUALY_CSP_MODE').pipe(Config.withDefault('report')),
      )
      return WebConfig.of({ ...rootsFrom(declared, context.manifestDir), cspMode })
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

const PLUGIN_ID = '@qualy/plugin-web'

/** the content security policy as the shell sends it: which header, what value */
interface ShellPolicySetting {
  readonly header: (typeof CSP_HEADER)[CspMode]
  readonly value: string
}

/** the document-only headers: the shell is a page, the assets are not */
const documentHeaders = (response: ServerResponse, policy: ShellPolicySetting) => {
  // no other site may frame it (clickjacking), and a page that opens it
  // from another origin gets no handle back on its window (the repository
  // opens no windows itself, so the isolation costs nothing)
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  // the policy, frozen once at the barrier, and where to report to under
  // the Reporting API name the policy's report-to refers to
  response.setHeader(policy.header, policy.value)
  response.setHeader('Reporting-Endpoints', `${REPORTING_ENDPOINT}="${REPORT_PATH}"`)
}

/** on everything served: a script is a script and an image an image, never sniffed; a link out says no more than the origin */
const commonHeaders = (response: ServerResponse) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

/**
 * The pinned release, served: two file servers behind one middleware.
 *
 * The hashed assets come from the store's shared directory, where every
 * retained release's assets live side by side, so a browser on an earlier
 * release keeps finding its chunks; their names promise their bytes, so
 * they are cached for a year, immutable, and a name the store lacks is a
 * 404 and never the shell. Everything else - the shell for any navigation,
 * the icons, the public files - comes from the pinned release's own
 * directory and is never cached: those names do not change when their
 * bytes do. The static middleware writes the node response itself, so the
 * serve chain's headers never reach these bytes: whatever the shell and
 * the assets carry is set here, and only here.
 */
const serve = (
  store: ReleaseStore,
  current: CurrentWebRelease,
  policy: ShellPolicySetting,
): ConnectMiddleware => {
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
  const shell = sirv(current.root, {
    dev: true,
    etag: true,
    brotli: true,
    gzip: true,
    // spa fallback: extension-less GET/HEAD navigations get index.html,
    // missing files with extensions stay 404
    single: true,
    setHeaders: (response, pathname) => {
      commonHeaders(response)
      response.setHeader('Cache-Control', 'no-cache')
      // pathname is the request path, so spa navigations ('/', '/ping')
      // have no extension: those serve the html shell, a document
      if (pathname.endsWith('.html') || !path.posix.extname(pathname)) {
        documentHeaders(response, policy)
      }
    },
  })
  const mount = `/${SHARED_ASSETS}`
  const notFound = (response: ServerResponse) => {
    response.statusCode = 404
    response.end()
  }
  return (request, response, next) => {
    const url = request.url ?? '/'
    // nothing hidden is served: the release's own metadata sits beside its
    // shell, and the per-request lookup does not know a dotfile from a file
    if (/\/\./.test(url.split('?')[0]!)) {
      notFound(response)
      return
    }
    if (url === mount || url.startsWith(`${mount}/`) || url.startsWith(`${mount}?`)) {
      // under the mount, rooted at the shared directory; a miss is a miss
      request.url = url.slice(mount.length) || '/'
      assets(request, response, () => notFound(response))
      return
    }
    shell(request, response, next)
  }
}

const production = Effect.fn('Web.production')(function* (
  assetRoot: string,
  policy: ShellPolicySetting,
) {
  // The store's pointer is read once, here, and the release it names is
  // pinned for the life of this process: an installer moving the pointer
  // later changes nothing a running host serves. One process is one api
  // assembly and one web shell, until it is replaced.
  const store = storeAt(assetRoot)
  const current = yield* Effect.try({
    try: () => readCurrentWebRelease(store),
    catch: (error) =>
      new WebUnservable({
        message: `the web release store at ${assetRoot} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      }),
  }).pipe(Effect.orDie)
  if (current === undefined) {
    return yield* Effect.die(
      new WebUnservable({
        message: `no web release is installed at ${assetRoot}; run 'pnpm build' first, or disable @qualy/plugin-web for a headless deployment`,
      }),
    )
  }
  if (!fs.existsSync(path.join(current.root, 'index.html'))) {
    return yield* Effect.die(
      new WebUnservable({
        message: `web release ${current.releaseId} at ${current.root} has no index.html`,
      }),
    )
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
  yield* Effect.logInfo(`serving web release ${current.releaseId} from ${current.root}`)
  return {
    current,
    middleware: serve(store, current, policy),
    standingOf: judging(store, current, info),
  }
})

/**
 * What a page's claimed release is to this process, for the serve chain.
 *
 * Only this plugin can answer it: the store is its, and the hash a release
 * was built from is in the release's own metadata beside its shell. The host
 * asks through a registry, the way it asks for readiness, so it names no
 * plugin.
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
  info: { readonly resolutionHash: string },
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
      installed.resolutionHash === info.resolutionHash ? 'compatible' : 'other-assembly'
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
    const deployed = yield* Config.string('NODE_ENV').pipe(
      Config.withDefault('development'),
      Effect.orDie,
    )
    if (deployed !== 'production') {
      yield* Effect.logInfo('serving the api only; the browser is served by the dev service')
      return
    }
    // built after the barrier, so the frozen policy is there to read
    const policy = yield* ShellPolicyHeader
    const { current, middleware, standingOf } = yield* production(config.assetRoot, {
      header: CSP_HEADER[config.cspMode],
      value: policy.value(),
    })
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
        return yield* fromConnect(middleware)
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
