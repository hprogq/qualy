import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import {
  collectBaseline,
  compiledBaseline,
  pendingBaseline,
  renderBaseline,
  type BaselineFragment,
} from './baseline.ts'
import type { DatabaseContribution } from './contribution.ts'
import { loadEntityModules, structuralDiff } from './diff.ts'
import { scanDestructive } from './drop-guard.ts'
import { asState, type DatabaseState } from './state.ts'
import { createMigrationDir, databaseWork, migrationName } from './work.ts'

// Generation for the whole assembly: the tables the entities describe, plus
// the SQL each plugin owns that no schema comparison can see.
//
// Both have to land in one migration and in the right order. An extension is
// pre-structure because a column type depends on it; a trigger is
// post-structure because the table it guards has to exist first. Splitting
// them across two migrations would leave a window where the lineage does not
// apply to an empty database, which is exactly the failure this replaces.

const BREAK = '--> statement-breakpoint'

const flag = (args: readonly string[], name: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}

export async function generateDatabase(
  context: CapabilityWorkContext<DatabaseContribution, DatabaseState>,
): Promise<void> {
  const work = databaseWork(context)
  const state = asState(context.state)
  // before anything reads it: the lineage of an assembly that has never
  // generated is an empty directory, not a missing one
  fs.mkdirSync(work.migrations, { recursive: true })

  const fragments = collectBaseline(context, state)
  const pending = pendingBaseline(fragments, compiledBaseline(work.migrations), state.order)

  const modules = await loadEntityModules(work.entities)
  // every fragment, not just the pending ones: the declared database has to be
  // whole for the comparison to be about structure
  const { statements } = await structuralDiff(work, modules, fragments)

  if (statements.length === 0 && pending.length === 0) {
    console.log('database: nothing to generate')
    return
  }

  const section = (phase: BaselineFragment['phase']) =>
    pending.filter((fragment) => fragment.phase === phase).map(renderBaseline)
  const parts = [...section('pre-structure'), ...statements, ...section('post-structure')]

  const created = createMigrationDir(
    work.migrations,
    migrationName(flag(context.args, 'name'), 'update'),
  )
  const file = path.join(work.migrations, created, 'migration.sql')
  fs.writeFileSync(file, `${parts.join(`\n${BREAK}\n`)}\n`)

  for (const fragment of pending) {
    console.log(`database: compiled ${fragment.plugin} ${fragment.file} (${fragment.phase})`)
  }
  console.log(`database: ${created}`)
  guardDestructive([file])
}

/**
 * Destructive statements never leave generation silently.
 *
 * A freshly generated migration that drops tables, columns or whole schemas
 * requires ALLOW_DESTRUCTIVE=1, or an explicit '-- destructive: approved'
 * marker inside the migration for one that has been reviewed.
 */
export function guardDestructive(files: readonly string[]): void {
  const hits = scanDestructive(files)
  if (hits.length > 0 && process.env.ALLOW_DESTRUCTIVE !== '1') {
    const detail = hits.map((hit) => `  ${hit}`).join('\n')
    throw new Error(
      `database: destructive statements detected, set ALLOW_DESTRUCTIVE=1 to proceed\n${detail}`,
    )
  }
  console.log(`database: drop guard ok (${files.length} file(s) scanned)`)
}
