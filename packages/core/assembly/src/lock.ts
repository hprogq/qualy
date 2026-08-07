import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { canonicalHash } from './hash.ts'
import type { PluginState, Resolution } from './resolve.ts'

// qualy.lock.json records what an assembly resolved to. It is generated, not
// maintained: `qualy resolve` overwrites it, and the only reason to read it by
// hand is to see what a deployment is about to do.
//
// It exists for two things the manifest cannot answer on its own. A plugin
// removed from the manifest may have left something behind, and only the
// previous lock remembers what. And a deployment needs to be able to say
// "this is exactly the assembly that was reviewed", which is what the two
// hashes are for: manifestHash catches an edited qualy.yml, resolutionHash
// catches an edited lock.
//
// Everything under `capabilities[key].state` belongs to the provider that
// produced it. The core serialises it, hashes it and compares it, and never
// looks inside. That is safe because capability state is DERIVED: resolve
// recomputes it from the contributions every time, so a state written by an
// older shape of the provider is simply replaced rather than migrated.
//
// What the lock must never carry: secrets, connection parameters, identifiers
// of external resources, or anything about whether a particular environment
// has had something applied to it. Those are facts about an environment, and
// a lock is committed to a repository that many environments share.

export const LOCKFILE_VERSION = 2

export interface LockedPlugin {
  version: string
  state: PluginState
  /** capabilities that asked for this plugin to be kept after its removal */
  retainedBy?: string[]
  /** capability key to that capability's parsed declaration */
  contributions?: Record<string, unknown>
}

export interface LockedCapability {
  /** the plugin whose package provides this capability, checked on the next resolve */
  provider: string
  state: unknown
}

export interface AssemblyLock {
  lockfileVersion: number
  manifestHash: string
  resolutionHash: string
  plugins: Record<string, LockedPlugin>
  capabilities: Record<string, LockedCapability>
  runtime: { plugins: string[] }
}

const omitEmpty = <T>(value: readonly T[] | undefined) =>
  value && value.length > 0 ? [...value] : undefined

export function lockFromResolution(resolution: Resolution): AssemblyLock {
  const plugins: Record<string, LockedPlugin> = {}
  for (const plugin of resolution.plugins.values()) {
    plugins[plugin.id] = {
      version: plugin.version,
      state: plugin.state,
      retainedBy: omitEmpty(plugin.retainedBy),
      contributions:
        Object.keys(plugin.contributions).length > 0 ? plugin.contributions : undefined,
    }
  }
  const capabilities: Record<string, LockedCapability> = {}
  for (const capability of resolution.capabilities.values()) {
    capabilities[capability.key] = {
      provider: capability.provider,
      state: capability.state,
    }
  }
  const runtime = { plugins: resolution.runtimePlugins }
  return {
    lockfileVersion: LOCKFILE_VERSION,
    manifestHash: resolution.manifestHash,
    // hashed over the round trip the file itself takes, so a state carrying a
    // toJSON cannot hash one way here and another way when it is read back
    resolutionHash: canonicalHash(
      JSON.parse(
        JSON.stringify({ lockfileVersion: LOCKFILE_VERSION, plugins, capabilities, runtime }),
      ),
    ),
    plugins,
    capabilities,
    runtime,
  }
}

/** the exact bytes a lock is written as, so a caller can compare before writing */
export const renderLock = (lock: AssemblyLock) => `${JSON.stringify(lock, null, 2)}\n`

/**
 * What a lock's own contents hash to, as opposed to what it claims they do.
 *
 * Comparing the stored hash against a fresh resolution only catches the
 * assembly moving. Someone who edits a state or a contribution inside the lock
 * and leaves the hash alone changes nothing that comparison can see, because
 * the recorded hash still describes the assembly the lock was built from.
 */
export const lockSelfHash = (lock: AssemblyLock) =>
  canonicalHash({
    lockfileVersion: lock.lockfileVersion,
    plugins: lock.plugins,
    capabilities: lock.capabilities,
    runtime: lock.runtime,
  })

/**
 * What to do with a lock this version cannot read.
 *
 * A newer one was written by a tool that knows more than this one does, and
 * guessing at it would be worse than stopping. An older one is a format this
 * version replaced, and rewriting it costs nothing as long as nothing is lost:
 * everything in a lock is derived from the manifest and the installed packages
 * EXCEPT which plugins are being kept after leaving the manifest, which only
 * the lock remembers. So an older lock is discarded when every plugin in it is
 * still one the manifest could describe, and refused when it is not.
 */
function superseded(file: string, lock: Partial<AssemblyLock> | null): void {
  const found = Number(lock?.lockfileVersion)
  if (!Number.isInteger(found)) {
    throw new Error(`${file}: lockfileVersion is missing; this file is not a qualy lock`)
  }
  if (found > LOCKFILE_VERSION) {
    throw new Error(
      `${file}: lockfileVersion ${found} was written by a newer version of qualy, which this one cannot read`,
    )
  }
  const kept = Object.entries(lock?.plugins ?? {})
    .filter(([, plugin]) => plugin?.state !== 'active' && plugin?.state !== 'disabled')
    .map(([id]) => id)
  if (kept.length > 0) {
    throw new Error(
      `${file}: lockfileVersion ${found} has been superseded by ${LOCKFILE_VERSION}, and it is the only record that these plugins are still being kept:\n  ${kept.join('\n  ')}\n` +
        'Put them back in the manifest, resolve, then remove them again so the new lock records why they are kept.',
    )
  }
  console.warn(
    `${file}: lockfileVersion ${found} has been superseded by ${LOCKFILE_VERSION}; it will be rewritten`,
  )
}

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
    superseded(file, lock)
    return undefined
  }
  if (!lock.plugins || typeof lock.plugins !== 'object') {
    throw new Error(`${file}: plugins is missing`)
  }
  lock.capabilities ??= {}
  // The next resolve decides what is still being kept from this file's
  // contributions, and then writes its own hash over the answer. Reading an
  // edited one would launder the edit into the record within one command, so
  // it is refused here rather than reported as drift later.
  if (lockSelfHash(lock) !== lock.resolutionHash) {
    throw new Error(
      `${file} has been edited: its contents are not what its own hash describes. ` +
        'Restore it from version control, or delete it and put back anything it was the only record of before resolving.',
    )
  }
  return lock
}

/**
 * Written whole or not at all.
 *
 * A file truncated by an interrupted write is worse than a missing one: a
 * partial lock would let the next resolve decide the plugins missing from it
 * were never installed, and a partial entry list is still valid YAML, just
 * with fewer plugins in it. The temporary name is unique so two resolves
 * running at once cannot write through each other.
 */
export function writeAtomic(file: string, content: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true })
  const temp = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
  try {
    const handle = fs.openSync(temp, 'w')
    try {
      fs.writeFileSync(handle, content)
      fs.fsyncSync(handle)
    } finally {
      fs.closeSync(handle)
    }
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
  return true
}

export const writeLock = (file: string, lock: AssemblyLock): boolean =>
  writeAtomic(file, renderLock(lock))

/**
 * Why the lock on disk no longer describes this assembly, if it does not.
 *
 * Frozen callers refuse to start on any of these. Non-frozen callers use the
 * same answers to decide whether resolve has anything to write.
 */
export function lockDrift(lock: AssemblyLock | undefined, resolution: Resolution): string[] {
  if (!lock) return ['no lock file; run `pnpm qualy resolve`']
  const expected = lockFromResolution(resolution)
  const reasons: string[] = []
  if (lock.manifestHash !== expected.manifestHash) {
    reasons.push(`${resolution.manifest.source} changed since the lock was written`)
  }
  if (lock.resolutionHash !== expected.resolutionHash) {
    // an edited lock never reaches here, readLock refuses one; this is the
    // manifest or the installed packages moving under an intact lock
    reasons.push('the lock does not match what this manifest and these packages resolve to')
  }
  return reasons
}

/**
 * Whether a drift report is fatal.
 *
 * Production defaults to refusing, because the failure it guards against is a
 * deployment silently running an assembly nobody reviewed, and an environment
 * variable that has to be remembered is not a guard. Development defaults to
 * warning, since editing qualy.yml and restarting is the whole loop there.
 */
export function frozenLockfile(): boolean {
  const declared = process.env.QUALY_FROZEN_LOCKFILE
  if (declared === '1') return true
  if (declared === '0') return false
  return process.env.NODE_ENV === 'production'
}
