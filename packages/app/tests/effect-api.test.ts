import { Effect, Exit, Layer, Redacted, Scope } from 'effect'
import { NodeHttpServer } from '@effect/platform-node'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiClient, HttpApiScalar, OpenApi } from 'effect/unstable/httpapi'
import { FetchHttpClient } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { DatabaseConfig, layer as databaseLayer } from '@qualy/plugin-database/effect'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { qualyApi } from '@qualy/api'
import { apiHandlers } from '../api-handlers.gen.ts'
import { healthApi, healthHandlers } from '../src/effect/health.ts'

// M3: a plugin's endpoints reaching the aggregate.
//
// The plugin never imports the aggregate, and the aggregate is generated from
// what resolution selected, so the property under test is that the two meet at
// all: a group defined in one package, implemented in another, and served by a
// third that only knows the generated list.

const port = 3198
const base = `http://127.0.0.1:${port}`

const spec = `${QUALY_API_PREFIX}/openapi.json` as const

const shell = (url: string) =>
  HttpRouter.serve(
    Layer.mergeAll(
      HttpApiBuilder.layer(qualyApi, { openapiPath: spec }).pipe(Layer.provide(apiHandlers)),
      HttpApiScalar.layer(qualyApi, { path: `${QUALY_API_PREFIX}/docs` }),
      HttpApiBuilder.layer(healthApi).pipe(Layer.provide(healthHandlers)),
    ),
  ).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(databaseLayer),
    Layer.provide(
      Layer.succeed(
        DatabaseConfig,
        DatabaseConfig.of({
          url: Redacted.make(url),
          migrations: 'apply',
          migrationsFolder: new URL('../../../db/migrations', import.meta.url).pathname,
        }),
      ),
    ),
  )

describe.runIf(postgresAvailable)('the generated api aggregate', () => {
  it('serves a plugin group at its frozen path and records the call', async () => {
    const db = await createTestContext('effect-api')
    const scope = await Effect.runPromise(Scope.make())
    try {
      await Effect.runPromise(Layer.buildWithScope(shell(db.url), scope))

      const response = await fetch(`${base}${QUALY_API_PREFIX}/ping/hello?name=ada`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ msg: 'hi, ada' })

      // the handler reached the database through the layer the host provided,
      // not one it opened itself
      const logged = await db.row<{ name: string }>(
        `select name from ping_logs order by created_at desc limit 1`,
      )
      expect(logged.name).toBe('ada')

      // the optional parameter is genuinely optional
      expect(await (await fetch(`${base}${QUALY_API_PREFIX}/ping/hello`)).json()).toEqual({
        msg: 'hi, world',
      })

      // health answers at the root, unmoved by the business prefix, because an
      // orchestrator probes a fixed path
      expect((await fetch(`${base}/health/live`)).status).toBe(200)
      expect((await fetch(`${base}${QUALY_API_PREFIX}/health/live`)).status).toBe(404)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.dispose()
    }
  })

  it('is reachable through a client built from the definition alone', async () => {
    const db = await createTestContext('effect-api-client')
    const scope = await Effect.runPromise(Scope.make())
    try {
      await Effect.runPromise(Layer.buildWithScope(shell(db.url), scope))

      // what the browser will do: build from qualyApi, which carries no
      // handler and no server dependency
      const call = Effect.gen(function* () {
        const client = yield* HttpApiClient.make(qualyApi, { baseUrl: base })
        return yield* client.ping.hello({ query: { name: 'grace' } })
      }).pipe(Effect.provide(FetchHttpClient.layer))

      const result = await Effect.runPromise(call)
      expect(result).toEqual({ msg: 'hi, grace' })
      // the response is genuinely typed rather than `any`, which an assignment
      // alone would not show: reading a field the schema does not declare has
      // to be a compile error
      const msg: string = result.msg
      expect(msg).toBe('hi, grace')
      // @ts-expect-error the success schema declares msg and nothing else
      expect(result.nope).toBeUndefined()
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.dispose()
    }
  })

  it('serves exactly the paths its document advertises', async () => {
    // the prefix has to be applied to the plugin's local api and to the
    // aggregate, because routes come from the first and the document from the
    // second. Nothing in the type system relates them, so a plugin that forgot
    // would serve a path the document does not mention and the client would
    // 404 against a route that looks correct.
    const db = await createTestContext('effect-api-parity')
    const scope = await Effect.runPromise(Scope.make())
    try {
      await Effect.runPromise(Layer.buildWithScope(shell(db.url), scope))
      const document = (await (await fetch(`${base}${spec}`)).json()) as {
        paths: Record<string, Record<string, unknown>>
      }
      const advertised = Object.keys(document.paths)
      expect(advertised.length).toBeGreaterThan(0)
      for (const path of advertised) {
        expect(path.startsWith(QUALY_API_PREFIX), `${path} is outside the prefix`).toBe(true)
        // a GET the document promises must not 404
        const status = (await fetch(`${base}${path}`)).status
        expect(status, `${path} is documented but not served`).not.toBe(404)
      }
      // and the probes are absent from it, as the old server guaranteed
      expect(advertised.some((path) => path.includes('/health/'))).toBe(false)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.dispose()
    }
  })
})
