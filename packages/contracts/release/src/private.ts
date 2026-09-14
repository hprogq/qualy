import { Schema } from 'effect'
import { RELEASE_PROBE_SCHEMA, ReleaseIdSchema, type ReleaseProbe } from './index.ts'

// The half of the release protocol a browser never reads.
//
// The identity a build stamps into a bundle, the metadata it writes beside
// the output, the record a store keeps, the pointer a host starts from: all
// of it is read by a build tool and a host, and none of it is served.
//
// A separate module because a module is the unit a bundler keeps or drops.
// These lived beside the probe, and the browser imports the probe - so a
// build shipped the private half's field names to every visitor, `assets`
// and `resolutionHash` and `browserContractHash` among them. No value ever
// went with them, but a public artifact that names the private vocabulary
// is telling a reader what to look for, and the split costs nothing.
//
// The public half imports nothing from here. The one thing it re-exports is
// `WebReleaseIdentity`, and only as a type, which is erased before a
// bundler ever sees it.

/** the private documents' generation: the identity, the build metadata, the pointer */
export const RELEASE_SCHEMA = 1 as const

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

/**
 * Which browser surfaces a build carries, as one value.
 *
 * The assembly hash says which plugins were selected; it does not say what
 * their browser halves offer, because a plugin's page ids and slot keys are
 * not part of what a lock records. So two releases of the same selection can
 * disagree about what the shell manifest may name - a page added, renamed or
 * removed by ordinary code - and an older tab asking for its manifest would
 * be handed a surface its own bundle has no renderer for.
 *
 * It is a fingerprint of the surface IDENTITIES alone, which is why ordinary
 * implementation changes leave it alone and an older tab keeps working. It
 * lives in the store beside the release and never goes near a browser: a page
 * is told to reload, never why.
 */
export const BrowserContractHashSchema = Schema.String.check(Schema.isMinLength(1))

/** a release installed into a production store, as its own metadata records it */
export const InstalledWebReleaseSchema = Schema.Struct({
  ...WebBuildMetadataSchema.fields,
  resolutionHash: Schema.String.check(Schema.isMinLength(1)),
  // optional so a store written before this existed still parses; a release
  // without one cannot be shown to be compatible, which is the safe reading
  browserContractHash: Schema.optional(BrowserContractHashSchema),
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

// A parse throws with the reason: these are values off disk, and a tool or a
// host that cannot read one must refuse loudly rather than carry on.

export const parseWebReleaseIdentity: (value: unknown) => WebReleaseIdentity =
  Schema.decodeUnknownSync(WebReleaseIdentitySchema)

export const parseWebBuildMetadata: (value: unknown) => WebBuildMetadata =
  Schema.decodeUnknownSync(WebBuildMetadataSchema)

export const parseInstalledWebRelease: (value: unknown) => InstalledWebRelease =
  Schema.decodeUnknownSync(InstalledWebReleaseSchema)

export const parseCurrentReleasePointer: (value: unknown) => CurrentReleasePointer =
  Schema.decodeUnknownSync(CurrentReleasePointerSchema)
