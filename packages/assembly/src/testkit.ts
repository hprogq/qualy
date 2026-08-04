import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPackageResolver } from './metadata.ts'
import { lockFromResolution, readLock, writeLock } from './lock.ts'
import { resolveAssembly } from './resolve.ts'
import { capabilityContext } from './work.ts'
import { lockPathFor } from './manifest.ts'

// A throwaway assembly: its own manifest, its own lock and its own
// node_modules.
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

// anchored at this module rather than at the cwd, so a suite run from
// anywhere links the same packages
const HOST = fileURLToPath(new URL('../../app/', import.meta.url))

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

  const workspace: Workspace = {
    dir,
    manifestPath,
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

/** resolve the workspace as it stands and record the result, as `qualy resolve` does */
export async function commitLock(workspace: Workspace): Promise<void> {
  const lockPath = lockPathFor(workspace.manifestPath)
  writeLock(
    lockPath,
    lockFromResolution(
      await resolveAssembly({
        manifestPath: workspace.manifestPath,
        previousLock: readLock(lockPath),
      }),
    ),
  )
}

/** the resolution a workspace currently has, the way the CLI computes it */
export function resolveWorkspace(workspace: Workspace) {
  const lockPath = lockPathFor(workspace.manifestPath)
  return resolveAssembly({
    manifestPath: workspace.manifestPath,
    previousLock: readLock(lockPath),
  })
}

/** the context a capability provider is handed for the work phases */
export async function capabilityWorkContext(workspace: Workspace, key: string) {
  return capabilityContext(await resolveWorkspace(workspace), key)
}
