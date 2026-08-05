import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiScalar } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { spikeApi, systemHandlers, tenantHandlers } from '../src/api.ts'
import { databaseLayer } from '../src/index.ts'

// M1b, the runtime shell property: one scope owns the HTTP server and the
// database pool, and closing it closes both.
//
// This is what ADR 0002's runtime rests on. Under cordis the two were released
// by separate disposers registered by separate plugins, and the order between
// them was a property of the manifest. Here it is a property of one scope, so
// a graceful shutdown is a single close rather than a cascade nobody wrote
// down.

const port = 3199
const base = `http://127.0.0.1:${port}`

describe.runIf(postgresAvailable).concurrent('one scope owns the server and the pool', () => {
  it('serves the api, its openapi document and its docs, then closes both on one signal', async () => {
    const db = await createTestContext('effect-spike-runtime')
    const connections = async () =>
      (
        await db.row<{ count: number }>(
          `select count(*)::int as count from pg_stat_activity where datname = current_database()`,
        )
      ).count
    const status = async (path: string) => {
      try {
        return (await fetch(`${base}${path}`)).status
      } catch {
        return 0
      }
    }

    try {
      await db.query(`insert into tenants (slug, name) values ('one', 'One'), ('two', 'Two')`)
      const baseline = await connections()

      // the whole application as one layer, wired the way the upstream
      // walkthrough wires it
      const routes = Layer.mergeAll(
        HttpApiBuilder.layer(spikeApi, { openapiPath: '/openapi.json' }).pipe(
          Layer.provide([tenantHandlers, systemHandlers]),
        ),
        HttpApiScalar.layer(spikeApi, { path: '/docs' }),
      )
      const application = HttpRouter.serve(routes).pipe(
        Layer.provide(NodeHttpServer.layer(createServer, { port })),
      )

      const scope = await Effect.runPromise(Scope.make())
      await Effect.runPromise(
        Layer.buildWithScope(Layer.provide(application, databaseLayer(db.url)), scope),
      )

      // the database-backed endpoint really reached postgres, which is what
      // makes the shutdown assertion below about something real
      const counted = await (await fetch(`${base}/tenants-count`)).json()
      expect(counted).toEqual({ tenants: 2 })

      // a declared business error arrives with the status its schema annotated
      expect(await status('/tenants/missing')).toBe(404)
      expect(await status('/tenants/default')).toBe(200)

      // one definition, three products: the API, its document and its docs
      expect(await status('/openapi.json')).toBe(200)
      expect(await status('/docs')).toBe(200)

      expect(await connections()).toBeGreaterThan(baseline)

      // one close, both gone. Asserting only the port would miss a leaked
      // pool, which is the failure that actually costs something.
      await Effect.runPromise(Scope.close(scope, Exit.void))

      expect(await status('/tenants-count')).toBe(0)
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
})
