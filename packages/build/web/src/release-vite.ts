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
  type WebBuildMetadata,
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
// equality, and nothing else may be read out of it. A production id is
// therefore minted opaque - no clock, no order, no revision - because it
// goes out to every visitor, and a name that carries a commit or a build
// number tells them things they cannot act on. What was built is a real
// question with a private answer: QUALY_BUILD_REVISION rides in the
// metadata beside the output and into the store, never into the bundle.
// A deployment that passes QUALY_RELEASE_ID names the release itself and
// owes the same restraint; a git sha alone could not name one anyway,
// since two builds of one commit, or a build over uncommitted work, are
// two releases.

/** the module the composition root imports the identity from */
export const RELEASE_MODULE_ID = 'virtual:qualy/release'
const RESOLVED_RELEASE_MODULE_ID = `\0${RELEASE_MODULE_ID}`

/** written into the build output, for the installer; never served */
export const WEB_BUILD_METADATA = '.qualy-web-build.json'

/**
 * Which module stands behind each public surface, written beside the output.
 *
 * The browser addresses surfaces - `page:assessment/review` - and is never
 * told what implements them. Somebody diagnosing a report or a missing chunk
 * still wants to know, so the build writes the answer down where a build
 * artifact lives. Same rule as a source map: produced, archived with the
 * build, never installed into the store and never served.
 */
export const BROWSER_SURFACE_MAP = '.qualy-browser-surfaces.json'

/**
 * What a build writes for itself. None of it is part of a release.
 *
 * Named in one place because two things have to agree: the installer, which
 * leaves them out of the store, and the gate that walks a staged store and
 * refuses them if they turn up anyway.
 */
export const PRIVATE_BUILD_FILES: readonly string[] = [WEB_BUILD_METADATA, BROWSER_SURFACE_MAP]

/** how a deployment names a production build: public, opaque, one build */
export const RELEASE_ID_VARIABLE = 'QUALY_RELEASE_ID'

/** what that build was, for a deployment's own records: private, never public */
export const BUILD_REVISION_VARIABLE = 'QUALY_BUILD_REVISION'

/** the longest revision the metadata takes, as the contract's schema checks it */
const MAX_REVISION = 200

export interface ReleaseIdSource {
  /** where the deployment's name and revision are read from; the process environment unless given */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** a development session's die: a short hex string; random unless given */
  readonly random?: () => string
  /** the opaque part of a minted production name; 16 random bytes unless given */
  readonly token?: () => string
}

const die = () => randomBytes(4).toString('hex')

// base64url, so every character is one a release id may carry, and 16
// bytes of it - the same width a uuid has, in 22 characters rather than 36
const mint = () => randomBytes(16).toString('base64url')

/** the id for a release of the given mode: the deployment's name, or one minted here */
export function releaseIdFor(mode: ReleaseMode, source: ReleaseIdSource = {}): string {
  if (mode === 'development') return `dev-${(source.random ?? die)()}`
  const given = (source.env ?? process.env)[RELEASE_ID_VARIABLE]
  if (given !== undefined && given !== '') {
    if (!isReleaseId(given)) {
      throw new Error(
        `${RELEASE_ID_VARIABLE} is not a release id: 1-128 of [A-Za-z0-9._-], starting with a letter or digit`,
      )
    }
    return given
  }
  return `r_${(source.token ?? mint)()}`
}

/** the revision this build is of, where the deployment told the build tool one */
export function buildRevisionFrom(source: ReleaseIdSource = {}): string | undefined {
  const given = (source.env ?? process.env)[BUILD_REVISION_VARIABLE]
  if (given === undefined || given === '') return undefined
  if (given.length > MAX_REVISION) {
    throw new Error(`${BUILD_REVISION_VARIABLE} is longer than ${String(MAX_REVISION)} characters`)
  }
  return given
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

/** the metadata file's content, for the installer: the identity, and what it was built from */
export const releaseMetadataSource = (identity: WebReleaseIdentity, revision?: string): string => {
  const metadata: WebBuildMetadata = revision === undefined ? identity : { ...identity, revision }
  return `${JSON.stringify(metadata, null, 2)}\n`
}

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
        source: releaseMetadataSource(current(), buildRevisionFrom(source)),
      })
    },
  }
}
