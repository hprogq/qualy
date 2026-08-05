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
import { databaseWork, drizzleKit, migrationDirs } from './drizzle.ts'
import { scanDestructive } from './drop-guard.ts'
import { asState, type DatabaseState } from './state.ts'

// Generation for the whole assembly: the tables drizzle derives from the
// aggregated schema, plus the SQL each plugin owns that drizzle cannot see.
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
  const name = flag(context.args, 'name')

  const fragments = collectBaseline(context, state)
  const pending = pendingBaseline(fragments, compiledBaseline(work.migrations), state.order)

  const before = new Set(migrationDirs(work.migrations))
  fs.mkdirSync(work.migrations, { recursive: true })
  drizzleKit(work, ['generate', ...(name ? ['--name', name] : [])])
  let created = migrationDirs(work.migrations).find((dir) => !before.has(dir))

  if (!created && pending.length > 0) {
    // no table changed, but a plugin declared sql that is not in the lineage
    // yet; an empty migration is the carrier drizzle offers for that
    drizzleKit(work, ['generate', '--custom', '--name', name ?? 'baseline'])
    created = migrationDirs(work.migrations).find((dir) => !before.has(dir))
  }

  if (!created) {
    if (pending.length > 0) {
      throw new Error('no migration was produced despite pending baseline fragments')
    }
    console.log('database: nothing to generate')
    return
  }

  if (pending.length > 0) {
    const file = path.join(work.migrations, created, 'migration.sql')
    // an empty custom migration arrives carrying drizzle's placeholder
    // comment, which is not structure and should not be framed as such
    const structure = fs
      .readFileSync(file, 'utf8')
      .replace(/^--\s*Custom SQL migration file.*$/m, '')
      .trim()
    const section = (phase: BaselineFragment['phase']) =>
      pending.filter((fragment) => fragment.phase === phase).map(renderBaseline)
    const parts = [
      ...section('pre-structure'),
      ...(structure ? [structure] : []),
      ...section('post-structure'),
    ]
    fs.writeFileSync(file, `${parts.join(`${BREAK}\n\n`)}\n`)
    for (const fragment of pending) {
      console.log(`database: compiled ${fragment.plugin} ${fragment.file} (${fragment.phase})`)
    }
  }

  console.log(`database: ${created}`)
  guardDestructive([path.join(work.migrations, created, 'migration.sql')])
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
