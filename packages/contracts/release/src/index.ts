import { Schema } from 'effect'

// The web release protocol: what a browser is running, what a server is
// serving, and whether the two may still talk.
//
// Three identities are kept apart on purpose. The assembly's resolutionHash
// says which set of plugins a build or a process was made from; it does not
// change when a component file does, so it is not a build's identity. The
// release id is one specific web build (or one development Vite session):
// two builds of the same commit, or a build over an uncommitted change, are
// two releases, and the only question ever asked of two ids is whether they
// are equal. The client protocol is a small integer for the compatibility
// generation between the browser and the api; it moves only on a breaking
// api change, and a server serves a window of it while old tabs drain.
//
// The documents here are of two kinds, and only one of them is public. The
// identity in the bundle, the metadata a build writes and a store keeps,
// the pointer: those are private, read by a build tool and a host. The
// probe is the one document a browser reads, so it carries the one fact a
// browser acts on. They version apart for the same reason.
//
// This package is framework-free: the browser reads the probe before its
// runtime is up, the build tool writes the metadata, the server pins it.
// The schemas are Effect Schema, as every contract's are - a value read off
// disk or off the wire is decoded, never trusted.

/** the private documents' generation: the identity, the build metadata, the pointer */
export const RELEASE_SCHEMA = 1 as const

/**
 * The public probe's generation, which moves on its own.
 *
 * It is 2 because the probe used to answer with the deployment's mode and
 * the server's protocol window as well, and a reader that expects those is
 * reading a different document. The private documents did not change, so
 * their number did not move: one version per document, not one per package.
 */
export const RELEASE_PROBE_SCHEMA = 2 as const

/** where any Qualy web host answers which release it is serving; outside /api on purpose */
export const QUALY_RELEASE_ENDPOINT = '/__qualy/release'

export const QUALY_CLIENT_RELEASE_HEADER = 'x-qualy-web-release'
export const QUALY_CLIENT_PROTOCOL_HEADER = 'x-qualy-client-protocol'
export const QUALY_CLIENT_UNSUPPORTED_HEADER = 'x-qualy-client-unsupported'

// Generation 2: the shell manifest stopped naming the module behind each
// surface, which is a breaking change to a document every page reads. The
// window is a single generation because a server cannot serve both shapes -
// expand-then-contract is for changes where it can - so a tab from the
// previous release is refused on its first api call and told to reload,
// which is exactly what that refusal is for.
export const CURRENT_CLIENT_PROTOCOL = 2
export const SERVER_MIN_CLIENT_PROTOCOL = 2
export const SERVER_MAX_CLIENT_PROTOCOL = 2

export type ReleaseMode = 'development' | 'production'

/**
 * A release id is a name for a directory and a header value, so it is kept
 * to the characters both take without escaping. It begins with a letter or
 * a digit: that is what rules out `.`, `..` and any hidden name, and with
 * no separator in the alphabet a value can never name a path outside the
 * store. At most 128 characters.
 */
export const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export const isReleaseId = (value: unknown): value is string =>
  typeof value === 'string' && RELEASE_ID_PATTERN.test(value)

export const ReleaseIdSchema = Schema.String.check(Schema.isPattern(RELEASE_ID_PATTERN))

export const ReleaseModeSchema = Schema.Literals(['development', 'production'])

/** a protocol generation: a small non-negative integer */
export const ClientProtocolSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1_000_000),
)

/** an instant as JSON carries it: the ISO 8601 form `Date.toISOString` writes, kept a string */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
export const InstantSchema = Schema.String.check(Schema.isPattern(INSTANT))

/** what the browser is running: written into the bundle at build time */
export const WebReleaseIdentitySchema = Schema.Struct({
  schema: Schema.Literal(RELEASE_SCHEMA),
  releaseId: ReleaseIdSchema,
  mode: ReleaseModeSchema,
  clientProtocol: ClientProtocolSchema,
})

export type WebReleaseIdentity = typeof WebReleaseIdentitySchema.Type

/**
 * What a build was made from, for whoever has to find it again.
 *
 * A public release id says nothing about its build on purpose, so the
 * mapping back to a commit has to live somewhere - here, in the metadata
 * beside the output and in the store, both of which a deployment reads and
 * nothing serves. The bundle never carries it and the probe never answers
 * it: that is the whole point of naming releases opaquely.
 */
export const BuildRevisionSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
)

/** what a build writes beside its output, for the installer; never served */
export const WebBuildMetadataSchema = Schema.Struct({
  ...WebReleaseIdentitySchema.fields,
  revision: Schema.optional(BuildRevisionSchema),
})

export type WebBuildMetadata = typeof WebBuildMetadataSchema.Type

/** a release installed into a production store, as its own metadata records it */
export const InstalledWebReleaseSchema = Schema.Struct({
  ...WebBuildMetadataSchema.fields,
  resolutionHash: Schema.String.check(Schema.isMinLength(1)),
  installedAt: InstantSchema,
  assets: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
})

export type InstalledWebRelease = typeof InstalledWebReleaseSchema.Type

/** the store's pointer to the release a host starting now should pin */
export const CurrentReleasePointerSchema = Schema.Struct({
  schema: Schema.Literal(RELEASE_SCHEMA),
  releaseId: ReleaseIdSchema,
})

export type CurrentReleasePointer = typeof CurrentReleasePointerSchema.Type

/**
 * What a host answers at the release endpoint: which release it serves.
 *
 * This is the whole public wire of the protocol, so it answers the one
 * question a page asks here - is the host still on the release I am - and
 * the only operation on the answer is equality. Whether the two may still
 * talk is a different question with a different answer: the api settles it
 * on the first request that matters. Telling every visitor the deployment's
 * mode and the protocol window the server accepts bought nothing the page
 * does, and both are facts about the server rather than about the page.
 */
export const ReleaseProbeSchema = Schema.Struct({
  schema: Schema.Literal(RELEASE_PROBE_SCHEMA),
  releaseId: ReleaseIdSchema,
})

export type ReleaseProbe = typeof ReleaseProbeSchema.Type

/** the channel tabs of one origin tell each other about a release they saw */
export const QUALY_RELEASE_CHANNEL = 'qualy:release'

/** what a tab posts on the channel: the probe it read, nothing of its own */
export const ReleaseObservedSchema = Schema.Struct({
  type: Schema.Literal('release-observed'),
  probe: ReleaseProbeSchema,
})

export type ReleaseObserved = typeof ReleaseObservedSchema.Type

/**
 * The probe a host answers for the release it is serving.
 *
 * Written field by field out of the private identity rather than spread
 * from it: what a public document carries is a decision, and a decision
 * that reads `...identity` is made again, silently, every time a private
 * field is added.
 */
export const releaseProbeOf = (identity: WebReleaseIdentity): ReleaseProbe => ({
  schema: RELEASE_PROBE_SCHEMA,
  releaseId: identity.releaseId,
})

// The readers: a parse throws with the reason, for a value off disk that a
// tool or a host must refuse loudly; a guard answers yes or no, for a
// value off the wire that a page reads and would not throw at.

export const parseWebReleaseIdentity: (value: unknown) => WebReleaseIdentity =
  Schema.decodeUnknownSync(WebReleaseIdentitySchema)

export const parseWebBuildMetadata: (value: unknown) => WebBuildMetadata =
  Schema.decodeUnknownSync(WebBuildMetadataSchema)

export const parseInstalledWebRelease: (value: unknown) => InstalledWebRelease =
  Schema.decodeUnknownSync(InstalledWebReleaseSchema)

export const parseCurrentReleasePointer: (value: unknown) => CurrentReleasePointer =
  Schema.decodeUnknownSync(CurrentReleasePointerSchema)

export const isReleaseProbe: (value: unknown) => value is ReleaseProbe =
  Schema.is(ReleaseProbeSchema)

export const isReleaseObserved: (value: unknown) => value is ReleaseObserved =
  Schema.is(ReleaseObservedSchema)
