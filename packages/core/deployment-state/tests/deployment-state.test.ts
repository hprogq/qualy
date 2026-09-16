import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lockSelfHash, renderLock, type AssemblyLock } from '@qualy/assembly'
import {
  DEVELOPMENT_STATE_DIR,
  PRODUCTION_STATE_DIR,
  deploymentPaths,
  ensureStateLayout,
  promoteDeployedLock,
  readDeployedLock,
  verifyDeployment,
  withDeploymentLock,
} from '@qualy/deployment-state'

// The state directory on its own: where it is, that it refuses what it
// cannot write, and that the deployed lock moves atomically or not at all.
// What a deployment does around it is the CLI's suite.

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-state-'))

/** a lock with the shape readLock accepts: hashed over its own contents */
const lockOf = (label: string): AssemblyLock => {
  const plugins = { [`@fake/plugin-${label}`]: { version: '0.0.0', state: 'active' as const } }
  const lock: AssemblyLock = {
    lockfileVersion: 2,
    manifestHash: `sha256:manifest-${label}`,
    resolutionHash: '',
    plugins,
    capabilities: {},
    runtime: { plugins: Object.keys(plugins) },
  }
  return { ...lock, resolutionHash: lockSelfHash(lock) }
}

describe('where the state lives', () => {
  it('is named by QUALY_STATE_DIR first, relative to the product', () => {
    const paths = deploymentPaths({
      productRoot: '/srv/product',
      mode: 'production',
      env: { QUALY_STATE_DIR: 'state/here' },
    })
    expect(paths.root).toBe(path.resolve('/srv/product', 'state/here'))
    expect(paths.deployedLock).toBe(path.join(paths.root, 'assembly', 'deployed.lock.json'))
    expect(paths.migrations).toBe(path.join(paths.root, 'database', 'migrations'))
  })

  it('defaults to the system location in production and beside the product in development', () => {
    expect(deploymentPaths({ productRoot: '/srv/product', mode: 'production', env: {} }).root).toBe(
      PRODUCTION_STATE_DIR,
    )
    expect(deploymentPaths({ productRoot: '/srv/product', mode: 'development', env: {} }).root).toBe(
      path.join('/srv/product', DEVELOPMENT_STATE_DIR),
    )
  })
})

describe('the layout', () => {
  it('creates the directories and proves it can write there', () => {
    const dir = scratch()
    try {
      const paths = deploymentPaths({ productRoot: dir, mode: 'development', env: {} })
      ensureStateLayout(paths)
      expect(fs.existsSync(paths.assembly)).toBe(true)
      expect(fs.existsSync(paths.migrations)).toBe(true)
      // the probe leaves nothing behind
      expect(fs.readdirSync(paths.root).sort()).toEqual(['assembly', 'database'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails fast where it cannot write, naming the directory', () => {
    const dir = scratch()
    const locked = path.join(dir, 'readonly')
    fs.mkdirSync(locked)
    fs.chmodSync(locked, 0o555)
    try {
      const paths = deploymentPaths({ productRoot: dir, mode: 'production', env: { QUALY_STATE_DIR: 'readonly/state' } })
      expect(() => ensureStateLayout(paths)).toThrow(/deployment state at .*readonly\/state is not writable/)
    } finally {
      fs.chmodSync(locked, 0o755)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the deployed lock', () => {
  it('is absent until promoted, then reads back as what was promoted', () => {
    const dir = scratch()
    try {
      const paths = deploymentPaths({ productRoot: dir, mode: 'development', env: {} })
      ensureStateLayout(paths)
      expect(readDeployedLock(paths)).toBeUndefined()
      const a = lockOf('a')
      expect(promoteDeployedLock(paths, a)).toBe(true)
      expect(renderLock(readDeployedLock(paths)!)).toBe(renderLock(a))
      // promoting the same lock again writes nothing
      expect(promoteDeployedLock(paths, a)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('says why a target may not run here, or says nothing', () => {
    const dir = scratch()
    try {
      const paths = deploymentPaths({ productRoot: dir, mode: 'development', env: {} })
      const a = lockOf('a')
      const b = lockOf('b')
      expect(verifyDeployment(paths, a)).toEqual([expect.stringContaining('no deployment state at')])
      ensureStateLayout(paths)
      expect(verifyDeployment(paths, a)).toEqual([expect.stringContaining('nothing has been deployed')])
      promoteDeployedLock(paths, a)
      expect(verifyDeployment(paths, a)).toEqual([])
      const reasons = verifyDeployment(paths, b)
      expect(reasons).toHaveLength(2)
      expect(reasons[0]).toContain(a.resolutionHash)
      expect(reasons[0]).toContain(b.resolutionHash)
      expect(reasons[1]).toContain('manifest')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a deployed lock somebody edited', () => {
    const dir = scratch()
    try {
      const paths = deploymentPaths({ productRoot: dir, mode: 'development', env: {} })
      ensureStateLayout(paths)
      promoteDeployedLock(paths, lockOf('a'))
      const edited = JSON.parse(fs.readFileSync(paths.deployedLock, 'utf8')) as AssemblyLock
      edited.runtime.plugins = []
      fs.writeFileSync(paths.deployedLock, renderLock(edited))
      expect(() => verifyDeployment(paths, lockOf('a'))).toThrow(/has been edited/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('one deployment at a time', () => {
  it('runs the body under the lock and releases it, even when the body fails', async () => {
    const dir = scratch()
    try {
      const paths = deploymentPaths({ productRoot: dir, mode: 'development', env: {} })
      const seen = await withDeploymentLock(paths, async () => {
        const holder = JSON.parse(fs.readFileSync(paths.deploymentLock, 'utf8')) as { pid: number }
        return holder.pid
      })
      expect(seen).toBe(process.pid)
      expect(fs.existsSync(paths.deploymentLock)).toBe(false)

      await expect(
        withDeploymentLock(paths, async () => {
          throw new Error('the work failed')
        }),
      ).rejects.toThrow('the work failed')
      expect(fs.existsSync(paths.deploymentLock)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses at once while another holds it, and names the holder', async () => {
    const dir = scratch()
    try {
      const paths = deploymentPaths({ productRoot: dir, mode: 'development', env: {} })
      let inner: Promise<unknown> | undefined
      await withDeploymentLock(paths, async () => {
        inner = withDeploymentLock(paths, async () => 'never')
        await expect(inner).rejects.toThrow(/another deployment is running \(pid \d+ on .+\)/)
      })
      // a lock left by a process that is gone is reported as exactly that
      fs.writeFileSync(
        paths.deploymentLock,
        `${JSON.stringify({ pid: 2 ** 22 - 1, host: os.hostname(), startedAt: '2026-01-01T00:00:00.000Z' })}\n`,
      )
      await expect(withDeploymentLock(paths, async () => 'never')).rejects.toThrow(
        /no longer running; remove the file/,
      )
      // and one from another machine is not second-guessed
      fs.writeFileSync(
        paths.deploymentLock,
        `${JSON.stringify({ pid: 1, host: 'elsewhere.example', startedAt: '2026-01-01T00:00:00.000Z' })}\n`,
      )
      await expect(withDeploymentLock(paths, async () => 'never')).rejects.toThrow(
        /holds .*deploy\.lock \(pid 1 on elsewhere\.example/,
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
