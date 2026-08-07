import fs from 'node:fs'
import path from 'node:path'
import { lockPathFor, readLock, resolveAssembly, type Resolution } from '@qualy/assembly'
import { repoRoot } from './paths.ts'

// What the manifest SELECTED, which is the question codegen asks: contracts,
// components, message catalogs and permission catalogs all belong to plugins
// someone chose, and `--all` widens that to the ones currently switched off so
// a release build carries the superset.
//
// The other question, what the assembly still ACCOUNTS FOR, is larger: a
// plugin taken out of the manifest may have left objects behind somewhere. It
// is not asked here, because the answer is capability specific and belongs to
// the capability that has to deal with it.

export interface Entry {
  name: string
  config?: unknown
  disabled?: boolean
}

export const DEFAULT_MANIFEST = 'qualy.yml'

// --yml <path> points the generators at an alternate manifest; tests use
// throwaway workspaces so they never mutate the working one. An explicit path
// is the caller's and stays relative to their working directory; the default
// anchors to the repository, because the Vite build runs these from apps/web
export const manifestPath = (ymlPath?: string) => {
  const flag = process.argv.indexOf('--yml')
  const given = ymlPath ?? (flag >= 0 ? process.argv[flag + 1] : undefined)
  return given ? path.resolve(given) : path.join(repoRoot, DEFAULT_MANIFEST)
}

// resolution walks every plugin package and imports every capability
// provider, and the callers below ask for it once per entry; keyed by content
// rather than by path so that rewriting a manifest in place still resolves
// again
const cache = new Map<string, Promise<Resolution>>()

export function currentResolution(options: { ymlPath?: string } = {}): Promise<Resolution> {
  const file = manifestPath(options.ymlPath)
  // computed before any await, so two concurrent callers agree on the key
  const key = `${file} ${fs.readFileSync(file, 'utf8')}`
  const cached = cache.get(key)
  if (cached) return cached
  const pending = resolveAssembly({
    manifestPath: file,
    previousLock: readLock(lockPathFor(file)),
    // a failure must not be memoised: the next caller retries rather than
    // inheriting a rejection whose stack points at whoever asked first
  }).catch((error: unknown) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, pending)
  return pending
}

/**
 * What the manifest selected, sorted by plugin id.
 *
 * `{ all: true }` (or `--all`) keeps the entries that are switched off.
 * Detached plugins are never here: they are not part of the selection any
 * more, only of what some capability still accounts for.
 */
export async function readEntries(
  options: { all?: boolean; ymlPath?: string } = {},
): Promise<Entry[]> {
  const all = options.all ?? process.argv.includes('--all')
  const resolution = await currentResolution(options)
  return [...resolution.plugins.values()]
    .filter((plugin) => plugin.state === 'active' || (all && plugin.state === 'disabled'))
    .map((plugin) => ({
      name: plugin.id,
      config: resolution.manifest.plugins.get(plugin.id)?.config,
      disabled: plugin.state === 'disabled' || undefined,
    }))
}
