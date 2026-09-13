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
// This package is framework-free: the browser reads the probe before its
// runtime is up, the build tool writes the metadata, the server pins it.
// The schemas are Effect Schema, as every contract's are - a value read off
// disk or off the wire is decoded, never trusted.

export const RELEASE_SCHEMA = 1 as const

/** where any Qualy web host answers which release it is serving; outside /api on purpose */
export const QUALY_RELEASE_ENDPOINT = '/__qualy/release'

export const QUALY_CLIENT_RELEASE_HEADER = 'x-qualy-web-release'
export const QUALY_CLIENT_PROTOCOL_HEADER = 'x-qualy-client-protocol'
export const QUALY_CLIENT_UNSUPPORTED_HEADER = 'x-qualy-client-unsupported'

export const CURRENT_CLIENT_PROTOCOL = 1
export const SERVER_MIN_CLIENT_PROTOCOL = 1
export const SERVER_MAX_CLIENT_PROTOCOL = 1

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

/** a release installed into a production store, as its own metadata records it */
export const InstalledWebReleaseSchema = Schema.Struct({
  ...WebReleaseIdentitySchema.fields,
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

/** what a host answers at the release endpoint */
export const ReleaseProbeSchema = Schema.Struct({
  schema: Schema.Literal(RELEASE_SCHEMA),
  releaseId: ReleaseIdSchema,
  mode: ReleaseModeSchema,
  clientProtocol: ClientProtocolSchema,
  serverProtocol: Schema.Struct({
    min: ClientProtocolSchema,
    max: ClientProtocolSchema,
  }),
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

/** the probe a host answers for the release it is serving, with the protocol window it accepts */
export const releaseProbeOf = (
  identity: WebReleaseIdentity,
  serverProtocol: { readonly min: number; readonly max: number } = {
    min: SERVER_MIN_CLIENT_PROTOCOL,
    max: SERVER_MAX_CLIENT_PROTOCOL,
  },
): ReleaseProbe => ({
  schema: RELEASE_SCHEMA,
  releaseId: identity.releaseId,
  mode: identity.mode,
  clientProtocol: identity.clientProtocol,
  serverProtocol: { min: serverProtocol.min, max: serverProtocol.max },
})

// The readers: a parse throws with the reason, for a value off disk that a
// tool or a host must refuse loudly; a guard answers yes or no, for a
// value off the wire that a page reads and would not throw at.

export const parseWebReleaseIdentity: (value: unknown) => WebReleaseIdentity =
  Schema.decodeUnknownSync(WebReleaseIdentitySchema)

export const parseInstalledWebRelease: (value: unknown) => InstalledWebRelease =
  Schema.decodeUnknownSync(InstalledWebReleaseSchema)

export const parseCurrentReleasePointer: (value: unknown) => CurrentReleasePointer =
  Schema.decodeUnknownSync(CurrentReleasePointerSchema)

export const isReleaseProbe: (value: unknown) => value is ReleaseProbe =
  Schema.is(ReleaseProbeSchema)

export const isReleaseObserved: (value: unknown) => value is ReleaseObserved =
  Schema.is(ReleaseObservedSchema)
