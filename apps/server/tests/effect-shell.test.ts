import { Effect, Exit, Layer, Redacted, Scope } from 'effect'
import { NodeHttpServer } from '@effect/platform-node'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { DatabaseConfig, MigrationsBehind, layer as databaseLayer } from '@qualy/plugin-database/server'
import { healthApi, healthHandlers } from '../src/health.ts'

// M2: the application shell, assembled the way main.ts assembles it.
//
// The interesting properties are not "it responds". They are that the port
// does not exist until everything it depends on is built, that one close
// releases the server and the pool together, and that a database behind its
// lineage stops the assembly instead of being served.

const port = 3197
const base = `http://127.0.0.1:${port}`

const configLayer = (url: string, migrations: 'apply' | 'off') =>
  Layer.succeed(
    DatabaseConfig,
    DatabaseConfig.of({
      url: Redacted.make(url),
      migrations,
      migrationsFolder: new URL('../../../db/migrations', import.meta.url).pathname,
    }),
  )

const shell = (url: string, migrations: 'apply' | 'off' = 'apply') =>
  HttpRouter.serve(
    Layer.mergeAll(
      HttpApiBuilder.layer(healthApi, { openapiPath: '/openapi.json' }).pipe(
        Layer.provide(healthHandlers),
      ),
      HttpApiScalar.layer(healthApi, { path: '/docs' }),
    ),
  ).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(databaseLayer),
    Layer.provide(configLayer(url, migrations)),
  )

const status = async (path: string) => {
  try {
    return (await fetch(`${base}${path}`)).status
  } catch {
    return 0
  }
}

describe.runIf(postgresAvailable).concurrent('effect application shell', () => {
  it('binds the port only after the database is ready, and releases both together', async () => {
    const db = await createTestContext('effect-shell')
    const connections = async () =>
      (
        await db.row<{ count: number }>(
          `select count(*)::int as count from pg_stat_activity where datname = current_database()`,
        )
      ).count
    try {
      const baseline = await connections()
      // nothing is listening before the layer is built, which is the property
      // that replaces "first readiness must be pending": there is no window in
      // which the server answers for an assembly that is not finished
      expect(await status('/health/live')).toBe(0)

      const scope = await Effect.runPromise(Scope.make())
      await Effect.runPromise(Layer.buildWithScope(shell(db.url), scope))

      expect(await status('/health/live')).toBe(200)
      expect(await status('/health/ready')).toBe(200)
      expect(await status('/openapi.json')).toBe(200)
      expect(await status('/docs')).toBe(200)
      expect(await connections()).toBeGreaterThan(baseline)

      await Effect.runPromise(Scope.close(scope, Exit.void))

      expect(await status('/health/live')).toBe(0)
      let settled = await connections()
      for (let attempt = 0; attempt < 50 && settled > baseline; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        settled = await connections()
      }
      expect(settled).toBe(baseline)
    } finally {
      await db.dispose()
    }
  })

  it('refuses to assemble against a database behind its lineage', async () => {
    // 'off' leaves the lineage to a deployment job. An instance that comes up
    // anyway would serve a schema a version behind and fail later as missing
    // columns, far from the cause.
    // migrated normally, then the ledger is emptied: the schema is whatever it
    // is, but the database no longer claims to have run the lineage, which is
    // exactly what a deployment that forgot the migration job looks like
    const db = await createTestContext('effect-shell-behind')
    try {
      await db.query(`delete from cordis_meta.schema_migrations`)
      const exit = await Effect.runPromiseExit(
        Effect.scoped(Layer.build(shell(db.url, 'off'))),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      const reason = (exit as Extract<typeof exit, { _tag: 'Failure' }>).cause.reasons[0]
      expect((reason as { error?: unknown }).error).toBeInstanceOf(MigrationsBehind)
      // and nothing is listening, because the failure happened before the
      // server layer was ever built
      expect(await status('/health/live')).toBe(0)
    } finally {
      await db.dispose()
    }
  })
})
