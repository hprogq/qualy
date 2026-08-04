import fs from 'node:fs'
import path from 'node:path'
import { canonicalHash } from './hash.ts'
import type { PluginState, Resolution } from './resolve.ts'

// qualy.lock.json records what an assembly resolved to. It is generated, not
// maintained: `qualy resolve` overwrites it, and the only reason to read it
// by hand is to see what a deployment is about to do.
//
// It exists for two things the manifest cannot answer on its own. A plugin
// removed from the manifest still owns tables, and only the previous lock
// remembers that. And a deployment needs to be able to say "this is exactly
// the assembly that was reviewed", which is what the two hashes are for:
// manifestHash catches an edited qualy.yml, resolutionHash catches an edited
// lock.
//
// What it must never carry: secrets, connection parameters, database
// identifiers, or anything about whether a particular database has run a
// particular migration. Those are facts about an environment, and a lock is
// committed to a repository that many environments share.

export const LOCKFILE_VERSION = 1

export interface LockedPlugin {
  version: string
  state: PluginState
  databaseDependsOn?: string[]
  database?: { schemaEntry?: string; baselineDir?: string }
}

export interface AssemblyLock {
  lockfileVersion: number
  manifestHash: string
  resolutionHash: string
  plugins: Record<string, LockedPlugin>
  plans: { runtimeOrder: string[]; databaseOrder: string[] }
}

const omitEmpty = <T>(value: readonly T[] | undefined) =>
  value && value.length > 0 ? [...value] : undefined

export function lockFromResolution(resolution: Resolution): AssemblyLock {
  const plugins: Record<string, LockedPlugin> = {}
  for (const plugin of resolution.plugins.values()) {
    plugins[plugin.id] = {
      version: plugin.version,
      state: plugin.state,
      databaseDependsOn: omitEmpty(plugin.databaseDependsOn),
      database: plugin.database
        ? {
            schemaEntry: plugin.database.schemaEntry,
            baselineDir: plugin.database.baselineDir,
          }
        : undefined,
    }
  }
  const plans = {
    runtimeOrder: resolution.runtimeOrder,
    databaseOrder: resolution.databaseOrder,
  }
  return {
    lockfileVersion: LOCKFILE_VERSION,
    manifestHash: resolution.manifestHash,
    resolutionHash: canonicalHash({ lockfileVersion: LOCKFILE_VERSION, plugins, plans }),
    plugins,
    plans,
  }
}

/** the exact bytes a lock is written as, so a caller can compare before writing */
export const renderLock = (lock: AssemblyLock) => `${JSON.stringify(lock, null, 2)}\n`

/**
 * What a lock's own contents hash to, as opposed to what it claims they do.
 *
 * Comparing the stored hash against a fresh resolution only catches the
 * assembly moving. Someone who edits a state or a dependency inside the lock
 * and leaves the hash alone changes nothing that comparison can see, because
 * the recorded hash still describes the assembly the lock was built from.
 */
export const lockSelfHash = (lock: AssemblyLock) =>
  canonicalHash({
    lockfileVersion: lock.lockfileVersion,
    plugins: lock.plugins,
    plans: lock.plans,
  })

export function readLock(file: string): AssemblyLock | undefined {
  if (!fs.existsSync(file)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file} is not valid json: ${(error as Error).message}`)
  }
  const lock = parsed as AssemblyLock
  if (lock?.lockfileVersion !== LOCKFILE_VERSION) {
    throw new Error(
      `${file}: lockfileVersion ${String(lock?.lockfileVersion)} is not supported, expected ${LOCKFILE_VERSION}`,
    )
  }
  if (!lock.plugins || typeof lock.plugins !== 'object') {
    throw new Error(`${file}: plugins is missing`)
  }
  return lock
}

/**
 * Written whole or not at all.
 *
 * A lock truncated by an interrupted write is worse than no lock: the next
 * resolve would read a partial plugin table and quietly decide the plugins
 * missing from it were never installed.
 */
export function writeLock(file: string, lock: AssemblyLock): boolean {
  const content = renderLock(lock)
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false
  const temp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const handle = fs.openSync(temp, 'w')
  try {
    fs.writeFileSync(handle, content)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  fs.renameSync(temp, file)
  return true
}

/**
 * Why the lock on disk no longer describes this assembly, if it does not.
 *
 * Frozen callers refuse to start on any of these. Non-frozen callers use the
 * same answers to decide whether resolve has anything to write.
 */
export function lockDrift(lock: AssemblyLock | undefined, resolution: Resolution): string[] {
  if (!lock) return [`no lock file; run \`pnpm qualy resolve\``]
  const expected = lockFromResolution(resolution)
  const reasons: string[] = []
  if (lock.manifestHash !== expected.manifestHash) {
    reasons.push(`${resolution.manifest.source} changed since the lock was written`)
  }
  if (lockSelfHash(lock) !== lock.resolutionHash) {
    reasons.push('the lock has been edited: its contents are not what its own hash describes')
  } else if (lock.resolutionHash !== expected.resolutionHash) {
    // the manifest or the installed packages moved under a lock that is
    // internally consistent, so it is simply out of date
    reasons.push('the lock does not match what this manifest and these packages resolve to')
  }
  return reasons
}
