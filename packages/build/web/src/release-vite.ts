import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  CURRENT_CLIENT_PROTOCOL,
  QUALY_RELEASE_ENDPOINT,
  RELEASE_SCHEMA,
  isReleaseId,
  releaseProbeOf,
  type ReleaseMode,
  type WebReleaseIdentity,
} from '@qualy/release-contract'

// The web release's identity, minted where the bundle is made.
//
// One Vite plugin instance is one release: a production build mints an id
// once and writes it into the bundle (as a virtual module) and beside it
// (as metadata the release installer reads); a development server mints
// one for its own lifetime, so hot updates and backend restarts leave it
// alone and only a real Vite restart - a new plugin instance - changes it.
// In development the same plugin answers the release endpoint, since the
// browser's entry is Vite and the backend never sees the shell.
//
// The id is a name, not a version: the only comparison ever made is
// equality. A build in CI is named by CI through QUALY_RELEASE_ID; a local
// build is named by the clock and a die, because a git sha alone cannot
// tell two builds of one commit apart, nor a build over uncommitted work
// from the commit it sits on.

/** the module the composition root imports the identity from */
export const RELEASE_MODULE_ID = 'virtual:qualy/release'
const RESOLVED_RELEASE_MODULE_ID = `\0${RELEASE_MODULE_ID}`

/** written into the build output, for the installer; never served */
export const WEB_BUILD_METADATA = '.qualy-web-build.json'

/** how a deployment names a production build */
export const RELEASE_ID_VARIABLE = 'QUALY_RELEASE_ID'

export interface ReleaseIdSource {
  /** where the deployment's name is read from; the process environment unless given */
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly now?: () => Date
  /** a short hex string; random unless given */
  readonly random?: () => string
}

const die = () => randomBytes(4).toString('hex')

/** 2026-09-14T09:00:00.000Z -> 20260914T090000Z: sortable, and every character a name may carry */
const stamp = (at: Date) =>
  at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')

/** the id for a release of the given mode, from the deployment's name, or the clock and a die */
export function releaseIdFor(mode: ReleaseMode, source: ReleaseIdSource = {}): string {
  const random = source.random ?? die
  if (mode === 'development') return `dev-${random()}`
  const given = (source.env ?? process.env)[RELEASE_ID_VARIABLE]
  if (given !== undefined && given !== '') {
    if (!isReleaseId(given)) {
      throw new Error(
        `${RELEASE_ID_VARIABLE} is not a release id: 1-128 of [A-Za-z0-9._-], starting with a letter or digit`,
      )
    }
    return given
  }
  return `local-${stamp((source.now ?? (() => new Date()))())}-${random()}`
}

export const releaseIdentity = (
  mode: ReleaseMode,
  source: ReleaseIdSource = {},
): WebReleaseIdentity => ({
  schema: RELEASE_SCHEMA,
  releaseId: releaseIdFor(mode, source),
  mode,
  clientProtocol: CURRENT_CLIENT_PROTOCOL,
})

/** the virtual module's source: the identity, frozen, as `webRelease` */
export const releaseModuleSource = (identity: WebReleaseIdentity): string =>
  `export const webRelease = Object.freeze(${JSON.stringify(identity)})\n`

/** the metadata file's content, for the installer */
export const releaseMetadataSource = (identity: WebReleaseIdentity): string =>
  `${JSON.stringify(identity, null, 2)}\n`

/**
 * The release endpoint as a Connect handler, for the development server.
 * Answers GET and HEAD at the exact path with the probe, never cached,
 * typed and same-origin; another method is refused, another path is not
 * this handler's.
 */
export const releaseProbeHandler =
  (identity: () => WebReleaseIdentity) =>
  (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => {
    // mounted at the endpoint, so the url here is what follows it
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/') {
      next()
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.statusCode = 405
      response.setHeader('Allow', 'GET, HEAD')
      response.setHeader('Cache-Control', 'no-store')
      response.end()
      return
    }
    const body = JSON.stringify(releaseProbeOf(identity()))
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Content-Length', Buffer.byteLength(body))
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    response.end(request.method === 'HEAD' ? undefined : body)
  }

/**
 * The plugin: one instance, one release. The mode follows the command -
 * a build is a production release, a server a development one - and the
 * id is minted when the configuration resolves and never again.
 */
export const qualyRelease = (source: ReleaseIdSource = {}): Plugin => {
  let identity: WebReleaseIdentity | undefined
  const current = (): WebReleaseIdentity => {
    if (identity === undefined)
      throw new Error('the release identity is minted once the config resolves')
    return identity
  }
  return {
    name: 'qualy-release',
    configResolved(config) {
      identity ??= releaseIdentity(
        config.command === 'build' ? 'production' : 'development',
        source,
      )
    },
    resolveId(id) {
      return id === RELEASE_MODULE_ID ? RESOLVED_RELEASE_MODULE_ID : undefined
    },
    load(id) {
      return id === RESOLVED_RELEASE_MODULE_ID ? releaseModuleSource(current()) : undefined
    },
    configureServer(server) {
      server.middlewares.use(QUALY_RELEASE_ENDPOINT, releaseProbeHandler(current))
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: WEB_BUILD_METADATA,
        source: releaseMetadataSource(current()),
      })
    },
  }
}
