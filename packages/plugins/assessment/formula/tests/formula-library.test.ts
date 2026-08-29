import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
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
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import type { Principal } from '@qualy/rbac-contract'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { permissions as formulaPermissions } from '../src/permissions.ts'
import { formulaActions } from '../src/actions.ts'
import { entities } from '../src/db/entities.ts'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'

// The library end to end on a real database: authoring, optimistic
// concurrency, the whole publish pipeline (typecheck, bundle, sandbox
// contract, examples) and the frozen version row it produces. What the
// pipeline's stages each refuse is pinned by the bundler and artifact
// suites; here it is the service's own composition and records.

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

const stack = (url: string) => {
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
      Layer.provideMerge(Layer.mergeAll(uiLayer, databaseFor(url, { entities: closure }))),
    ),
    { catalog },
  )
  return formulaLayer.pipe(
    Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
    Layer.provideMerge(services),
  )
}

const run = <A, E>(url: string, effect: Effect.Effect<A, E, FormulaLibrary | Rbac | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const one = <T>(result: unknown) => (result as { rows: T[] }).rows[0]!

/** a tenant, a root and a college, an all-active admin and a bystander */
const seed = (slug: string) =>
  Effect.gen(function* () {
    const t = one<{ id: string }>(
      yield* runSql(sql`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`),
    ).id
    const college = one<{ id: string }>(
      yield* runSql(
        sql`insert into org_types (tenant_id, name) values (${t}, 'College') returning id`,
      ),
    ).id
    const base = slug.replaceAll('-', '_')
    const root = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, name, path, depth)
        values (${t}, ${college}, 'Root', ${base}, 0) returning id`),
    ).id
    const collegeA = one<{ id: string }>(
      yield* runSql(sql`
        insert into org_nodes (tenant_id, org_type_id, parent_id, name, path, depth)
        values (${t}, ${college}, ${root}, 'College A', ${sql.raw(`'${base}.a'`)}, 1)
        returning id`),
    ).id
    const studentType = one<{ id: string }>(
      yield* runSql(sql`
        insert into user_types (tenant_id, code, name, placement_mode)
        values (${t}, 'student', 'Student', 'unrestricted') returning id`),
    ).id
    const person = (name: string, at: string) =>
      runSql(sql`
        insert into users (tenant_id, display_name, user_type_id, primary_org_node_id)
        values (${t}, ${name}, ${studentType}, ${at}) returning id`)
    const admin = one<{ id: string }>(yield* person('Admin', root)).id
    const bystander = one<{ id: string }>(yield* person('Bystander', collegeA)).id
    const adminRole = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, permission_mode, system_key)
        values (${t}, 'admin', 'Admin', 'tenant', 'active', 'all-active', 'tenant-admin')
        returning id`),
    ).id
    yield* runSql(
      sql`insert into role_grants (tenant_id, user_id, role_id) values (${t}, ${admin}, ${adminRole})`,
    )
    const principal = (userId: string): Principal => ({ tenantId: t, userId, sessionId: 's' })
    return { t, root, collegeA, admin, bystander, principal }
  })

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

describe.runIf(postgresAvailable)('the formula library', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('assessment-formula')
  })

  afterAll(async () => {
    await db?.dispose()
  })

  it('authors, publishes and freezes an identity formula end to end', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-publish')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: '认定分值', description: '直接采用认定分值' },
            as,
          )
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: IDENTITY,
              draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const version = yield* library.publish(f.t, created.id, drafted.draftRevision, as)
          const detail = yield* library.getFunction(f.t, created.id, as)
          const listed = yield* library.listFunctions(f.t, {}, as)
          return { created, version, detail, listed }
        }),
      ),
    )
    expect(outcome.version.versionNo).toBe(1)
    for (const hash of [
      outcome.version.sourceSha256,
      outcome.version.runtimeSha256,
      outcome.version.contractSha256,
      outcome.version.formulaRuntimeSha256,
    ])
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(outcome.version.formulaAbiVersion).toBe(1)
    expect(outcome.version.typescriptVersion).toContain('7.')
    expect(outcome.version.esbuildVersion).toMatch(/^\d+\./)
    expect(outcome.version.quickjsEngineVersion).toContain('quickjs')
    expect(outcome.version.testReport).toEqual([
      { name: 'three', passed: true, expected: '3', actual: '3' },
    ])
    expect(outcome.detail.versions.map((row) => row.versionNo)).toEqual([1])
    expect(outcome.listed.items.map((row) => row.latestVersionNo)).toEqual([1])
  }, 120_000)

  it('refuses to publish what does not hold: types, examples, stale drafts', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-refusals')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: 'Broken' },
            as,
          )

          // the default draft carries no examples: publishing has nothing proven
          const untested = yield* Effect.flip(
            library.publish(f.t, created.id, created.draftRevision, as),
          )

          const badTyped = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: IDENTITY.replace('(input) => input.value', '(input) => true'),
              draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
            },
            as,
          )
          const misTyped = yield* Effect.flip(
            library.publish(f.t, created.id, badTyped.draftRevision, as),
          )

          const wrongAnswer = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: badTyped.draftRevision,
              draftSourceTs: IDENTITY,
              draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '4' }],
            },
            as,
          )
          const failing = yield* Effect.flip(
            library.publish(f.t, created.id, wrongAnswer.draftRevision, as),
          )

          const stale = yield* Effect.flip(
            library.updateDraft(
              f.t,
              created.id,
              { expectedDraftRevision: 1, draftSourceTs: IDENTITY },
              as,
            ),
          )
          return { untested, misTyped, failing, stale }
        }),
      ),
    )
    expect(outcome.untested._tag).toBe('ASSESSMENT_FORMULA_TEST_FAILED')
    expect(outcome.misTyped._tag).toBe('ASSESSMENT_FORMULA_TYPECHECK_FAILED')
    expect(
      (outcome.misTyped as { diagnostics: readonly { code: string }[] }).diagnostics.length,
    ).toBeGreaterThan(0)
    expect(outcome.failing._tag).toBe('ASSESSMENT_FORMULA_TEST_FAILED')
    expect(
      (outcome.failing as { report: readonly { passed: boolean; actual?: string }[] }).report,
    ).toEqual([{ name: 'three', passed: false, expected: '4', actual: '3' }])
    expect(outcome.stale._tag).toBe('ASSESSMENT_FORMULA_DRAFT_CONFLICT')
  }, 120_000)

  it('answers a forged contract with a refusal, never a host-side defect', async () => {
    // the type system is not a trust boundary: an assertion can hand the
    // extractor input: undefined, and every validator on the host must
    // fail closed into a 422 instead of throwing
    const forged = `import { Schema, defineFormula } from '@qualy/formula'

const definition = defineFormula({
  input: Schema.input({}),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (_input, q) => q.decimal.fromInteger(0),
})

export default { ...definition, input: undefined } as unknown as typeof definition
`
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-forged')
          const library = yield* FormulaLibrary
          const as = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: 'Forged' },
            as,
          )
          const drafted = yield* library.updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: created.draftRevision,
              draftSourceTs: forged,
              draftTests: [{ name: 'zero', input: {}, expected: '0' }],
            },
            as,
          )
          return yield* Effect.flip(library.publish(f.t, created.id, drafted.draftRevision, as))
        }),
      ),
    )
    expect(outcome._tag).toBe('ASSESSMENT_FORMULA_CONTRACT_INVALID')
    expect((outcome as { issues: readonly { path: string; reason: string }[] }).issues).toEqual([
      { path: 'input', reason: 'not-an-object' },
    ])
  }, 120_000)

  it('keeps unauthorized readers outside: empty lists, unknown functions', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seed('fx-access')
          const library = yield* FormulaLibrary
          const admin = f.principal(f.admin)
          const created = yield* library.createFunction(
            f.t,
            { ownerNodeId: f.collegeA, name: 'Private' },
            admin,
          )
          const outsider = f.principal(f.bystander)
          const listed = yield* library.listFunctions(f.t, {}, outsider)
          const denied = yield* Effect.flip(library.getFunction(f.t, created.id, outsider))
          const archived = yield* library.setStatus(f.t, created.id, 'archived', admin)
          const editRefused = yield* Effect.flip(
            library.updateDraft(
              f.t,
              created.id,
              { expectedDraftRevision: archived.draftRevision, draftSourceTs: IDENTITY },
              admin,
            ),
          )
          return { listed, denied, editRefused }
        }),
      ),
    )
    expect(outcome.listed.items).toEqual([])
    expect(outcome.denied._tag).toBe('ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND')
    expect(outcome.editRefused._tag).toBe('ASSESSMENT_FORMULA_FUNCTION_ARCHIVED')
  }, 120_000)
})
