import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createPackageResolver,
  lockFromResolution,
  lockPathFor,
  readLock,
  resolveAssembly,
  writeLock,
} from '@qualy/assembly'

// A throwaway assembly: its own manifest, its own lock, its own migrations
// directory and its own node_modules.
//
// Pointing a generator at a temporary manifest while it still resolved
// packages through this repository's host proved less than it looked like.
// The interesting question is whether a DIFFERENT selection can build itself
// from nothing, and that question is only asked honestly by a workspace that
// has nothing: no committed lineage to diff against, no lock to inherit
// state from, and only the packages the selection names.
//
// The node_modules here is a directory of symlinks to the real package
// directories rather than a copy, so each package still resolves its own
// dependencies from where pnpm put them, exactly as it does in the host.

export interface Workspace {
  dir: string
  manifestPath: string
  migrationsDir: string
  /** overwrite the manifest, e.g. to remove a plugin and resolve again */
  writeManifest(plugins: readonly string[], options?: ManifestOptions): void
  dispose(): void
}

export interface ManifestOptions {
  disabled?: readonly string[]
  configs?: Record<string, unknown>
}

export interface SyntheticPackage {
  id: string
  qualy?: unknown
}

const REPO = process.cwd()
const HOST = path.join(REPO, 'packages/app')

export const renderManifestText = (
  plugins: readonly string[],
  options: ManifestOptions = {},
): string => {
  const lines = ['version: 1', '', 'plugins:']
  for (const id of plugins) {
    const body: string[] = []
    if (options.disabled?.includes(id)) body.push('    enabled: false')
    const config = options.configs?.[id]
    if (config !== undefined) {
      body.push(`    config: ${JSON.stringify(config)}`)
    }
    lines.push(`  '${id}':${body.length > 0 ? '' : ' {}'}`, ...body)
  }
  return `${lines.join('\n')}\n`
}

/**
 * @param plugins what the manifest selects
 * @param synthetic packages invented for a test, written into the workspace
 */
export function createWorkspace(
  plugins: readonly string[],
  options: ManifestOptions & { synthetic?: readonly SyntheticPackage[] } = {},
): Workspace {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-workspace-'))
  const modules = path.join(dir, 'node_modules')
  fs.mkdirSync(modules, { recursive: true })

  const host = createPackageResolver(HOST)
  const link = (id: string, target: string) => {
    const at = path.join(modules, ...id.split('/'))
    fs.mkdirSync(path.dirname(at), { recursive: true })
    if (!fs.existsSync(at)) fs.symlinkSync(target, at, 'dir')
  }
  const synthetic = new Set((options.synthetic ?? []).map((entry) => entry.id))
  for (const id of plugins) {
    if (synthetic.has(id)) continue
    link(id, host.resolvePackageDir(id))
  }
  for (const entry of options.synthetic ?? []) {
    const at = path.join(modules, ...entry.id.split('/'))
    fs.mkdirSync(at, { recursive: true })
    fs.writeFileSync(
      path.join(at, 'package.json'),
      `${JSON.stringify({ name: entry.id, version: '0.0.0', type: 'module', exports: { '.': './index.js' }, qualy: entry.qualy }, null, 2)}\n`,
    )
    fs.writeFileSync(path.join(at, 'index.js'), 'export const name = "synthetic"\n')
  }

  const manifestPath = path.join(dir, 'qualy.yml')
  const migrationsDir = path.join(dir, 'migrations')
  fs.mkdirSync(migrationsDir, { recursive: true })

  const workspace: Workspace = {
    dir,
    manifestPath,
    migrationsDir,
    writeManifest(selection, overrides) {
      fs.writeFileSync(manifestPath, renderManifestText(selection, overrides ?? options))
    },
    dispose() {
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
  workspace.writeManifest(plugins, options)
  return workspace
}

/** the drizzle config a workspace generates its own lineage with */
export function writeDrizzleConfig(workspace: Workspace): string {
  const file = path.join(workspace.dir, 'drizzle.config.ts')
  fs.writeFileSync(
    file,
    `import { defineConfig } from 'drizzle-kit'
     import { resolveSchemaEntries } from '${REPO}/scripts/lib/schema-entries.ts'
     export default defineConfig({
       dialect: 'postgresql',
       schema: resolveSchemaEntries({ ymlPath: '${workspace.manifestPath}' }),
       out: '${workspace.migrationsDir}',
       migrations: { schema: 'cordis_meta', table: 'schema_migrations' },
       // generate is a diff between the schema and the snapshot, so it needs
       // no server; the credentials stay where they belong
       dbCredentials: { url: 'postgres://generate-only/unused' },
     })`,
  )
  return file
}

/** resolve the workspace as it stands and record the result, as `qualy resolve` does */
export function commitLock(workspace: Workspace): void {
  const lockPath = lockPathFor(workspace.manifestPath)
  writeLock(
    lockPath,
    lockFromResolution(
      resolveAssembly({ manifestPath: workspace.manifestPath, previousLock: readLock(lockPath) }),
    ),
  )
}
