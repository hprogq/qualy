import { Config, Effect, Layer, Option, Schema, Context } from 'effect'
import { RUM_ENVIRONMENTS, type TencentRumServerConfig } from '../settings.ts'
import { decodePluginConfig } from '@qualy/plugin-kit/config'

// Which reporting project this deployment writes to.
//
// Public, all of it, but a deployment's fact rather than the product's - which
// is why it is read here and served rather than built into the bundle.
//
// Whether the project has to be named is the reporting switch's question
// (@qualy/plugin-rum, QUALY_RUM_REPORTING), so the id is recorded as present
// or missing here and the registration decides: with reporting on, a missing
// id refuses to start rather than report nowhere - the failure that is only
// noticed when somebody goes looking for an incident nobody recorded. The
// environment name and the sample rate are refused when malformed either way.

/** this deployment's reporting settings, or why it cannot report */
export type TencentRumConfiguration =
  | { readonly settings: TencentRumServerConfig }
  | { readonly refusal: string }

export class TencentRumConfig extends Context.Service<TencentRumConfig, TencentRumConfiguration>()(
  '@qualy/plugin-rum-tencent/TencentRumConfig',
) {}

export const TENCENT_RUM_ID_MISSING =
  'QUALY_RUM_TENCENT_ID must be set while QUALY_RUM_REPORTING is on; it is the browser reporting id, not the project id'

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
    ? Config.String(name)
    : Config.String(name).pipe(Config.withDefault(declared))

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<TencentRumConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    TencentRumConfig,
    Effect.gen(function* () {
      const declared = yield* decodePluginConfig(TencentRumManifestConfig, manifest)
      const id = yield* Config.option(stringOr('QUALY_RUM_TENCENT_ID', declared.id))
      const environment = yield* Config.Literals(RUM_ENVIRONMENTS, 'QUALY_RUM_TENCENT_ENV').pipe(
        Config.withDefault(declared.environment ?? 'production'),
      )
      const rate = yield* Config.Number('QUALY_RUM_TENCENT_SAMPLE_RATE').pipe(
        Config.withDefault(declared.sampleRate ?? 1),
      )
      const sampleRate = yield* Schema.decodeUnknownEffect(SampleRate)(rate)
      if (Option.isNone(id)) return TencentRumConfig.of({ refusal: TENCENT_RUM_ID_MISSING })
      return TencentRumConfig.of({ settings: { id: id.value, environment, sampleRate } })
    }),
  )
