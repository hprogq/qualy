import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// installed.lock.json is the single authority for the installed set: which
// plugins' database objects must exist. cordis.yml only controls the active
// set and must never influence anything derived from the installed set.

export interface InstalledEntry {
  id: string
  version: string
  dependsOn: string[]
}

export interface ResolvedPlugin extends InstalledEntry {
  packageDir: string
  packageVersion: string
  database?: {
    schemaEntry: string
    schemaEntryFile: string
    behaviorDir?: string
    behaviorDirPath?: string
  }
}

const lockPath = 'installed.lock.json'

export function readInstalledLock(): InstalledEntry[] {
  if (!fs.existsSync(lockPath)) {
    throw new Error(`${lockPath} not found; it is the authority for the installed plugin set`)
  }
  const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { plugins?: InstalledEntry[] }
  if (!Array.isArray(raw.plugins)) {
    throw new Error(`${lockPath} is malformed: expected a top-level "plugins" array`)
  }
  const seen = new Set<string>()
  for (const entry of raw.plugins) {
    if (typeof entry.id !== 'string' || !Array.isArray(entry.dependsOn)) {
      throw new Error(`${lockPath} is malformed: every entry needs "id" and "dependsOn"`)
    }
    if (seen.has(entry.id)) throw new Error(`duplicate plugin id in ${lockPath}: ${entry.id}`)
    seen.add(entry.id)
  }
  return raw.plugins
}

function assertClosure(entries: InstalledEntry[]): void {
  const ids = new Set(entries.map((entry) => entry.id))
  for (const entry of entries) {
    for (const dep of entry.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(
          `installed set is not dependency-closed: ${entry.id} depends on ${dep}, which is not installed`,
        )
      }
    }
  }
}

// Kahn topological sort; throws on dependency cycles
function sortTopologically(entries: InstalledEntry[]): InstalledEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const indegree = new Map(entries.map((entry) => [entry.id, entry.dependsOn.length]))
  const dependents = new Map<string, string[]>()
  for (const entry of entries) {
    for (const dep of entry.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), entry.id])
    }
  }
  const queue = entries.filter((entry) => entry.dependsOn.length === 0).map((entry) => entry.id)
  queue.sort()
  const ordered: InstalledEntry[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    ordered.push(byId.get(id)!)
    for (const dependent of dependents.get(id) ?? []) {
      const left = indegree.get(dependent)! - 1
      indegree.set(dependent, left)
      if (left === 0) queue.push(dependent)
    }
    queue.sort()
  }
  if (ordered.length !== entries.length) {
    const stuck = entries.filter((entry) => !ordered.includes(entry)).map((entry) => entry.id)
    throw new Error(`dependency cycle in installed set: ${stuck.join(', ')}`)
  }
  return ordered
}

export function resolvePackageDir(id: string): string {
  let entryUrl: string
  try {
    entryUrl = import.meta.resolve(id)
  } catch {
    throw new Error(
      `installed plugin ${id} cannot be resolved; is it missing from the root package.json?`,
    )
  }
  let dir = path.dirname(fileURLToPath(entryUrl))
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`cannot locate package.json for ${id}`)
    dir = parent
  }
  return fs.realpathSync(dir)
}

interface QualyField {
  database?: { schemaEntry?: string; behaviorDir?: string }
  dependsOn?: string[]
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')
}

// reads the lock, resolves every package, validates declarations and returns
// the installed set in dependency-topological order; every violation is a
// hard failure, capability probing is never used
export function loadInstalled(): ResolvedPlugin[] {
  const entries = readInstalledLock()
  assertClosure(entries)
  const ordered = sortTopologically(entries)

  const resolved: ResolvedPlugin[] = []
  const entryFiles = new Map<string, string>()
  for (const entry of ordered) {
    const packageDir = resolvePackageDir(entry.id)
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      version?: string
      qualy?: QualyField
    }
    const declaredDeps = pkg.qualy?.dependsOn ?? []
    if (!sameSet(declaredDeps, entry.dependsOn)) {
      throw new Error(
        `${entry.id}: dependsOn drift between package.json ([${declaredDeps}]) and installed.lock.json ([${entry.dependsOn}])`,
      )
    }
    const plugin: ResolvedPlugin = {
      ...entry,
      packageDir,
      packageVersion: pkg.version ?? '0.0.0',
    }
    const database = pkg.qualy?.database
    if (database) {
      if (!database.schemaEntry) {
        throw new Error(`${entry.id}: qualy.database is declared without a schemaEntry`)
      }
      const schemaEntryFile = path.resolve(packageDir, database.schemaEntry)
      if (!fs.existsSync(schemaEntryFile)) {
        throw new Error(
          `${entry.id}: declared schemaEntry ${database.schemaEntry} does not resolve to a file`,
        )
      }
      const clash = entryFiles.get(schemaEntryFile)
      if (clash) {
        throw new Error(`${entry.id} and ${clash} declare the same schemaEntry file`)
      }
      entryFiles.set(schemaEntryFile, entry.id)
      plugin.database = {
        schemaEntry: database.schemaEntry,
        schemaEntryFile,
        behaviorDir: database.behaviorDir,
        behaviorDirPath: database.behaviorDir
          ? path.resolve(packageDir, database.behaviorDir)
          : undefined,
      }
    }
    resolved.push(plugin)
  }
  return resolved
}
