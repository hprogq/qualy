import fs from 'node:fs'
import path from 'node:path'
import { Config, Context, Data, Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import sirv from 'sirv'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { Assembled, AssemblyInfo } from '@qualy/api-kit/assembled'
import type { ShellPolicy } from '@qualy/api-kit/shell-policy'
import { fromConnect, type ConnectMiddleware } from '@qualy/api-kit/node'
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
      const declared = yield* Schema.decodeUnknownEffect(WebManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
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

/** the api owns everything under its mount, matched or not */
const insideApi = (url: string) =>
  url === QUALY_API_PREFIX ||
  url.startsWith(`${QUALY_API_PREFIX}/`) ||
  url.startsWith(`${QUALY_API_PREFIX}?`)

/** the content security policy as the shell sends it: which header, what value */
interface ShellPolicySetting {
  readonly header: (typeof CSP_HEADER)[CspMode]
  readonly value: string
}

/** the staged build, with the caching rules a hashed-asset bundle needs */
const assets = (assetRoot: string, policy: ShellPolicySetting): ConnectMiddleware =>
  sirv(assetRoot, {
    etag: true,
    // The twins the build wrote, served when the request accepts them. Off
    // by default, and the default is what shipped: every visitor downloaded
    // the bundle raw, which is roughly five times the bytes for nothing.
    // A request that accepts neither still gets the original.
    brotli: true,
    gzip: true,
    // spa fallback: extension-less GET/HEAD navigations get index.html,
    // missing assets with extensions stay 404
    single: true,
    maxAge: 31_536_000,
    immutable: true,
    setHeaders: (response, pathname) => {
      // The static middleware writes the node response itself, so the serve
      // chain's headers never reach these bytes: whatever the shell and the
      // assets carry is set here, and only here.
      // a script is served as a script and an image as an image, never
      // sniffed into something else; and a link out of any page says no
      // more than the origin to the other side
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
      // pathname is the request path, so spa navigations ('/', '/ping') have no
      // extension: those serve the html shell, which must not be cached
      if (pathname.endsWith('.html') || !path.posix.extname(pathname)) {
        response.setHeader('Cache-Control', 'no-cache')
        // The shell is a document and gets the document-only headers: no
        // other site may frame it (clickjacking), and a page that opens it
        // from another origin gets no handle back on its window (the
        // repository opens no windows itself, so the isolation costs
        // nothing). The hashed assets are not documents and are left with
        // their immutable caching.
        response.setHeader('X-Frame-Options', 'DENY')
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
        // the policy, frozen once at the barrier, and where to report to
        // under the Reporting API name the policy's report-to refers to
        response.setHeader(policy.header, policy.value)
        response.setHeader('Reporting-Endpoints', `${REPORTING_ENDPOINT}="${REPORT_PATH}"`)
      }
    },
  })

const production = Effect.fn('Web.production')(function* (
  assetRoot: string,
  policy: ShellPolicySetting,
) {
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
  return assets(assetRoot, policy)
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
  HttpRouter.HttpRouter | WebConfig | AssemblyInfo | ShellPolicyHeader
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
    const middleware = yield* production(config.assetRoot, {
      header: CSP_HEADER[config.cspMode],
      value: policy.value(),
    })
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
 * The one service this half runs: the shell policy, frozen at the barrier.
 *
 * Everything else here is a file handler with no lifetime. The policy is a
 * service because its value is decided by every other plugin's layer having
 * built, and the routes above read it once they build after that moment.
 */
export const layer: Layer.Layer<ShellPolicyHeader, never, ShellPolicy | Assembled> = policyLayer
