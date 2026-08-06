import { randomUUID } from 'node:crypto'
import { DatabaseSchema, MikroORM } from '@mikro-orm/postgresql'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postgresAvailable } from '../src/testkit.ts'

// Two objects postgres hands back in a shape @mikro-orm/sql 7.1.10 mangles.
//
// Migration generation compares two databases, so every object in a new
// migration has been read out of one of them first. Both defects are patched
// in patches/@mikro-orm__sql@7.1.10.patch and reported in docs/upstream; this
// asks postgres the question the patch answers, so that dropping the patch or
// taking an upgrade that reverts it fails here, by name, rather than as an
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

  // Unpatched, stripping pg's `(code)::text` cast ate the parenthesis that
  // closed the first term as well, producing `code IS NULL) OR ((code ~ ...`
  // - which reaches a migration and fails to parse at deploy time.
  it('keeps a check constraint balanced', () => {
    expect(table?.getChecks().find((check) => check.name === CHECK)?.expression).toBe(
      `(code IS NULL) OR (code ~ '^[a-z]+$'::text)`,
    )
  })

  // Unpatched, the access method was dropped: a gist index over an ltree path
  // came back as a plain column list and was regenerated as btree, which
  // postgres accepts and which answers no subtree query.
  it('keeps the access method of a non-btree index', () => {
    expect(table?.getIndexes().find((index) => index.keyName === INDEX)?.expression).toMatch(
      /using gist/i,
    )
  })
})
