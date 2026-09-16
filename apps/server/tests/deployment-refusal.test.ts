import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lockPathFor, lockSelfHash, renderLock, type AssemblyLock } from '@qualy/assembly'
import { deploymentPaths, ensureStateLayout, promoteDeployedLock } from '@qualy/deployment-state'
import { manifestPath } from '../src/manifest.ts'

// A production start over an instance nobody deployed.
//
// The lock beside the manifest says which assembly the software targets; the
// deployed lock in the instance's state says which one this instance last
// reached. Production refuses when they differ, or when there is nothing to
// compare against, and it refuses BEFORE acquiring anything: no port, no
// pool, no web release. So these cases need neither a database nor a build -
// the refusal is in the band where only files have been read.
//
// The one case that passes the check goes on to fail somewhere real (the
// database url here points at a closed port), and what is asserted about it
// is only that it got past this gate: the boot mark after verification was
// printed, and no line says deployment required.

const entry = path.resolve(import.meta.dirname, '../src/run.ts')
const repoRoot = path.resolve(import.meta.dirname, '../..')

interface Outcome {
  readonly code: number | null
  readonly lines: readonly string[]
}

const boot = (env: NodeJS.ProcessEnv): Promise<Outcome> =>
  new Promise((resolve, reject) => {
    execFile(
      'node',
      [entry, 'production'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          // the check under test runs before anything reaches the database;
          // a closed port makes sure a boot that passes it still ends
          DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
          QUALY_LOG_FORMAT: 'json',
          QUALY_BOOT_TIMING: '1',
          ...env,
        },
        timeout: 90_000,
      },
      (error, stdout, stderr) => {
        const code = error && 'code' in error && typeof error.code === 'number' ? error.code : 0
        if (error && !('code' in error)) return reject(error)
        const lines = [...stdout.split('\n'), ...stderr.split('\n')]
          .filter((line) => line.trim() !== '')
          .map((line) => {
            try {
              return String((JSON.parse(line) as { message?: unknown }).message ?? line)
            } catch {
              return line
            }
          })
        resolve({ code, lines })
      },
    )
  })

const refusal = (outcome: Outcome) => outcome.lines.filter((line) => line.includes('startup failed'))

/** a valid lock of some other assembly, hashed over its own contents */
const otherLock = (): AssemblyLock => {
  const lock: AssemblyLock = {
    lockfileVersion: 2,
    manifestHash: 'sha256:some-other-manifest',
    resolutionHash: '',
    plugins: { '@fake/plugin-elsewhere': { version: '0.0.0', state: 'active' } },
    capabilities: {},
    runtime: { plugins: ['@fake/plugin-elsewhere'] },
  }
  return { ...lock, resolutionHash: lockSelfHash(lock) }
}

describe('a production start checks what this instance deployed', () => {
  it('refuses an instance with no deployment state, and says what to run', async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-no-state-'))
    fs.rmSync(state, { recursive: true })
    try {
      const outcome = await boot({ QUALY_STATE_DIR: state })
      expect(outcome.code).toBe(1)
      const said = refusal(outcome)
      expect(said).toHaveLength(1)
      expect(said[0]).toContain('deployment required')
      expect(said[0]).toContain('no deployment state at')
      expect(said[0]).toContain('qualy deploy')
    } finally {
      fs.rmSync(state, { recursive: true, force: true })
    }
  }, 120_000)

  it('refuses an instance deployed to another assembly, naming both', async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-other-state-'))
    try {
      const paths = deploymentPaths({ productRoot: repoRoot, mode: 'production', env: { QUALY_STATE_DIR: state } })
      ensureStateLayout(paths)
      const other = otherLock()
      promoteDeployedLock(paths, other)
      const outcome = await boot({ QUALY_STATE_DIR: state })
      expect(outcome.code).toBe(1)
      const said = refusal(outcome)
      expect(said).toHaveLength(1)
      expect(said[0]).toContain('deployment required')
      expect(said[0]).toContain(other.resolutionHash)
      const target = JSON.parse(fs.readFileSync(lockPathFor(manifestPath()), 'utf8')) as AssemblyLock
      expect(said[0]).toContain(target.resolutionHash)
    } finally {
      fs.rmSync(state, { recursive: true, force: true })
    }
  }, 120_000)

  it('lets an instance deployed to this very assembly past the gate', async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-same-state-'))
    try {
      const paths = deploymentPaths({ productRoot: repoRoot, mode: 'production', env: { QUALY_STATE_DIR: state } })
      ensureStateLayout(paths)
      // the target lock itself, copied the way a deployment records it
      fs.copyFileSync(lockPathFor(manifestPath()), paths.deployedLock)
      const outcome = await boot({ QUALY_STATE_DIR: state })
      // it does not serve - nothing listens on port 1 - but it was not this
      // check that stopped it
      expect(outcome.lines.some((line) => line.includes('deployment required'))).toBe(false)
      expect(outcome.lines.some((line) => line.endsWith('application composed'))).toBe(true)
      expect(outcome.code).toBe(1)
    } finally {
      fs.rmSync(state, { recursive: true, force: true })
    }
  }, 120_000)

  it('never repairs: a refused start writes nothing into the state directory', async () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-untouched-state-'))
    try {
      const paths = deploymentPaths({ productRoot: repoRoot, mode: 'production', env: { QUALY_STATE_DIR: state } })
      ensureStateLayout(paths)
      const other = otherLock()
      promoteDeployedLock(paths, other)
      await boot({ QUALY_STATE_DIR: state })
      expect(fs.readFileSync(paths.deployedLock, 'utf8')).toBe(renderLock(other))
      expect(fs.existsSync(paths.deploymentLock)).toBe(false)
    } finally {
      fs.rmSync(state, { recursive: true, force: true })
    }
  }, 120_000)
})
