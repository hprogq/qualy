import { Effect, Schema } from 'effect'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { QUALY_API_ID } from '@qualy/api-kit'
import { Readiness } from '@qualy/api-kit/readiness'

// Liveness says the process is up. Readiness says it can take traffic.
//
// Under the static runtime these mean less than they did, and that is the
// point: the port is bound by a layer that is built after everything it
// depends on, so there is no window where the server answers while the
// database is still starting. An orchestrator sees connection refused and then
// a working instance, rather than 503 and then 200.
//
// Readiness therefore checks that the dependencies are still reachable, which
// is a question about now rather than about startup - and it asks whatever
// registered a probe rather than a plugin this file names. An assembly with
// nothing to probe is ready, which is the only honest answer: ready has never
// claimed the assembly is complete, only that what is loaded is healthy.

export class NotReady extends Schema.TaggedError<NotReady>()(
  'NotReady',
  { check: Schema.String },
  { httpApiStatus: 503, identifier: 'NotReady' },
) {}

export const healthApiGroup = HttpApiGroup.make('health')
  .add(
    HttpApiEndpoint.get('live', '/health/live', {
      success: Schema.Struct({ status: Schema.Literal('live') }),
    }),
  )
  .add(
    HttpApiEndpoint.get('ready', '/health/ready', {
      success: Schema.Struct({ status: Schema.Literal('ready') }),
      error: NotReady,
    }),
  )

// built under the shared api id like any plugin's group, but deliberately not
// prefixed: an orchestrator probes a fixed path that does not move with the
// business API, and these stay out of the generated document
export const healthApi = HttpApi.make(QUALY_API_ID).add(healthApiGroup)

export const healthHandlers = HttpApiBuilder.group(healthApi, 'health', (handlers) =>
  Effect.gen(function* () {
    const readiness = yield* Readiness
    return handlers
      .handle('live', () => Effect.succeed({ status: 'live' as const }))
      .handle(
        'ready',
        Effect.fn('health.ready')(function* () {
          // read per request rather than closed over: what is registered is a
          // fact about the assembly that was built, and reading it here is
          // what keeps this handler from naming a single plugin
          for (const check of yield* readiness.checks) {
            yield* check.probe.pipe(
              // why it failed belongs in the log, not in the body of an
              // unauthenticated endpoint
              Effect.tapCause((cause) =>
                Effect.logWarning(`readiness check ${check.name} failed`, cause),
              ),
              Effect.mapError(() => new NotReady({ check: check.name })),
            )
          }
          return { status: 'ready' as const }
        }),
      )
  }),
)
