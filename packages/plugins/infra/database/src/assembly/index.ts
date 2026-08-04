import { existsSync } from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'
import { defineCapabilityProvider } from '@qualy/assembly-contract'
import {
  lockedOwnsObjects,
  parseDatabaseContribution,
  type DatabaseContribution,
} from './contribution.ts'
import { databaseWork, drizzleKit, LOCAL_FALLBACK } from './drizzle.ts'
import { allMigrationFiles, changedMigrationFiles } from './drop-guard.ts'
import { generateDatabase, guardDestructive } from './generate.ts'
import { runMigrations } from '../migrator.ts'
import { asState, resolveDatabase, type DatabaseState } from './state.ts'

// Everything the assembly knows about databases lives behind this one module.
//
// The assembly core reaches it because @qualy/plugin-database's package.json
// declares qualy.capabilityProvider, and it disappears the moment that plugin
// leaves the manifest: an assembly of plugins that own no tables never loads
// this file, never resolves a schema and never runs drizzle.
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

  generate: generateDatabase,

  deploy: async (context) => {
    const work = databaseWork(context)
    const pool = new Pool({ connectionString: work.url })
    try {
      const { applied, elapsed } = await runMigrations(pool, { folder: work.migrations })
      console.log(
        applied > 0
          ? `database: applied ${applied} migration(s) (${elapsed}ms)`
          : `database: migrations up to date (${elapsed}ms)`,
      )
    } finally {
      await pool.end()
    }
  },

  commands: {
    // a lineage where two branches added a migration with the same prefix
    // applies in an order that depends on which one you checked out
    check: async (context) => {
      console.log(drizzleKit(databaseWork(context), ['check']).trim())
    },

    // an empty migration for SQL that records one historical step, as opposed
    // to a baseline fragment, which states a plugin's current shape
    custom: async (context) => {
      const work = databaseWork(context)
      const name = arg(context.args, 'name')
      console.log(
        drizzleKit(work, ['generate', '--custom', ...(name ? ['--name', name] : [])]).trim(),
      )
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

    studio: async (context) => {
      drizzleKit(databaseWork(context), ['studio'])
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
