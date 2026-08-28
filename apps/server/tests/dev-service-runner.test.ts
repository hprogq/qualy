import { fork, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import { PROTOCOL, type ChildMessage } from '../src/dev/protocol.ts'

// The runner every development service runs in, driven the way a supervisor
// would drive it (docs/runtime-redesign.md §16).
//
// What is being checked is the shape of the scope rather than any behaviour
// of the service: that preparing happens before the supervisor has said
// anything, that nothing is acquired until it does, and that what acquire
// took is released when the process is asked to stop - not when acquire
// returned, which is the mistake the design calls out by name.

const runner = path.resolve(import.meta.dirname, '../src/dev/service-runner.ts')
const fixture = pathToFileURL(path.resolve(import.meta.dirname, 'support/fake-dev-service.ts')).href

const children: ChildProcess[] = []

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
})

const spec: DevServiceSpec = {
  key: '@qualy/plugin-fake:fake',
  pluginId: '@qualy/plugin-fake',
  id: 'fake',
  moduleUrl: fixture,
  config: { greeting: 'hello' },
  manifestDir: process.cwd(),
  pluginRoot: process.cwd(),
}

interface Run {
  readonly child: ChildProcess
  readonly lines: string[]
  readonly messages: ChildMessage[]
}

const start = (): Run => {
  const child = fork(runner, [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.push(child)
  const lines: string[] = []
  const messages: ChildMessage[] = []
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) if (line !== '') lines.push(line)
  })
  child.on('message', (message: ChildMessage) => messages.push(message))
  child.send({ protocol: PROTOCOL, type: 'spec', spec, origin: 'http://127.0.0.1:3000' })
  return { child, lines, messages }
}

const until = async (holds: () => boolean, within = 30_000) => {
  const end = Date.now() + within
  while (Date.now() < end) {
    if (holds()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('never happened')
}

const said = (run: Run, what: string) => run.lines.some((line) => line.includes(what))

describe('a development service runner', () => {
  it('prepares first, and acquires nothing until it is let in', async () => {
    const run = start()
    await until(() => run.messages.some((message) => message.type === 'prepared'))
    // prepared, and the context reached the service intact
    expect(said(run, 'prepared @qualy/plugin-fake at http://127.0.0.1:3000')).toBe(true)
    // and nothing has been taken: the supervisor has not answered yet
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(said(run, 'acquired')).toBe(false)

    run.child.send({ protocol: PROTOCOL, type: 'accept' })
    await until(() => said(run, 'acquired'))
    expect(said(run, 'acquired with {"greeting":"hello"}')).toBe(true)
    await until(() => run.messages.some((message) => message.type === 'ready'))
  }, 60_000)

  it('holds what it acquired until it is asked to stop', async () => {
    const run = start()
    await until(() => run.messages.some((message) => message.type === 'prepared'))
    run.child.send({ protocol: PROTOCOL, type: 'accept' })
    await until(() => run.messages.some((message) => message.type === 'ready'))

    // the scope is still open: acquire returned a while ago and nothing was
    // released with it
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(said(run, 'released')).toBe(false)

    run.child.send({ protocol: PROTOCOL, type: 'shutdown' })
    await until(() => said(run, 'released'))
    await until(() => run.child.exitCode !== null)
    expect(run.child.exitCode).toBe(0)
  }, 60_000)

  it('ends when its supervisor goes away', async () => {
    const run = start()
    await until(() => run.messages.some((message) => message.type === 'prepared'))
    run.child.disconnect()
    await until(() => run.child.exitCode !== null)
    expect(run.child.exitCode).toBe(0)
  }, 60_000)
})
