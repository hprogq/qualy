import { NodeHttpClient } from '@effect/platform-node'
import { Config, ConfigProvider, Effect, Layer, Option } from 'effect'
import {
  OtlpExporter,
  OtlpMetrics,
  OtlpSerialization,
  OtlpTracer,
} from 'effect/unstable/observability'
import { resourceFromEnv } from './resource.ts'

// Telemetry for this process is Effect's own OTLP stack, not a second SDK.
//
// Every span the platform's HTTP tracer or an `Effect.fn` already creates is
// exported as-is once a tracer that exports is installed; metrics come from
// the Effect metric registry the same way. The `@opentelemetry/*` SDK family
// would buy auto-instrumentation of foreign libraries at the price of an ESM
// loader hook on Node 24 - a price to pay when a phase actually needs it,
// not before.
//
// Export is best-effort by construction: the exporter batches, retries
// transient failures, disables itself for a minute after a hard one and drops
// the buffer, and its shutdown flush is time-boxed. No business effect ever
// awaits an export. That asymmetry against the audit trail - which fails the
// transaction it could not record - is the design, not an accident.

/**
 * Where Effect's env parsing is stricter than the OTel spec, side with the
 * spec: an unset exporter variable means OTLP, not "off". Off is what an
 * unset endpoint or `OTEL_SDK_DISABLED` says. The metric interval default is
 * this deployment's choice (60s) rather than upstream's 10s; a fallback
 * provider only speaks where the environment stayed silent.
 */
const specDefaults = ConfigProvider.layerAdd(
  ConfigProvider.fromUnknown({
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_METRIC_EXPORT_INTERVAL: '60000',
  }),
)

/**
 * The whole telemetry installation as one layer for the composition root.
 *
 * With no OTLP endpoint in the environment - every `pnpm dev` that did not
 * opt in - this is a no-op that builds no HTTP client and replaces no tracer.
 * With one, it installs the exporting tracer and the metrics exporter, and
 * its scope closing is what flushes the last batch, so it must be provided
 * outside the application layer: the application drains first, telemetry
 * flushes after.
 */
export const telemetryLayer: Layer.Layer<OtlpExporter.Flusher> = Layer.unwrap(
  Effect.gen(function* () {
    const { disabled, base, traces, metrics } = yield* Config.all({
      disabled: Config.boolean('OTEL_SDK_DISABLED').pipe(Config.withDefault(false)),
      base: Config.option(Config.string('OTEL_EXPORTER_OTLP_ENDPOINT')),
      traces: Config.option(Config.string('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT')),
      metrics: Config.option(Config.string('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT')),
    })
    if (disabled || (Option.isNone(base) && Option.isNone(traces) && Option.isNone(metrics))) {
      return OtlpExporter.layerFlusher
    }
    const protocol = yield* Config.literals(
      ['http/protobuf', 'http/json', 'grpc'],
      'OTEL_EXPORTER_OTLP_PROTOCOL',
    ).pipe(Config.withDefault('http/protobuf'))
    if (protocol === 'grpc') {
      // a config refusal, not a degradation: this process only speaks
      // OTLP/HTTP, and pretending otherwise would silently drop telemetry
      return yield* Effect.die(
        new Error(
          'OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported: set http/protobuf or http/json',
        ),
      )
    }
    const resource = yield* resourceFromEnv
    return Layer.mergeAll(
      OtlpTracer.layerFromConfig({ resource }),
      OtlpMetrics.layerFromConfig({ resource }),
    ).pipe(
      Layer.provide(
        protocol === 'http/json' ? OtlpSerialization.layerJson : OtlpSerialization.layerProtobuf,
      ),
      // telemetry owns its transport; nothing else in the process is asked
      // to provide an HttpClient
      Layer.provide(NodeHttpClient.layerUndici),
    )
  }).pipe(Effect.orDie),
).pipe(Layer.provide(specDefaults))
