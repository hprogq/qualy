import { MikroORM, type EntityManager as PostgresEntityManager } from '@mikro-orm/postgresql'
import { UnderscoreNamingStrategy, type EntitySchema } from '@mikro-orm/core'
import { Context, Effect, Layer, Redacted } from 'effect'
import { DatabaseConfig } from './config.ts'

// The ORM as an Effect resource, built from an entity set the host hands in.
//
// The plugin does not discover entities. Discovery would have to read files
// the assembly decides, which is exactly the question the manifest already
// answers - and a glob would find the tables of plugins this assembly does not
// include. What runs is what the aggregate says, and the aggregate is derived
// from the lock.

/**
 * Every entity this assembly retains, in the order the database capability
 * decided.
 *
 * Widened to the schema array here on purpose. The tuple type matters to the
 * plugins that write queries, and each of them narrows the manager to its own
 * closure rather than to this one: org may reach org's tables and the ones it
 * declares a database dependency on, and taking the aggregate's type would let
 * it reach rbac by accident while making it depend on the host.
 */
export class Entities extends Context.Service<Entities, readonly EntitySchema[]>()(
  '@qualy/plugin-database/Entities',
) {}

export class Orm extends Context.Service<Orm, MikroORM>()('@qualy/plugin-database/Orm') {}

/**
 * How this schema names its constraints.
 *
 * A composite primary key is `pk_<table>`; a single-column one takes the
 * postgres default. That is what the deployed schema does throughout, and it
 * has to be said here because the name comes from one assembly-wide strategy
 * with no per-entity override - so the alternative was a table of exceptions
 * naming tables from several plugins, which is knowledge this plugin has no
 * business holding, or renaming five live constraints to suit the tool.
 */
export class QualyNamingStrategy extends UnderscoreNamingStrategy {
  override indexName(
    tableName: string,
    columns: string[],
    type: 'primary' | 'foreign' | 'unique' | 'index' | 'sequence' | 'check' | 'default' | 'trigger',
  ): string {
    if (type === 'primary' && columns.length > 1) return `pk_${tableName}`
    return super.indexName(tableName, columns, type)
  }
}

/**
 * The manager a plugin writes its queries against.
 *
 * `'~entities'` is the phantom property MikroORM carries from `init` into the
 * manager, and it is where `getKysely()` reads column types back out of. A
 * plugin declares its own closure as this parameter, so its queries reach its
 * tables and stop there.
 */
export type ClosureEntityManager<T extends readonly unknown[]> = PostgresEntityManager & {
  '~entities': T
}

/**
 * A fresh manager, typed for the caller's own tables.
 *
 * The ORM was built from the whole assembly, so its manager is wider than any
 * one plugin's closure and has to be narrowed. Narrowing is the safe
 * direction - a plugin that names fewer tables reaches fewer tables - but it
 * is still an assertion, so it is made once here instead of at every call
 * site, where fifteen copies would eventually disagree about which one is a
 * lie.
 *
 * Forked rather than shared: the manager carries an identity map, and one
 * shared across requests is one request seeing another's rows.
 */
export const entityManager = <const T extends readonly unknown[]>(): Effect.Effect<
  ClosureEntityManager<T>,
  never,
  Orm
> =>
  Effect.gen(function* () {
    const orm = yield* Orm
    return orm.em.fork() as unknown as ClosureEntityManager<T>
  })

/**
 * Kysely, told to speak entity and property names.
 *
 * Generic over the manager rather than over one assembly's entity set: bound
 * to a concrete one it would stop accepting any other, so every plugin would
 * need a copy of this helper, and the copies would differ in exactly the
 * option that decides whether a uuid compares as a uuid.
 */
export const kyselyOf = <T extends PostgresEntityManager>(em: T) =>
  em.getKysely({
    tableNamingStrategy: 'entity',
    columnNamingStrategy: 'property',
    convertValues: true,
  })

/**
 * The ORM, closed when the layer that built it is.
 *
 * It does not migrate: the lineage is applied by the layer that owns the
 * connection, before anything is built on top of it, and a second thing
 * deciding whether the schema is current is a second answer.
 */
export const layer: Layer.Layer<Orm, never, DatabaseConfig | Entities> = Layer.effect(
  Orm,
  Effect.gen(function* () {
    const config = yield* DatabaseConfig
    const entities = yield* Entities
    return yield* Effect.acquireRelease(
      Effect.promise(() =>
        MikroORM.init({
          entities: entities as EntitySchema[],
          clientUrl: Redacted.value(config.url),
          namingStrategy: QualyNamingStrategy,
          // an assembly part way through the migration has entities for some
          // of its tables and none for the rest, which is not a mistake
          discovery: { warnWhenNoEntities: false },
        }),
      ),
      (orm) => Effect.promise(() => orm.close()),
    )
  }),
)
