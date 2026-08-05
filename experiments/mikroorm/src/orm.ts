import { MikroORM } from '@mikro-orm/postgresql'
import { entities } from './entities.ts'

// The connection this spike measures against, opened the way a host would.
//
// The entity tuple is threaded through rather than widened. `MikroORM.init`
// carries it into `orm.em` as a phantom `'~entities'` property, and
// `getKysely()` reads its column types back out of that
// (repos/mikro-orm/packages/sql/src/SqlEntityManager.ts:241). Passing the
// tuple as `EntitySchema[]`, or taking a bare `EntityManager` below, erases it
// - and the failure is quiet: every table name becomes `never`, so `selectFrom`
// rejects every string and the errors point at the call rather than at the
// wiring. This is what the upstream `discovery:export` command generates for
// the same reason.

export type Orm = Awaited<ReturnType<typeof open>>

/** the manager type that still knows what the assembly contains */
export type Em = Orm['em']

export const open = async (clientUrl: string) =>
  MikroORM.init({
    entities,
    clientUrl,
    // the schema already exists; this spike compares querying, and lets the
    // migration questions be asked separately
    discovery: { warnWhenNoEntities: false },
    // a spike that logs every statement measures the logger
    debug: false,
  })

/**
 * Kysely, told to speak entity and property names.
 *
 * Without the plugin it is a bare query builder over raw table names, which
 * would answer the type-safety question with a different tool than the one an
 * assembly would ship. `convertValues` is what makes a uuid property compare
 * against a uuid column rather than against text.
 */
export const kyselyOf = <T extends Em>(em: T) =>
  em.getKysely({
    tableNamingStrategy: 'entity',
    columnNamingStrategy: 'property',
    convertValues: true,
  })
