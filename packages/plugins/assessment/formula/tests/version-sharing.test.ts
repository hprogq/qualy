import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import type { Rbac } from '@qualy/rbac-contract/effect'
import { FormulaTemplateLibrary, templateLibraryLayer } from '../src/server/template-library.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'
import { publishedVersion } from './support/versions.ts'

// Offering a published version to an audience.
//
// Sharing is an authoring act on something the caller wrote, so ownership is
// the gate and somebody else's function reads as absent. What is NOT a gate
// is archival: a function its author archived stops being offered for new
// configuration, and taking back the audience its versions already carry is
// exactly the act that must still work - refusing it would leave an author
// unable to stop distributing something.
//
// Widening needs the permission where it widens TO. Narrowing never does:
// revoking somebody's sharing permission must not strand them unable to take
// back what they already offered.

const stack = (url: string) => templateLibraryLayer.pipe(Layer.provideMerge(servicesFor(url)))

const run = <A, E>(url: string, effect: Effect.Effect<A, E, FormulaTemplateLibrary | Rbac | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url) as never) as Effect.Effect<A, E>)

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const tagOf = (exit: Exit.Exit<unknown, unknown>): string => {
  const rendered = inspect(exit, { depth: 10 })
  const match = /_tag: '([A-Z_]+)'/.exec(rendered)
  return match?.[1] ?? rendered
}

/** grants one author the sharing permission at one node */
const grantShareAt = (tenantId: string, userId: string, orgNodeId: string, code: string) =>
  Effect.gen(function* () {
    const roleId = one<{ id: string }>(
      yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${tenantId}, ${code}, ${code}, 'org', 'active', 'allow-list') returning id`),
    ).id
    yield* runSql(sql`
      insert into role_permissions (tenant_id, role_id, permission_id)
      select ${tenantId}, ${roleId}, p.id from permissions p
      where p.code = 'assessment.formula.share'`)
    yield* runSql(sql`
      insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
      values (${tenantId}, ${userId}, ${roleId}, ${orgNodeId}, 'subtree')`)
    return roleId
  })

describe.runIf(postgresAvailable)('offering a published version', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-version-sharing')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  it('offers what the author wrote, where the author may offer it', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('share-basic')
          const templates = yield* FormulaTemplateLibrary
          const mine = f.principal(f.authorA)
          const published = yield* publishedVersion(f.t, f.authorA, '我的公式')
          yield* grantShareAt(f.t, f.authorA, f.collegeA, 'share-a')

          const before = yield* templates.getSharing(f.t, published.functionId, 1, mine)
          const offered = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: before.token, orgNodeIds: [f.collegeA] },
            mine,
          )
          // somebody else's function is absent, not forbidden
          const theirs = yield* Effect.exit(
            templates.getSharing(f.t, published.functionId, 1, f.principal(f.authorB)),
          )
          const noSuchVersion = yield* Effect.exit(
            templates.getSharing(f.t, published.functionId, 9, mine),
          )
          return {
            before,
            offered,
            theirs: tagOf(theirs),
            noSuchVersion: tagOf(noSuchVersion),
            collegeA: f.collegeA,
          }
        }),
      ),
    )

    expect(outcome.before.scopes).toEqual([])
    expect(outcome.offered.scopes.map((scope) => scope.orgNodeId)).toEqual([outcome.collegeA])
    // the token is what the audience looked like, so it moved with it
    expect(outcome.offered.token).not.toBe(outcome.before.token)
    expect(outcome.theirs).toBe('ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND')
    expect(outcome.noSuchVersion).toBe('ASSESSMENT_FORMULA_VERSION_NOT_FOUND')
  }, 120_000)

  it('needs the permission to widen, and never to narrow', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('share-authz')
          const templates = yield* FormulaTemplateLibrary
          const mine = f.principal(f.authorA)
          const published = yield* publishedVersion(f.t, f.authorA, '公式')

          // without the permission, widening is refused
          const empty = yield* templates.getSharing(f.t, published.functionId, 1, mine)
          const refused = yield* Effect.exit(
            templates.replaceSharing(
              f.t,
              published.functionId,
              1,
              { expectedToken: empty.token, orgNodeIds: [f.collegeA] },
              mine,
            ),
          )

          // with it, the same call lands
          const roleId = yield* grantShareAt(f.t, f.authorA, f.collegeA, 'share-b')
          const offered = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: empty.token, orgNodeIds: [f.collegeA] },
            mine,
          )

          // and once it is taken away again, taking the offer back still works
          yield* runSql(sql`delete from role_grants where role_id = ${roleId}`)
          const narrowed = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: offered.token, orgNodeIds: [] },
            mine,
          )
          return { refused: tagOf(refused), offered: offered.scopes.length, narrowed }
        }),
      ),
    )

    expect(outcome.refused).toBe('ACCESS_DENIED')
    expect(outcome.offered).toBe(1)
    expect(outcome.narrowed.scopes).toEqual([])
  }, 120_000)

  it('reads a unit that is not there as a bad request, not as a refusal', async () => {
    // `canAt` answers false for a node that does not exist, so asking it
    // first would report every typo and every other tenant's id as a
    // permission problem. What is wrong is that the request names something
    // that is not there.
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('share-nodes')
          const templates = yield* FormulaTemplateLibrary
          const mine = f.principal(f.authorA)
          const published = yield* publishedVersion(f.t, f.authorA, '公式')
          yield* grantShareAt(f.t, f.authorA, f.root, 'share-c')
          const empty = yield* templates.getSharing(f.t, published.functionId, 1, mine)

          const absent = yield* Effect.exit(
            templates.replaceSharing(
              f.t,
              published.functionId,
              1,
              { expectedToken: empty.token, orgNodeIds: ['01920000-0000-7000-8000-00000000ffff'] },
              mine,
            ),
          )
          // a unit already inside another says nothing the union does not
          const nested = yield* Effect.exit(
            templates.replaceSharing(
              f.t,
              published.functionId,
              1,
              { expectedToken: empty.token, orgNodeIds: [f.root, f.collegeA] },
              mine,
            ),
          )
          // but REPLACING an ancestor with one of its descendants leaves
          // nothing overlapping and must go through
          const swapped = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: empty.token, orgNodeIds: [f.root] },
            mine,
          )
          const narrower = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: swapped.token, orgNodeIds: [f.collegeA] },
            mine,
          )
          return {
            absent: tagOf(absent),
            nested: tagOf(nested),
            narrower: narrower.scopes.map((scope) => scope.orgNodeId),
            collegeA: f.collegeA,
          }
        }),
      ),
    )

    expect(outcome.absent).toBe('BAD_REQUEST')
    expect(outcome.nested).toBe('BAD_REQUEST')
    expect(outcome.narrower).toEqual([outcome.collegeA])
  }, 120_000)

  it('refuses an audience that moved, and leaves untouched offers alone', async () => {
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('share-cas')
          const templates = yield* FormulaTemplateLibrary
          const mine = f.principal(f.authorA)
          const published = yield* publishedVersion(f.t, f.authorA, '公式')
          yield* grantShareAt(f.t, f.authorA, f.root, 'share-d')
          const empty = yield* templates.getSharing(f.t, published.functionId, 1, mine)
          const first = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: empty.token, orgNodeIds: [f.collegeA] },
            mine,
          )
          // a second screen still holding the older reading
          const stale = yield* Effect.exit(
            templates.replaceSharing(
              f.t,
              published.functionId,
              1,
              { expectedToken: empty.token, orgNodeIds: [f.root] },
              mine,
            ),
          )

          const sharedAtBefore = one<{ shared_at: string }>(
            yield* runSql(sql`
              select shared_at::text from assessment_formula_share_scopes
              where version_id = ${published.versionId} and org_node_id = ${f.collegeA}`),
          ).shared_at
          const auditBefore = one<{ count: string }>(
            yield* runSql(sql`
              select count(*)::text as count from audit_events
              where action_code = 'assessment.formula.sharing.change'`),
          ).count
          // asking for exactly what is already there decides nothing
          const noop = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: first.token, orgNodeIds: [f.collegeA] },
            mine,
          )
          const sharedAtAfter = one<{ shared_at: string }>(
            yield* runSql(sql`
              select shared_at::text from assessment_formula_share_scopes
              where version_id = ${published.versionId} and org_node_id = ${f.collegeA}`),
          ).shared_at
          const auditAfter = one<{ count: string }>(
            yield* runSql(sql`
              select count(*)::text as count from audit_events
              where action_code = 'assessment.formula.sharing.change'`),
          ).count

          return {
            stale: tagOf(stale),
            noop: noop.scopes.length,
            sharedAtBefore,
            sharedAtAfter,
            auditBefore,
            auditAfter,
          }
        }),
      ),
    )

    expect(outcome.stale).toBe('ASSESSMENT_FORMULA_SHARING_CONFLICT')
    expect(outcome.noop).toBe(1)
    // the row nobody decided about keeps the instant it was offered at
    expect(outcome.sharedAtAfter).toBe(outcome.sharedAtBefore)
    // and a decision nobody made is not recorded as one
    expect(outcome.auditAfter).toBe(outcome.auditBefore)
  }, 120_000)

  it('lets an archived function stop distributing what it published', async () => {
    // archival hides a function from new configuration; it must not take
    // away the one act that stops an audience from growing
    const outcome = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('share-archived')
          const templates = yield* FormulaTemplateLibrary
          const mine = f.principal(f.authorA)
          const published = yield* publishedVersion(f.t, f.authorA, '归档公式')
          yield* grantShareAt(f.t, f.authorA, f.root, 'share-e')
          const empty = yield* templates.getSharing(f.t, published.functionId, 1, mine)
          const offered = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: empty.token, orgNodeIds: [f.collegeA] },
            mine,
          )

          yield* runSql(sql`
            update assessment_formula_functions set archived_at = now()
            where id = ${published.functionId}`)

          const read = yield* templates.getSharing(f.t, published.functionId, 1, mine)
          // widening still works too, because archival is not the gate:
          // the college gives way to the whole tenant above it
          const widened = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: offered.token, orgNodeIds: [f.root] },
            mine,
          )
          const withdrawn = yield* templates.replaceSharing(
            f.t,
            published.functionId,
            1,
            { expectedToken: widened.token, orgNodeIds: [] },
            mine,
          )
          return {
            read: read.scopes.length,
            widened: widened.scopes.map((scope) => scope.orgNodeId),
            withdrawn,
            root: f.root,
          }
        }),
      ),
    )

    expect(outcome.read).toBe(1)
    expect(outcome.widened).toEqual([outcome.root])
    expect(outcome.withdrawn.scopes).toEqual([])
  }, 120_000)
})
