import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

// Whether this deployment reports browser failures, and with what.
//
// Asked at run time rather than compiled in. The production bundle is a
// superset of every installed plugin, built once and deployed more than once,
// so a reporting project baked into it would be one deployment's fact frozen
// into every deployment's artifact. Asked here, turning reporting on, off, or
// over to another vendor is configuration.
//
// `/app` because what asks is the shell, the same domain the manifest is
// served under. Not `/rum` and not the vendor's name: the first is an
// implementation word and the second would change the address when the
// vendor changed, which is the one thing this endpoint exists to avoid.
//
// The provider's own settings ride inside `config` and are opaque here. This
// plugin knows that a reporting provider has configuration; it must never
// learn what a reporting id or a sample rate is, or the vendor neutrality is
// only skin deep.
//
// Which provider was selected is deliberately absent too, and that is the
// whole of generation 2. A build carries the browser halves of the ACTIVE
// selection and nothing else, so the page asking already holds exactly one
// of them - naming it on the wire told every visitor which vendor this
// deployment reports to, and told the page something it could not act on.
// `config` is the answer: settings to start with, or null for "this
// deployment reports nowhere".
//
// `releaseId` is deliberately absent. The browser's release and the server's
// can differ - a tab left open across a deployment is the normal case - and a
// failure in that tab belongs to the build that tab is running. The bundle
// knows which one that is; this endpoint does not.

/**
 * Generation 2: the vendor's name left the wire.
 *
 * The number lives on the document rather than on the package, so a reader
 * that expects another generation knows it is reading something else. A page
 * from an older build asks and finds a number it does not know, which it
 * reads as "no reporting" - the same answer it gets from a deployment that
 * reports nowhere, and the right one: its own bundle cannot be made to match
 * a document it has never seen.
 */
export const RUM_SETTINGS_SCHEMA = 2 as const

const RumSettingsSchema = Schema.Struct({
  schema: Schema.Literal(RUM_SETTINGS_SCHEMA),
  /** the selected provider's own settings, or null when there is no provider */
  config: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
})

export type RumSettings = typeof RumSettingsSchema.Type

export const rumApiGroup = HttpApiGroup.make('rum').add(
  // anonymous on purpose: everything here is already public the moment a page
  // reports, since the browser puts it on the wire itself
  HttpApiEndpoint.get('getRumSettings', '/app/observability', {
    success: RumSettingsSchema,
  }),
)
