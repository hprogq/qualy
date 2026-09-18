import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { exited, forkService, serviceReady, servicePrepared, stop } from '../src/dev/child.ts'

// The waits a supervisor does on a child that has ALREADY left.
//
// Every one of them used to register a listener for an event that had fired,
// which never settles - and the supervisor has one loop, so a wait that never
// settles is a session that accepts no more saves and answers no Ctrl+C. The
// window is small on a good day and is exactly the shape of a bad one: a
// startup that fails immediately, a channel torn down mid-handshake, a
// terminal delivering Ctrl+C to the whole group while a candidate is being
// prepared.
//
// So these do not test the happy path. They fork a child that cannot possibly
// survive, wait for it to be gone, and only then ask the questions.

const spec = {
  key: 'test:gone',
  pluginId: '@qualy/test',
  id: 'gone',
  // there is no such module, so the runner fails the moment it looks
  moduleUrl: pathToFileURL('/qualy/no/such/dev-service.ts').href,
  config: {},
  manifestDir: process.cwd(),
  pluginRoot: process.cwd(),
}

/** every wait here has to settle; a hang is the defect under test */
const within = <T>(work: Promise<T>, ms = 5_000) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`still waiting after ${String(ms)}ms`)), ms).unref(),
    ),
  ])

describe('waiting on a child that is already gone', () => {
  it('settles every question the supervisor asks', async () => {
    const child = forkService(spec, 'http://127.0.0.1:1', { ...process.env })
    // the exit latch is the one both the waits and the deadline read
    const code = await within(exited(child))
    expect(code).not.toBe(0)
    expect(child.gone).toBe(true)

    // asked AFTER the exit: each of these registered its own listener once,
    // and the event they were listening for had already happened
    await expect(within(servicePrepared(child))).rejects.toThrow(/ended/)
    await expect(within(serviceReady(child))).rejects.toThrow(/ended/)
    // and stopping something that has stopped is not a deadline to wait out
    await expect(within(stop(child, 60_000), 2_000)).resolves.toBeUndefined()
  }, 30_000)
})
