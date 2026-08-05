import { MikroORM } from '@mikro-orm/postgresql'
import type { EntitySchema, NamingStrategy } from '@mikro-orm/core'

// Is a database built from entities the database the product runs on?
//
// The only honest way to ask is to build both and compare them: one from the
// committed lineage, one from the entity declarations, then every column,
// constraint and index of the tables in question set against each other.
// Anything the entities failed to declare shows up as a difference rather than
// as an omission that surfaces in production.
//
// The column query reads width and precision, not just the type name. A first
// version compared `data_type` alone, which for every varchar in the schema is
// the string 'character varying' - so an entity declaring a 255-wide column
// where the lineage has 100 compared equal, and did. A gate that cannot see
// the difference between those two is not a gate over column definitions.

const list = (tables: readonly string[]) => tables.map((name) => `'${name}'`).join(',')

const catalog = (tables: readonly string[]) => ({
  columns: `select table_name || '.' || column_name || ' ' || data_type
              || coalesce('(' || character_maximum_length || ')', '')
              || coalesce('(' || numeric_precision || ',' || numeric_scale || ')', '')
              || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
            from information_schema.columns
            where table_schema = 'public' and table_name in (${list(tables)}) order by 1`,
  // not-null is in pg_constraint on this server version and the column query
  // already carries it, so it is excluded to keep a difference readable
  constraints: `select conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
                from pg_constraint
                where connamespace = 'public'::regnamespace
                  and contype <> 'n'
                  and conrelid::regclass::text in (${list(tables)})
                order by 1`,
  indexes: `select indexdef from pg_indexes
            where schemaname = 'public' and tablename in (${list(tables)}) order by 1`,
})

export interface SchemaParity {
  /** what the committed lineage builds, and what the entities build */
  columns: { lineage: string[]; entities: string[] }
  constraints: { lineage: string[]; entities: string[] }
  indexes: { lineage: string[]; entities: string[] }
}

export interface SchemaParityOptions {
  /** names the scratch databases, so a failing run says which gate opened them */
  label: string
  /** the tables these entities own, dropped and rebuilt on the generated side */
  tables: readonly string[]
  entities: readonly EntitySchema[]
  namingStrategy?: new () => NamingStrategy
  /**
   * Statements applied after the generator, for what it cannot express.
   *
   * A tenant-scoped foreign key points at a composite unique key rather than
   * at a primary one, which is the shape that carries tenant isolation into
   * the database and the shape the generator has no declaration for.
   */
  afterCreate?: readonly string[]
}

type Context = {
  url: string
  query<Row>(text: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>
  dispose(): Promise<void>
}

/**
 * Both databases, read and compared object by object.
 *
 * The generated side starts from the same lineage, because it is what creates
 * the extensions and every table these ones reference; only the tables under
 * test are dropped and rebuilt. Building it from nothing would compare these
 * entities against a database that could not hold them.
 */
export async function schemaParity(
  create: (label: string) => Promise<Context>,
  options: SchemaParityOptions,
): Promise<SchemaParity> {
  const lineage = await create(`${options.label}-lineage`)
  const generated = await create(`${options.label}-generated`)
  try {
    await generated.query(`drop table if exists ${options.tables.join(', ')} cascade`)
    const orm = await MikroORM.init({
      entities: options.entities as EntitySchema[],
      clientUrl: generated.url,
      ...(options.namingStrategy ? { namingStrategy: options.namingStrategy } : {}),
      discovery: { warnWhenNoEntities: false },
    })
    try {
      await orm.schema.execute(await orm.schema.getCreateSchemaSQL())
    } finally {
      await orm.close()
    }
    for (const statement of options.afterCreate ?? []) {
      await generated.query(statement)
    }

    const read = async (context: Context, query: string) =>
      (await context.query<Record<string, string>>(query)).rows.map((row) => Object.values(row)[0]!)
    const queries = catalog(options.tables)
    const both = async (query: string) => ({
      lineage: await read(lineage, query),
      entities: await read(generated, query),
    })
    return {
      columns: await both(queries.columns),
      constraints: await both(queries.constraints),
      indexes: await both(queries.indexes),
    }
  } finally {
    // both, whatever happened to either: a scratch database left behind is a
    // database the next run has to work around
    const failures: unknown[] = []
    for (const context of [generated, lineage]) {
      await context.dispose().catch((error: unknown) => failures.push(error))
    }
    if (failures.length > 0) throw new AggregateError(failures, 'could not drop a parity database')
  }
}
