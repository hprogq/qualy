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
// The documents of this protocol are of two kinds, and only one of them is
// public: the probe, the one a browser reads, carrying the one fact a
// browser acts on. The identity in the bundle, the metadata a build writes
// and a store keeps, the pointer a host starts from - those are private and
// live in `./private`, because a module is the unit a bundler keeps or
// drops and they used to ride into the browser on this one's back. They
// version apart for the same reason they are split.
//
// This package is framework-free: the browser reads the probe before its
// runtime is up, the build tool writes the metadata, the server pins it.
// The schemas are Effect Schema, as every contract's are - a value read off
// disk or off the wire is decoded, never trusted.

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

/**
 * Why a server will not talk to this page, as the header says it.
 *
 * Three different facts, one consequence. `protocol` is the api generation
 * this page speaks; `assembly` is a page built from a different set of
 * plugins than the one answering it, which active-only builds made possible -
 * a page whose bundle has screens this server has no api for, or the other
 * way round; `release` is a page naming a build this host cannot identify at
 * all, usually one the store stopped keeping.
 *
 * The page does the same thing about all three - it cannot go on, and says
 * so - and the difference is for whoever reads the diagnostics: one says a
 * deployment shipped a breaking api change, one says the plugin selection
 * moved, one says retention is too short for how long tabs stay open.
 */
export type ClientUnsupportedReason = 'protocol' | 'assembly' | 'release'

export const CLIENT_UNSUPPORTED_REASONS = ['protocol', 'assembly', 'release'] as const

export const isClientUnsupportedReason = (value: unknown): value is ClientUnsupportedReason =>
  typeof value === 'string' && (CLIENT_UNSUPPORTED_REASONS as readonly string[]).includes(value)

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

/**
 * What the bundle carries about itself.
 *
 * The type only. The schema that describes it is private, along with every
 * other document a build tool writes and a host reads - see `./private`.
 */
export type { WebReleaseIdentity } from './private.ts'

/** the channel tabs of one origin tell each other about a release they saw */
export const QUALY_RELEASE_CHANNEL = 'qualy:release'

/** what a tab posts on the channel: the probe it read, nothing of its own */
export const ReleaseObservedSchema = Schema.Struct({
  type: Schema.Literal('release-observed'),
  probe: ReleaseProbeSchema,
})

export type ReleaseObserved = typeof ReleaseObservedSchema.Type

// A guard answers yes or no: these are values off the wire that a page
// reads, and a page would not throw at one. The parsers for the documents
// off disk live next door, with the documents.

export const isReleaseProbe: (value: unknown) => value is ReleaseProbe =
  Schema.is(ReleaseProbeSchema)

export const isReleaseObserved: (value: unknown) => value is ReleaseObserved =
  Schema.is(ReleaseObservedSchema)
