import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import { Rbac } from '@qualy/rbac-contract/effect'
import { Access } from '@qualy/plugin-rbac/server'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'
import {
  FormulaTemplateLibrary,
  sharingToken,
  templateLibraryLayer,
} from '../src/server/template-library.ts'
import { scoringBudgetLayer } from '../src/scoring/budget.ts'
import { one, seedFormulaFixture, servicesFor } from './support/stack.ts'
import { publishedVersion } from './support/versions.ts'

const stack = (url: string) =>
  Layer.mergeAll(
    templateLibraryLayer,
    formulaLayer.pipe(
      Layer.provide(sandboxLocalLayer({ size: 1, variant: 'release' })),
      Layer.provide(formulaAuthoringLocalLayer),
      Layer.provide(scoringBudgetLayer),
    ),
  ).pipe(Layer.provideMerge(servicesFor(url)))

type Services = FormulaLibrary | FormulaTemplateLibrary | Rbac | Access | Orm

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Services>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url) as never) as Effect.Effect<A, E>)

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const tagOf = (exit: Exit.Exit<unknown, unknown>): string => {
  const rendered = inspect(exit, { depth: 10 })
  return /_tag: '([A-Z_]+)'/.exec(rendered)?.[1] ?? rendered
}

const revokeGrant = (f: Effect.Success<ReturnType<typeof seedFormulaFixture>>, grantId: string) =>
  Effect.gen(function* () {
    const access = yield* Access
    const rbac = yield* Rbac
    yield* access.grants.revoke(f.t, grantId, f.principal(f.admin), (tenantId) =>
      rbac.assertTenantKeepsAdministrator(tenantId),
    )
  })

describe.runIf(postgresAvailable)('template authority under write locks', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>

  beforeAll(async () => {
    db = await createTestContext('formula-template-authority-races')
  }, 120_000)

  afterAll(async () => {
    await db?.dispose()
  })

  // The tenant lock is the same lock taken by role and placement writers.
  // Holding the version too makes the old snapshot-based implementation
  // queue, while the fixed implementation queues earlier on the tenant.
  const changeWhileQueued = async <A, E, E2>(
    tenantId: string,
    versionId: string | null,
    change: Effect.Effect<unknown, E2, Services>,
    write: Effect.Effect<A, E, Services>,
  ) => {
    let entered!: () => void
    const holding = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const blocker = run(
      db.url,
      transaction(
        Effect.gen(function* () {
          yield* runSql(sql`select id from tenants where id = ${tenantId} for update`)
          if (versionId !== null) {
            yield* runSql(
              sql`select id from assessment_formula_versions where id = ${versionId} for update`,
            )
          }
          entered()
          yield* Effect.promise(() => gate)
          yield* change
        }),
      ),
    )
    await Promise.race([
      holding,
      blocker.then((exit) => {
        ok(exit)
        throw new Error('the blocker ended before acquiring its locks')
      }),
    ])
    const writing = run(db.url, write)
    let waited = false
    try {
      for (let attempt = 0; attempt < 150; attempt++) {
        const state = await db.query(`select 1 from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`)
        if (state.rows.length > 0) {
          waited = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    } finally {
      release()
    }
    ok(await blocker)
    const result = await writing
    expect(waited, 'the mutation must have reached its database lock').toBe(true)
    return result
  }

  it.each(['authoring', 'placement'] as const)(
    'refuses a queued copy after the reader loses its %s authority',
    async (change) => {
      const { f, published, grantId } = ok(
        await run(
          db.url,
          Effect.gen(function* () {
            const f = yield* seedFormulaFixture(`template-copy-${change}-race`)
            const published = yield* publishedVersion(f.t, f.authorA, 'Shared source')
            yield* runSql(sql`insert into assessment_formula_share_scopes
          (tenant_id, version_id, org_node_id, shared_by)
          values (${f.t}, ${published.versionId}, ${f.collegeA}, ${f.authorA})`)
            const grantId = one<{ id: string }>(
              yield* runSql(sql`
          select id from role_grants where tenant_id = ${f.t} and user_id = ${f.authorB}`),
            ).id
            return { f, published, grantId }
          }),
        ),
      )
      const copied = await changeWhileQueued(
        f.t,
        published.versionId,
        change === 'authoring'
          ? revokeGrant(f, grantId)
          : // Iam.users.setPlacement makes this change under the same tenant lock.
            // The destination is outside the college audience but authoring remains.
            runSql(sql`update users set primary_org_node_id = ${f.root}
              where tenant_id = ${f.t} and id = ${f.authorB}`),
        Effect.gen(function* () {
          const library = yield* FormulaLibrary
          const templates = yield* FormulaTemplateLibrary
          const as = f.principal(f.authorB)
          // Keep the handler's initial gate; the service must recheck after waiting.
          yield* library.requireAuthor(as)
          yield* library.chargeDraftWrite(as)
          return yield* templates.copyTemplate(f.t, published.versionId, as, {
            name: 'Queued copy',
          })
        }),
      )
      const count = await db.query(
        `select count(*)::int as n from assessment_formula_functions
        where tenant_id = $1 and created_by = $2`,
        [f.t, f.authorB],
      )
      expect(tagOf(copied)).toBe(
        change === 'authoring' ? 'ACCESS_DENIED' : 'ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND',
      )
      expect(count.rows[0]?.n).toBe(0)
    },
    120_000,
  )

  it('refuses a queued withdrawal after authoring is revoked', async () => {
    const { f, published, grantId } = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('template-withdraw-author-race')
          const published = yield* publishedVersion(f.t, f.authorA, 'Shared source')
          yield* runSql(sql`insert into assessment_formula_share_scopes
        (tenant_id, version_id, org_node_id, shared_by)
        values (${f.t}, ${published.versionId}, ${f.collegeA}, ${f.authorA})`)
          const grantId = one<{ id: string }>(
            yield* runSql(sql`
        select id from role_grants where tenant_id = ${f.t} and user_id = ${f.authorA}`),
          ).id
          return { f, published, grantId }
        }),
      ),
    )
    const withdrawn = await changeWhileQueued(
      f.t,
      published.versionId,
      revokeGrant(f, grantId),
      Effect.gen(function* () {
        const library = yield* FormulaLibrary
        const templates = yield* FormulaTemplateLibrary
        const as = f.principal(f.authorA)
        yield* library.requireAuthor(as)
        return yield* templates.replaceSharing(
          f.t,
          published.functionId,
          1,
          { expectedToken: sharingToken([f.collegeA]), orgNodeIds: [] },
          as,
        )
      }),
    )
    const shares = await db.query(
      `select org_node_id from assessment_formula_share_scopes
      where tenant_id = $1 and version_id = $2`,
      [f.t, published.versionId],
    )
    expect(tagOf(withdrawn)).toBe('ACCESS_DENIED')
    expect(shares.rows).toEqual([{ org_node_id: f.collegeA }])
  }, 120_000)

  it('does not widen with a sharing grant revoked after the permission read', async () => {
    const { f, published, grantId } = ok(
      await run(
        db.url,
        Effect.gen(function* () {
          const f = yield* seedFormulaFixture('template-widen-share-race')
          const published = yield* publishedVersion(f.t, f.authorA, 'Shared source')
          const roleId = one<{ id: string }>(
            yield* runSql(sql`
        insert into roles (tenant_id, code, name, kind, status, anchor_mode)
        values (${f.t}, 'sharer', 'Sharer', 'org', 'active', 'allow-list') returning id`),
          ).id
          yield* runSql(sql`insert into role_permissions (tenant_id, role_id, permission_id)
        select ${f.t}, ${roleId}, id from permissions where code = 'assessment.formula.share'`)
          const grantId = one<{ id: string }>(
            yield* runSql(sql`
        insert into role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
        values (${f.t}, ${f.authorA}, ${roleId}, ${f.collegeA}, 'subtree') returning id`),
          ).id
          return { f, published, grantId }
        }),
      ),
    )
    // With only the tenant blocked the old writer passes canAt, then queues
    // on its INSERT foreign key. The fixed writer waits before checking canAt.
    const widened = await changeWhileQueued(
      f.t,
      null,
      revokeGrant(f, grantId),
      Effect.gen(function* () {
        const library = yield* FormulaLibrary
        const templates = yield* FormulaTemplateLibrary
        const as = f.principal(f.authorA)
        yield* library.requireAuthor(as)
        return yield* templates.replaceSharing(
          f.t,
          published.functionId,
          1,
          { expectedToken: sharingToken([]), orgNodeIds: [f.collegeA] },
          as,
        )
      }),
    )
    const shares = await db.query(
      `select org_node_id from assessment_formula_share_scopes
      where tenant_id = $1 and version_id = $2`,
      [f.t, published.versionId],
    )
    expect(tagOf(widened)).toBe('ACCESS_DENIED')
    expect(shares.rows).toEqual([])
  }, 120_000)
})
