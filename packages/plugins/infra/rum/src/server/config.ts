import { Config, Context, Effect, Layer, Schema } from 'effect'
import { decodePluginConfig } from '@qualy/plugin-kit/config'

// Whether this deployment reports at all.
//
// A switch of its own rather than "a reporting id was given". Which provider
// reports is the release's choice, fixed in the manifest because it decides
// what the browser bundle carries; whether the one the release carries is
// used is the deployment's, and a development machine, a CI job and a
// production server answer it differently with the same image. Off unless a
// deployment says on - and on is a promise: a provider that cannot keep it
// for want of an id refuses to start rather than report nowhere.

export class RumReporting extends Context.Service<RumReporting, { readonly on: boolean }>()(
  '@qualy/plugin-rum/RumReporting',
) {}

export const RUM_REPORTING_VARIABLE = 'QUALY_RUM_REPORTING'

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<RumReporting, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    RumReporting,
    Effect.gen(function* () {
      // nothing in the manifest: an empty block, and a typo in it refused
      yield* decodePluginConfig(Schema.Struct({}), manifest)
      // anything but on or off is refused rather than read as off
      const switched = yield* Config.Literals(['on', 'off'], RUM_REPORTING_VARIABLE).pipe(
        Config.withDefault('off' as const),
      )
      return RumReporting.of({ on: switched === 'on' })
    }),
  )
