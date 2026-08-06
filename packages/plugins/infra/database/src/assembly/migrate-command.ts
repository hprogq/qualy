import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import type { CliContext } from '@qualy/plugin-kit/cli'
import type { DatabaseContribution } from './contribution.ts'
import type { DatabaseState } from './state.ts'
import { databaseWork } from './work.ts'
import { loadEntityModules } from './diff.ts'
import { runMigrations } from '../migrator.ts'

// `qualy db migrate` - the migration half of deploy, on its own.
//
// Loaded when invoked and never before: this module reaches the migrator and
// the entity loader, which the server boot and the descriptor import must
// not pay for.

export async function run(context: CliContext): Promise<void> {
  const work = databaseWork(
    context.capability as CapabilityWorkContext<DatabaseContribution, DatabaseState>,
  )
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
}
