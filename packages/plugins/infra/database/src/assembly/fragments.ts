import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityResolveContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import type { DatabaseState } from './state.ts'

// SQL a plugin ships as files, compiled into a lineage by `qualy generate`.
//
// Two kinds share this machinery and mean opposite things:
//
//   A BASELINE fragment states the CURRENT shape of something no schema
//   comparison can see - an extension, a function, a seed row - and has to be
//   safe against a database that already has it (`IF NOT EXISTS`, `CREATE OR
//   REPLACE`, `ON CONFLICT DO NOTHING`). It is compiled into every lineage,
//   fresh or not, because a fresh database needs the object too.
//
//   A TRANSITION states a ONE-TIME change to existing data - a column's rows
//   moved into a new table, a permission code retired off the roles that held
//   it - written for the shape a previous release left behind. A fresh
//   instance has no such shape and no such rows: for it, the transition is
//   recorded as satisfied and never run. An instance with a history compiles
//   the SQL into its own lineage exactly once.
//
// What they share is the bookkeeping: a marker line in the migration that
// names the plugin, the file and a hash of its contents, so the next
// generation knows what is already history and refuses an edit to it.

export type FragmentKind = 'baseline' | 'transition'
export type FragmentPhase = 'pre-structure' | 'post-structure'

export interface SqlFragment {
  kind: FragmentKind
  plugin: string
  /** path inside the plugin package, which is what the marker records */
  file: string
  phase: FragmentPhase
  sha: string
  sql: string
}

const MARKER: Record<FragmentKind, string> = {
  baseline: '-- qualy-baseline:',
  transition: '-- qualy-transition:',
}
const DIRECTORY: Record<FragmentKind, keyof DatabaseContribution> = {
  baseline: 'baselineDir',
  transition: 'transitionsDir',
}
const PHASE = /^--\s*phase:\s*(pre-structure|post-structure)\s*$/m

/** the word a fresh instance writes after a transition's marker instead of running it */
export const SATISFIED = 'satisfied'

export const markerFor = (fragment: Pick<SqlFragment, 'kind' | 'plugin' | 'file' | 'sha'>) =>
  `${MARKER[fragment.kind]} ${fragment.plugin} ${fragment.file} ${fragment.sha}`

/**
 * Every fragment of one kind the current assembly declares, in a stable order.
 *
 * The order is the resolved database order, with ties broken by name, so
 * reordering the manifest cannot silently reorder SQL. Within a plugin the
 * numeric prefix decides. Disabled and detached plugins contribute too:
 * neither switching a plugin off nor taking it out of the manifest removes
 * its tables, so the objects those tables depend on have to stay as well - and
 * a transition a retained plugin shipped is history its tables still carry.
 */
export function collectFragments(
  kind: FragmentKind,
  context: Pick<
    CapabilityResolveContext<DatabaseContribution, DatabaseState>,
    'contributions' | 'resolvePackageDir'
  >,
  state: DatabaseState,
): SqlFragment[] {
  const fragments: SqlFragment[] = []
  for (const pluginId of state.order) {
    const declared = context.contributions.get(pluginId)?.[DIRECTORY[kind]]
    if (typeof declared !== 'string') continue
    const dir = path.resolve(context.resolvePackageDir(pluginId), declared)
    // one spelling in the marker whatever the declaration wrote: `./x` and
    // `x` name the same directory, and a marker is compared by string
    const inside = path.posix.normalize(declared.split(path.sep).join('/'))
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.sql')) continue
      const sql = fs.readFileSync(path.join(dir, name), 'utf8')
      const phase = (PHASE.exec(sql)?.[1] ?? 'post-structure') as FragmentPhase
      fragments.push({
        kind,
        plugin: pluginId,
        file: `${inside}/${name}`,
        phase,
        sha: createHash('sha256').update(sql).digest('hex').slice(0, 16),
        sql: sql.trim(),
      })
    }
  }
  return fragments
}

/**
 * What a lineage already carries of one kind, keyed by plugin and file.
 *
 * A transition recorded as satisfied counts as carried: the instance has
 * said it needs nothing from it, and that is as final as having run it.
 */
export function compiledFragments(kind: FragmentKind, migrationsDir: string): Map<string, string> {
  const compiled = new Map<string, string>()
  if (!fs.existsSync(migrationsDir)) return compiled
  const marker = MARKER[kind]
  for (const entry of fs.readdirSync(migrationsDir)) {
    if (!entry.endsWith('.sql')) continue
    for (const line of fs.readFileSync(path.join(migrationsDir, entry), 'utf8').split('\n')) {
      if (!line.startsWith(marker)) continue
      const [plugin, relative, sha] = line.slice(marker.length).trim().split(/\s+/)
      if (plugin && relative && sha) compiled.set(`${plugin} ${relative}`, sha)
    }
  }
  return compiled
}

/**
 * The fragments this generation has to write, having checked that nothing
 * already written has changed underneath the lineage.
 *
 * A compiled fragment is history: databases have run it, or recorded that
 * they never needed to. Editing the source afterwards would mean the lineage
 * and the package disagree about what was applied, and every database would
 * be right in a different way. Changing behaviour means adding a fragment
 * that supersedes it.
 */
export function pendingFragments(
  kind: FragmentKind,
  fragments: readonly SqlFragment[],
  compiled: ReadonlyMap<string, string>,
  carried: Iterable<string>,
): SqlFragment[] {
  // Whether the plugin is still part of this assembly, which is what the
  // retained order answers. Asking instead whether the plugin still has SOME
  // fragment on disk let a plugin delete its LAST one unnoticed: org owns
  // exactly one baseline, the extension its own column type needs, and
  // removing it generated a lineage that failed on any empty database with
  // `type "ltree" does not exist` - the very failure baselines exist to stop.
  const stillHere = new Set(carried)
  const drifted: string[] = []
  const vanished: string[] = []
  for (const [key, sha] of compiled) {
    const fragment = fragments.find((item) => `${item.plugin} ${item.file}` === key)
    if (!fragment) {
      // a plugin the assembly no longer carries at all keeps its history
      if (stillHere.has(key.split(' ')[0]!)) vanished.push(key)
      continue
    }
    if (fragment.sha !== sha) drifted.push(key)
  }
  const what = kind === 'baseline' ? 'baseline fragments' : 'transitions'
  if (drifted.length > 0) {
    throw new Error(
      `${what} changed after they were compiled into the lineage: ${drifted.join(', ')}. ` +
        'Add a fragment that supersedes them instead of editing history.',
    )
  }
  if (vanished.length > 0) {
    throw new Error(`${what} compiled into the lineage no longer exist: ${vanished.join(', ')}`)
  }
  return fragments.filter((fragment) => !compiled.has(`${fragment.plugin} ${fragment.file}`))
}

/** the fragment as it appears in a migration, marker first so it can be found again */
export const renderFragment = (fragment: SqlFragment) => `${markerFor(fragment)}\n${fragment.sql}`

/**
 * A transition a fresh instance records without running: there is no data
 * from a previous release for it to move, and running it against tables that
 * never had the old shape is a failure, not a no-op.
 */
export const renderSatisfied = (fragment: SqlFragment) => `${markerFor(fragment)} ${SATISFIED}`
