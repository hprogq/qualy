import { assembledBarrier, assembledLayer } from '@qualy/api-kit/assembled'
import { readinessLayer } from '@qualy/api-kit/readiness'
import { Effect, Exit, Layer, Redacted, Schema, Scope } from 'effect'
import { NodeHttpServer } from '@effect/platform-node'
import { HttpRouter } from 'effect/unstable/http'
import {
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/unstable/httpapi'
import { FetchHttpClient } from 'effect/unstable/http'
import fs from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { stillFinalizing, traceLayerLifecycle } from '@qualy/plugin-kit/shutdown-trace'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import { DatabaseConfig } from '@qualy/plugin-database/server'
import { AuthConfig } from '@qualy/plugin-auth/server/sign-in'
import { masterKeyFrom, SecretsConfig } from '@qualy/plugin-secrets/server'
import { TEST_MASTER_KEY } from '@qualy/plugin-secrets/testkit'
import { DEFAULT_LIMITS, StorageConfig } from '@qualy/plugin-storage/server'
import { LocalStorageConfig } from '@qualy/plugin-storage-local/config'
import { FormulaSettings } from '@qualy/plugin-assessment-formula/config'
import { MailConfig } from '@qualy/plugin-mail/server'
import { SmtpConfig } from '@qualy/plugin-mail-smtp/config'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { Api } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { lockPathFor, productRootFor, readLock, resolveAssembly } from '@qualy/assembly'
import { clientFor } from '@qualy/web-runtime/api'
import { loadAssembly } from '@qualy/assembly/runtime'
import { manifestPath } from '../src/manifest.ts'
import { healthApi, healthHandlers } from '../src/health.ts'

// M3: a plugin's endpoints reaching the aggregate - now the runtime one.
//
// The plugin never imports the aggregate; the assembler builds it at boot
// from the descriptors the resolution selected. The property under test is
// that the two meet at all: a group defined in one package, implemented in
// another, and served by a host that only knows the lock. The typed client
// still comes from the generated definitions, which is what proves the
// runtime aggregate serves what the static one describes.

const port = 3198
const base = `http://127.0.0.1:${port}`

const spec = `${QUALY_API_PREFIX}/openapi.json` as const

// teardown in two named, bounded stages. By the time either runs, the
// business assertions have all finished - a jam here is a shutdown defect,
// not a test failure. Each stage gets far more budget than its worst
// healthy showing (the whole file tears down in well under a second, and
// the slowest shutdown on record anywhere is the lsp bridge's ~20s), so a
// breach is a verdict, not noise: the stage is named and the run fails
// fast instead of silently eating the it's whole 120s. Both stages always
// run - a stuck scope must not also leak the scratch database - and every
// error surfaces; nothing here exists to make a hung run look green.
const TEARDOWN_STAGE_BUDGET_MS = 30_000

/**
 * The finalizer observer, installed on the scope THIS FILE owns.
 *
 * The assembler already marks every plugin layer's teardown boundary, and
 * the host installs an observer for them - but the host is `main.ts`, and
 * none of these tests run it. Each `it` here makes its own scope, builds
 * the shell into it and closes it itself, so the markers fired during that
 * close had nowhere to report to: a run that hung in `scope-close` could
 * only ever say `scope-close`, never which layer was still releasing.
 *
 * Installed here rather than at each call site because this is the single
 * seam every one of these tests already closes through, and the window that
 * matters is exactly the one it owns: the markers fire while the scope is
 * closing, and the observer is removed only once that has finished.
 */
const traceTeardown = (label: string) => {
  const at = () => new Date().toISOString().slice(11, 23)
  traceLayerLifecycle({
    finalizing: (name) => console.log(`[teardown ${label}] finalizer start ${name} at ${at()}`),
    finalized: (name, elapsedMs) =>
      console.log(`[teardown ${label}] finalizer done ${name} in ${elapsedMs}ms`),
  })
}

const teardownStaged = async (
  label: string,
  scope: Scope.Scope,
  db: { dispose: () => Promise<void> },
) => {
  const at = () => new Date().toISOString().slice(11, 23)
  const failures: unknown[] = []
  traceTeardown(label)
  const stage = async (name: string, run: () => Promise<void>) => {
    console.log(`[teardown ${label}] ${name} begins at ${at()}`)
    const started = performance.now()
    let watch: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          watch = setTimeout(
            () =>
              reject(
                new Error(
                  `effect-api teardown stuck in ${name} (${label}): no completion within ${TEARDOWN_STAGE_BUDGET_MS}ms`,
                ),
              ),
            TEARDOWN_STAGE_BUDGET_MS,
          )
        }),
      ])
      console.log(
        `[teardown ${label}] ${name} done at ${at()} in ${Math.round(performance.now() - started)}ms`,
      )
    } catch (error) {
      console.log(`[teardown ${label}] ${name} FAILED at ${at()}: ${String(error)}`)
      // the whole point of the observer: name the layers that began
      // releasing and never finished, so the next occurrence indicts one
      // plugin rather than the whole assembly
      const stuck = stillFinalizing()
      console.log(
        `[teardown ${label}] still releasing: ${stuck.length === 0 ? '(none reported)' : stuck.join(', ')}`,
      )
      failures.push(error)
    } finally {
      clearTimeout(watch)
    }
  }
  try {
    await stage('scope-close', () => Effect.runPromise(Scope.close(scope, Exit.void)))
    await stage('db-dispose', () => db.dispose())
  } finally {
    // only once the close has finished, or given up: an observer removed
    // any earlier would stop recording halfway through the window it exists
    // to describe
    traceLayerLifecycle(undefined)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `effect-api teardown failed in both stages (${label})`)
  }
}

// The production assembler over the production manifest plus the ping demo
// plugin, minus the web plugin. Ping is this suite's subject - a group
// defined in one package, implemented in another, whose handler writes
// through the host's database layer - and it has left the product's
// manifest, so the suite puts it back on a scratch copy of that manifest,
// resolved against the same host so every other plugin is exactly the
// product's. The web plugin's raw routes would mount vite, which this
// suite is not about.
const assembled = await (async () => {
  const manifest = manifestPath()
  const scratch = path.join(fs.mkdtempSync(path.join(tmpdir(), 'qualy-effect-api-')), 'qualy.yml')
  const withPing = fs
    .readFileSync(manifest, 'utf8')
    .replace(/^plugins:\n/m, "plugins:\n  '@qualy/plugin-ping': {}\n")
  if (!withPing.includes('@qualy/plugin-ping')) throw new Error('the manifest has no plugins block')
  fs.writeFileSync(scratch, withPing)
  const resolution = await resolveAssembly({
    manifestPath: scratch,
    // the scratch manifest lives in a temporary directory; its plugins are the
    // product's, so they resolve from the product's own package
    hostDir: productRootFor(manifest),
    previousLock: readLock(lockPathFor(manifest)),
  })
  resolution.runtimePlugins = resolution.runtimePlugins.filter((id) => id !== '@qualy/plugin-web')
  return loadAssembly(resolution, {
    host: [
      Plugin.define(
        '@qualy/app-test',
        Api.provider({
          documentation: Effect.succeed({
            spec,
            reference: `${QUALY_API_PREFIX}/docs`,
          }),
        }),
        Api.routesProvider,
      ),
    ],
  })
})()

const shell = (url: string) => {
  const { prepared, services, runtime, above } = assembled
  const routes = Layer.mergeAll(
    above,
    HttpApiBuilder.layer(healthApi).pipe(Layer.provide(healthHandlers)),
  )
  // one reference, as the host wires it: the runtime bindings build once for
  // the barrier and the router alike
  const runtimeGraph = runtime.pipe(Layer.provide(services), Layer.provide(prepared))
  const booted = assembledBarrier.pipe(
    Layer.provide(runtimeGraph),
    Layer.provide(services),
    Layer.provide(prepared),
  )
  return HttpRouter.serve(
    routes.pipe(Layer.provide(runtimeGraph), Layer.provide(services), Layer.provide(prepared)),
  ).pipe(
    Layer.provide(booted),
    Layer.provide(services),
    Layer.provide(prepared),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provideMerge(readinessLayer),
    Layer.provideMerge(assembledLayer),
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
        Layer.succeed(
          AuthConfig,
          AuthConfig.of({
            defaultTenantSlug: 'default',
            sessionTtlSeconds: 604_800,
            secureCookies: false,
            sessionCookieName: 'qualy_session',
          }),
        ),
        Layer.succeed(
          SecretsConfig,
          SecretsConfig.of({ masterKey: Redacted.make(masterKeyFrom(TEST_MASTER_KEY)!) }),
        ),
        // storage is assembled like everything else here; nothing in this
        // suite uploads, so the disk it would write to is a scratch directory
        Layer.succeed(
          StorageConfig,
          StorageConfig.of({ defaultBackend: 'local', limits: DEFAULT_LIMITS }),
        ),
        Layer.succeed(
          LocalStorageConfig,
          LocalStorageConfig.of({ root: path.join(tmpdir(), 'qualy-effect-api-storage') }),
        ),
        // mail is assembled too and nothing here sends any; the relay is one
        // nobody listens on
        Layer.succeed(
          MailConfig,
          MailConfig.of({ defaultBackend: 'smtp', from: 'no-reply@qualy.invalid', timeoutMs: 1_000 }),
        ),
        Layer.succeed(
          SmtpConfig,
          SmtpConfig.of({ host: '127.0.0.1', port: 1, tls: 'none', auth: undefined }),
        ),
        // the formula writer is pinned closed here on purpose: this suite's
        // subject is the api aggregate, not the rollout
        Layer.succeed(FormulaSettings, FormulaSettings.of({ authoring: false })),
      ),
    ),
  ) as unknown as Layer.Layer<never>
}

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
      await teardownStaged('effect-api', scope, db)
    }
  }, 120_000)

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
        methods: readonly { type: string; mode: string }[]
      }
      expect(methods.map((method) => method.type)).toContain('local')
      // the type IS the address: the browser finds the renderer filed under
      // `local`, and nothing here names the package that ships it
      expect(methods.find((method) => method.type === 'local')).toMatchObject({
        mode: 'component',
      })
      expect(JSON.stringify(methods)).not.toContain('auth-local')
    } finally {
      await teardownStaged('login-methods', scope, db)
    }
  }, 120_000)

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
        pages: readonly {
          id: string
          path: string
          layout: string
          title?: unknown
        }[]
        layouts: readonly { contract: string }[]
      }
      // ping's page is public, so an anonymous request sees it; a page whose
      // layout nobody implements is dropped, so this also proves the layout
      // plugin registered its own contract implementation. Its title comes
      // from the menu entry it declares, which is where a tab gets its words.
      expect(manifest.pages).toContainEqual({
        id: 'ping/page',
        path: '/ping',
        layout: 'app-shell/v1',
        title: { kind: 'message', id: 'ping/navigation/ping', defaultMessage: 'Ping' },
      })
      expect(manifest.layouts.map((layout) => layout.contract)).toContain('app-shell/v1')
    } finally {
      await teardownStaged('manifest', scope, db)
    }
  }, 120_000)

  it('is reachable through a client built from the definition alone', async () => {
    const db = await createTestContext('effect-api-client')
    const scope = await Effect.runPromise(Scope.make())
    try {
      await Effect.runPromise(Layer.buildWithScope(shell(db.url), scope))

      // what the browser does, through the same builder it uses: a client
      // derived from the plugin's own definition. baseUrl is an ORIGIN - the
      // mount lives in the definition, so every declared path is the full one.
      const { pingApiGroup } = await import('@qualy/plugin-ping/api')
      const pingApi = Api.local(pingApiGroup)
      const call = Effect.gen(function* () {
        const client = yield* clientFor(pingApi, base)
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

      // Some answers under /api are the pipeline's rather than a handler's,
      // and no endpoint declares them - so the typed client has no decoder
      // for their status and used to fall through to its own transport
      // error. The reader was then told "something went wrong" for the one
      // answer whose whole point is to say what to do next.
      const gone = await Effect.runPromise(
        Effect.flip(
          Effect.gen(function* () {
            const client = yield* clientFor(
              Api.local(
                HttpApiGroup.make('ping').add(
                  HttpApiEndpoint.get('hello', '/ping/nowhere', {
                    success: Schema.Struct({ msg: Schema.String }),
                  }),
                ),
              ),
              base,
            )
            return yield* client.ping.hello()
          }),
        ),
      )
      expect((gone as { _tag?: string })._tag).toBe('API_ROUTE_NOT_FOUND')
    } finally {
      await teardownStaged('client', scope, db)
    }
  }, 120_000)

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
          // the route exists, so any answer at all counts. An endpoint behind
          // the session middleware answers 401, which is still a route - and
          // one that looks its argument up answers 404 for an id nobody
          // minted, which is also still a route. What says a path is NOT
          // mounted is the mount's own catch-all, by its tag, so that is what
          // is read rather than the status.
          const url = path.replace(/\{[^}]+\}/g, '00000000-0000-7000-8000-000000000000')
          const response = await fetch(`${base}${url}`, { method: method.toUpperCase() })
          const unmatched =
            response.status === 404 &&
            (
              await response
                .clone()
                .text()
                .catch(() => '')
            ).includes('API_ROUTE_NOT_FOUND')
          expect(unmatched, `${method.toUpperCase()} ${path} is documented but not served`).toBe(
            false,
          )
        }
      }
      // and the probes are absent from it, as the old server guaranteed
      expect(advertised.some((path) => path.includes('/health/'))).toBe(false)
    } finally {
      await teardownStaged('parity', scope, db)
    }
  }, 120_000)
})
