import { Effect, Exit, Layer, Redacted, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { NodeHttpServer } from '@effect/platform-node'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Plugin, isPluginDescriptor } from '@qualy/plugin-kit'
import { assemble } from '@qualy/plugin-kit/assemble'
import { DatabaseEntities, Postgres } from '@qualy/plugin-database/plugin'
import { ReactUi, UiSurfaceDeclarations } from '@qualy/plugin-ui-registry/plugin'
import { Api } from '@qualy/api-kit/plugin'
import { DatabaseConfig, layer as databaseLayer } from '@qualy/plugin-database/server'
import { Ui } from '@qualy/plugin-ui-registry/server/registry'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import pingPlugin from '@qualy/plugin-ping'

// The descriptor prototype (docs/plugin-descriptor-plan.md, M1): the four
// claims the audit asked to have proven before anything is cut over. The
// host still runs the generated composition; this suite runs the same ping
// through the two-phase assembler instead.

// what the host will one day be: infrastructure as descriptors too
const databasePlugin = Plugin.define(
  '@qualy/plugin-database',
  Postgres.provider,
  // the service layer itself still rides a bare layer feature: the Orm key is
  // deliberately not exported as a value, so tag topology cannot name it yet
  Plugin.layer(databaseLayer),
)
const uiPlugin = Plugin.define('@qualy/plugin-ui-registry', ReactUi.provider)
const apiPlugin = Plugin.define('@qualy/api', Api.provider)

describe('the descriptor prototype', () => {
  it('is the whole plugin, as one default export of pure data', () => {
    // claim 1: the root default-exports a descriptor, and loading it runs
    // nothing - every feature is a value
    expect(isPluginDescriptor(pingPlugin)).toBe(true)
    expect(pingPlugin.id).toBe('@qualy/plugin-ping')
    expect(pingPlugin.features.length).toBe(3)
  })

  it('yields its entities to a reader that builds nothing', () => {
    // claim 2: the migration CLI can discover the schema from the descriptor
    // alone - no service started, no database opened
    const tuples = Plugin.contributionsOf(pingPlugin, DatabaseEntities)
    expect(tuples).toHaveLength(1)
    expect(tuples[0]!.map((entity) => entity.tableName)).toContain('ping_logs')
  })

  it('puts its page into the catalog without ever requiring Ui', () => {
    // claim 3: the page is prepare-phase data; the plugin never touches the
    // registry service. The assembler populates it before any service exists.
    const declared = Plugin.contributionsOf(pingPlugin, UiSurfaceDeclarations)
    expect(declared[0]!.pages?.[0]?.page.id).toBe('ping/page')

    // every provider rides along because completeness is enforced: ping
    // contributes tables and a group too, and a contribution nobody
    // interprets refuses the assembly by name
    const { prepared } = assemble([
      uiPlugin,
      apiPlugin,
      Plugin.define('@qualy/plugin-database', Postgres.provider),
      pingPlugin,
    ])
    // the erased boundary the plan declares: assembled layers carry any/any,
    // and the caller narrows once, to what it knows the compilation provides
    const catalog = prepared as Layer.Layer<Ui>
    const surfaces = Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(catalog)
          return yield* Effect.provideContext(
            Effect.flatMap(Ui, (ui) => ui.surfaces),
            context,
          )
        }),
      ),
    )
    expect((surfaces.pages ?? []).map((page) => page.page.id)).toEqual(['ping/page'])
  })

  it('refuses a contribution nobody interprets, naming both sides', () => {
    expect(() => assemble([pingPlugin])).toThrow(
      /@qualy\/plugin-ping contribute\(s\) to @qualy\/plugin-database\/entities, which no selected plugin provides/,
    )
  })

  it.runIf(postgresAvailable)(
    'closes the handlers above the complete service graph and serves',
    async () => {
      // claim 4: the group layer builds after every service, exactly the
      // phase order the generated host uses - but derived from descriptors
      const db = await createTestContext('descriptor-proto')
      const port = 3199
      const scope = await Effect.runPromise(Scope.make())
      try {
        const { prepared, services, above } = assemble([
          databasePlugin,
          uiPlugin,
          apiPlugin,
          pingPlugin,
        ])
        const config = Layer.succeed(
          DatabaseConfig,
          DatabaseConfig.of({
            url: Redacted.make(db.url),
            migrations: 'off',
            migrationsFolder: new URL('../../db/migrations', import.meta.url).pathname,
            poolSize: 2,
          }),
        )
        // the same erased boundary the future host will own: one narrowing
        // of the assembled composition, everything inside fully typed
        const application = HttpRouter.serve(
          above.pipe(Layer.provide(services), Layer.provide(prepared), Layer.provide(config)),
        ).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port }))) as Layer.Layer<never>
        await Effect.runPromise(Layer.buildWithScope(application, scope))

        const answer = await fetch(`http://127.0.0.1:${port}/api/ping/hello?name=descriptor`)
        expect(answer.status).toBe(200)
        expect(await answer.json()).toEqual({ msg: 'hi, descriptor' })
        const logged = await db.row<{ count: number }>(
          `select count(*)::int as count from ping_logs where name = 'descriptor'`,
        )
        expect(logged.count).toBe(1)
      } finally {
        await Effect.runPromise(Scope.close(scope, Exit.void))
        await db.dispose()
      }
    },
  )
})
