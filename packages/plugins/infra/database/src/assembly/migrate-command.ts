import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import type { CliContext } from '@qualy/plugin-kit/cli'
import type { DatabaseContribution } from './contribution.ts'
import type { DatabaseState } from './state.ts'
import { databaseTarget, databaseWork } from './work.ts'
import { runMigrations } from '../migrator.ts'

// `qualy db migrate` - the migration half of deploy, on its own.
//
// Loaded when invoked and never before: this module reaches the migrator,
// which the server boot and the descriptor import must not pay for.

export async function run(context: CliContext): Promise<void> {
  const work = databaseWork(
    context.capability as CapabilityWorkContext<DatabaseContribution, DatabaseState>,
  )
  const { applied, elapsed } = await runMigrations(work.url, {
    folder: work.migrations,
    entities: work.modules.flatMap((module) => [...module.entities]),
  })
  const target = databaseTarget(work.url)
  console.log(
    applied > 0
      ? `database: applied ${applied} migration(s) to ${target} (${elapsed}ms)`
      : `database: ${target} is up to date (${elapsed}ms)`,
  )
}
