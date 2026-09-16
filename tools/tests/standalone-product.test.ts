import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lockPathFor, readLock } from '@qualy/assembly'
import { createWorkspace, type Workspace } from '@qualy/assembly/testkit'

// A product that is not this repository, driven from inside it.
//
// The CLI used to find its manifest beside its own source, which is right
// exactly once - here - and wrong for every product that installs the CLI as
// a package: `qualy resolve` typed in a customer's product directory would
// have resolved the SDK's manifest. So the manifest is now the nearest
// qualy.yml above the working directory, and this is the proof: a temporary
// product with a package.json, a node_modules and a manifest of its own, and
// the lifecycle commands run in it with no `--yml` and no QUALY_CONFIG.
//
// Everything asserted is about which files the commands read and wrote, so
// the commands are run as processes with their working directory set, the
// way a person runs them.

const repoRoot = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(repoRoot, 'apps/cli/src/main.ts')

const SELECTION = [
  '@qualy/plugin-database',
  '@qualy/plugin-ui-registry',
  '@qualy/plugin-layout-default',
]
const KIT = ['@qualy/plugin-kit', '@qualy/ui-contract']

/** the CLI, as typed in some directory, in an environment naming no manifest */
const qualy = (args: readonly string[], cwd: string, env: Record<string, string | undefined> = {}) => {
  const environment: Record<string, string | undefined> = {
    ...process.env,
    QUALY_CONFIG: undefined,
    ...env,
  }
  for (const key of Object.keys(environment)) {
    if (environment[key] === undefined) delete environment[key]
  }
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd,
      env: environment,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { ok: true, output: stdout }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

const product = (): Workspace => createWorkspace(SELECTION, { linked: KIT })

describe('the lifecycle in a standalone product', () => {
  it('finds the manifest above the working directory, and writes its lock beside it', () => {
    const at = product()
    try {
      const resolved = qualy(['resolve'], at.dir)
      expect(resolved.ok, resolved.output).toBe(true)
      expect(resolved.output).toContain('qualy.lock.json written')
      const lock = readLock(lockPathFor(at.manifestPath))
      expect(Object.keys(lock?.plugins ?? {}).sort()).toEqual([...SELECTION].sort())
      // and nothing of this repository's was touched: its lock still describes
      // its own manifest, not the product's three plugins
      expect(Object.keys(readLock(path.join(repoRoot, 'qualy.lock.json'))!.plugins).length).toBeGreaterThan(
        SELECTION.length,
      )

      const planned = qualy(['plan'], at.dir)
      expect(planned.ok, planned.output).toBe(true)
      expect(planned.output).toContain('no changes')

      const listed = qualy(['list'], at.dir)
      expect(listed.ok, listed.output).toBe(true)
      expect(listed.output).toContain('lifecycle: resolve, plan, generate, deploy, plugin')
      expect(listed.output).toContain('database check')
    } finally {
      at.dispose()
    }
  }, 120_000)

  it('is found from a directory inside the product, not only from its root', () => {
    const at = product()
    try {
      expect(qualy(['resolve'], at.dir).ok).toBe(true)
      const inside = path.join(at.dir, 'ops', 'deeper')
      fs.mkdirSync(inside, { recursive: true })
      const frozen = qualy(['resolve', '--frozen-lockfile'], inside)
      expect(frozen.ok, frozen.output).toBe(true)
      expect(frozen.output).toContain('is up to date')
    } finally {
      at.dispose()
    }
  }, 120_000)

  it('refuses to guess when no product is above the working directory', () => {
    // a directory that is nobody's product: the answer is a sentence naming
    // the two ways to say which one, never this repository's manifest
    const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-nowhere-'))
    try {
      const refused = qualy(['resolve'], nowhere)
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('no qualy.yml found in')
      expect(refused.output).toContain('--yml <path>')
      expect(refused.output).toContain('QUALY_CONFIG')
      expect(fs.existsSync(path.join(nowhere, 'qualy.lock.json'))).toBe(false)
    } finally {
      fs.rmSync(nowhere, { recursive: true, force: true })
    }
  }, 60_000)

  it('refuses a manifest that sits outside any package', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-orphan-'))
    try {
      fs.writeFileSync(path.join(dir, 'qualy.yml'), 'version: 3\nplugins: {}\n')
      const refused = qualy(['resolve'], dir)
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('no package.json at')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it("reads the product's .env, wherever the command was typed", () => {
    // deploy reaches the database named in the environment; a DATABASE_URL
    // that only the product's .env declares, pointing at a port nothing
    // listens on, is refused by name - which proves it was read, and from
    // the product root rather than the working directory
    const at = product()
    try {
      expect(qualy(['resolve'], at.dir).ok).toBe(true)
      fs.writeFileSync(path.join(at.dir, '.env'), 'DATABASE_URL=postgres://nobody:nobody@127.0.0.1:1/none\n')
      const inside = path.join(at.dir, 'ops')
      fs.mkdirSync(inside, { recursive: true })
      const deployed = qualy(['deploy'], inside, {
        DATABASE_URL: undefined,
        QUALY_TEST_DATABASE_URL: undefined,
        NODE_ENV: 'production',
        // production keeps its state under /var/lib/qualy, which this test may
        // not write; the instance here is the product's own directory
        QUALY_STATE_DIR: 'state',
      })
      expect(deployed.ok).toBe(false)
      expect(deployed.output).toMatch(/127\.0\.0\.1:1\b|ECONNREFUSED/)
      expect(deployed.output).not.toContain('DATABASE_URL is not set')
    } finally {
      at.dispose()
    }
  }, 120_000)
})
