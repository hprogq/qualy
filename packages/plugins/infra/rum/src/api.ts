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
// `releaseId` is deliberately absent. The browser's release and the server's
// can differ - a tab left open across a deployment is the normal case - and a
// failure in that tab belongs to the build that tab is running. The bundle
// knows which one that is; this endpoint does not.

export const RUM_SETTINGS_SCHEMA = 1 as const

const RumSettingsSchema = Schema.Struct({
  schema: Schema.Literal(RUM_SETTINGS_SCHEMA),
  /** the provider's code, or null when this deployment reports nowhere */
  provider: Schema.NullOr(Schema.String),
  /** the provider's own settings, verbatim; empty when there is no provider */
  config: Schema.Record(Schema.String, Schema.Unknown),
})

export type RumSettings = typeof RumSettingsSchema.Type

export const rumApiGroup = HttpApiGroup.make('rum').add(
  // anonymous on purpose: everything here is already public the moment a page
  // reports, since the browser puts it on the wire itself
  HttpApiEndpoint.get('getRumSettings', '/app/observability', {
    success: RumSettingsSchema,
  }),
)
