import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import os from 'node:os'
import { commitLock, createWorkspace, type Workspace } from '@qualy/assembly/testkit'
import { openFileSet } from '../../apps/cli/src/resolution.ts'
import { lockPathFor, readLock } from '@qualy/assembly'

// Managing the selection from the command line.
//
// These run the real CLI as a process, against a throwaway workspace with its
// own manifest, its own lock and its own node_modules - because half of what
// the commands promise is about files, and a promise about files is only
// tested by looking at the files afterwards.
//
// The two properties every case here is really about:
//
//   A refused command changes nothing. Adding a package that is not there,
//   or one whose descriptor calls itself something else, must leave a
//   manifest that still resolves - not one naming a plugin the next command
//   will choke on.
//
//   Taking a plugin off does not take its data off. `disable` and `remove`
//   are selection verbs; a capability still holding something says so, and
//   the plugin stays in the lock accounted for.

const repoRoot = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(repoRoot, 'apps/cli/src/main.ts')

const INFRA = ['@qualy/plugin-database', '@qualy/plugin-ui-registry']
const KIT = ['@qualy/plugin-kit', '@qualy/ui-contract']
const DIST_PROBE = '@acme/qualy-dist-probe'
const DIST_PROBE_DIR = path.resolve(import.meta.dirname, '../fixtures/acme-dist-probe')

/** what the command printed, and whether it refused */
function run(workspace: Workspace, args: readonly string[]) {
  try {
    const stdout = execFileSync('node', [CLI, 'plugin', ...args, '--yml', workspace.manifestPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { ok: true, output: stdout }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

const manifestOf = (workspace: Workspace) => fs.readFileSync(workspace.manifestPath, 'utf8')
const lockTextOf = (workspace: Workspace) =>
  fs.readFileSync(lockPathFor(workspace.manifestPath), 'utf8')

/** every file the workspace itself holds, by content, ignoring what was installed */
function contents(dir: string, at = dir): Map<string, string> {
  const found = new Map<string, string>()
  for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const file = path.join(at, entry.name)
    if (entry.isDirectory()) for (const [k, v] of contents(dir, file)) found.set(k, v)
    else found.set(path.relative(dir, file), fs.readFileSync(file, 'utf8'))
  }
  return found
}

const changedBetween = (before: Map<string, string>, after: Map<string, string>) =>
  [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => before.get(file) !== after.get(file))
    .sort()
const lockOf = (workspace: Workspace) => readLock(lockPathFor(workspace.manifestPath))

/**
 * A workspace holding more packages than it selects.
 *
 * Installed-but-unselected is the state a package is in between `pnpm add`
 * and `qualy plugin add`, and it is the only state `add` can be tested from.
 */
async function ready(select: readonly string[] = INFRA): Promise<Workspace> {
  const workspace = createWorkspace(select, { linked: KIT })
  await commitLock(workspace)
  return workspace
}

describe('qualy plugin add', () => {
  it('puts an installed package into the selection, and says a release must be rebuilt', async () => {
    const workspace = createWorkspace(INFRA, {
      linked: KIT,
      external: { [DIST_PROBE]: DIST_PROBE_DIR },
    })
    try {
      // installed the way a deployment installs one - and NOT selected, which
      // is the state `add` exists for
      fs.mkdirSync(path.join(workspace.dir, 'node_modules/@acme'), { recursive: true })
      fs.symlinkSync(
        DIST_PROBE_DIR,
        path.join(workspace.dir, 'node_modules', ...DIST_PROBE.split('/')),
        'dir',
      )
      // a comment, of the kind the real manifest is full of
      fs.writeFileSync(
        workspace.manifestPath,
        manifestOf(workspace).replace('plugins:', '# what this deployment runs\nplugins:'),
      )
      await commitLock(workspace)
      const before = contents(workspace.dir)

      const added = run(workspace, ['add', DIST_PROBE])
      expect(added.ok, added.output).toBe(true)
      // the selection, and nothing else. Adding a plugin used to mean editing
      // the application's own source so a collector would agree to build it;
      // what it writes now is the manifest and what the manifest implies
      expect(changedBetween(before, contents(workspace.dir))).toEqual([
        'qualy.lock.json',
        'qualy.yml',
      ])
      expect(added.output).toContain(`${DIST_PROBE} is active`)
      expect(added.output).toContain('deploy a rebuilt one')

      const manifest = manifestOf(workspace)
      expect(manifest).toContain(`'${DIST_PROBE}': {}`)
      // the file people maintain keeps being the file people maintain
      expect(manifest).toContain('# what this deployment runs')
      expect(lockOf(workspace)!.plugins[DIST_PROBE]!.state).toBe('active')
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a package it already has, and changes nothing', async () => {
    const workspace = await ready()
    try {
      const before = manifestOf(workspace)
      const lockBefore = lockTextOf(workspace)
      const again = run(workspace, ['add', '@qualy/plugin-database'])
      expect(again.ok).toBe(false)
      expect(again.output).toContain('is already in')
      expect(manifestOf(workspace)).toBe(before)
      expect(lockTextOf(workspace)).toBe(lockBefore)
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a package nobody installed, and names the fix', async () => {
    const workspace = await ready()
    try {
      const before = manifestOf(workspace)
      const lockBefore = lockTextOf(workspace)
      const missing = run(workspace, ['add', '@acme/qualy-not-installed'])
      expect(missing.ok).toBe(false)
      expect(missing.output).toContain('is not installed')
      expect(manifestOf(workspace)).toBe(before)
      expect(lockTextOf(workspace)).toBe(lockBefore)
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a package whose descriptor calls itself something else', async () => {
    const workspace = createWorkspace(INFRA, {
      linked: KIT,
      synthetic: [
        {
          id: '@acme/qualy-impostor',
          // a published package whose descriptor and package name disagree:
          // everything downstream is keyed by one and owned by the other
          files: {
            'index.js': `export default { _tag: 'Plugin', id: '@acme/qualy-someone-else', dependsOn: [], features: [] }\n`,
          },
        },
      ],
    })
    try {
      await commitLock(workspace)
      const before = manifestOf(workspace)
      const lockBefore = lockTextOf(workspace)
      const refused = run(workspace, ['add', '@acme/qualy-impostor'])
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('calls itself')
      // the whole point of the rollback: the tree still resolves
      expect(manifestOf(workspace)).toBe(before)
      expect(lockTextOf(workspace)).toBe(lockBefore)
      expect(run(workspace, ['disable', '@qualy/plugin-ui-registry']).ok).toBe(true)
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a selection nothing can provide for, and puts the manifest back', async () => {
    const workspace = createWorkspace(INFRA, {
      linked: KIT,
      synthetic: [
        {
          id: '@acme/qualy-orphan',
          // it contributes to a capability this assembly has no provider for
          qualy: { contributions: { nosuch: { entry: 'index.js' } } },
        },
      ],
    })
    try {
      await commitLock(workspace)
      const before = manifestOf(workspace)
      const lockBefore = lockTextOf(workspace)
      const refused = run(workspace, ['add', '@acme/qualy-orphan'])
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('contributes to capability nosuch')
      expect(refused.output).toContain('unchanged')
      expect(manifestOf(workspace)).toBe(before)
      expect(lockTextOf(workspace)).toBe(lockBefore)
    } finally {
      workspace.dispose()
    }
  })
})

describe('the files a selection owns are written together or not at all', () => {
  // The manifest, the lock and every module a capability derives. `writeAtomic`
  // makes ONE of them all-or-nothing, which is not the same claim: a command
  // that wrote the first three and failed on the fourth left a tree carrying a
  // new selection, a new lock and a mixture of old and new generated modules -
  // and every command that could have fixed it is gated on the lock matching
  // those modules.
  //
  // The fault is a real one rather than a stubbed writer: a directory standing
  // where a file must go, which is what a botched deploy or a stray `mkdir -p`
  // leaves behind. The repository's capabilities derive no modules today, so
  // the four-file set is built here directly - at the seam the CLI itself
  // writes through.
  it('puts every earlier file back when a later one cannot be written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-file-set-'))
    try {
      const at = (name: string) => path.join(dir, name)
      fs.writeFileSync(at('qualy.yml'), 'version: 3\n')
      fs.writeFileSync(at('qualy.lock.json'), '{"old":true}\n')
      fs.writeFileSync(at('one.ts'), 'export const one = 1\n')
      // the fourth write cannot succeed: its path is a directory
      fs.mkdirSync(at('two.ts'))

      const files = openFileSet()
      expect(() => {
        files.write(at('qualy.yml'), 'version: 3\nplugins:\n  a: {}\n')
        files.write(at('qualy.lock.json'), '{"new":true}\n')
        files.write(at('one.ts'), 'export const one = 2\n')
        files.write(at('three.ts'), 'export const three = 3\n')
        files.write(at('two.ts'), 'export const two = 2\n')
      }).toThrow()

      files.rollback()

      expect(fs.readFileSync(at('qualy.yml'), 'utf8')).toBe('version: 3\n')
      expect(fs.readFileSync(at('qualy.lock.json'), 'utf8')).toBe('{"old":true}\n')
      expect(fs.readFileSync(at('one.ts'), 'utf8')).toBe('export const one = 1\n')
      // one the set created rather than replaced: it goes away entirely
      expect(fs.existsSync(at('three.ts'))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves a file it never changed alone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-file-set-'))
    try {
      const at = path.join(dir, 'same.ts')
      fs.writeFileSync(at, 'export const same = 1\n')
      const files = openFileSet()
      // a write of the bytes already there is not a change, so a rollback
      // has nothing to put back and must not rewrite the file either
      expect(files.write(at, 'export const same = 1\n')).toBe(false)
      files.rollback()
      expect(fs.readFileSync(at, 'utf8')).toBe('export const same = 1\n')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('qualy plugin enable and disable', () => {
  it('takes a plugin off the runtime and puts it back, without touching its data', async () => {
    const workspace = await ready()
    try {
      const off = run(workspace, ['disable', '@qualy/plugin-ui-registry'])
      expect(off.ok, off.output).toBe(true)
      expect(manifestOf(workspace)).toContain('enabled: false')
      expect(lockOf(workspace)!.plugins['@qualy/plugin-ui-registry']!.state).toBe('disabled')

      // a disabled plugin is still installed and still accounted for: the
      // lock names it, which is what keeps its tables from disappearing
      expect(Object.keys(lockOf(workspace)!.plugins)).toContain('@qualy/plugin-ui-registry')

      const on = run(workspace, ['enable', '@qualy/plugin-ui-registry'])
      expect(on.ok, on.output).toBe(true)
      // true is the default, so the file says it by saying nothing
      expect(manifestOf(workspace)).not.toContain('enabled:')
      expect(lockOf(workspace)!.plugins['@qualy/plugin-ui-registry']!.state).toBe('active')
    } finally {
      workspace.dispose()
    }
  })

  it('puts the key where the file already puts it, so a round trip is byte-for-byte', async () => {
    // an entry with configuration under it: `enabled` appended after the
    // config block means the same thing and different bytes, and a diff
    // nobody asked for is how a hand-maintained file stops being trusted
    const workspace = createWorkspace(INFRA, { linked: KIT })
    try {
      // written the way the product's own manifest is written - a comment, a
      // block mapping under an entry - rather than the testkit's flow JSON.
      // The key is only something to sit under the entry: the database plugin
      // reads no configuration and would refuse it at start, which this test,
      // about where `enabled` is written, never reaches
      fs.writeFileSync(
        workspace.manifestPath,
        [
          'version: 3',
          '',
          'plugins:',
          '  # the one with something under it',
          "  '@qualy/plugin-database':",
          '    config:',
          '      poolSize: 4',
          "  '@qualy/plugin-ui-registry': {}",
          '',
        ].join('\n'),
      )
      await commitLock(workspace)
      const before = manifestOf(workspace)
      expect(run(workspace, ['disable', '@qualy/plugin-database']).ok).toBe(true)
      const off = manifestOf(workspace)
      expect(off).toContain('enabled: false')
      expect(off.indexOf('enabled: false')).toBeLessThan(off.indexOf('poolSize'))
      expect(run(workspace, ['enable', '@qualy/plugin-database']).ok).toBe(true)
      expect(manifestOf(workspace)).toBe(before)
      expect(manifestOf(workspace)).toContain('# the one with something under it')
    } finally {
      workspace.dispose()
    }
  })

  it('is a no-op when the plugin is already in that state', async () => {
    const workspace = await ready()
    try {
      const before = manifestOf(workspace)
      const lockBefore = lockTextOf(workspace)
      const again = run(workspace, ['enable', '@qualy/plugin-database'])
      expect(again.ok).toBe(true)
      expect(again.output).toContain('already enabled')
      expect(manifestOf(workspace)).toBe(before)
      expect(lockTextOf(workspace)).toBe(lockBefore)
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a plugin that is not in the manifest at all', async () => {
    const workspace = await ready()
    try {
      const refused = run(workspace, ['disable', '@qualy/plugin-org'])
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('is not in')
    } finally {
      workspace.dispose()
    }
  })
})

describe('qualy plugin remove', () => {
  it('keeps a plugin whose tables a capability is still holding', async () => {
    // org, auth and rbac are one selection: their tables and permission codes
    // reference each other, so any of them alone is refused
    const selection = [...INFRA, '@qualy/plugin-org', '@qualy/plugin-auth', '@qualy/plugin-rbac']
    const workspace = createWorkspace(selection, { linked: KIT })
    try {
      await commitLock(workspace)
      const removed = run(workspace, ['remove', '@qualy/plugin-rbac'])
      expect(removed.ok, removed.output).toBe(true)
      expect(removed.output).toContain('kept by database')
      expect(removed.output).toContain('data is untouched')

      expect(manifestOf(workspace)).not.toContain('@qualy/plugin-rbac')
      const locked = lockOf(workspace)!.plugins['@qualy/plugin-rbac']!
      expect(locked.state).toBe('detached')
      expect(locked.retainedBy).toEqual(['database'])
    } finally {
      workspace.dispose()
    }
  })

  it('lets a plugin that left nothing behind leave the lock as well', async () => {
    const workspace = createWorkspace([...INFRA, DIST_PROBE], {
      linked: KIT,
      external: { [DIST_PROBE]: DIST_PROBE_DIR },
    })
    try {
      await commitLock(workspace)
      const removed = run(workspace, ['remove', DIST_PROBE])
      expect(removed.ok, removed.output).toBe(true)
      expect(removed.output).toContain('nothing of it was deleted')
      expect(lockOf(workspace)!.plugins[DIST_PROBE]).toBeUndefined()
    } finally {
      workspace.dispose()
    }
  })

  it('refuses a plugin that is not in the manifest', async () => {
    const workspace = await ready()
    try {
      const before = manifestOf(workspace)
      const lockBefore = lockTextOf(workspace)
      const refused = run(workspace, ['remove', '@qualy/plugin-org'])
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('is not in')
      expect(manifestOf(workspace)).toBe(before)
      expect(lockTextOf(workspace)).toBe(lockBefore)
    } finally {
      workspace.dispose()
    }
  })
})
