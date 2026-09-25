import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { sql } from 'kysely'
import { describe, expect, it } from 'vitest'
import { withMigrator } from '../src/migrator.ts'
import { entityManager, kyselyOf } from '../src/server/index.ts'
import { createTestContext, databaseFor, postgresAvailable } from '../src/testkit.ts'

// What a database url says beyond host, port, user and name.
//
// A deployment reaching a remote server writes `?sslmode=require` on
// DATABASE_URL and believes the connection is encrypted. MikroORM took the
// url apart into the five pieces and built the pool from those alone, so
// every parameter after the `?` was dropped: the application's pool ran in
// plaintext beside the migration lock's session, which parsed the same url
// and did not. `application_name` travels by exactly the same road as
// `sslmode` and, unlike TLS, the scratch server can show that it arrived.

const named = (url: string, name: string): string => {
  const parsed = new URL(url)
  parsed.searchParams.set('application_name', name)
  return parsed.href
}

describe('every orm this plugin opens', () => {
  it('hands the driver the whole url', () => {
    // a fifth call site that passes `clientUrl` alone would bring the
    // dropped parameters back for whatever it connects to
    const source = path.join(import.meta.dirname, '..', 'src')
    const files = fs
      .readdirSync(source, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
    const opening = files.filter((file) =>
      fs.readFileSync(path.join(source, file), 'utf8').includes('MikroORM.init('),
    )
    expect(opening.length).toBeGreaterThan(0)
    for (const file of opening) {
      const text = fs.readFileSync(path.join(source, file), 'utf8')
      expect(text, file).toContain('driverConnection(')
      expect(text, file).not.toMatch(/clientUrl:/)
    }
  })
})

describe.runIf(postgresAvailable)('the parameters a database url carries', () => {
  it('reach the pool the application queries through', async () => {
    const db = await createTestContext('url-parameters-pool')
    try {
      const seen = await Effect.runPromise(
        Effect.gen(function* () {
          const em = yield* entityManager()
          return yield* Effect.promise(() =>
            sql<{
              name: string
            }>`select current_setting('application_name') as name`.execute(kyselyOf(em)),
          )
        }).pipe(
          Effect.provide(databaseFor(named(db.url, 'qualy-pool-probe'), { migrations: 'off' })),
        ),
      )
      expect(seen.rows[0]?.name).toBe('qualy-pool-probe')
    } finally {
      await db.dispose()
    }
  })

  it('reach the session the migrator runs on', async () => {
    const db = await createTestContext('url-parameters-migrator')
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-url-lineage-'))
    try {
      const seen = await withMigrator(
        named(db.url, 'qualy-migrator-probe'),
        { folder, entities: [] },
        (_migrator, orm) =>
          orm.em
            .getConnection()
            .execute<{ name: string }[]>(`select current_setting('application_name') as name`),
      )
      expect(seen[0]?.name).toBe('qualy-migrator-probe')
    } finally {
      await db.dispose()
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })
})
