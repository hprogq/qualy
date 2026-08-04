import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readEntries } from './read-entries.ts'
import { resolvePackageDir } from './schema-entries.ts'

// SQL a plugin owns that drizzle cannot express: extensions, functions,
// triggers, views, and the rows a schema is unusable without.
//
// Everything a plugin needs used to be expressible except this. A table came
// from schemaEntry and reached the lineage on its own, but `CREATE EXTENSION
// ltree` sat in a hand-written host migration marked `-- owner:
// @qualy/plugin-org`: the ownership was already stated, only the carrier was
// missing. The consequence showed up as soon as a different plugin selection
// tried to build its own lineage from nothing, because drizzle-kit generate
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
 * Plugins are sorted by name rather than by manifest position, so reordering
 * qualy.yml cannot silently reorder SQL. Within a plugin the numeric prefix
 * decides. Ordering ACROSS plugins only matters once one plugin's fragment
 * depends on another's, which nothing does yet; when it does, the fix is a
 * declared database dependency, not a rule about filenames.
 */
export function collectBaseline(options: { ymlPath?: string } = {}): BaselineFragment[] {
  const fragments: BaselineFragment[] = []
  // disabled entries contribute too: turning a plugin off leaves its tables
  // in place, so the objects those tables depend on have to stay as well
  const entries = readEntries({ all: true, ymlPath: options.ymlPath })
    .filter((entry) => entry.name.startsWith('@qualy/'))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const packageDir = resolvePackageDir(entry.name)
    const manifest = path.join(packageDir, 'package.json')
    if (!fs.existsSync(manifest)) continue
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      qualy?: { database?: { baselineDir?: string } }
    }
    const declared = pkg.qualy?.database?.baselineDir
    if (!declared) continue
    const dir = path.resolve(packageDir, declared)
    // declared but missing is a broken package, not an empty contribution
    if (!fs.existsSync(dir)) {
      throw new Error(`${entry.name}: declared baselineDir ${declared} does not exist`)
    }
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.sql')) continue
      const sql = fs.readFileSync(path.join(dir, name), 'utf8')
      const phase = (PHASE.exec(sql)?.[1] ?? 'post-structure') as BaselinePhase
      fragments.push({
        plugin: entry.name,
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
): BaselineFragment[] {
  const declared = new Set(fragments.map((fragment) => `${fragment.plugin} ${fragment.file}`))
  const drifted: string[] = []
  const vanished: string[] = []
  for (const [key, sha] of compiled) {
    const fragment = fragments.find((item) => `${item.plugin} ${item.file}` === key)
    if (!fragment) {
      // a plugin the assembly no longer carries at all keeps its history;
      // only a still-declared plugin losing a compiled file is a fault
      if (declared.size > 0 && [...declared].some((id) => id.startsWith(`${key.split(' ')[0]} `))) {
        vanished.push(key)
      }
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
  return fragments.filter(
    (fragment) => !compiled.has(`${fragment.plugin} ${fragment.file}`),
  )
}

/** the fragment as it appears in a migration, marker first so it can be found again */
export const renderBaseline = (fragment: BaselineFragment) =>
  `${markerFor(fragment)}\n${fragment.sql}`
