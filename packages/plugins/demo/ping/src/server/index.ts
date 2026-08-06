import { Config, Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { entityManager, kyselyOf, query, withDatabase } from '@qualy/plugin-database/server'
import { pingApiGroup } from '../api.ts'
import { entities } from '../db/entities.ts'

// The local API exists so this plugin can implement its group without
// importing the aggregate that contains it; see QUALY_API_ID. It carries the
// same prefix as the aggregate because routes are built from this one.
const local = HttpApi.make(QUALY_API_ID).add(pingApiGroup).prefix(QUALY_API_PREFIX)

const closure = [...entities] as const

export const pingApiHandlers = HttpApiBuilder.group(local, 'ping', (handlers) =>
  Effect.gen(function* () {
    // read once while the layer is built, not per request: a greeting that is
    // configured wrong should stop the assembly rather than fail requests
    const greeting = yield* Config.string('PING_GREETING').pipe(Config.withDefault('hi'))
    // taken while the group is built, so the handler carries no requirement
    const withDb = yield* withDatabase
    return handlers.handle(
      'hello',
      Effect.fn('ping.hello')(function* ({ query: request }) {
        const visitor = request.name ?? 'world'
        // the endpoint declares no failure, so a database that is down is a
        // defect: a 500 and a logged cause, not a shape the client must handle
        yield* withDb(
          Effect.gen(function* () {
            const em = yield* entityManager<typeof closure>()
            yield* query(() =>
              kyselyOf(em).insertInto('PingLog').values({ name: visitor }).execute(),
            )
          }),
        ).pipe(Effect.orDie)
        return { msg: `${greeting}, ${visitor}` }
      }),
    )
  }),
)

/**
 * What this plugin contributes beyond its API.
 *
 * Nothing, for now. The generated runtime module imports `layer` from every
 * plugin that declares a runtime entry, and a plugin that only serves requests
 * still has to say so.
 */
export const layer = Layer.empty
