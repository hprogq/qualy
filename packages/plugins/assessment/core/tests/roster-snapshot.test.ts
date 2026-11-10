import { Effect, Fiber } from 'effect'
import { PostgresDriver, sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { Assessment } from '../src/server/index.ts'
import { ok, run, runningBatch, seed } from './support/round.ts'

describe.runIf(postgresAvailable)('roster page snapshots', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  beforeAll(async () => {
    db = await createTestContext('roster-snapshot')
  })
  afterAll(async () => {
    await db?.dispose()
  })

  it.each(['accounts', 'candidates', 'unreachable'] as const)(
    'keeps %s count and rows together when a member changes after count',
    async (kind) => {
      let target = ''
      let observed = false
      let release!: () => void
      let signal!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const reached = new Promise<void>((resolve) => {
        signal = resolve
      })
      const waitForCount = () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            release()
            reject(new Error('roster count was not observed'))
          }, 5_000)
          void reached.then(() => {
            clearTimeout(timer)
            resolve()
          })
        })
      const wrapped = new WeakSet<object>()
      const original = PostgresDriver.prototype.acquireConnection
      const spy = vi
        .spyOn(PostgresDriver.prototype, 'acquireConnection')
        .mockImplementation(async function (this: PostgresDriver, options) {
          const connection = await original.call(this, options)
          if (!wrapped.has(connection)) {
            wrapped.add(connection)
            const execute = connection.executeQuery
            connection.executeQuery = async <R>(
              compiled: Parameters<typeof execute>[0],
              options?: Parameters<typeof execute>[1],
            ) => {
              const result = await (execute<R>).call(connection, compiled, options)
              if (
                !observed &&
                target !== '' &&
                compiled.parameters.includes(target) &&
                /^select count\(\*\) as "total"/i.test(compiled.sql)
              ) {
                observed = true
                signal()
                await held
              }
              return result
            }
          }
          return connection
        })
      try {
        const result = ok(
          await run(
            db.url,
            Effect.gen(function* () {
              const f = yield* seed(`snapshot-${kind}`)
              const g = yield* runningBatch(f)
              const assessment = yield* Assessment
              const admin = f.principal(f.admin)
              target = g.batch.id
              const read =
                kind === 'accounts'
                  ? assessment.listParticipantAccounts(
                      f.t,
                      g.batch.id,
                      {
                        filter: { status: 'active' },
                        order: 'name',
                        page: 1,
                        limit: 1,
                        around: g.p1,
                      },
                      admin,
                    )
                  : kind === 'candidates'
                    ? assessment.listParticipantCandidates(
                        f.t,
                        g.batch.id,
                        { filter: { q: 'Zhang' }, page: 1, limit: 50 },
                        admin,
                      )
                    : assessment.listUnreachableParticipants(
                        f.t,
                        g.batch.id,
                        {
                          route: { kind: 'levels', nodeTypeIds: [crypto.randomUUID()] },
                          page: 1,
                          limit: 50,
                        },
                        admin,
                      )
              const reader = yield* Effect.forkChild(read)
              yield* Effect.promise(waitForCount)
              if (kind === 'candidates') {
                yield* runSql(
                  sql`update users set enabled = false where tenant_id = ${f.t} and id = ${f.s1}`,
                )
              } else {
                yield* runSql(
                  sql`update batch_participants set status = 'excluded' where tenant_id = ${f.t} and batch_id = ${g.batch.id} and user_id = ${f.s1}`,
                )
              }
              release()
              const page = yield* Fiber.join(reader)
              return { page, person: f.s1 }
            }),
          ),
        )
        expect(observed).toBe(true)
        expect(result.page.rows).toHaveLength(kind === 'accounts' ? 1 : result.page.total)
        expect(result.page.rows.some((row) => row.userId === result.person)).toBe(true)
        if (kind === 'accounts') expect(result.page.page).toBe(result.page.total)
      } finally {
        release()
        spy.mockRestore()
      }
    },
  )
})
