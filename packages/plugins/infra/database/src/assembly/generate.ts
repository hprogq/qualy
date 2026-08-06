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
import { destructiveIn, scanDestructive } from './drop-guard.ts'
import { asState, type DatabaseState } from './state.ts'
import { databaseWork } from './work.ts'

// Generation for the whole assembly: the tables the entities describe, plus
// the SQL each plugin owns that no schema comparison can see.
//
// Both have to land in one migration and in the right order. An extension is
// pre-structure because a column type depends on it; a trigger is
// post-structure because the table it guards has to exist first. Splitting
// them across two migrations would leave a window where the lineage does not
// apply to an empty database, which is exactly the failure this replaces.
//
// A migration is a .sql file named by the instant it was generated, which is
// also the order it applies in. Nothing else is in it: no separator
// convention, no wrapper class, nothing that has to be parsed back out.

const flag = (args: readonly string[], name: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}

/** what a --name may become once it has to be part of a filename */
const slug = (given: string) => {
  const cleaned = given
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!cleaned) throw new Error(`database: --name ${given} has no usable characters`)
  return cleaned
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
  const diff = await structuralDiff(work, modules, fragments)

  if (diff.up.length === 0 && pending.length === 0) {
    console.log('database: nothing to generate')
    return
  }

  const section = (phase: BaselineFragment['phase']) =>
    pending.filter((fragment) => fragment.phase === phase).map(renderBaseline)
  const parts = [...section('pre-structure'), ...diff.up, ...section('post-structure')]
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const given = flag(context.args, 'name')
  const file = path.join(work.migrations, `${stamp}${given ? `_${slug(given)}` : ''}.sql`)
  const sql = `${parts.map((part) => (part.trimEnd().endsWith(';') ? part : `${part};`)).join('\n\n')}\n`

  // before it exists, not after: a refused migration that had already landed
  // would be applied by the next deploy, and its baseline markers would be read
  // as compiled by the next generate - so refusing it once would silently drop
  // those fragments from every migration after it
  refuse(destructiveIn(path.basename(file), sql), 1)
  writeMigration(file, sql)

  for (const fragment of pending) {
    console.log(`database: compiled ${fragment.plugin} ${fragment.file} (${fragment.phase})`)
  }
  console.log(`database: ${path.basename(file)}`)
}

/**
 * A migration lands whole or not at all.
 *
 * A half-written file is worse than a missing one: the lineage would apply the
 * part that made it to disk and record the whole thing as done.
 */
function writeMigration(file: string, sql: string): void {
  const temp = `${file}.${process.pid}.tmp`
  const handle = fs.openSync(temp, 'wx')
  try {
    fs.writeFileSync(handle, sql)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  try {
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

/**
 * An empty migration, for the SQL that records one historical step.
 *
 * The other half of the baseline rule: a fragment states a plugin's current
 * shape and has to be idempotent, this records a step in time and is written
 * as a strict CREATE.
 */
export function blankMigration(migrations: string, name: string | undefined): string {
  fs.mkdirSync(migrations, { recursive: true })
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const file = path.join(migrations, `${stamp}_${slug(name ?? 'custom')}.sql`)
  fs.writeFileSync(file, '-- owner: @qualy/plugin-<name>\n')
  return file
}

/**
 * Destructive statements never leave generation silently.
 *
 * A freshly generated migration that drops tables, columns or whole schemas
 * requires ALLOW_DESTRUCTIVE=1, or an explicit '-- destructive: approved'
 * marker inside the migration for one that has been reviewed.
 */
export function guardDestructive(files: readonly string[]): void {
  refuse(scanDestructive(files), files.length)
}

function refuse(hits: readonly string[], scanned: number): void {
  if (hits.length > 0 && process.env.ALLOW_DESTRUCTIVE !== '1') {
    const detail = hits.map((hit) => `  ${hit}`).join('\n')
    throw new Error(
      `database: destructive statements detected, set ALLOW_DESTRUCTIVE=1 to proceed\n${detail}`,
    )
  }
  console.log(`database: drop guard ok (${scanned} file(s) scanned)`)
}
