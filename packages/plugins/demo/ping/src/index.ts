import { Config, Effect, Layer } from 'effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { Postgres } from '@qualy/plugin-database/plugin'
import { ReactUi } from '@qualy/plugin-ui-registry/plugin'
import { registerSurfaces, type Ui } from '@qualy/plugin-ui-registry/server/registry'
import { ADMIN_SHELL, PUBLIC, defineSurfaces } from '@qualy/ui-contract'
import { entityManager, kyselyOf, query, withDatabase } from '@qualy/plugin-database/server'
import { pingApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { pingNavigationLabel } from './messages.ts'
import { pingPage } from './pages.ts'

// The plugin, as one description: a table, a screen, an api group. The
// default export is the whole of it - what the descriptor assembler loads -
// and everything it references is a value, so importing this module runs
// nothing and opens nothing.

// The local API exists so this plugin can implement its group without
// importing the aggregate that contains it; see QUALY_API_ID. It carries the
// same prefix as the aggregate because routes are built from this one.
const local = HttpApi.make(QUALY_API_ID).add(pingApiGroup).prefix(QUALY_API_PREFIX)

const closure = [...entities] as const

const surfaces = defineSurfaces({
  pages: [
    {
      page: pingPage,
      component: 'ping/PingPage',
      layout: ADMIN_SHELL,
      // the demo endpoint is deliberately open; a real plugin would gate this
      visibility: PUBLIC,
      navigation: { label: pingNavigationLabel, order: 10 },
    },
  ],
})

const handlers = HttpApiBuilder.group(local, 'ping', (handlers) =>
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

export default Plugin.define(
  '@qualy/plugin-ping',
  Postgres.entities(entities),
  ReactUi.surfaces(surfaces),
  Api.group(pingApiGroup, handlers),
)

// Legacy bridge, until the descriptor assembler takes over the host
// (docs/plugin-descriptor-plan.md, batch 5): the generated runtime module
// still composes these two exports, built from the same values the
// descriptor carries, so the two shapes cannot drift apart.
export const apiHandlers = handlers
export const layer: Layer.Layer<never, never, Ui> = registerSurfaces(surfaces)
