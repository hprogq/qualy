import { createServer } from 'node:http'
import { inspect } from 'node:util'
import { Deferred, Effect, Exit, Layer, Scope } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import { HttpRouter } from 'effect/http'
import { NodeHttpServer } from '@effect/platform-node'
import { HttpApiBuilder } from 'effect/http-api'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { Api } from '@qualy/api-kit/local'
import { uiLayer } from '@qualy/plugin-ui-registry/server/registry'
import { Access, serviceLayer as rbacLayer } from '@qualy/plugin-rbac/server'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { permissions as rbacPermissions } from '@qualy/plugin-rbac/permissions'
import { accessActions } from '@qualy/plugin-rbac/actions'
import { booted } from '@qualy/rbac-contract/testkit'
import { compileCatalog } from '@qualy/rbac-contract/plugin'
import type { ActivePermission } from '@qualy/rbac-contract'
import { Rbac } from '@qualy/rbac-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { entities as rbacEntities } from '@qualy/plugin-rbac/db'
import { entities as auditEntities } from '@qualy/plugin-audit/db'
import { sessionCookieName } from '@qualy/auth-contract/session'
import { layer as sessionLayer } from '@qualy/plugin-auth/server/session'
import { AuthConfig } from '../../../base/auth/src/server/auth-config.ts'
import { hashSessionToken } from '../../../base/auth/src/session.ts'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import { permissions as formulaPermissions } from '../src/permissions.ts'
import { permissions as assessmentPermissions } from '@qualy/plugin-assessment/permissions'
import { formulaActions } from '../src/actions.ts'
import { entities as assessmentEntities } from '@qualy/plugin-assessment/db'
import { entities as storageEntities } from '@qualy/plugin-storage/db'
import { entities } from '../src/db/entities.ts'
import { formulaApiGroup } from '../src/api.ts'
import { formulaApiHandlers, layer as formulaLayer } from '../src/server/index.ts'
import { configurationAccessLayer } from '@qualy/plugin-assessment/server/configuration-access'
import { scoringAuthoringAccessLayer } from '@qualy/plugin-assessment/server/scoring-authoring-access'
import { bindingCatalogLayer } from '../src/server/binding-catalog.ts'
import { FormulaTemplateLibrary, templateLibraryLayer } from '../src/server/template-library.ts'
import { UserPlacement } from '@qualy/auth-contract'
import { formulaLanguageLayer } from '../src/server/language.ts'
import { formulaLspQuotaLayer } from '../src/server/lsp-bridge.ts'
import { FormulaSettings } from '../src/server/config.ts'
import { scoringBudgetLayer } from '../src/scoring/budget.ts'
import { seedFormulaFixture, servicesFor } from './support/stack.ts'
import { publishedVersion } from './support/versions.ts'

// The layer the service suite cannot see: the HttpApi wire itself. Every
// request here is the byte-for-byte shape the browser client sends - method,
// cookie, JSON payload - so a contract that encodes but will not serve, or
// serves but will not decode, fails HERE and not in a person's hands.

const port = 3205
const base = `http://127.0.0.1:${port}`
// the same library served with the writer closed
const closedPort = 3207
const closedBase = `http://127.0.0.1:${closedPort}`

const catalog: readonly ActivePermission[] = compileCatalog([
  { owner: 'rbac', permissions: rbacPermissions },
  // the binding-options endpoint asks the ROUND's permission before its own
  { owner: 'assessment', permissions: assessmentPermissions },
  { owner: 'assessment-formula', permissions: formulaPermissions },
])

const closure = [
  // the binding-options endpoint reads a batch's own tables through the
  // assessment access faces, so this suite's database has to have them
  ...storageEntities,
  ...assessmentEntities,
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

let copyGate:
  | {
      readonly copied: Deferred.Deferred<{ readonly functionId: string }>
      readonly release: Deferred.Deferred<void>
    }
  | undefined

// Pause the real service at its return boundary so the HTTP response's
// subsequent projection must face the same concurrent authority change.
const controlledTemplates = Layer.effect(
  FormulaTemplateLibrary,
  Effect.gen(function* () {
    const templates = yield* FormulaTemplateLibrary
    return {
      ...templates,
      copyTemplate: (...args: Parameters<typeof templates.copyTemplate>) =>
        Effect.gen(function* () {
          const gate = copyGate
          const copied = yield* templates.copyTemplate(...args)
          if (gate !== undefined) {
            yield* Deferred.succeed(gate.copied, copied)
            yield* Deferred.await(gate.release)
          }
          return copied
        }),
    }
  }),
).pipe(Layer.provide(templateLibraryLayer))

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
  // a session names the door it came in through
  const door = (
    (yield* runSql(sql`
      insert into auth_providers (tenant_id, code, type, name, is_system)
      values (${t}, 'local', 'local', 'Local', true) returning id`)) as unknown as {
      rows: { id: string }[]
    }
  ).rows[0]!.id
  yield* runSql(sql`
    insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
    values (${t}, ${admin}, ${door}, ${hashSessionToken(token)}, now() + interval '1 day')`)
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
    AuthConfig.of({
      defaultTenantSlug: 'fx-http',
      sessionTtlSeconds: 3600,
      secureCookies: false,
      sessionCookieName: 'qualy_session',
    }),
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
    // the binding-options endpoint's: the batch's own access faces, and the
    // catalog that reads what a round may newly bind
    configurationAccessLayer,
    scoringAuthoringAccessLayer,
    bindingCatalogLayer.pipe(Layer.provide(configurationAccessLayer)),
    controlledTemplates,
    // Template copy reads the actor's placement from the database. The
    // library-list surface that needs this port is covered in its own suite.
    Layer.succeed(UserPlacement, { primaryNode: () => Effect.succeed(null) }),
  ).pipe(Layer.provideMerge(services), Layer.provideMerge(scoringBudgetLayer))
  // two servers over the same library and database, apart only in what the
  // manifest says about the writer: the main one has it open, as every
  // authoring bearing here assumes, and the second has it closed
  const serving = (at: number, authoring: boolean) => {
    const settings = Layer.succeed(FormulaSettings, FormulaSettings.of({ authoring }))
    return HttpRouter.serve(
      HttpApiBuilder.layer(Api.local(formulaApiGroup)).pipe(
        Layer.provide(
          formulaApiHandlers.pipe(
            Layer.provide(library),
            Layer.provide(settings),
            Layer.provide(sessionLayer.pipe(Layer.provide(Layer.mergeAll(infra, authConfig)))),
          ),
        ),
      ),
    ).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port: at })),
      Layer.provide(infra),
      Layer.provide(library),
      Layer.provide(settings),
    )
  }

  scope = await Effect.runPromise(Scope.make())
  // built apart, not merged: each server declares the whole api on a router
  // of its own, and one router refuses a route declared twice
  await Effect.runPromise(Layer.buildWithScope(serving(port, true), scope))
  await Effect.runPromise(Layer.buildWithScope(serving(closedPort, false), scope))
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

const callAt = async (
  origin: string,
  method: string,
  path: string,
  body?: unknown,
  sessionToken = token,
) => {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      cookie: `${sessionCookieName}=${sessionToken}`,
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

const call = (method: string, path: string, body?: unknown) => callAt(base, method, path, body)

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2, title: '分值' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

describe.runIf(postgresAvailable)('the formula api over http', () => {
  it('finishes a copied template response before a queued author revocation takes effect', async () => {
    const services = servicesFor(db.url)
    const sessionToken = 'formula-copy-response-token'
    const fixture = await Effect.runPromise(
      Effect.gen(function* () {
        const f = yield* seedFormulaFixture('formula-copy-response')
        const published = yield* publishedVersion(f.t, f.authorA, 'Offered template')
        yield* runSql(sql`
          insert into assessment_formula_share_scopes (tenant_id, version_id, org_node_id, shared_by)
          values (${f.t}, ${published.versionId}, ${f.root}, ${f.authorA})`)
        const providerId = one<{ id: string }>(
          yield* runSql(sql`
          insert into auth_providers (tenant_id, code, type, name)
          values (${f.t}, 'local', 'local', 'Local') returning id`),
        ).id
        yield* runSql(sql`
          insert into sessions (tenant_id, user_id, auth_provider_id, token_hash, expires_at)
          values (${f.t}, ${f.authorB}, ${providerId}, ${hashSessionToken(sessionToken)}, now() + interval '1 day')`)
        const grantId = one<{ id: string }>(
          yield* runSql(sql`
          select id from role_grants where tenant_id = ${f.t} and user_id = ${f.authorB}`),
        ).id
        return { f, published, grantId }
      }).pipe(Effect.provide(services)),
    )
    const gate = {
      copied: await Effect.runPromise(Deferred.make<{ readonly functionId: string }>()),
      release: await Effect.runPromise(Deferred.make<void>()),
    }
    copyGate = gate
    const copying = callAt(
      base,
      'POST',
      `/api/assessment/formula-templates/${fixture.published.versionId}/copies`,
      { name: 'Copied before revocation' },
      sessionToken,
    )
    let revoking: Promise<void> | undefined
    let revoked = false
    let queued = false
    let copied: { readonly functionId: string }
    try {
      copied = await Promise.race([
        Effect.runPromise(Deferred.await(gate.copied)),
        copying.then((response) => {
          throw new Error(
            `copy ended before its gate: ${response.status} ${inspect(response.body)}`,
          )
        }),
      ])
      revoking = Effect.runPromise(
        Effect.gen(function* () {
          const access = yield* Access
          const rbac = yield* Rbac
          yield* access.grants.revoke(
            fixture.f.t,
            fixture.grantId,
            fixture.f.principal(fixture.f.admin),
            (tenantId) => rbac.assertTenantKeepsAdministrator(tenantId),
          )
        }).pipe(Effect.provide(services)),
      ).then(() => {
        revoked = true
      })
      await vi.waitFor(
        async () => {
          const waiting = await db.row<{ waiting: boolean }>(`
          select exists (select 1 from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid()
              and wait_event_type = 'Lock' and query ilike '%for update%') as waiting`)
          queued = waiting.waiting
          // The old handler lets revocation finish here. Observe that too so
          // its HTTP 500 is asserted instead of hanging on a missing lock.
          expect(queued || revoked).toBe(true)
        },
        { timeout: 5_000 },
      )
    } finally {
      await Effect.runPromise(Deferred.succeed(gate.release, undefined))
      copyGate = undefined
    }
    const response = await copying
    await revoking
    expect(response.status, inspect(response.body)).toBe(200)
    expect(queued, 'revocation must wait until the copy response projection finishes').toBe(true)
    expect(response.body).toMatchObject({ function: { id: copied.functionId } })
    const saved = await db.query<{ id: string }>(
      `
      select id from assessment_formula_functions where tenant_id = $1 and created_by = $2`,
      [fixture.f.t, fixture.f.authorB],
    )
    expect(saved.rows).toEqual([{ id: copied.functionId }])
    const later = await callAt(
      base,
      'GET',
      `/api/assessment/formula-functions/${copied.functionId}`,
      undefined,
      sessionToken,
    )
    expect(later.status).toBe(403)
  }, 120_000)

  it('refuses a malformed identifier instead of letting postgres refuse it', async () => {
    // Every identifier in this contract addresses a uuid column. Accepting
    // any short string meant a malformed one travelled to the database,
    // which rejects it as a syntax error - a defect, answered 500, for a
    // request that merely names something that cannot exist.
    const read = await call('GET', '/api/assessment/formula-functions/not-a-uuid')
    expect(read.status).toBeLessThan(500)
    const listed = await call('GET', '/api/assessment/formula-functions/%20/versions')
    expect(listed.status).toBeLessThan(500)
  })

  it('refuses a version or revision number past what its column can hold', async () => {
    // the columns are int4: a number past them is not "no such version" but
    // a database error, which answered 500
    const created = await call('POST', '/api/assessment/formula-functions', {
      name: 'Out of range',
    })
    const id = (created.body as { function: { id: string } }).function.id
    for (const path of [
      `/api/assessment/formula-functions/${id}/versions/3000000000`,
      `/api/assessment/formula-functions/${id}/versions/3000000000/sharing`,
      `/api/assessment/formula-functions/${id}/draft/revisions/3000000000`,
    ]) {
      expect((await call('GET', path)).status, path).toBe(400)
    }
  })

  it('saves through the real HttpApiClient pipeline, the way the browser does', async () => {
    const created = await call('POST', '/api/assessment/formula-functions', {
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
      releaseName: '2026 秋季正式规则',
    })
    expect(published.status, inspect(published.body)).toBe(200)
    expect(
      (published.body as { version: { versionNo: number; testReport: unknown } }).version,
    ).toMatchObject({ versionNo: 1, testReport: [{ name: 'three', passed: true }] })
  }, 120_000)

  it('previews and evaluates the current buffer without touching the draft', async () => {
    const created = await call('POST', '/api/assessment/formula-functions', {
      name: 'Draft tools',
    })
    expect(created.status, inspect(created.body)).toBe(200)
    const id = (created.body as { function: { id: string } }).function.id

    const ANNOTATED = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    level: Schema.choice({ national: '国家级', provincial: '省级' }, { title: '赛事级别' }),
    base: Schema.decimal({ maxScale: 2, minimum: '0', maximum: '10', title: '基础分' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input, q) => (input.level === 'national' ? q.decimal.mulInteger(input.base, 2) : input.base),
})
`
    // the preview speaks about the SENT buffer, not the persisted draft
    const preview = await call('POST', `/api/assessment/formula-functions/${id}/draft/preview`, {
      sourceTs: ANNOTATED,
    })
    expect(preview.status, inspect(preview.body)).toBe(200)
    const previewBody = preview.body as {
      sourceSha256: string
      contractSha256: string
      inputSchema: {
        properties: Record<string, { title?: string }>
        'x-qualy-order'?: readonly string[]
      }
    }
    expect(previewBody.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(previewBody.inputSchema['x-qualy-order']).toEqual(['level', 'base'])
    expect(previewBody.inputSchema.properties['level']?.title).toBe('赛事级别')

    // and the draft on the server is untouched by any of this
    const read = await call('GET', `/api/assessment/formula-functions/${id}`)
    expect((read.body as { function: { draftRevision: number } }).function.draftRevision).toBe(1)

    // one evaluator, three moods: a try-run without expectation, a passing
    // regression, a failing one - plus an input the contract refuses
    const evaluated = await call(
      'POST',
      `/api/assessment/formula-functions/${id}/draft/evaluation`,
      {
        sourceTs: ANNOTATED,
        cases: [
          { clientId: 'try', input: { level: 'national', base: '3.00' } },
          { clientId: 'pass', input: { level: 'provincial', base: '2.50' }, expected: '2.5' },
          { clientId: 'fail', input: { level: 'national', base: '2.00' }, expected: '2' },
          { clientId: 'bad', input: { level: 'municipal', base: '1.00' }, expected: '1' },
        ],
      },
    )
    expect(evaluated.status, inspect(evaluated.body)).toBe(200)
    const body = evaluated.body as {
      contractSha256: string
      cases: readonly {
        clientId: string
        passed?: boolean
        actual?: string
        problems?: readonly { at: string; parameter?: string }[]
      }[]
    }
    expect(body.contractSha256).toBe(previewBody.contractSha256)
    const byId = new Map(body.cases.map((row) => [row.clientId, row]))
    expect(byId.get('try')).toEqual({ clientId: 'try', actual: '6' })
    expect(byId.get('pass')).toMatchObject({ passed: true, actual: '2.5' })
    expect(byId.get('fail')).toMatchObject({ passed: false, actual: '4', expected: '2' })
    expect(byId.get('bad')?.passed).toBe(false)
    expect(byId.get('bad')?.problems?.[0]).toMatchObject({ at: 'input', parameter: 'level' })

    // a source the compiler refuses answers with the author's diagnostics
    const refused = await call('POST', `/api/assessment/formula-functions/${id}/draft/preview`, {
      sourceTs: `${ANNOTATED}\nconst broken: number = 'text'\n`,
    })
    expect(refused.status, inspect(refused.body)).toBe(422)
    expect(JSON.stringify(refused.body)).toContain('TYPECHECK')
  }, 120_000)

  it('tries a published version by what it froze, the way the browser asks', async () => {
    const created = await call('POST', '/api/assessment/formula-functions', {
      name: 'Version try-run',
    })
    expect(created.status, inspect(created.body)).toBe(200)
    const id = (created.body as { function: { id: string } }).function.id
    const saved = await call('PATCH', `/api/assessment/formula-functions/${id}`, {
      expectedDraftRevision: 1,
      draftSourceTs: IDENTITY,
      draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
    })
    expect(saved.status, inspect(saved.body)).toBe(200)
    const published = await call('POST', `/api/assessment/formula-functions/${id}/versions`, {
      expectedDraftRevision: 2,
      releaseName: '2026 秋季正式规则',
    })
    expect(published.status, inspect(published.body)).toBe(200)
    const version = (published.body as { version: { contractSha256: string } }).version

    // the browser's own client, so the contract must encode and decode whole
    const outcome = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* HttpApiClient.make(Api.local(formulaApiGroup), {
          baseUrl: base,
          transformClient: HttpClient.mapRequest(
            HttpClientRequest.setHeader('cookie', `${sessionCookieName}=${token}`),
          ),
        })
        return yield* client.assessmentFormula.evaluateFormulaVersion({
          params: { functionId: id, versionNo: '1' },
          payload: {
            cases: [
              { clientId: 'try', input: { value: '3.00' } },
              { clientId: 'fail', input: { value: '2.00' }, expected: '5' },
              { clientId: 'bad', input: { value: '11.00' }, expected: '11' },
            ],
          },
        })
      }).pipe(Effect.provide(FetchHttpClient.layer)),
    )
    if (Exit.isFailure(outcome)) throw new Error(inspect(outcome.cause, { depth: 10 }))
    expect(outcome.value.contractSha256).toBe(version.contractSha256)
    const byId = new Map(outcome.value.cases.map((row) => [row.clientId, row]))
    expect(byId.get('try')).toEqual({ clientId: 'try', actual: '3' })
    expect(byId.get('fail')).toMatchObject({ passed: false, actual: '2', expected: '5' })
    expect(byId.get('bad')?.passed).toBe(false)
    expect((byId.get('bad')!.problems as readonly { at: string }[])[0]).toMatchObject({
      at: 'input',
      parameter: 'value',
    })

    const evaluations = (versionNo: string) =>
      `/api/assessment/formula-functions/${id}/versions/${versionNo}/evaluations`
    const missing = await call('POST', evaluations('9'), { cases: [] })
    expect(missing.status, inspect(missing.body)).toBe(404)
    expect((missing.body as { _tag: string })._tag).toBe('ASSESSMENT_FORMULA_VERSION_NOT_FOUND')
    const unusable = await call('POST', evaluations('first'), { cases: [] })
    expect(unusable.status, inspect(unusable.body)).toBe(400)

    // a stored artifact that no longer matches its hash is refused, not run
    await query(sql`
      update assessment_formula_versions set runtime_js = runtime_js || '/*tampered*/'
      where function_id = ${id} and version_no = 1`)
    const tampered = await call('POST', evaluations('1'), {
      cases: [{ clientId: 'try', input: { value: '3.00' } }],
    })
    expect(tampered.status, inspect(tampered.body)).toBe(409)
    expect(tampered.body).toEqual({ _tag: 'ASSESSMENT_FORMULA_VERSION_UNRUNNABLE' })
  }, 120_000)

  it('pages the function list with a keyset cursor: no repeats, no gaps', async () => {
    for (let index = 0; index < 12; index += 1) {
      const created = await call('POST', '/api/assessment/formula-functions', {
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

const query = (statement: Parameters<typeof runSql>[0]) =>
  Effect.runPromise(Effect.provide(runSql(statement), databaseFor(db.url, { entities: closure })))

const rootNode = async () =>
  one<{ id: string }>(await query(sql`select id from org_nodes where path = 'fx_http'`)).id

describe.runIf(postgresAvailable)('the versions a batch may bind, over http', () => {
  it("answers to the round's administrator, and to nobody by unknown batch", async () => {
    // the gate is the ROUND's, not this library's: whoever may administer
    // the batch may see what it can bind
    const unknown = await call(
      'GET',
      '/api/assessment/batches/01920000-0000-7000-8000-0000000000c1/formula-binding-options',
    )
    expect(unknown.status, inspect(unknown.body)).toBe(404)
  }, 120_000)

  it('derives the current binding from the frozen plan, not from a supplied id', async () => {
    // knowing a version's uuid must not be a way to make the server show
    // it: the current binding comes from the question's own plan, and a
    // question of another round is simply not this caller's question
    const stray = await call(
      'GET',
      '/api/assessment/batches/01920000-0000-7000-8000-0000000000c2/formula-binding-options?itemId=01920000-0000-7000-8000-0000000000c3',
    )
    // the batch does not exist for this tenant, so the answer stops there
    expect(stray.status, inspect(stray.body)).toBe(404)
  }, 120_000)

  it('offers nothing to bind afresh while the writer is closed, whatever the cursor says', async () => {
    // The same round, the same author, the same published version, asked of
    // two deployments: the open one lists it; the closed one answers with
    // history only, and never opens the catalog of what could be newly
    // bound - so a cursor the open deployment refuses is not even read.
    const root = await rootNode()
    const batch = one<{ id: string }>(
      await query(sql`
        insert into assessment_batches (tenant_id, name, material_range)
        values (${tenantId}, 'Closed round', daterange('2026-03-01','2026-09-01'))
        returning id`),
    ).id
    await query(sql`
      insert into batch_management_anchors (tenant_id, batch_id, org_node_id)
      values (${tenantId}, ${batch}, ${root})`)
    const created = await call('POST', '/api/assessment/formula-functions', { name: '闭门公式' })
    expect(created.status, inspect(created.body)).toBe(200)
    const id = (created.body as { function: { id: string } }).function.id
    const saved = await call('PATCH', `/api/assessment/formula-functions/${id}`, {
      expectedDraftRevision: 1,
      name: '闭门公式',
      draftSourceTs: IDENTITY,
      draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
    })
    expect(saved.status, inspect(saved.body)).toBe(200)
    const published = await call('POST', `/api/assessment/formula-functions/${id}/versions`, {
      expectedDraftRevision: 2,
      releaseName: '2026 秋季正式规则',
    })
    expect(published.status, inspect(published.body)).toBe(200)

    const options = `/api/assessment/batches/${batch}/formula-binding-options`
    const open = await call('GET', options)
    expect(open.status, inspect(open.body)).toBe(200)
    // among whatever else this author has published in this suite
    expect(
      (open.body as { items: readonly { functionId: string }[] }).items.map(
        (item) => item.functionId,
      ),
    ).toContain(id)
    const closed = await callAt(closedBase, 'GET', options)
    expect(closed.status, inspect(closed.body)).toBe(200)
    expect(closed.body).toEqual({ items: [], nextCursor: null, current: null })

    const garbage = `${options}?cursor=${encodeURIComponent('not-a-cursor')}`
    const openGarbage = await call('GET', garbage)
    expect(openGarbage.status, inspect(openGarbage.body)).toBe(400)
    const closedGarbage = await callAt(closedBase, 'GET', garbage)
    expect(closedGarbage.status, inspect(closedGarbage.body)).toBe(200)
    expect(closedGarbage.body).toEqual({ items: [], nextCursor: null, current: null })
  }, 120_000)
})
