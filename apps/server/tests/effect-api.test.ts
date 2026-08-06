import { readinessLayer } from '@qualy/api-kit/readiness'
import { Effect, Exit, Layer, Redacted, Scope } from 'effect'
import { NodeHttpServer } from '@effect/platform-node'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, HttpApiClient, HttpApiScalar, OpenApi } from 'effect/unstable/httpapi'
import { FetchHttpClient } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { DatabaseConfig, Entities } from '@qualy/plugin-database/server'
import { PermissionCatalog } from '@qualy/rbac-contract/effect'
import { entities } from '../entities.gen.ts'
import { pluginLayers } from '../runtime.gen.ts'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { permissionCatalog } from '../permissions.gen.ts'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { qualyApi } from '@qualy/api'
import { makeClient } from '@qualy/api-client/effect'
import { apiHandlers } from '../api-handlers.gen.ts'
import { healthApi, healthHandlers } from '../src/health.ts'

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
    // the same shape as the composition root: handlers get their services from
    // the generated plugin layers rather than from a hand-built subset, so a
    // plugin that starts requiring something is caught here too
    Layer.provide(pluginLayers),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          DatabaseConfig,
          DatabaseConfig.of({
            url: Redacted.make(url),
            migrations: 'apply',
            migrationsFolder: new URL('../../../db/migrations', import.meta.url).pathname,
          }),
        ),
        // the aggregate the host provides, for the same reason the plugin
        // layers are the generated ones: a hand-built subset would not notice
        // a plugin that started shipping entities
        readinessLayer,
        Layer.succeed(Entities, entities),
        Layer.succeed(PermissionCatalog, permissionCatalog),
        Layer.succeed(
          AuthConfig,
          AuthConfig.of({
            defaultTenantSlug: 'default',
            sessionTtlSeconds: 604_800,
            secureCookies: false,
          }),
        ),
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

  // A driver plugin's whole contribution is that it registers itself, so this
  // is the only thing that proves auth-local is in the assembly at all. It
  // went untested while a generated catalog carried the driver, because the
  // generator made it structurally true; a registration is a line of code,
  // and a line of code can be deleted.
  it('offers the login method of every driver plugin the assembly loaded', async () => {
    const db = await createTestContext('effect-api-login-methods')
    const scope = await Effect.runPromise(Scope.make())
    try {
      // a method is a provider row paired with the driver that presents it,
      // so the row has to exist before the pairing can be observed
      const tenant = await db.row<{ id: string }>(
        `insert into tenants (slug, name) values ('default','Default') returning id`,
      )
      await db.query(
        `insert into auth_providers (tenant_id, code, type, name) values ($1,'local','local','Password')`,
        [tenant.id],
      )

      await Effect.runPromise(Layer.buildWithScope(shell(db.url), scope))
      const response = await fetch(`${base}${QUALY_API_PREFIX}/auth/login-methods`)
      expect(response.status).toBe(200)
      const { methods } = (await response.json()) as {
        methods: readonly { type: string; mode: string; component?: string }[]
      }
      expect(methods.map((method) => method.type)).toContain('local')
      expect(methods.find((method) => method.type === 'local')).toMatchObject({
        mode: 'component',
        component: 'auth-local/LoginMethod',
      })
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.dispose()
    }
  })

  // Same shape as the login method above, and the same reason: a plugin's
  // screens reach the shell because its layer registers them, and a line of
  // code can be deleted. A generated catalog made this structurally true, so
  // nobody wrote it down; removing ping's registration left every test green.
  it('serves the screens of every plugin that registered any', async () => {
    const db = await createTestContext('effect-api-manifest')
    const scope = await Effect.runPromise(Scope.make())
    try {
      await Effect.runPromise(Layer.buildWithScope(shell(db.url), scope))
      const response = await fetch(`${base}${QUALY_API_PREFIX}/app/manifest`)
      expect(response.status).toBe(200)
      const manifest = (await response.json()) as {
        pages: readonly { id: string; path: string; component: string; layout: string }[]
        layouts: readonly { contract: string }[]
      }
      // ping's page is public, so an anonymous request sees it; a page whose
      // layout nobody implements is dropped, so this also proves the layout
      // plugin registered its own contract implementation
      expect(manifest.pages).toContainEqual({
        id: 'ping/page',
        path: '/ping',
        component: 'ping/PingPage',
        layout: 'admin-shell/v1',
      })
      expect(manifest.layouts.map((layout) => layout.contract)).toContain('admin-shell/v1')
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

      // what the browser does, through the same builder it uses: baseUrl is an
      // ORIGIN. The mount lives in the definition, so every declared path is
      // already the full path.
      const call = Effect.gen(function* () {
        const client = yield* makeClient(base)
        return yield* client.ping.hello({ query: { name: 'grace' } })
      })

      const result = await Effect.runPromise(call)
      expect(result).toEqual({ msg: 'hi, grace' })
      // the response is genuinely typed rather than `any`, which an assignment
      // alone would not show: reading a field the schema does not declare has
      // to be a compile error
      const msg: string = result.msg
      expect(msg).toBe('hi, grace')
      // @ts-expect-error the success schema declares msg and nothing else
      expect(result.nope).toBeUndefined()

      // The trap this encodes: passing the mount as the base asks for
      // /api/api/..., and nothing type-checks that away. It surfaced as a
      // blank page, four layers from the line that caused it.
      const doubled = await fetch(`${base}${QUALY_API_PREFIX}${QUALY_API_PREFIX}/ping/hello`)
      expect(doubled.status).toBe(404)
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
      const advertised = Object.entries(document.paths)
      expect(advertised.length).toBeGreaterThan(0)
      for (const [path, methods] of advertised) {
        expect(path.startsWith(QUALY_API_PREFIX), `${path} is outside the prefix`).toBe(true)
        for (const method of Object.keys(methods)) {
          // path templates get a plausible id: what is being checked is that
          // the route exists, so anything but 404 counts. An endpoint behind
          // the session middleware answers 401, which is still a route.
          const url = path.replace(/\{[^}]+\}/g, '00000000-0000-7000-8000-000000000000')
          const status = (await fetch(`${base}${url}`, { method: method.toUpperCase() })).status
          expect(status, `${method.toUpperCase()} ${path} is documented but not served`).not.toBe(
            404,
          )
        }
      }
      // and the probes are absent from it, as the old server guaranteed
      expect(advertised.some((path) => path.includes('/health/'))).toBe(false)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await db.dispose()
    }
  })
})
