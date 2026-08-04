import { Effect, Schema } from 'effect'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { ping } from '@qualy/plugin-database/effect'

// Liveness says the process is up. Readiness says it can take traffic.
//
// Under the static runtime these mean less than they did, and that is the
// point: the port is bound by a layer that is built after everything it
// depends on, so there is no window where the server answers while the
// database is still starting. An orchestrator sees connection refused and then
// a working instance, rather than 503 and then 200.
//
// Readiness therefore checks that the dependency is still reachable, which is
// a question about now rather than about startup.

export class NotReady extends Schema.TaggedErrorClass<NotReady>()(
  'NotReady',
  { check: Schema.String },
  { httpApiStatus: 503 },
) {}

export const healthApi = HttpApi.make('health').add(
  HttpApiGroup.make('health')
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
    ),
)

export const healthHandlers = HttpApiBuilder.group(healthApi, 'health', (handlers) =>
  handlers
    .handle('live', () => Effect.succeed({ status: 'live' as const }))
    .handle('ready', () =>
      ping().pipe(
        Effect.as({ status: 'ready' as const }),
        // why it failed belongs in the log, not in the body of an
        // unauthenticated endpoint
        Effect.tapCause((cause) => Effect.logWarning('readiness check failed', cause)),
        Effect.mapError(() => new NotReady({ check: 'database' })),
      ),
    ),
)
