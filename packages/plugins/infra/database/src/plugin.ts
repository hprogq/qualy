import type { EntitySchema } from '@mikro-orm/core'
import { Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import { Entities } from './server/orm.ts'

// This capability's face in the descriptor model: what a plugin writes to say
// "I own these tables", and what the owner does with all of them.
//
// The constructor namespace is the open-world answer to `ctx.db.addSchema`:
// the kernel never learns what an entity is, this module does - and a second
// database (or a Mongo) would be a sibling namespace, not a kernel change.

/** every entity tuple contributed by the assembly's plugins, in plugin order */
export const DatabaseEntities = ExtensionPoint.make<readonly EntitySchema[]>(
  '@qualy/plugin-database/entities',
  { phase: 'prepare' },
)

export const Postgres = {
  /** declares this plugin's tables; pure data until the owner compiles it */
  entities: (entities: readonly EntitySchema[]): PluginFeature =>
    Plugin.contribute(DatabaseEntities, entities),

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
    compile: (contributions) => Layer.succeed(Entities, contributions.flat()),
  }),
}
