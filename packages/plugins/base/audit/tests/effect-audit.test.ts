import { literal } from '@qualy/i18n-contract'
import { sql } from 'kysely'
import { Cause, Effect, Exit, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { transaction, type Orm } from '@qualy/plugin-database/server'
import { entities as orgEntities } from '@qualy/plugin-org/db'
import { entities as authEntities } from '@qualy/plugin-auth/db'
import { RequestContext } from '@qualy/api-kit/request'
import { AuditAction } from '@qualy/audit-contract/action'
import { Audit, AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { entities as auditEntities } from '../src/db/entities.ts'
import { db as auditDb } from '../src/server/db.ts'
import { listEvents } from '../src/server/index.ts'
import { writerLayer } from '../src/server/writer.ts'

// The writer under its two promises: an event can only be what a declared
// action admits, and it lives or dies with the transaction of the operation
// it records. Both matter more than the reads - a read can be fixed
// tomorrow, an event that silently missed its transaction cannot.

const closure = [...orgEntities, ...authEntities, ...auditEntities] as const

const UserDisabled = AuditAction.define({
  code: 'auth.user.disable',
  target: 'auth.user',
  version: 1,
  name: literal('Disable user'),
  details: Schema.Struct({
    from: Schema.Literal('active'),
    to: Schema.Literal('disabled'),
  }),
})

/** an action whose schema admits anything, to exercise the writer's own guard */
const FreeForm = AuditAction.define({
  code: 'audit.test.free-form',
  version: 1,
  name: literal('Free form'),
  details: Schema.Record(Schema.String, Schema.Unknown),
})

const catalog = compileActionCatalog([
  { owner: 'auth', actions: [UserDisabled] },
  { owner: 'audit', actions: [FreeForm] },
])

const stack = (url: string) =>
  writerLayer.pipe(
    // provideMerge rather than provide: the tests write fixtures through the
    // same database the layer uses, so it has to stay available above
    Layer.provideMerge(databaseFor(url, { entities: closure })),
    Layer.provide(Layer.succeed(AuditActionCatalog, catalog)),
  )

const run = <A, E>(url: string, effect: Effect.Effect<A, E, Audit | Orm>) =>
  Effect.runPromiseExit(Effect.provide(effect, stack(url)))

const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${JSON.stringify(exit.cause)}`)
}

const seedTenant = Effect.fn('seedTenant')(function* () {
  const result = yield* runSql<{ id: string }>(
    sql`insert into tenants (slug, name) values ('t', 'T') returning id`,
  )
  return result.rows[0]!.id
})

const eventRows = (tenantId: string) =>
  auditDb.query((k) =>
    k
      .selectFrom('AuditEvent')
      .selectAll()
      .where('tenantId', '=', tenantId)
      .orderBy('occurredAt', 'desc')
      .orderBy('id', 'desc')
      .execute(),
  )

describe.runIf(postgresAvailable)('the audit writer', () => {
  it('records an event with what the caller stated and nothing else', async () => {
    const db = await createTestContext('audit-record')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const tenant = yield* seedTenant()
          const audit = yield* Audit
          yield* audit.record(UserDisabled, {
            tenantId: tenant,
            actor: { kind: 'user', userId: '11111111-1111-4111-8111-111111111111', label: 'Ada' },
            target: { id: '22222222-2222-4222-8222-222222222222', label: 'Grace' },
            details: { from: 'active', to: 'disabled' },
          })
          return { tenant, rows: yield* eventRows(tenant).pipe(Effect.orDie) }
        }),
      )
      const { rows } = ok(exit)
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(row.actionCode).toBe('auth.user.disable')
      expect(row.actionVersion).toBe(1)
      expect(row.actorKind).toBe('user')
      expect(row.actorLabel).toBe('Ada')
      expect(row.targetKind).toBe('auth.user')
      expect(row.targetLabel).toBe('Grace')
      expect(row.outcome).toBe('success')
      expect(row.details).toEqual({ from: 'active', to: 'disabled' })
      // no request in scope: the event says so instead of inventing one
      expect(row.source).toBe('system')
      expect(row.requestId).toBeNull()
      expect(row.clientIp).toBeNull()
    } finally {
      await db.dispose()
    }
  })

  it('dies with the transaction it joined, and commits with it', async () => {
    const db = await createTestContext('audit-transaction')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const tenant = yield* seedTenant()
          const audit = yield* Audit
          const record = audit.record(UserDisabled, {
            tenantId: tenant,
            actor: { kind: 'system' },
            details: { from: 'active', to: 'disabled' },
          })

          // aborted: the event was visible inside, and left nothing behind.
          // The failure carries the inside count out, since failing is what
          // this branch is for
          const seen = yield* transaction(
            Effect.gen(function* () {
              yield* record
              const inside = (yield* eventRows(tenant).pipe(Effect.orDie)).length
              return yield* Effect.fail({ insideCount: inside })
            }),
          ).pipe(Effect.flip)
          const afterAbort = (yield* eventRows(tenant).pipe(Effect.orDie)).length

          // committed: the same write survives with its transaction
          yield* transaction(record)
          const afterCommit = (yield* eventRows(tenant).pipe(Effect.orDie)).length
          return { seen, afterAbort, afterCommit }
        }),
      )
      const { seen, afterAbort, afterCommit } = ok(exit)
      expect(seen.insideCount).toBe(1)
      expect(afterAbort).toBe(0)
      expect(afterCommit).toBe(1)
    } finally {
      await db.dispose()
    }
  })

  it('refuses an action nobody declared, as a defect', async () => {
    const db = await createTestContext('audit-undeclared')
    try {
      const Undeclared = AuditAction.define({
        code: 'audit.test.undeclared',
        version: 1,
        name: literal('Undeclared'),
        details: Schema.Struct({}),
      })
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const tenant = yield* seedTenant()
          const audit = yield* Audit
          yield* audit.record(Undeclared, {
            tenantId: tenant,
            actor: { kind: 'system' },
            details: {},
          })
        }),
      )
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it('refuses a version that does not match the declaration', async () => {
    const db = await createTestContext('audit-version')
    try {
      const Stale = AuditAction.define({ ...UserDisabled, version: 2 })
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const tenant = yield* seedTenant()
          const audit = yield* Audit
          yield* audit.record(Stale, {
            tenantId: tenant,
            actor: { kind: 'system' },
            details: { from: 'active', to: 'disabled' },
          })
        }),
      )
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
    } finally {
      await db.dispose()
    }
  })

  it('refuses details outside the declared schema, and credential-shaped keys inside it', async () => {
    const db = await createTestContext('audit-guards')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const tenant = yield* seedTenant()
          const audit = yield* Audit

          const offSchema = yield* Effect.exit(
            audit.record(UserDisabled, {
              tenantId: tenant,
              actor: { kind: 'system' },
              details: { from: 'disabled', to: 'active' } as never,
            }),
          )
          const secretKey = yield* Effect.exit(
            audit.record(FreeForm, {
              tenantId: tenant,
              actor: { kind: 'system' },
              details: { nested: { password: 'hunter2' } },
            }),
          )
          const oversized = yield* Effect.exit(
            audit.record(FreeForm, {
              tenantId: tenant,
              actor: { kind: 'system' },
              details: { blob: 'x'.repeat(64 * 1024) },
            }),
          )
          const stored = (yield* eventRows(tenant).pipe(Effect.orDie)).length
          return { offSchema, secretKey, oversized, stored }
        }),
      )
      const { offSchema, secretKey, oversized, stored } = ok(exit)
      for (const refused of [offSchema, secretKey, oversized]) {
        expect(Exit.isFailure(refused) && Cause.hasDies(refused.cause)).toBe(true)
      }
      expect(stored).toBe(0)
    } finally {
      await db.dispose()
    }
  })

  it('carries the request correlation of the request it ran under', async () => {
    const db = await createTestContext('audit-request')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const tenant = yield* seedTenant()
          const audit = yield* Audit
          yield* audit
            .record(UserDisabled, {
              tenantId: tenant,
              actor: { kind: 'user', userId: '11111111-1111-4111-8111-111111111111' },
              details: { from: 'active', to: 'disabled' },
            })
            .pipe(
              Effect.provideService(RequestContext, {
                requestId: '33333333-3333-4333-8333-333333333333',
                clientIp: '198.51.100.1',
                userAgent: 'qualy-test/1.0',
                traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
                sessionId: '44444444-4444-4444-8444-444444444444',
                bindSession: () => Effect.void,
              }),
            )
          return yield* eventRows(tenant).pipe(Effect.orDie)
        }),
      )
      const rows = ok(exit)
      const row = rows[0]!
      expect(row.source).toBe('http')
      expect(row.requestId).toBe('33333333-3333-4333-8333-333333333333')
      expect(row.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
      expect(row.sessionId).toBe('44444444-4444-4444-8444-444444444444')
      expect(row.clientIp).toBe('198.51.100.1')
      expect(row.userAgent).toBe('qualy-test/1.0')
    } finally {
      await db.dispose()
    }
  })

  it('pages the trail without skipping or repeating across a same-instant tie', async () => {
    const db = await createTestContext('audit-paging')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const tenant = yield* seedTenant()
          const audit = yield* Audit
          const record = (to: 'active' | 'disabled') =>
            audit.record(FreeForm, {
              tenantId: tenant,
              actor: { kind: 'system' },
              details: { to },
            })
          // one transaction: now() is the same instant for all three rows,
          // so the page boundary has to be decided by the id tiebreak
          yield* transaction(Effect.all([record('active'), record('active'), record('disabled')]))

          const firstPage = yield* listEvents(tenant, {}, { limit: 2 }).pipe(Effect.orDie)
          const last = firstPage.at(-1)!
          const secondPage = yield* listEvents(
            tenant,
            {},
            {
              after: [last.occurredAtCursor, last.id],
              limit: 2,
            },
          ).pipe(Effect.orDie)

          const other = yield* runSql<{ id: string }>(
            sql`insert into tenants (slug, name) values ('u', 'U') returning id`,
          )
          const foreign = yield* listEvents(other.rows[0]!.id, {}, { limit: 10 }).pipe(Effect.orDie)
          return { firstPage, secondPage, foreign }
        }),
      )
      const { firstPage, secondPage, foreign } = ok(exit)
      expect(firstPage).toHaveLength(2)
      expect(secondPage).toHaveLength(1)
      const ids = [...firstPage, ...secondPage].map((row) => row.id)
      expect(new Set(ids).size).toBe(3)
      // the other tenant reads its own empty trail, never a neighbour's
      expect(foreign).toHaveLength(0)
    } finally {
      await db.dispose()
    }
  })

  it('filters by action and outcome without breaking the cursor contract', async () => {
    const db = await createTestContext('audit-filters')
    try {
      const exit = await run(
        db.url,
        Effect.gen(function* () {
          const tenant = yield* seedTenant()
          const audit = yield* Audit
          yield* audit.record(UserDisabled, {
            tenantId: tenant,
            actor: { kind: 'system' },
            details: { from: 'active', to: 'disabled' },
          })
          yield* audit.record(FreeForm, {
            tenantId: tenant,
            actor: { kind: 'anonymous' },
            outcome: 'denied',
            reasonCode: 'not-allowed',
            details: {},
          })
          const byAction = yield* listEvents(
            tenant,
            { actionCode: 'auth.user.disable' },
            {
              limit: 10,
            },
          ).pipe(Effect.orDie)
          const byOutcome = yield* listEvents(tenant, { outcome: 'denied' }, { limit: 10 }).pipe(
            Effect.orDie,
          )
          return { byAction, byOutcome }
        }),
      )
      const { byAction, byOutcome } = ok(exit)
      expect(byAction).toHaveLength(1)
      expect(byAction[0]!.actionCode).toBe('auth.user.disable')
      expect(byOutcome).toHaveLength(1)
      expect(byOutcome[0]!.reasonCode).toBe('not-allowed')
    } finally {
      await db.dispose()
    }
  })
})

describe('the action catalog', () => {
  it('refuses a code declared twice, a malformed code and a versionless action', () => {
    expect(() =>
      compileActionCatalog([
        { owner: 'a', actions: [UserDisabled] },
        { owner: 'b', actions: [UserDisabled] },
      ]),
    ).toThrow(/declared by both a and b/)
    expect(() =>
      compileActionCatalog([
        {
          owner: 'a',
          actions: [
            AuditAction.define({
              code: 'UPPER.case',
              version: 1,
              name: literal('x'),
              details: Schema.Struct({}),
            }),
          ],
        },
      ]),
    ).toThrow(/malformed/)
    expect(() =>
      compileActionCatalog([
        {
          owner: 'a',
          actions: [
            AuditAction.define({
              code: 'audit.test.zero',
              version: 0,
              name: literal('x'),
              details: Schema.Struct({}),
            }),
          ],
        },
      ]),
    ).toThrow(/version/)
  })
})
