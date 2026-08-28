import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// What this process is allowed to touch before it decides to run.
//
// The boot has two bands and one line between them. Above the line the work
// is pure: read the manifest, check it against the lock, import every active
// plugin's descriptor, compose the layers. Below it - `Layer.launch` - the
// process takes the port, the pool, the scheduler and whatever else the
// assembly owns.
//
// That line is about to carry weight. A development supervisor stages a
// candidate process through the upper band while the process it replaces is
// still serving, and only lets it cross once the old one has gone. Two
// processes in the lower band at once means two owners of the same port and
// the same database; a candidate that connects while merely being prepared
// is the failure that costs.
//
// So the band is measured rather than asserted in prose: the probe runs it
// with the database pointed at an address that refuses, and records every
// outbound connection and every listen. It also returns rather than exiting,
// so a timer or an open handle left behind shows up as a probe that never
// ends.

const run = promisify(execFile)
const probe = path.resolve(import.meta.dirname, 'support/resource-cold-probe.ts')

interface Report {
  readonly connects: readonly string[]
  readonly listens: readonly string[]
  readonly composed: boolean
  readonly error?: string
}

const compose = async (): Promise<Report> => {
  const { stdout } = await run('node', ['--import', 'tsx', probe], {
    env: {
      ...process.env,
      // nothing is listening here, so anything that tries to connect fails
      // loudly rather than finding a database by accident
      DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/none',
      NODE_ENV: 'development',
      QUALY_BOOT_TIMING: '0',
    },
    timeout: 120_000,
  })
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as Report
}

describe('the boot band before the application is launched', () => {
  it('composes the whole application without reaching the outside world', async () => {
    const report = await compose()
    expect(report.error).toBeUndefined()
    expect(report.composed).toBe(true)
    // a database that refuses every connection changes nothing, because
    // nothing connects
    expect(report.connects).toEqual([])
  }, 130_000)

  it('takes no port while composing', async () => {
    const report = await compose()
    expect(report.listens).toEqual([])
  }, 130_000)

  it('leaves nothing running behind it', async () => {
    // the probe never calls process.exit; that this resolves at all is the
    // assertion - a timer, a pool or a watcher left open would hang here
    // until the timeout above
    await expect(compose()).resolves.toMatchObject({ composed: true })
  }, 130_000)
})
