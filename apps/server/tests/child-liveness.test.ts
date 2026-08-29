import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import { exited, forkService, stop, type Child } from '../src/dev/child.ts'

// Whether a child has exited, when it was killed by a signal.
//
// `exitCode` cannot answer this. A process ended by a signal keeps
// `exitCode === null` forever and reports the signal on `signalCode` instead,
// so every `exitCode !== null` test reads a signal-killed child as still
// running. That is not a corner case here: a terminal delivers Ctrl+C to the
// whole foreground process group, so it is what every interrupt during a
// reload looks like.
//
// Measured before the latch existed: `exited()` on such a child registered a
// listener for an event that had already fired and never settled, so `stop()`
// waited out its entire kill deadline, killed a process that was already gone,
// and then awaited the same never-settling promise. The supervisor sat there.

const fixture = pathToFileURL(path.resolve(import.meta.dirname, 'support/fake-dev-service.ts')).href

const spec: DevServiceSpec = {
  key: '@qualy/plugin-fake:fake',
  pluginId: '@qualy/plugin-fake',
  id: 'fake',
  moduleUrl: fixture,
  config: { greeting: 'hello' },
  manifestDir: process.cwd(),
  pluginRoot: process.cwd(),
}

const started: Child[] = []

afterEach(() => {
  for (const child of started.splice(0)) if (!child.gone) child.process.kill('SIGKILL')
})

const signalKilled = async (): Promise<Child> => {
  const child = forkService(spec, 'http://127.0.0.1:3000', process.env)
  started.push(child)
  await new Promise((resolve) => setTimeout(resolve, 300))
  child.process.kill('SIGKILL')
  await new Promise<void>((resolve) => child.process.once('exit', () => resolve()))
  // the shape the whole case is about: dead, and exitCode still says nothing
  expect(child.process.exitCode).toBeNull()
  expect(child.process.signalCode).toBe('SIGKILL')
  return child
}

describe('a child killed by a signal', () => {
  it('is known to be gone even though its exit code is null', async () => {
    const child = await signalKilled()
    expect(child.gone).toBe(true)
  }, 30_000)

  it('settles instead of waiting for an exit that already happened', async () => {
    const child = await signalKilled()
    const raced = await Promise.race([
      exited(child).then(() => 'settled' as const),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 2_000)),
    ])
    expect(raced).toBe('settled')
  }, 30_000)

  it('is not waited out for the whole kill deadline', async () => {
    const child = await signalKilled()
    const began = Date.now()
    await stop(child, 20_000)
    expect(Date.now() - began).toBeLessThan(1_000)
  }, 40_000)
})
