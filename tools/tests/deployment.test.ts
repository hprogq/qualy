import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lockPathFor } from '@qualy/assembly'
import { createWorkspace, type SyntheticPackage, type Workspace } from '@qualy/assembly/testkit'
import { deploymentPaths } from '@qualy/deployment-state'

// `qualy deploy` as a transaction over one instance.
//
// The claim is not that deploy applies things. It is that the deployed lock
// - the instance's record of which assembly it reached - moves only when
// every capability's work succeeded, and never otherwise. Asserted with a
// capability this repository does not have, whose deploy fails on request:
// a case built on the database capability would need a database, and would
// pass just as well if the core had learned what a migration is.
//
// The CLI runs as a process, with the temporary product as its working
// directory and nothing named in the environment, because the point of the
// state directory is where it is: beside the product in development, found
// by the same rule the server uses to check it.

const repoRoot = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(repoRoot, 'apps/cli/src/main.ts')

const FLAKY = '@fake/plugin-flaky'
const OTHER = '@qualy/plugin-layout-default'

/** a capability whose deploy refuses while a file exists, and leaves a mark when it runs */
const flaky: SyntheticPackage = {
  id: FLAKY,
  files: {
    'index.js': `export default { _tag: 'Plugin', id: '${FLAKY}', dependsOn: [], features: [{ _tag: 'Capability', key: 'flaky', load: () => import('./provider.js') }] }\n`,
    'provider.js': [
      "import fs from 'node:fs'",
      'export default {',
      "  key: 'flaky',",
      '  parseContribution: () => ({}),',
      '  resolve: () => ({}),',
      '  deploy: async (context) => {',
      '    const config = context.providerConfig ?? {}',
      "    if (config.failWhen && fs.existsSync(config.failWhen)) throw new Error('the flaky capability refused to deploy')",
      "    if (config.record) fs.appendFileSync(config.record, 'deployed\\n')",
      '  },',
      '}',
    ].join('\n'),
  },
}

const qualy = (
  args: readonly string[],
  cwd: string,
  env: Record<string, string | undefined> = {},
): { ok: boolean; output: string; ms: number } => {
  const environment: Record<string, string | undefined> = { ...process.env, QUALY_CONFIG: undefined, ...env }
  for (const key of Object.keys(environment)) {
    if (environment[key] === undefined) delete environment[key]
  }
  const started = performance.now()
  try {
    const stdout = execFileSync('node', [CLI, ...args], { cwd, env: environment, encoding: 'utf8', stdio: 'pipe' })
    return { ok: true, output: stdout, ms: performance.now() - started }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return {
      ok: false,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      ms: performance.now() - started,
    }
  }
}

interface Instance {
  workspace: Workspace
  failWhen: string
  record: string
  /** the development state beside the product, where the deployed lock lands */
  paths: ReturnType<typeof deploymentPaths>
  select(plugins: readonly string[]): void
  targetLock(): string
  deployedLock(): string | undefined
  dispose(): void
}

const instance = (): Instance => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-deploy-'))
  const failWhen = path.join(scratch, 'refuse')
  const record = path.join(scratch, 'record')
  const configs = { [FLAKY]: { failWhen, record } }
  const workspace = createWorkspace([FLAKY], { synthetic: [flaky], configs })
  const paths = deploymentPaths({ productRoot: workspace.dir, mode: 'development', env: {} })
  return {
    workspace,
    failWhen,
    record,
    paths,
    select: (plugins) => workspace.writeManifest(plugins, { configs }),
    targetLock: () => fs.readFileSync(lockPathFor(workspace.manifestPath), 'utf8'),
    deployedLock: () =>
      fs.existsSync(paths.deployedLock) ? fs.readFileSync(paths.deployedLock, 'utf8') : undefined,
    dispose: () => {
      workspace.dispose()
      fs.rmSync(scratch, { recursive: true, force: true })
    },
  }
}

describe('the deployed lock follows successful deployments and nothing else', () => {
  it('records target A, keeps A while B fails, then records B', () => {
    const at = instance()
    try {
      // target A
      expect(qualy(['resolve'], at.workspace.dir).ok).toBe(true)
      const a = at.targetLock()
      const first = qualy(['deploy'], at.workspace.dir)
      expect(first.ok, first.output).toBe(true)
      expect(first.output).toContain('deploy: flaky')
      expect(at.deployedLock()).toBe(a)
      expect(fs.readFileSync(at.record, 'utf8')).toBe('deployed\n')

      // target B, whose deployment is refused partway
      at.select([FLAKY, OTHER])
      expect(qualy(['resolve'], at.workspace.dir).ok).toBe(true)
      const b = at.targetLock()
      expect(b).not.toBe(a)
      fs.writeFileSync(at.failWhen, '')
      const refused = qualy(['deploy'], at.workspace.dir)
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('the flaky capability refused to deploy')
      expect(refused.output).toContain('deployed.lock.json unchanged')
      // the instance still says A, and the deployment lock was not left behind
      expect(at.deployedLock()).toBe(a)
      expect(fs.existsSync(at.paths.deploymentLock)).toBe(false)

      // and once the work can succeed, B
      fs.rmSync(at.failWhen)
      const second = qualy(['deploy'], at.workspace.dir)
      expect(second.ok, second.output).toBe(true)
      expect(at.deployedLock()).toBe(b)
      expect(second.output).toContain('deployed sha256:')
    } finally {
      at.dispose()
    }
  }, 120_000)

  it('refuses a second deployment while one holds the instance, without waiting', () => {
    const at = instance()
    try {
      expect(qualy(['resolve'], at.workspace.dir).ok).toBe(true)
      fs.mkdirSync(at.paths.root, { recursive: true })
      // the lock of a deployment still running: this very process
      fs.writeFileSync(
        at.paths.deploymentLock,
        `${JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() })}\n`,
      )
      const refused = qualy(['deploy'], at.workspace.dir)
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('another deployment is running')
      expect(refused.output).toContain(`pid ${String(process.pid)}`)
      // failed clearly rather than waited: well under any plausible lock wait
      expect(refused.ms).toBeLessThan(15_000)
      // nothing was applied and nothing was recorded
      expect(fs.existsSync(at.record)).toBe(false)
      expect(at.deployedLock()).toBeUndefined()
      // and the other deployment's lock is still theirs
      expect(fs.existsSync(at.paths.deploymentLock)).toBe(true)
    } finally {
      at.dispose()
    }
  }, 120_000)

  it('fails before any work when the state directory cannot be written', () => {
    const at = instance()
    const locked = path.join(at.workspace.dir, 'readonly')
    fs.mkdirSync(locked)
    fs.chmodSync(locked, 0o555)
    try {
      expect(qualy(['resolve'], at.workspace.dir).ok).toBe(true)
      const refused = qualy(['deploy'], at.workspace.dir, { QUALY_STATE_DIR: 'readonly/state' })
      expect(refused.ok).toBe(false)
      expect(refused.output).toContain('is not writable')
      // the capability never ran: the probe comes before the work, so a
      // deployment that could not be recorded is not started
      expect(fs.existsSync(at.record)).toBe(false)
    } finally {
      fs.chmodSync(locked, 0o755)
      at.dispose()
    }
  }, 120_000)

  it('honours QUALY_STATE_DIR relative to the product, from anywhere inside it', () => {
    const at = instance()
    try {
      expect(qualy(['resolve'], at.workspace.dir).ok).toBe(true)
      const inside = path.join(at.workspace.dir, 'ops')
      fs.mkdirSync(inside)
      const deployed = qualy(['deploy'], inside, { QUALY_STATE_DIR: 'var/state' })
      expect(deployed.ok, deployed.output).toBe(true)
      expect(fs.existsSync(path.join(at.workspace.dir, 'var/state/assembly/deployed.lock.json'))).toBe(
        true,
      )
      expect(fs.existsSync(path.join(inside, 'var'))).toBe(false)
    } finally {
      at.dispose()
    }
  }, 120_000)
})
