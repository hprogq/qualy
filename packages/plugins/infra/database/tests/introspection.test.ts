import { randomUUID } from 'node:crypto'
import { DatabaseSchema, MikroORM } from '@mikro-orm/postgresql'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postgresAvailable } from '../src/testkit.ts'

// Two objects postgres hands back in a shape @mikro-orm/sql once mangled.
//
// Migration generation compares two databases, so every object in a new
// migration has been read out of one of them first. Both defects were reported
// from here (docs/upstream drafts 5 and 6), carried a local patch until 7.1.13
// and are fixed upstream from that release on. The questions stay asked: an
// upgrade that regresses either one fails here, by name, rather than as an
// unexplained difference in the clean-room gate.

const TABLE = 'introspection_probe'
const CHECK = 'chk_introspection_probe_code'
const INDEX = 'idx_introspection_probe_path_gist'

const base = process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy'
const name = `qualy_introspection_${randomUUID().replace(/-/g, '').slice(0, 12)}`

const admin = () => new Pool({ connectionString: base })
const scratch = () => {
  const url = new URL(base)
  url.pathname = `/${name}`
  return url.toString()
}

describe.runIf(postgresAvailable)('what postgres introspection reads back', () => {
  let table: ReturnType<DatabaseSchema['getTable']>
  // the index as the schema helper would write it back out, which is the
  // question that matters: what reaches a migration is regenerated DDL, not
  // the introspected record it came from
  let indexAgain: string | undefined

  beforeAll(async () => {
    const pool = admin()
    try {
      await pool.query(`create database "${name}"`)
    } finally {
      await pool.end()
    }

    const orm = await MikroORM.init({
      entities: [],
      clientUrl: scratch(),
      discovery: { warnWhenNoEntities: false },
    })
    try {
      await orm.schema.execute('create extension if not exists ltree')
      await orm.schema.execute(`create table ${TABLE} (
        id uuid primary key default uuidv7(),
        code varchar(63),
        path ltree not null
      )`)
      // a body with two parenthesised terms and a cast, which is what postgres
      // makes of `code IS NULL OR code ~ '...'` on a varchar column
      await orm.schema.execute(
        `alter table ${TABLE} add constraint ${CHECK} check (code is null or code ~ '^[a-z]+$')`,
      )
      await orm.schema.execute(`create index ${INDEX} on ${TABLE} using gist (path)`)
      table = (
        await DatabaseSchema.create(orm.em.getConnection(), orm.em.getPlatform(), orm.config)
      ).getTable(TABLE)
      const index = table?.getIndexes().find((candidate) => candidate.keyName === INDEX)
      const helper = orm.em.getPlatform().getSchemaHelper()
      indexAgain = index && helper ? helper.getCreateIndexSQL(TABLE, index) : undefined
    } finally {
      await orm.close()
    }
  }, 60_000)

  afterAll(async () => {
    const pool = admin()
    try {
      await pool.query(`drop database if exists "${name}"`)
    } finally {
      await pool.end()
    }
  })

  // Before the fix, stripping pg's `(code)::text` cast ate the parenthesis
  // that closed the first term as well, producing `code IS NULL) OR ((code ~
  // ...`, which reaches a migration and fails to parse at deploy time.
  it('keeps a check constraint balanced', () => {
    expect(table?.getChecks().find((check) => check.name === CHECK)?.expression).toBe(
      `(code IS NULL) OR (code ~ '^[a-z]+$'::text)`,
    )
  })

  // Before the fix, the access method was dropped: a gist index over an ltree
  // path came back as a plain column list and was regenerated as btree, which
  // postgres accepts and which answers no subtree query. Asking the helper to
  // write the index back out tests the outcome rather than the record, so it
  // holds across the two shapes the fix has taken.
  it('regenerates a non-btree index as itself', () => {
    expect(indexAgain).toMatch(/using gist/i)
  })
})
