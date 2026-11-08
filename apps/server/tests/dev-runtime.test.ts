import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import {
  exited,
  forkService,
  send,
  servicePrepared,
  serviceReady,
  stop,
  type Child,
} from '../src/dev/child.ts'
import { PROTOCOL } from '../src/dev/protocol.ts'

const children: Child[] = []
const directories: string[] = []
// Resolve in the product before entering a temporary cwd. A version-manager
// shim cannot discover this product's pinned version from that directory.
const bunDirectory = path.dirname(
  execFileSync('bun', ['--no-env-file', '--no-install', '--print', 'process.execPath'], {
    encoding: 'utf8',
  }).trim(),
)

afterEach(async () => {
  for (const child of children.splice(0)) await stop(child, 2_000)
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

// An actual Node parent and Bun service: the IPC channel, environment and
// finalizer must work together, not just produce the expected fork options.
const start = (env: NodeJS.ProcessEnv = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-dev-runtime-'))
  directories.push(dir)
  fs.writeFileSync(path.join(dir, '.env'), 'QUALY_ENV_LEAK=from-file\n')
  const report = path.join(dir, 'report.json')
  const released = path.join(dir, 'released')
  const module = path.join(dir, 'service.mjs')
  fs.writeFileSync(
    module,
    `import fs from 'node:fs'
import { Effect } from ${JSON.stringify(import.meta.resolve('effect'))}
export const prepare = () => Effect.sync(() => fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({
  runtime: process.versions.bun === undefined ? 'node' : 'bun',
  executable: process.execPath,
  inherited: process.env.QUALY_INHERITED,
  leaked: process.env.QUALY_ENV_LEAK ?? null,
})))
export const acquire = () => Effect.acquireRelease(
  Effect.sync(() => setInterval(() => {}, 1000)),
  timer => Effect.sync(() => { clearInterval(timer); fs.writeFileSync(${JSON.stringify(released)}, 'released') }),
)
`,
  )
  const spec: DevServiceSpec = {
    key: 'test:runtime',
    pluginId: '@qualy/test',
    id: 'runtime',
    runtime: 'bun',
    moduleUrl: pathToFileURL(module).href,
    config: {},
    manifestDir: dir,
    pluginRoot: dir,
  }
  const cwd = process.cwd()
  let child: Child
  try {
    process.chdir(dir)
    child = forkService(spec, 'http://127.0.0.1:1', {
      ...process.env,
      PATH: `${bunDirectory}${path.delimiter}${process.env['PATH'] ?? ''}`,
      QUALY_DEV_RUNTIME: undefined,
      QUALY_ENV_LEAK: undefined,
      QUALY_INHERITED: 'from-supervisor',
      ...env,
    })
  } finally {
    process.chdir(cwd)
  }
  children.push(child)
  return { child, report, released }
}

describe('the development service runtime', () => {
  it('runs Bun from a Node parent without loading another environment, and releases on stop', async () => {
    expect(process.versions['bun']).toBeUndefined()
    const run = start()
    await servicePrepared(run.child)
    expect(JSON.parse(fs.readFileSync(run.report, 'utf8'))).toMatchObject({
      runtime: 'bun',
      inherited: 'from-supervisor',
      leaked: null,
    })
    expect(fs.existsSync(run.released)).toBe(false)
    send(run.child, { protocol: PROTOCOL, type: 'accept' })
    await serviceReady(run.child)
    await stop(run.child, 5_000)
    expect(await exited(run.child)).toBe(0)
    expect(fs.readFileSync(run.released, 'utf8')).toBe('released')
  })

  it('uses Node only when the developer explicitly requests the fallback', async () => {
    const run = start({ QUALY_DEV_RUNTIME: 'node' })
    await servicePrepared(run.child)
    expect(JSON.parse(fs.readFileSync(run.report, 'utf8'))).toMatchObject({
      runtime: 'node',
      executable: process.execPath,
    })
  })

  it('releases an acquired Bun service when the parent channel closes', async () => {
    const run = start()
    await servicePrepared(run.child)
    send(run.child, { protocol: PROTOCOL, type: 'accept' })
    await serviceReady(run.child)
    run.child.process.disconnect()
    expect(await exited(run.child)).toBe(0)
    expect(fs.readFileSync(run.released, 'utf8')).toBe('released')
  })

  it('settles a missing executable instead of waiting or silently falling back', async () => {
    const run = start({ PATH: '' })
    await expect(servicePrepared(run.child)).rejects.toThrow(/ended/)
    expect(run.child.gone).toBe(true)
    expect(fs.existsSync(run.report)).toBe(false)
  })

  it('refuses an unknown override', () => {
    expect(() => start({ QUALY_DEV_RUNTIME: 'unknown' })).toThrow(
      'QUALY_DEV_RUNTIME must be node or bun',
    )
  })
})
