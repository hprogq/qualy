import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import { collectBaseline, compiledBaseline, pendingBaseline } from './baseline.ts'
import type { DatabaseContribution } from './contribution.ts'
import { structuralDiff } from './diff.ts'
import { destructiveIn, scanDestructive } from './drop-guard.ts'
import { renderFragment, renderSatisfied, type FragmentPhase, type SqlFragment } from './fragments.ts'
import { asState, type DatabaseState } from './state.ts'
import { collectTransitions, compiledTransitions, pendingTransitions } from './transitions.ts'
import { databaseWork, type DatabaseWork } from './work.ts'

// Generation for the whole assembly: the tables the entities describe, the SQL
// each plugin owns that no schema comparison can see, and the one-time data
// steps a plugin shipped for the shape a previous release left behind.
//
// All of it lands in one migration, in the right order. An extension is
// pre-structure because a column type depends on it; a trigger is
// post-structure because the table it guards has to exist first; a transition
// that fills a new table from an old column runs after the table exists and
// before anything drops the column - which is why dropping is the next
// release's job. Splitting them across two migrations would leave a window
// where the lineage does not apply to an empty database, which is exactly the
// failure this replaces.
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

/** whether a lineage has ever had a migration: the line between a fresh instance and an upgrade */
export const isFreshLineage = (migrations: string): boolean =>
  !fs.existsSync(migrations) || !fs.readdirSync(migrations).some((entry) => entry.endsWith('.sql'))

export interface MigrationPlan {
  /** the whole migration, as it would be written */
  sql: string
  /** the structural statements, in order */
  structural: string[]
  /** baseline fragments compiled by this migration */
  baseline: SqlFragment[]
  /** transitions this migration accounts for: run on an upgrade, recorded as satisfied on a fresh instance */
  transitions: SqlFragment[]
  /** whether the instance had no lineage before this migration */
  fresh: boolean
}

/**
 * What the next migration of this instance would carry, or nothing.
 *
 * Pure with respect to the lineage: it reads the instance's migrations and the
 * plugins' fragments, builds the two scratch databases the comparison needs,
 * and writes no file. `generateDatabase` writes the result; the test kit uses
 * the same plan to build the declared schema a fresh instance would get.
 */
export async function planMigration(
  context: Pick<
    CapabilityWorkContext<DatabaseContribution, DatabaseState>,
    'contributions' | 'resolvePackageDir' | 'state'
  >,
  work: DatabaseWork,
): Promise<MigrationPlan | undefined> {
  const state = asState(context.state)
  const fresh = isFreshLineage(work.migrations)

  const baseline = collectBaseline(context, state)
  const pending = pendingBaseline(baseline, compiledBaseline(work.migrations), state.order)
  const transitions = pendingTransitions(
    collectTransitions(context, state),
    compiledTransitions(work.migrations),
    state.order,
  )

  // every baseline fragment, not just the pending ones: the declared database
  // has to be whole for the comparison to be about structure. Transitions are
  // not part of the declared shape at all - they move data, and the declared
  // database has none.
  const diff = await structuralDiff(work, work.modules, baseline)

  if (diff.up.length === 0 && pending.length === 0 && transitions.length === 0) return undefined

  const phase = (fragments: readonly SqlFragment[], want: FragmentPhase) =>
    fragments.filter((fragment) => fragment.phase === want).map(renderFragment)
  // an upgrade runs its transitions in phase order, after the baseline of the
  // same phase so a function a baseline defines is there for a transition to
  // call; a fresh instance records every one of them at the end and runs none
  const run = fresh ? [] : transitions
  const parts = [
    ...phase(pending, 'pre-structure'),
    ...phase(run, 'pre-structure'),
    ...diff.up,
    ...phase(pending, 'post-structure'),
    ...phase(run, 'post-structure'),
  ]
  const satisfied = fresh ? transitions.map(renderSatisfied) : []
  const sql = `${[...parts.map(terminated), ...satisfied].join('\n\n')}\n`
  return { sql, structural: diff.up, baseline: pending, transitions, fresh }
}

/** a statement ends in a semicolon; a fragment that already does is left alone */
const terminated = (part: string) => (part.trimEnd().endsWith(';') ? part : `${part};`)

const stampOf = (at: Date) => at.toISOString().replace(/\D/g, '').slice(0, 14)

/**
 * The next migration's instant, strictly after every migration already there.
 *
 * The clock alone is not enough. Two generations inside one second share a
 * stamp, and the second rename lands on the first file: a deploy that
 * generated twice - or a suite that does - silently replaced a migration
 * instead of adding one. A clock that has gone backwards would order the new
 * migration before an older one for the same reason. So the stamp is the
 * later of now and the lineage's last instant plus one second.
 */
export function nextStamp(migrations: string): string {
  const latest = fs.existsSync(migrations)
    ? fs
        .readdirSync(migrations)
        .map((entry) => /^(\d{14})/.exec(entry)?.[1])
        .filter((found): found is string => found !== undefined)
        .sort()
        .at(-1)
    : undefined
  const now = stampOf(new Date())
  if (latest === undefined || latest < now) return now
  // one second past the latest: the stamp is a UTC instant, parsed back and
  // advanced, so 59 rolls into the next minute rather than into 60
  const parsed = new Date(
    Date.UTC(
      Number(latest.slice(0, 4)),
      Number(latest.slice(4, 6)) - 1,
      Number(latest.slice(6, 8)),
      Number(latest.slice(8, 10)),
      Number(latest.slice(10, 12)),
      Number(latest.slice(12, 14)) + 1,
    ),
  )
  return stampOf(parsed)
}

export async function generateDatabase(
  context: CapabilityWorkContext<DatabaseContribution, DatabaseState>,
): Promise<void> {
  const work = databaseWork(context)
  // before anything reads it: the lineage of an assembly that has never
  // generated is an empty directory, not a missing one
  fs.mkdirSync(work.migrations, { recursive: true })

  const plan = await planMigration(context, work)
  if (plan === undefined) {
    console.log('database: nothing to generate')
    return
  }

  const given = flag(context.args, 'name')
  const file = path.join(
    work.migrations,
    `${nextStamp(work.migrations)}${given ? `_${slug(given)}` : ''}.sql`,
  )

  // before it exists, not after: a refused migration that had already landed
  // would be applied by the next deploy, and its markers would be read as
  // compiled by the next generate - so refusing it once would silently drop
  // those fragments from every migration after it
  refuse(destructiveIn(path.basename(file), plan.sql), 1)
  writeMigration(file, plan.sql)

  for (const fragment of plan.baseline) {
    console.log(`database: compiled ${fragment.plugin} ${fragment.file} (${fragment.phase})`)
  }
  for (const transition of plan.transitions) {
    console.log(
      plan.fresh
        ? `database: transition ${transition.plugin} ${transition.file} satisfied (fresh instance, not run)`
        : `database: transition ${transition.plugin} ${transition.file} (${transition.phase})`,
    )
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
 * An empty migration, for the SQL that records one historical step of ONE
 * instance - an emergency repair, a hand-made fix. It is not how a change
 * reaches other instances: that is a transition, shipped by the plugin.
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
