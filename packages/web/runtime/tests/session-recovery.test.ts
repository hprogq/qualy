import { afterEach, describe, expect, it } from 'vitest'
import {
  changingIdentity,
  identityChanging,
  installSessionRecovery,
  recovering,
} from '../src/session-recovery.ts'

// A call that finds the session gone is held for the reader to sign in again
// and then made once more; everything else fails as it would have.

const refused = Object.assign(new Error('SESSION_EXPIRED'), { _tag: 'SESSION_EXPIRED' })
const other = Object.assign(new Error('PROBE_BUSY'), { _tag: 'PROBE_BUSY' })

let uninstall: (() => void) | undefined
afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

/** a call that is refused the first time and answered after */
const refusedOnce = () => {
  let calls = 0
  return {
    call: () => {
      calls += 1
      return calls === 1 ? Promise.reject(refused) : Promise.resolve('answered')
    },
    calls: () => calls,
  }
}

describe('a call that finds the session gone', () => {
  it('is made again once the reader is back', async () => {
    let waited = 0
    uninstall = installSessionRecovery({
      wait: () => {
        waited += 1
        return Promise.resolve(true)
      },
    })
    const probe = refusedOnce()
    await expect(recovering(probe.call)).resolves.toBe('answered')
    expect({ calls: probe.calls(), waited }).toEqual({ calls: 2, waited: 1 })
  })

  it('fails as refused when the reader does not come back', async () => {
    uninstall = installSessionRecovery({ wait: () => Promise.resolve(false) })
    const probe = refusedOnce()
    await expect(recovering(probe.call)).rejects.toBe(refused)
    expect(probe.calls()).toBe(1)
  })

  it('fails as refused where nothing was installed to recover it', async () => {
    const probe = refusedOnce()
    await expect(recovering(probe.call)).rejects.toBe(refused)
    expect(probe.calls()).toBe(1)
  })

  it('leaves every other failure alone', async () => {
    let waited = 0
    uninstall = installSessionRecovery({
      wait: () => {
        waited += 1
        return Promise.resolve(true)
      },
    })
    await expect(recovering(() => Promise.reject(other))).rejects.toBe(other)
    expect(waited).toBe(0)
  })

  it('is not made again when it was cancelled while it waited', async () => {
    const controller = new AbortController()
    uninstall = installSessionRecovery({
      wait: () => {
        controller.abort()
        return Promise.resolve(true)
      },
    })
    const probe = refusedOnce()
    await expect(recovering(probe.call, controller.signal)).rejects.toBe(refused)
    expect(probe.calls()).toBe(1)
  })

  it('counts identity changes the page makes on purpose, overlapping or not', () => {
    const first = changingIdentity()
    const second = changingIdentity()
    first()
    first()
    expect(identityChanging()).toBe(true)
    second()
    expect(identityChanging()).toBe(false)
  })
})
