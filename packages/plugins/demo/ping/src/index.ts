import { Config, Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { Db } from '@qualy/plugin-database/plugin'
import { Ui } from '@qualy/plugin-ui-registry/plugin'
import { ADMIN_SHELL, PUBLIC, defineSurfaces } from '@qualy/ui-contract'
import { withDatabase } from '@qualy/plugin-database/server'
import { pingApiGroup } from './api.ts'
import { entities } from './db/entities.ts'
import { pingNavigationLabel } from './messages.ts'
import { pingPage } from './pages.ts'

// The plugin, as one description: a table, a screen, an api group. The
// default export is the whole of it - what the descriptor assembler loads -
// and everything it references is a value, so importing this module runs
// nothing and opens nothing.

const local = Api.local(pingApiGroup)

const db = Db.scope([...entities] as const)

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
          db.query((kysely) => kysely.insertInto('PingLog').values({ name: visitor }).execute()),
        ).pipe(Effect.orDie)
        return { msg: `${greeting}, ${visitor}` }
      }),
    )
  }),
)

const plugin = Plugin.define(
  '@qualy/plugin-ping',
  { dependsOn: ['@qualy/plugin-database', '@qualy/plugin-ui-registry'] },
  Db.entities(entities),
  Ui.surfaces(surfaces),
  Api.group(pingApiGroup, handlers),
)

export default plugin
