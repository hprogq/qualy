import { createServer } from 'node:http'
import { inspect } from 'node:util'
import { Effect, Exit, Layer, Scope } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/unstable/http'
import { HttpApiClient } from 'effect/unstable/httpapi'
import { HttpRouter } from 'effect/unstable/http'
import { NodeHttpServer } from '@effect/platform-node'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { accessActions } from '@qualy/plugin-rbac/actions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission } from '@qualy/rbac-contract'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { sessionCookieName, layer as sessionLayer } from '@qualy/plugin-auth/server/session'
import { AuthConfig } from '../../../base/auth/src/server/auth-config.ts'
import { hashSessionToken } from '../../../base/auth/src/session.ts'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import { permissions as formulaPermissions } from '../src/permissions.ts'
import { formulaActions } from '../src/actions.ts'
import { entities } from '../src/db/entities.ts'
import { formulaApiGroup } from '../src/api.ts'
import { formulaApiHandlers, layer as formulaLayer } from '../src/server/index.ts'
import { formulaLanguageLayer } from '../src/server/language.ts'
import { formulaLspQuotaLayer } from '../src/server/lsp-bridge.ts'

// The layer the service suite cannot see: the HttpApi wire itself. Every
// request here is the byte-for-byte shape the browser client sends - method,
// cookie, JSON payload - so a contract that encodes but will not serve, or
// serves but will not decode, fails HERE and not in a person's hands.

const port = 3205
const base = `http://127.0.0.1:${port}`

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  { owner: 'assessment-formula', permissions: formulaPermissions },
])

const closure = [
  ...orgEntities,
  ...authEntities,
  ...rbacEntities,
  ...auditEntities,
  ...entities,
] as const

let scope: Scope.Scope
let db: Awaited<ReturnType<typeof createTestContext>>
let tenantId: string
const token = 'formula-http-token'

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

const seed = Effect.fn('seed')(function* () {
  const t = one<{ id: string }>(
    yield* runSql(sql`insert into tenants (slug, name) values ('fx-http','T') returning id`),
  ).id
  const orgType = one<{ id: string }>(
    yield* runSql(sql`insert into org_types (tenant_id, name) values (${t}, 'U') returning id`),
  ).id
  const root = one<{ id: string }>(
    yield* runSql(sql`
      insert into org_nodes (tenant_id, org_type_id, name, path, depth)
      values (${t}, ${orgType}, 'Root', 'fx_http', 0) returning id`),
  ).id
  const userType = one<{ id: string }>(
    yield* runSql(sql`
      insert into user_types (tenant_id, code, name, placement_mode)
      values (${t},'staff','Staff','unrestricted') returning id`),
  ).id
  const admin = one<{ id: string }>(
    yield* runSql(sql`
      insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
      values (${t}, 'Admin', ${userType}, ${root}) returning id`),
  ).id
  const role = one<{ id: string }>(
    yield* runSql(sql`
      insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
      values (${t}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
      returning id`),
  ).id
  yield* runSql(
    sql`insert into role_grants (tenant_id, user_id, role_id) values (${t}, ${admin}, ${role})`,
  )
  yield* runSql(sql`
    insert into sessions (tenant_id, user_id, token_hash, expires_at)
    values (${t}, ${admin}, ${hashSessionToken(token)}, now() + interval '1 day')`)
  return { t, root }
})

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('formula-http')

  const infra = databaseFor(db.url, { entities: closure })
  const services = booted(
    rbacLayer.pipe(
      Layer.provideMerge(
        auditLayer.pipe(
          Layer.provide(
            Layer.succeed(
              AuditActionCatalog,
              compileActionCatalog([
                { owner: 'rbac', actions: accessActions },
                { owner: 'assessment-formula', actions: formulaActions },
              ]),
            ),
          ),
        ),
      ),
      Layer.provideMerge(Layer.mergeAll(uiLayer, infra)),
    ),
    { catalog },
  )
  const authConfig = Layer.succeed(
    AuthConfig,
    AuthConfig.of({ defaultTenantSlug: 'fx-http', sessionTtlSeconds: 3600, secureCookies: false }),
  )
  const library = Layer.mergeAll(
    formulaLayer.pipe(
      Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
      Layer.provide(formulaAuthoringLocalLayer),
    ),
    // the lsp endpoint's services: the language layer dials its socket
    // lazily, so an assembly that never opens a session never connects
    formulaLanguageLayer(),
    formulaLspQuotaLayer,
  ).pipe(Layer.provideMerge(services))
  const application = HttpRouter.serve(
    HttpApiBuilder.layer(Api.local(formulaApiGroup)).pipe(
      Layer.provide(
        formulaApiHandlers.pipe(
          Layer.provide(library),
          Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(infra, authConfig)))),
        ),
      ),
    ),
  ).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(infra),
    Layer.provide(library),
  )

  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
  const seeded = Exit.match(await Effect.runPromiseExit(Effect.provide(seed(), infra)), {
    onFailure: (cause) => {
      throw new Error(inspect(cause, { depth: 8 }))
    },
    onSuccess: (value) => value,
  })
  tenantId = seeded.t
}, 120_000)

afterAll(async () => {
  if (!postgresAvailable) return
  await Effect.runPromise(Scope.close(scope as Scope.Closeable, Exit.void))
  await db.dispose()
})

const call = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      cookie: `${sessionCookieName}=${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // some refusals are plain text; the assertions see whatever came back
  }
  return { status: response.status, body: parsed }
}

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

describe.runIf(postgresAvailable)('the formula api over http', () => {
  it('saves through the real HttpApiClient pipeline, the way the browser does', async () => {
    const created = await call('POST', '/api/assessment/formula-functions', {
      ownerNodeId: await rootNode(),
      name: 'Client pipeline',
    })
    expect(created.status, inspect(created.body)).toBe(200)
    const id = (created.body as { function: { id: string } }).function.id

    const outcome = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(Api.local(formulaApiGroup), {
          baseUrl: base,
          transformClient: HttpClient.mapRequest(
            HttpClientRequest.setHeader('cookie', `${sessionCookieName}=${token}`),
          ),
        })
        return yield* client.assessmentFormula.updateFormulaDraft({
          params: { functionId: id },
          payload: {
            expectedDraftRevision: 1,
            name: 'Client pipeline',
            draftSourceTs: IDENTITY,
            draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
          },
        })
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    )
    if (Exit.isFailure(outcome)) throw new Error(inspect(outcome.cause, { depth: 10 }))
    expect(outcome.value.function.draftRevision).toBe(2)
  }, 120_000)

  it('saves an example-less draft through the client pipeline too', async () => {
    const created = await call('POST', '/api/assessment/formula-functions', {
      ownerNodeId: await rootNode(),
      name: 'Empty examples',
    })
    expect(created.status, inspect(created.body)).toBe(200)
    const id = (created.body as { function: { id: string } }).function.id

    const outcome = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(Api.local(formulaApiGroup), {
          baseUrl: base,
          transformClient: HttpClient.mapRequest(
            HttpClientRequest.setHeader('cookie', `${sessionCookieName}=${token}`),
          ),
        })
        return yield* client.assessmentFormula.updateFormulaDraft({
          params: { functionId: id },
          payload: {
            expectedDraftRevision: 1,
            name: 'Empty examples',
            draftSourceTs: IDENTITY,
            draftTests: [],
          },
        })
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    )
    if (Exit.isFailure(outcome)) throw new Error(inspect(outcome.cause, { depth: 10 }))
    expect(outcome.value.function.draftRevision).toBe(2)
  }, 120_000)

  it('walks the browser flow: create, read, save the draft, publish', async () => {
    void tenantId
    const created = await call('POST', '/api/assessment/formula-functions', {
      ownerNodeId: await rootNode(),
      name: '认定分值',
    })
    expect(created.status, inspect(created.body)).toBe(200)
    const id = (created.body as { function: { id: string; draftRevision: number } }).function.id

    const read = await call('GET', `/api/assessment/formula-functions/${id}`)
    expect(read.status, inspect(read.body)).toBe(200)

    // the exact request the editor's save button sends
    const saved = await call('PATCH', `/api/assessment/formula-functions/${id}`, {
      expectedDraftRevision: 1,
      name: '认定分值',
      draftSourceTs: IDENTITY,
      draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
    })
    expect(saved.status, inspect(saved.body)).toBe(200)
    expect((saved.body as { function: { draftRevision: number } }).function.draftRevision).toBe(2)

    const published = await call('POST', `/api/assessment/formula-functions/${id}/versions`, {
      expectedDraftRevision: 2,
    })
    expect(published.status, inspect(published.body)).toBe(200)
    expect(
      (published.body as { version: { versionNo: number; testReport: unknown } }).version,
    ).toMatchObject({ versionNo: 1, testReport: [{ name: 'three', passed: true }] })
  }, 120_000)

  it('pages the function list with a keyset cursor: no repeats, no gaps', async () => {
    const owner = await rootNode()
    for (let index = 0; index < 12; index += 1) {
      const created = await call('POST', '/api/assessment/formula-functions', {
        ownerNodeId: owner,
        name: `Paged ${String(index).padStart(2, '0')}`,
      })
      expect(created.status, inspect(created.body)).toBe(200)
    }
    const seen: string[] = []
    let cursor: string | undefined
    for (let hops = 0; ; hops += 1) {
      expect(hops).toBeLessThan(10)
      const query =
        cursor === undefined ? 'limit=5' : `limit=5&cursor=${encodeURIComponent(cursor)}`
      const page = await call('GET', `/api/assessment/formula-functions?${query}`)
      expect(page.status, inspect(page.body)).toBe(200)
      const body = page.body as {
        items: readonly { id: string }[]
        nextCursor: string | null
      }
      seen.push(...body.items.map((row) => row.id))
      if (body.nextCursor === null) break
      // a non-null cursor promises a full page behind it
      expect(body.items.length).toBe(5)
      cursor = body.nextCursor
    }
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.length).toBeGreaterThanOrEqual(12)
  }, 120_000)
})

const rootNode = async () => {
  const found = await Effect.runPromise(
    Effect.provide(
      runSql(sql`select id from org_nodes where path = 'fx_http'`),
      databaseFor(db.url, { entities: closure }),
    ),
  )
  return one<{ id: string }>(found).id
}
