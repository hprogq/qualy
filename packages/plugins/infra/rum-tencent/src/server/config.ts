import { Config, Effect, Layer, Schema, Context } from 'effect'
import { RUM_ENVIRONMENTS, type TencentRumPublicConfig } from '../settings.ts'

// Which reporting project this deployment writes to.
//
// Public, all of it, but a deployment's fact rather than the product's - which
// is why it is read here and served rather than built into the bundle.
//
// Enabling the plugin without naming a project is a configuration error, not a
// reason to degrade: an operator who installed it meant to report, and a
// process that came up quietly reporting nowhere is the failure that is only
// noticed when somebody goes looking for an incident nobody recorded.

export class TencentRumConfig extends Context.Service<TencentRumConfig, TencentRumPublicConfig>()(
  '@qualy/plugin-rum-tencent/TencentRumConfig',
) {}

export const TencentRumManifestConfig = Schema.Struct({
  id: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.Literals(RUM_ENVIRONMENTS)),
  sampleRate: Schema.optional(Schema.Number),
})
export type TencentRumManifestConfig = typeof TencentRumManifestConfig.Type

/**
 * A share of the traffic, or all of it.
 *
 * Refused rather than clamped when it is out of range. Clamping up would
 * report everything from a deployment that asked for a tenth, and clamping
 * down would silently drop failures; both are answers to a typo that nobody
 * would ever see.
 */
const SampleRate = Schema.Number.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(1),
  Schema.isFinite(),
)

/** the environment may name it; the manifest is the fallback, not the reverse */
const stringOr = (name: string, declared: string | undefined) =>
  declared === undefined
    ? Config.string(name)
    : Config.string(name).pipe(Config.withDefault(declared))

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<TencentRumConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    TencentRumConfig,
    Effect.gen(function* () {
      const declared = yield* Schema.decodeUnknownEffect(TencentRumManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
      const id = yield* stringOr('QUALY_RUM_TENCENT_ID', declared.id)
      const environment = yield* Config.literals(RUM_ENVIRONMENTS, 'QUALY_RUM_TENCENT_ENV').pipe(
        Config.withDefault(declared.environment ?? 'production'),
      )
      const rate = yield* Config.number('QUALY_RUM_TENCENT_SAMPLE_RATE').pipe(
        Config.withDefault(declared.sampleRate ?? 1),
      )
      const sampleRate = yield* Schema.decodeUnknownEffect(SampleRate)(rate)
      return TencentRumConfig.of({ id, environment, sampleRate })
    }),
  )
