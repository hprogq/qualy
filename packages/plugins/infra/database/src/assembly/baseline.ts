import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityResolveContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import type { DatabaseState } from './state.ts'

// SQL a plugin owns that no schema comparison can see: extensions, functions,
// triggers, views, and the rows a schema is unusable without.
//
// Everything a plugin needs used to be expressible except this. A table came
// from its entities and reached the lineage on its own, but `CREATE EXTENSION
// ltree` sat in a hand-written host migration marked `-- owner:
// @qualy/plugin-org`: the ownership was already stated, only the carrier was
// missing. The consequence showed up as soon as a different plugin selection
// tried to build its own lineage from nothing, because a schema generator
// reproduces tables and nothing else, and org_nodes cannot be created without
// the type the extension provides.
//
// A fragment states the CURRENT shape of what it owns, not the history of
// how it got there, so it has to be safe to run against a database that
// already has it. `CREATE EXTENSION IF NOT EXISTS`, `CREATE OR REPLACE
// FUNCTION`, `INSERT ... ON CONFLICT DO NOTHING`. That is the difference
// between these and the one-off custom migrations the manual-SQL rule
// governs: those record a step in time and are written as strict CREATE.

export type BaselinePhase = 'pre-structure' | 'post-structure'

export interface BaselineFragment {
  plugin: string
  /** path inside the plugin package, which is what the marker records */
  file: string
  phase: BaselinePhase
  sha: string
  sql: string
}

const MARKER = '-- qualy-baseline:'
const PHASE = /^--\s*phase:\s*(pre-structure|post-structure)\s*$/m

export const markerFor = (fragment: Pick<BaselineFragment, 'plugin' | 'file' | 'sha'>) =>
  `${MARKER} ${fragment.plugin} ${fragment.file} ${fragment.sha}`

/**
 * Every fragment the current assembly declares, in a stable order.
 *
 * The order is the resolved database order, with ties broken by name, so
 * reordering the manifest cannot silently reorder SQL. Within a plugin the
 * numeric prefix decides. Disabled and detached plugins contribute too:
 * neither switching a plugin off nor taking it out of the manifest removes
 * its tables, so the objects those tables depend on have to stay as well.
 */
export function collectBaseline(
  context: Pick<
    CapabilityResolveContext<DatabaseContribution, DatabaseState>,
    'contributions' | 'resolvePackageDir'
  >,
  state: DatabaseState,
): BaselineFragment[] {
  const fragments: BaselineFragment[] = []
  for (const pluginId of state.order) {
    const declared = context.contributions.get(pluginId)?.baselineDir
    if (!declared) continue
    const dir = path.resolve(context.resolvePackageDir(pluginId), declared)
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.sql')) continue
      const sql = fs.readFileSync(path.join(dir, name), 'utf8')
      const phase = (PHASE.exec(sql)?.[1] ?? 'post-structure') as BaselinePhase
      fragments.push({
        plugin: pluginId,
        file: `${declared}/${name}`,
        phase,
        sha: createHash('sha256').update(sql).digest('hex').slice(0, 16),
        sql: sql.trim(),
      })
    }
  }
  return fragments
}

/** what the committed lineage already carries, keyed by plugin and file */
export function compiledBaseline(migrationsDir: string): Map<string, string> {
  const compiled = new Map<string, string>()
  if (!fs.existsSync(migrationsDir)) return compiled
  for (const dir of fs.readdirSync(migrationsDir)) {
    const file = path.join(migrationsDir, dir, 'migration.sql')
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.startsWith(MARKER)) continue
      const [plugin, relative, sha] = line.slice(MARKER.length).trim().split(/\s+/)
      if (plugin && relative && sha) compiled.set(`${plugin} ${relative}`, sha)
    }
  }
  return compiled
}

/**
 * The fragments this generation has to write, having checked that nothing
 * already written has changed underneath the lineage.
 *
 * A compiled fragment is history: databases have run it. Editing the source
 * afterwards would mean the lineage and the package disagree about what was
 * applied, and every database would be right in a different way. Changing
 * behaviour means adding a fragment that supersedes it.
 */
export function pendingBaseline(
  fragments: readonly BaselineFragment[],
  compiled: ReadonlyMap<string, string>,
  carried: Iterable<string>,
): BaselineFragment[] {
  // Whether the plugin is still part of this assembly, which is what the
  // retained order answers. Asking instead whether the plugin still has SOME
  // fragment on disk let a plugin delete its LAST one unnoticed: org owns
  // exactly one, the extension its own column type needs, and removing it
  // generated a lineage that failed on any empty database with
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
  if (drifted.length > 0) {
    throw new Error(
      `baseline fragments changed after they were compiled into the lineage: ${drifted.join(', ')}. ` +
        'Add a fragment that supersedes them instead of editing history.',
    )
  }
  if (vanished.length > 0) {
    throw new Error(
      `baseline fragments compiled into the lineage no longer exist: ${vanished.join(', ')}`,
    )
  }
  return fragments.filter((fragment) => !compiled.has(`${fragment.plugin} ${fragment.file}`))
}

/** the fragment as it appears in a migration, marker first so it can be found again */
export const renderBaseline = (fragment: BaselineFragment) =>
  `${markerFor(fragment)}\n${fragment.sql}`
