import type { EntitySchema } from '@mikro-orm/core'
import { Effect, Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import {
  Entities,
  entityManager,
  kyselyOf,
  query,
  type ClosureEntityManager,
  type Orm,
  type QueryFailed,
} from './server/orm.ts'

// This capability's face in the descriptor model: what a plugin writes to say
// "I own these tables", and what the owner does with all of them.
//
// The constructor namespace is the open-world answer to `ctx.db.addSchema`:
// the kernel never learns what an entity is, this module does - and a second
// database (or a Mongo) would be a sibling namespace, not a kernel change.

/** everything a plugin says about the database, beyond the entity values */
export interface DatabaseOptions {
  /**
   * Plugins whose tables this plugin's schema references.
   *
   * A hard constraint the assembly checks at resolve, so a missing dependency
   * is refused by plugin name instead of by postgres naming a relation halfway
   * through a migration. Distinct from the descriptor's own dependsOn, which
   * orders runtime construction.
   */
  readonly dependsOn?: readonly string[]
  /**
   * DDL applied after the tables exist, for what the metadata cannot declare.
   *
   * Today always the tenant-scoped composite foreign keys. Anything put here
   * has to be something the schema comparator can see, or it will never reach
   * a migration: the invisible half belongs in a baseline fragment.
   */
  readonly compositeForeignKeys?: readonly string[]
  /**
   * Package-relative directory of SQL fragments no schema comparison can see,
   * compiled into the lineage by `qualy generate`.
   */
  readonly baselineDir?: string
}

/** one plugin's whole database declaration */
export interface DatabaseDeclaration extends DatabaseOptions {
  readonly entities: readonly EntitySchema[]
}

/** every plugin's database declaration, in plugin order */
export const DatabaseEntities = ExtensionPoint.make<DatabaseDeclaration>(
  '@qualy/plugin-database/entities',
  { phase: 'prepare', capability: 'database' },
)

export const Db = {
  /** declares this plugin's tables and schema metadata; pure data until the owner compiles it */
  entities: (entities: readonly EntitySchema[], options?: DatabaseOptions): PluginFeature =>
    Plugin.contribute(DatabaseEntities, { entities, ...options }),

  /**
   * The owner's interpretation: the flattened set as the service the
   * connection reads. A prepare-phase value, which is what lets the orm - and
   * everything above it - depend on a complete set without any layer having
   * run first.
   *
   * The RETAINED set is not this one. Generation and deployment read the lock
   * so a disabled plugin's tables survive; this point carries what the
   * running selection declares, and the two meet in the migration CLI.
   */
  provider: Plugin.provideExtension(DatabaseEntities, {
    compile: (contributions) =>
      Layer.succeed(
        Entities,
        contributions.flatMap((declaration) => declaration.value.entities),
      ),
  }),

  /** a plugin's own typed view of the connection; see DatabaseScope */
  scope: <const T extends readonly unknown[]>(entities: T): DatabaseScope<T> => scope(entities),
}

/** the kysely a scope's queries are written against */
export type ScopedKysely<T extends readonly unknown[]> = ReturnType<
  typeof kyselyOf<ClosureEntityManager<T>>
>

/**
 * A plugin's own view of the database, in one handle.
 *
 * `scope(entities)` fixes the closure once - the tables this plugin may name,
 * its own and those of the plugins it declares schema dependencies on - and
 * `query` does what four helpers used to spell at every call site: take the
 * ambient manager (joining an open transaction by construction), speak entity
 * and property names, and put a driver failure in the error channel where the
 * constraint translator can reach it.
 */
export interface DatabaseScope<T extends readonly unknown[]> {
  readonly query: <A>(
    run: (db: ScopedKysely<T>) => Promise<A>,
  ) => Effect.Effect<A, QueryFailed, Orm>
}

export const scope = <const T extends readonly unknown[]>(entities: T): DatabaseScope<T> => {
  // the value fixes the type; the manager itself arrives ambiently, which is
  // what lets a call made inside a transaction join it
  void entities
  return {
    query: (run) => Effect.flatMap(entityManager<T>(), (em) => query(() => run(kyselyOf(em)))),
  }
}
