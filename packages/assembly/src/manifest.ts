import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { canonicalHash } from './hash.ts'

// qualy.yml is the product manifest: the selection a human maintains, not a
// runtime data structure. It used to be the cordis include file, which meant
// the loader wrote entry ids back into a file people hand-edit, two entries
// could name the same plugin with no way to tell which one a lock referred
// to, and file order carried an ordering that nothing honoured.
//
// The keyed form makes the plugin id the identity: one entry per plugin,
// order-free, and every downstream artifact keyed the same way.

export interface ManifestEntry {
  /** false keeps the plugin's tables and data while taking it off the runtime */
  enabled: boolean
  config: unknown
}

export interface AssemblyManifest {
  version: number
  /** insertion order is the file's, and is never used for anything */
  plugins: Map<string, ManifestEntry>
  /** where it was read from, so errors can name the file */
  source: string
  /**
   * Where the plugins this manifest names are installed, relative to it.
   *
   * The manifest is the product's configuration and belongs where somebody
   * editing a port or a database url would look for it. Which package declares
   * the plugin dependencies is a separate fact, and it used to be inferred
   * from the manifest's own directory - which silently required the two to be
   * the same directory, and put the configuration file inside the source tree
   * of one of the applications reading it.
   *
   * Required, including the standalone layout's `.`: an assembly that does not
   * say where its plugins are installed is one guessing, and a guess that is
   * usually right is the kind that fails once, in someone else's layout.
   */
  workspace: string
}

export const MANIFEST_VERSION = 2

const PLUGIN_KEYS = new Set(['enabled', 'config'])
const TOP_LEVEL_KEYS = new Set(['version', 'plugins', 'application'])

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`)
}

export function parseManifest(text: string, source: string): AssemblyManifest {
  // duplicate keys are a silent last-one-wins in yaml, and a manifest that
  // names a plugin twice has no single answer for its config
  const raw: unknown = YAML.parse(text, { uniqueKeys: true })
  if (Array.isArray(raw)) {
    fail(
      source,
      'this is the old entry-array format; a manifest is now `version: 1` with a `plugins` map',
    )
  }
  if (!raw || typeof raw !== 'object') fail(source, 'must be a mapping')
  const record = raw as Record<string, unknown>

  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_KEYS.has(key)) fail(source, `unknown top-level key ${key}`)
  }
  if (record.version !== MANIFEST_VERSION) {
    fail(source, `version must be ${MANIFEST_VERSION}, got ${JSON.stringify(record.version)}`)
  }
  if (record.plugins !== undefined && (!record.plugins || typeof record.plugins !== 'object')) {
    fail(source, 'plugins must be a mapping of plugin id to entry')
  }
  if (Array.isArray(record.plugins)) fail(source, 'plugins must be a mapping, not a list')

  const application = record.application
  if (application !== undefined && (!application || typeof application !== 'object')) {
    fail(source, 'application must be a mapping')
  }
  const app = (application ?? {}) as Record<string, unknown>
  for (const key of Object.keys(app)) {
    if (key !== 'workspace') fail(source, `application: unknown key ${key}`)
  }
  if (app.workspace !== undefined && typeof app.workspace !== 'string') {
    fail(source, 'application.workspace must be a path relative to this file')
  }
  const workspace = app.workspace as string | undefined
  if (workspace === undefined || workspace === '') {
    fail(
      source,
      'application.workspace is required: name the package whose dependencies these plugin ids resolve against, relative to this file, or "." if they are installed beside it',
    )
  }
  if (path.isAbsolute(workspace)) {
    // an absolute host would make the manifest describe one machine
    fail(source, 'application.workspace must be relative to this file')
  }

  const plugins = new Map<string, ManifestEntry>()
  for (const [id, value] of Object.entries((record.plugins ?? {}) as Record<string, unknown>)) {
    if (!id.trim()) fail(source, 'a plugin id cannot be empty')
    // `'@qualy/plugin-x':` with nothing after it is the common case
    if (value === null || value === undefined) {
      plugins.set(id, { enabled: true, config: undefined })
      continue
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      fail(source, `${id} must be a mapping with optional enabled and config`)
    }
    const entry = value as Record<string, unknown>
    for (const key of Object.keys(entry)) {
      if (!PLUGIN_KEYS.has(key)) fail(source, `${id}: unknown key ${key}`)
    }
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
      fail(source, `${id}: enabled must be a boolean`)
    }
    plugins.set(id, { enabled: entry.enabled ?? true, config: entry.config })
  }
  return { version: MANIFEST_VERSION, plugins, source, workspace }
}

export function readManifest(file: string): AssemblyManifest {
  if (!fs.existsSync(file)) {
    throw new Error(`assembly manifest not found: ${file}`)
  }
  return parseManifest(fs.readFileSync(file, 'utf8'), file)
}

/**
 * A hash of what the manifest says, not of how it was written.
 *
 * Plugins are sorted, so reordering the file changes nothing; comments and
 * quoting style never reach it either. What it does change on is a plugin
 * added, removed, toggled or reconfigured, which is exactly when a lock
 * stops describing the manifest it was built from.
 */
/**
 * The workspace as the hash sees it, so equivalent spellings are one assembly.
 *
 * `./apps/server`, `apps/server` and `apps/server/` all name the same package;
 * hashing them apart would report drift on a whitespace-level edit and make a
 * lock look stale for no reason.
 */
export const normalizeWorkspace = (workspace: string): string => {
  const normalized = path.normalize(workspace).replace(/[/\\]+$/, '')
  return normalized === '' ? '.' : normalized.split(path.sep).join('/')
}

export function manifestHash(manifest: AssemblyManifest): string {
  return canonicalHash({
    version: manifest.version,
    // the host is part of what this manifest says: pointing it at another
    // package selects different installed versions of the same plugin ids,
    // and a hash that ignored it would call that the same assembly
    application: { workspace: normalizeWorkspace(manifest.workspace) },
    plugins: Object.fromEntries(
      [...manifest.plugins.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, entry]) => [id, { enabled: entry.enabled, config: entry.config ?? null }]),
    ),
  })
}

export function renderManifest(manifest: AssemblyManifest): string {
  const plugins: Record<string, unknown> = {}
  for (const [id, entry] of manifest.plugins) {
    const body: Record<string, unknown> = {}
    if (!entry.enabled) body.enabled = false
    if (entry.config !== undefined) body.config = entry.config
    plugins[id] = Object.keys(body).length > 0 ? body : {}
  }
  return YAML.stringify(
    {
      version: manifest.version,
      application: { workspace: manifest.workspace },
      plugins,
    },
    { lineWidth: 0 },
  )
}

/**
 * The lock lives beside the manifest that produced it, and is named after it.
 *
 * A fixed name meant every manifest in a directory shared one lock, so
 * resolving a throwaway `--yml` next to the product manifest overwrote the
 * product's own lock with a hash of the wrong file. The default case is
 * unchanged: `qualy.yml` still produces `qualy.lock.json`.
 */
export const lockPathFor = (manifestPath: string) =>
  path.join(
    path.dirname(manifestPath),
    `${path.basename(manifestPath, path.extname(manifestPath))}.lock.json`,
  )

/**
 * The directory plugin packages resolve from.
 *
 * The manifest names it, so where the configuration lives and which package
 * declares the plugins are two answers instead of one. Everything reading
 * plugin metadata resolves through here, or generation and the running process
 * disagree about which package a plugin id means.
 */
export const hostDirFor = (manifest: AssemblyManifest): string => {
  const host = path.resolve(path.dirname(path.resolve(manifest.source)), manifest.workspace)
  // Checked here rather than left to the first plugin that fails to resolve.
  // A workspace naming a directory with no package.json produces
  // MODULE_NOT_FOUND for every plugin at once, which reads as "the plugins are
  // not installed" rather than "the manifest is pointing somewhere wrong".
  if (!fs.existsSync(path.join(host, 'package.json'))) {
    throw new Error(
      `${manifest.source}: application.workspace ${manifest.workspace} is not a package (no package.json at ${host})`,
    )
  }
  return host
}
