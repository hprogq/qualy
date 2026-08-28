import { fork, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  postgresAvailable,
  type TestContext,
} from '@qualy/plugin-database/testkit'
import { PROTOCOL, type ChildMessage } from '../src/dev/protocol.ts'

// Handing the port from one process to the next, without either of them ever
// holding it at the same time (docs/runtime-redesign.md §10, §14).
//
// The whole staged model rests on three things being true at once, and none
// of them can be checked from inside a single process: a candidate that has
// reported itself prepared has taken nothing, the process it replaces keeps
// serving until the moment it is told to stop, and the new one is not let in
// until the old one is gone. So this drives real processes and plays the part
// of the supervisor itself - which is also the first proof that the protocol
// is usable by one.

const runner = path.resolve(import.meta.dirname, '../src/run.ts')
const port = 3202
const base = `http://127.0.0.1:${port}`

const children: ChildProcess[] = []
// its own scratch database, because these processes really do boot: they run
// the migrations and open a pool the way any development backend does
let db: TestContext | null = null

beforeAll(async () => {
  if (postgresAvailable) db = await createTestContext('supervised-handoff')
}, 120_000)

afterAll(async () => {
  await db?.dispose()
}, 120_000)

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
})

/** a supervised backend, forked the way a supervisor would fork one */
const spawnBackend = (): ChildProcess => {
  const child = fork(runner, ['development'], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      QUALY_DEV_SUPERVISED: '1',
      PORT: String(port),
      NODE_ENV: 'development',
      DATABASE_URL: db!.url,
      // the scratch database is already at the head of the lineage; a second
      // process applying it again is work this suite is not about
      QUALY_MIGRATIONS: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.push(child)
  return child
}

type PreparedBackend = Extract<ChildMessage, { type: 'prepared'; role: 'backend' }>

const prepared = (child: ChildProcess) =>
  new Promise<PreparedBackend>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no prepared message')), 90_000)
    child.on('message', (message: ChildMessage) => {
      if (message.type === 'prepared' && message.role === 'backend') {
        clearTimeout(timer)
        resolve(message)
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`candidate exited before preparing (${String(code)})`))
    })
  })

const exited = (child: ChildProcess) =>
  new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode)
    child.once('exit', (code) => resolve(code))
  })

const alive = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${base}/health/live`, { signal: AbortSignal.timeout(1_000) })
    return response.status === 200
  } catch {
    return false
  }
}

const waitUntilAlive = async (within = 60_000): Promise<void> => {
  const until = Date.now() + within
  while (Date.now() < until) {
    if (await alive()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('the backend never answered')
}

describe.runIf(postgresAvailable)('a supervised backend', () => {
  it('reports what it prepared and waits to be told to run', async () => {
    const candidate = spawnBackend()
    const report = await prepared(candidate)
    expect(report.protocol).toBe(PROTOCOL)
    expect(report.role).toBe('backend')
    // what this assembly asks for beside it, resolved through the same
    // dependency graph the runtime was built from. A headless assembly - one
    // whose manifest does not run the web plugin - reports nothing here,
    // because the topology is read from what runs.
    expect(report.topology.map((service) => service.key)).toContain('@qualy/plugin-web:web')

    // prepared means composed, not running: nothing answers on the port and
    // nothing will until this candidate is accepted
    expect(await alive()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(await alive()).toBe(false)
    expect(candidate.exitCode).toBeNull()

    candidate.send({ protocol: PROTOCOL, type: 'accept' })
    await waitUntilAlive()
  }, 180_000)

  it('keeps serving from the old process until the new one is let in', async () => {
    const active = spawnBackend()
    await prepared(active)
    active.send({ protocol: PROTOCOL, type: 'accept' })
    await waitUntilAlive()

    // a candidate prepares beside it, and the port is untouched throughout
    const candidate = spawnBackend()
    await prepared(candidate)
    expect(await alive()).toBe(true)

    // the handoff: the old one is asked to stop and the new one is not let
    // in until it has actually gone, so the two never both own anything
    active.send({ protocol: PROTOCOL, type: 'shutdown' })
    expect(await exited(active)).toBe(0)
    expect(await alive()).toBe(false)

    candidate.send({ protocol: PROTOCOL, type: 'accept' })
    await waitUntilAlive()
    expect(candidate.exitCode).toBeNull()
  }, 240_000)

  it('ends a candidate that is refused', async () => {
    const candidate = spawnBackend()
    await prepared(candidate)
    candidate.send({ protocol: PROTOCOL, type: 'reject' })
    expect(await exited(candidate)).toBe(0)
    expect(await alive()).toBe(false)
  }, 180_000)

  it('ends a candidate whose supervisor goes away', async () => {
    const candidate = spawnBackend()
    await prepared(candidate)
    // the channel is the lease: a supervisor killed while a candidate waits
    // must not leave it waiting for a message that will never come
    candidate.disconnect()
    expect(await exited(candidate)).toBe(0)
  }, 180_000)
})
