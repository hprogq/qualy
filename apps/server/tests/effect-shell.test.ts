import { Effect, Exit, Layer, Scope } from 'effect'
import { NodeHttpServer } from '@effect/platform-node'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { createServer, get as httpGet } from 'node:http'
import { describe, expect, it } from 'vitest'
import { readinessLayer } from '@qualy/api-kit/readiness'
import { createTestContext, databaseFor, postgresAvailable } from '@qualy/plugin-database/testkit'
import { MigrationsBehind } from '@qualy/plugin-database/server'
import { healthApi, healthHandlers } from '../src/health.ts'

// M2: the application shell, assembled the way main.ts assembles it.
//
// The interesting properties are not "it responds". They are that the port
// does not exist until everything it depends on is built, that one close
// releases the server and the pool together, and that a database behind its
// lineage stops the assembly instead of being served.

const port = 3197
// its own, because suites are separate files and files run in parallel
const barePort = 3196
const base = `http://127.0.0.1:${port}`

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
    // the registry the database plugin offers its probe to, and the health
    // handler reads: provided under the database so the plugin can find it
    Layer.provide(databaseFor(url, { migrations }).pipe(Layer.provide(readinessLayer))),
    Layer.provideMerge(readinessLayer),
  )

/**
 * One request over one connection, closed with the response.
 *
 * Deliberately not fetch: undici keeps its sockets alive between calls, and
 * a kept-alive socket is exactly what lets a "closed" server answer one more
 * request - or lets its close linger - depending on load. These cases assert
 * on the closed port, so every probe must leave nothing behind.
 */
const probe = (url: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve) => {
    const request = httpGet(url, { agent: false }, (response) => {
      let body = ''
      response.on('data', (chunk: unknown) => {
        body += String(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
    request.on('error', () => resolve({ status: 0, body: '' }))
  })

const status = async (path: string) => (await probe(`${base}${path}`)).status

// Not concurrent: both cases assert on one port, and one of them asserts that
// nothing is listening on it. Running them together had the second read the
// first one's server and see 200 where it required a closed port - which only
// showed up in a full run, because a single-file run schedules them apart.
// Readiness with nothing to probe, which is the assembly this repository does
// not ship but the design promises: no database plugin, no probe, and a
// working endpoint. Before the registry the handler imported the database
// plugin directly, so this composition could not be built at all - not a
// missing test, a missing possibility.
describe('readiness without anything to probe', () => {
  const bare = HttpRouter.serve(
    HttpApiBuilder.layer(healthApi).pipe(Layer.provide(healthHandlers)),
  ).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port: barePort })),
    Layer.provideMerge(readinessLayer),
  )

  it('answers ready, because ready has never claimed the assembly is complete', async () => {
    const scope = await Effect.runPromise(Scope.make())
    try {
      await Effect.runPromise(Layer.buildWithScope(bare, scope))
      const response = await probe(`http://127.0.0.1:${barePort}/health/ready`)
      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ status: 'ready' })
      expect((await probe(`http://127.0.0.1:${barePort}/health/live`)).status).toBe(200)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
})

describe.runIf(postgresAvailable)('effect application shell', () => {
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
      await db.query(`delete from mikro_orm_migrations`)
      const exit = await Effect.runPromiseExit(Effect.scoped(Layer.build(shell(db.url, 'off'))))
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
