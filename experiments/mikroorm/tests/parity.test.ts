import { MikroORM } from '@mikro-orm/postgresql'
import { afterAll, describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable } from '@qualy/plugin-database/testkit'
import type { TestContext } from '@qualy/plugin-database/testkit'
import { QualyNamingStrategy, orgCompositeForeignKeys, orgEntities } from '../src/org-entities.ts'

// Is a database built from entities the database the product runs on?
//
// This is the question the whole route turns on, and the only honest way to
// ask it is to build both and compare them: one from the committed lineage,
// one from the entity declarations, then every column, constraint and index of
// org's four tables set against each other. Anything the entities failed to
// declare shows up here as a difference rather than as an omission that
// surfaces in production.
//
// It deliberately mirrors the gate already on main
// (plugins/infra/database/tests/clean-room-parity.test.ts), so that during a
// migration the same comparison covers both sides.

let lineage: TestContext
let generated: TestContext

afterAll(async () => {
  await generated?.dispose()
  await lineage?.dispose()
})

const TABLES = `('tenants','org_types','org_type_rules','org_nodes')`

const CATALOG = {
  columns: `select table_name || '.' || column_name || ' ' || data_type
              || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
            from information_schema.columns
            where table_schema = 'public' and table_name in ${TABLES} order by 1`,
  // not-null shows up in pg_constraint on this server version and is already
  // covered by the column query, so it is excluded to keep the diff readable
  constraints: `select conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
                from pg_constraint
                where connamespace = 'public'::regnamespace
                  and contype <> 'n'
                  and conrelid::regclass::text in ${TABLES}
                order by 1`,
  indexes: `select indexdef from pg_indexes
            where schemaname = 'public' and tablename in ${TABLES} order by 1`,
}

const read = async (db: TestContext, query: string) =>
  (await db.query<Record<string, string>>(query)).rows.map((row) => Object.values(row)[0]!)

describe.runIf(postgresAvailable)('a database built from entities', () => {
  it(
    'has the columns, constraints and indexes the lineage builds',
    async () => {
      lineage = await createTestContext('parity-lineage')

      // the generated side starts from the same lineage - it is what creates
      // the extension and every other table - then org's four tables are
      // dropped and rebuilt from the entity declarations alone
      generated = await createTestContext('parity-generated')
      await generated.query(
        `drop table if exists org_nodes, org_type_rules, org_types, tenants cascade`,
      )

      const orm = await MikroORM.init({
        entities: orgEntities as never,
        clientUrl: generated.url,
        namingStrategy: QualyNamingStrategy,
        discovery: { warnWhenNoEntities: false },
      })
      try {
        await orm.schema.execute(await orm.schema.getCreateSchemaSQL())
      } finally {
        await orm.close()
      }
      for (const statement of orgCompositeForeignKeys) {
        await generated.query(statement)
      }

      for (const [what, query] of Object.entries(CATALOG)) {
        const expected = await read(lineage, query)
        const actual = await read(generated, query)
        expect(expected.length, `no ${what} were compared`).toBeGreaterThan(0)
        expect(actual, `${what} differ`).toEqual(expected)
      }
    },
    240_000,
  )
})
