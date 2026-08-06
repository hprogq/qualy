import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineCapabilityProvider } from '@qualy/assembly-contract'
import {
  lockedOwnsObjects,
  parseDatabaseContribution,
  type DatabaseContribution,
} from './contribution.ts'
import { assertDistinctPrefixes, databaseWork, LOCAL_FALLBACK } from './work.ts'
import { allMigrationFiles, changedMigrationFiles } from './drop-guard.ts'
import {
  assertNoCollisions,
  ENTITIES_MODULE,
  entityContributions,
  renderEntityModule,
} from './entities.ts'
import { loadEntityModules } from './diff.ts'
import { blankMigration, generateDatabase, guardDestructive } from './generate.ts'
import { runMigrations } from '../migrator.ts'
import { asState, resolveDatabase, type DatabaseState } from './state.ts'

// Everything the assembly knows about databases lives behind this one module.
//
// The assembly core reaches it because @qualy/plugin-database's package.json
// declares qualy.capabilityProvider, and it disappears the moment that plugin
// leaves the manifest: an assembly of plugins that own no tables never loads
// this file, never resolves a schema and never opens a database.
//
// Importing this module must stay free of side effects. It runs inside the
// CLI, where there is no cordis context to attach to and nothing has agreed to
// open a connection yet. Connections belong inside deploy and the commands.

const arg = (args: readonly string[], name: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}

export default defineCapabilityProvider<DatabaseContribution, DatabaseState>({
  key: 'database',

  parseContribution: parseDatabaseContribution,

  resolve: resolveDatabase,

  // Tables outlive the plugin that declared them. A plugin taken out of the
  // manifest keeps its place in the assembly so its schema keeps contributing
  // and nothing generates a DROP for data nobody agreed to lose. One that
  // declared no objects at all leaves, since there is nothing to remember.
  retainsPlugin: ({ previousContribution }) => lockedOwnsObjects(previousContribution),

  plan: ({ previousState, nextState }) => {
    const before = new Set(asState(previousState).order)
    const after = new Set(nextState.order)
    const lines = [
      ...[...after].filter((id) => !before.has(id)).map((id) => `+ ${id}`),
      ...[...before].filter((id) => !after.has(id)).map((id) => `- ${id}`),
    ].sort()
    return lines.length > 0 ? lines : [`${nextState.order.length} plugin(s) own objects`]
  },

  // The host imports one tuple, not one import per plugin, and the tuple is
  // what carries table names into the query builder. Derived on every codegen
  // rather than committed: it is a function of the plugin set, and a stale one
  // types queries against a schema this assembly does not have.
  modules: (context) => {
    const contributions = entityContributions(context, asState(context.state))
    assertNoCollisions(contributions)
    return [{ path: ENTITIES_MODULE, content: renderEntityModule(contributions) }]
  },

  generate: generateDatabase,

  deploy: async (context) => {
    const work = databaseWork(context)
    const modules = await loadEntityModules(work.entities)
    const { applied, elapsed } = await runMigrations(work.url, {
      folder: work.migrations,
      entities: modules.flatMap((module) => [...module.entities]),
    })
    console.log(
      applied > 0
        ? `database: applied ${applied} migration(s) (${elapsed}ms)`
        : `database: migrations up to date (${elapsed}ms)`,
    )
  },

  commands: {
    // a lineage where two branches added a migration with the same prefix
    // applies in an order that depends on which one you checked out
    check: async (context) => {
      const work = databaseWork(context)
      assertDistinctPrefixes(work.migrations)
      console.log('database: lineage ok')
    },

    // an empty migration for SQL that records one historical step, as opposed
    // to a baseline fragment, which states a plugin's current shape
    custom: async (context) => {
      const work = databaseWork(context)
      const file = blankMigration(work.migrations, arg(context.args, 'name'))
      console.log(`database: ${path.relative(process.cwd(), file)}`)
    },

    'drop-guard': async (context) => {
      const work = databaseWork(context)
      const baseRef = arg(context.args, 'base-ref')
      if (baseRef) {
        guardDestructive(changedMigrationFiles(work.migrations, baseRef))
        return
      }
      // a full scan that finds nothing has either nothing to find or the wrong
      // folder, and reporting the second as ok is how a guard stops guarding
      if (!existsSync(work.migrations)) {
        throw new Error(`database: there is no lineage at ${work.migrations} to scan`)
      }
      guardDestructive(allMigrationFiles(work.migrations))
    },

    // where this assembly keeps its lineage, for scripts that need the path
    // without reimplementing how it is derived
    where: async (context) => {
      const work = databaseWork(context)
      console.log(path.relative(process.cwd(), work.migrations))
    },
  },
})

export { LOCAL_FALLBACK }
export type { DatabaseContribution, DatabaseState }
