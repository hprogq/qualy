import { PGlite } from '@electric-sql/pglite'
import { ltree } from '@electric-sql/pglite/contrib/ltree'
import { defineRelations } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { describe, expect, it } from 'vitest'
// test-only relative reach into the smoke plugin's schema: the assertion
// target is the committed migration lineage, not a package boundary
import { pingLogs } from '../../../demo/ping/src/db/schema.ts'

describe('migration lineage', () => {
  it('replays on a fresh pglite and serves typed queries', async () => {
    // the migration lineage now creates the ltree extension
    const client = new PGlite({ extensions: { ltree } })
    const relations = defineRelations({ pingLogs })
    const db = drizzle({ client, relations })

    await migrate(db, {
      migrationsFolder: 'db/migrations',
      migrationsSchema: 'cordis_meta',
      migrationsTable: 'schema_migrations',
    })

    await db.insert(pingLogs).values({ name: 'pglite' })
    const rows = await db.query.pingLogs.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('pglite')
    // uuidv7 ids are time-ordered, version nibble 7 (native in postgres 18)
    expect(rows[0]!.id).toMatch(/^[0-9a-f-]{14}7/)
    await client.close()
  })
})
