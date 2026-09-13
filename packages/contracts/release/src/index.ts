import { z } from 'zod'

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
// The validators are zod, as the sibling contracts' are - a value read off
// disk or off the wire is parsed, never trusted.

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

export const releaseIdSchema = z
  .string()
  .regex(
    RELEASE_ID_PATTERN,
    'a release id is 1-128 of [A-Za-z0-9._-], starting with a letter or digit',
  )

export const releaseModeSchema = z.enum(['development', 'production'])

/** a protocol generation: a small non-negative integer */
export const clientProtocolSchema = z.number().int().min(0).max(1_000_000)

/** what the browser is running: written into the bundle at build time */
export const webReleaseIdentitySchema = z.object({
  schema: z.literal(RELEASE_SCHEMA),
  releaseId: releaseIdSchema,
  mode: releaseModeSchema,
  clientProtocol: clientProtocolSchema,
})

export type WebReleaseIdentity = z.infer<typeof webReleaseIdentitySchema>

/** a release installed into a production store, as its own metadata records it */
export const installedWebReleaseSchema = webReleaseIdentitySchema.extend({
  resolutionHash: z.string().min(1),
  installedAt: z.iso.datetime(),
  assets: z.array(z.string().min(1)),
})

export type InstalledWebRelease = z.infer<typeof installedWebReleaseSchema>

/** the store's pointer to the release a host starting now should pin */
export const currentReleasePointerSchema = z.object({
  schema: z.literal(RELEASE_SCHEMA),
  releaseId: releaseIdSchema,
})

export type CurrentReleasePointer = z.infer<typeof currentReleasePointerSchema>

export const parseCurrentReleasePointer = (value: unknown): CurrentReleasePointer =>
  currentReleasePointerSchema.parse(value)

/** what a host answers at the release endpoint */
export const releaseProbeSchema = z.object({
  schema: z.literal(RELEASE_SCHEMA),
  releaseId: releaseIdSchema,
  mode: releaseModeSchema,
  clientProtocol: clientProtocolSchema,
  serverProtocol: z.object({
    min: clientProtocolSchema,
    max: clientProtocolSchema,
  }),
})

export type ReleaseProbe = z.infer<typeof releaseProbeSchema>

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

/** parse an identity read off disk or off the wire; throws with the reason */
export const parseWebReleaseIdentity = (value: unknown): WebReleaseIdentity =>
  webReleaseIdentitySchema.parse(value)

export const parseInstalledWebRelease = (value: unknown): InstalledWebRelease =>
  installedWebReleaseSchema.parse(value)

/** a probe as the browser reads it: a guard, since a bad answer is not an error to throw at a reader */
export const isReleaseProbe = (value: unknown): value is ReleaseProbe =>
  releaseProbeSchema.safeParse(value).success
