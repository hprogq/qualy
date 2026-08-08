import { randomUUID } from 'node:crypto'
import { DatabaseSchema, MikroORM, SchemaComparator } from '@mikro-orm/postgresql'
import type { EntitySchema } from '@mikro-orm/core'
import { Pool } from 'pg'
import { QualyNamingStrategy } from '../naming.ts'
import { closeAll, withCleanup } from '../cleanup.ts'
import { runMigrations } from '../migrator.ts'
import type { BaselineFragment } from './baseline.ts'
import type { EntityModule } from './entities.ts'
import type { DatabaseWork } from './work.ts'

// What it would take to turn the committed lineage into the schema this
// assembly declares.
//
// Both sides are real databases. One has the lineage applied, exactly as a
// deployment applies it; the other is built from the entities the way a fresh
// install would get it. The migration is the difference between two things
// that exist, rather than between a database and a description of one.
//
// That is not a detail of how it is implemented. Some of the schema is not
// expressible as entity metadata - the tenant-scoped foreign keys point at a
// composite unique key, which the metadata has no declaration for - so a
// comparison against metadata reports them as objects to drop, every time,
// forever. Applied to the second database instead, they are present on both
// sides and the diff never mentions them; a newly declared one appears as an
// addition on its own.
//
// Extensions, functions and seed rows are not in this picture at all: nothing
// reads them into a schema, so nothing can diff them. They travel as baseline
// fragments, written into the migration verbatim, and the two mechanisms
// therefore never describe the same object.

/** where the migrator records what it has run, which nothing may diff against */
const LEDGER_TABLE = 'mikro_orm_migrations'

interface Scratch {
  url: string
  drop: () => Promise<void>
}

/**
 * A database of this generation's own, dropped whatever happens to it.
 *
 * Generation cannot read the developer's database: it would be answering
 * "what does this machine need" instead of "what does the lineage need", and
 * the answer would differ per machine. Both sides are built from scratch here
 * so the migration is a function of the repository alone.
 */
async function scratchDatabase(baseUrl: string, label: string): Promise<Scratch> {
  const name = `qualy_gen_${label}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const admin = new Pool({ connectionString: baseUrl })
  try {
    await admin.query(`create database "${name}"`)
  } finally {
    await admin.end()
  }
  const url = new URL(baseUrl)
  url.pathname = `/${name}`
  return {
    url: url.toString(),
    drop: async () => {
      const pool = new Pool({ connectionString: baseUrl })
      try {
        await pool.query(`drop database "${name}"`)
      } catch (error) {
        // force only after the ordinary drop has already failed, and never
        // instead of reporting it: a forced cleanup that succeeds must not
        // turn a connection this generation failed to close into silence
        await pool.query(`drop database "${name}" with (force)`)
        throw error
      } finally {
        await pool.end()
      }
    },
  }
}

/** the body's answer, with the scratch database gone and neither failure lost */
const withScratch = <T>(scratch: Scratch, body: () => Promise<T>): Promise<T> =>
  withCleanup(body, scratch.drop, {
    cleanupFailed: 'could not drop a generation database',
    bothFailed: 'generation failed, and its database could not be dropped',
  })

const open = async (url: string, entities: readonly EntitySchema[]) =>
  MikroORM.init({
    entities: [...entities] as EntitySchema[],
    clientUrl: url,
    namingStrategy: QualyNamingStrategy,
    discovery: { warnWhenNoEntities: false },
    // introspection leaves the ledger out by name; it is the migrator's
    // bookkeeping and no plugin declares it
    migrations: { tableName: LEDGER_TABLE },
  })

const readSchema = async (orm: MikroORM) =>
  DatabaseSchema.create(orm.em.getConnection(), orm.em.getPlatform(), orm.config, undefined, [
    'public',
  ])

/**
 * The statements a migration should carry, one per breakpoint.
 *
 * A semicolon that ends a line is the separator MikroORM itself uses to break
 * its generated DDL back apart, and one inside a string literal - a check
 * constraint's pattern, say - is not one. Mirrors
 * repos/mikro-orm/packages/sql/src/schema/SqlSchemaGenerator.ts
 * `splitOutsideLiterals`.
 */
export function splitStatements(sql: string): string[] {
  const parts: string[] = []
  for (const chunk of sql.split(';\n')) {
    const previous = parts.at(-1)
    // whatever quote is left once the complete literals and comments are gone
    // opened one that this separator fell inside of
    if (previous !== undefined && previous.replace(/'[^']*'|--[^\n]*/g, '').includes(`'`)) {
      parts[parts.length - 1] = `${previous};\n${chunk}`
    } else {
      parts.push(chunk)
    }
  }
  return parts.map((part) => part.trim().replace(/;$/, '')).filter(Boolean)
}

export interface StructuralDiff {
  /** the statements that bring the lineage to the declared schema */
  up: string[]
}

/**
 * The lineage as it is, against the schema as it is declared.
 *
 * Destructive statements are not suppressed here. A dropped table is a real
 * answer to a real change, and hiding it would make generation quietly
 * disagree with the schema; the drop guard is what makes it deliberate.
 */
export async function structuralDiff(
  work: DatabaseWork,
  modules: readonly EntityModule[],
  baseline: readonly BaselineFragment[],
): Promise<StructuralDiff> {
  const entities = modules.flatMap((module) => [...module.entities])
  const lineage = await scratchDatabase(work.url, 'lineage')
  return withScratch(lineage, async () => {
    await runMigrations(lineage.url, { folder: work.migrations, entities })
    return diffAgainstDeclared(lineage.url, work.url, modules, baseline)
  })
}

/**
 * What one database is missing to be the schema this assembly declares.
 *
 * The subject can be any database - a scratch one with the lineage applied,
 * which is what generation asks about, or a real one somebody wants to know
 * about. The declared side is built the way a fresh install gets it, in a
 * scratch database of its own.
 */
export async function diffAgainstDeclared(
  subjectUrl: string,
  adminUrl: string,
  modules: readonly EntityModule[],
  baseline: readonly BaselineFragment[],
): Promise<StructuralDiff> {
  const entities = modules.flatMap((module) => [...module.entities])
  const declared = await scratchDatabase(adminUrl, 'declared')
  return withScratch(declared, async () => {
    const declaredOrm = await open(declared.url, entities)
    const lineageOrm = await open(subjectUrl, entities)
    try {
      const phase = (want: BaselineFragment['phase']) =>
        baseline.filter((fragment) => fragment.phase === want)
      // the same order the migration writes: a fragment before the tables
      // because a column type needs it, one after because it needs the tables
      for (const fragment of phase('pre-structure')) {
        await declaredOrm.schema.execute(fragment.sql)
      }
      await declaredOrm.schema.execute(await declaredOrm.schema.getCreateSchemaSQL())
      for (const module of modules) {
        for (const statement of module.compositeForeignKeys ?? []) {
          await declaredOrm.schema.execute(statement)
        }
      }
      for (const fragment of phase('post-structure')) {
        await declaredOrm.schema.execute(fragment.sql)
      }

      const comparator = new SchemaComparator(lineageOrm.em.getPlatform())
      const from = await readSchema(lineageOrm)
      const to = await readSchema(declaredOrm)
      // No reverse. The lineage is fix-forward by rule, and a `down` for an
      // initial migration is a file that drops every table - which the drop
      // guard would then have to be taught to ignore, in the one place whose
      // whole job is to make a drop deliberate.
      const forward = comparator.compare(from, to)
      return {
        up: splitStatements(
          lineageOrm.schema.diffToSQL(forward, { wrap: false, safe: false, dropTables: true }),
        ),
      }
    } finally {
      // both, in order: closing the first used to be able to throw and leave
      // the second connection open, which then made the drop fail as well
      await closeAll<MikroORM>(
        [declaredOrm, lineageOrm],
        (orm) => orm.close(),
        'could not close a generation connection',
      )
    }
  })
}

/**
 * Run the baseline fragments against a real database, in migration order.
 *
 * For `adopt`, whose structural comparison cannot see what fragments create.
 * Safe to run on a database that already has them because a fragment is
 * required to state its current shape idempotently - that requirement is what
 * lets the same file be compiled into a migration and replayed here.
 */
export async function applyBaseline(
  url: string,
  baseline: readonly BaselineFragment[],
): Promise<void> {
  const orm = await open(url, [])
  try {
    for (const want of ['pre-structure', 'post-structure'] as const) {
      for (const fragment of baseline.filter((entry) => entry.phase === want)) {
        await orm.schema.execute(fragment.sql)
      }
    }
  } finally {
    await orm.close()
  }
}
