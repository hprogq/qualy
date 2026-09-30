import { afterEach, describe, expect, it } from 'vitest'
import {
  changingIdentity,
  identityChanging,
  installSessionRecovery,
  presentedManifest,
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
      lost: () => false,
      frozen: () => false,
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
    uninstall = installSessionRecovery({
      wait: () => Promise.resolve(false),
      lost: () => false,
      frozen: () => false,
    })
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
      lost: () => false,
      frozen: () => false,
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
      lost: () => false,
      frozen: () => false,
      wait: () => {
        controller.abort()
        return Promise.resolve(true)
      },
    })
    const probe = refusedOnce()
    await expect(recovering(probe.call, controller.signal)).rejects.toBe(refused)
    expect(probe.calls()).toBe(1)
  })

  it('is not made at all once the page belongs to somebody no longer signed in', async () => {
    uninstall = installSessionRecovery({
      wait: () => Promise.resolve(true),
      lost: () => true,
      frozen: () => true,
    })
    let calls = 0
    const answer = recovering(() => {
      calls += 1
      return Promise.resolve('answered')
    })
    const outcome = await Promise.race([
      answer.then(() => 'answered'),
      new Promise((settle) => setTimeout(() => settle('unanswered'), 50)),
    ])
    expect({ outcome, calls }).toEqual({ outcome: 'unanswered', calls: 0 })
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

describe('a manifest asked again for a signed-in page', () => {
  const reader = { viewer: 'authenticated', identity: 'reader' }
  const nobody = { viewer: 'anonymous' }
  const other = { viewer: 'authenticated', identity: 'someone-else' }

  it('goes to the recovery when it answers as nobody, and the page keeps its own', () => {
    const told: [string, boolean][] = []
    uninstall = installSessionRecovery({
      wait: () => Promise.resolve(false),
      frozen: () => false,
      lost: (identity, someoneElse) => {
        told.push([identity, someoneElse])
        return true
      },
    })
    expect(presentedManifest(reader, nobody)).toBe(reader)
    expect(presentedManifest(reader, other)).toBe(reader)
    expect(told).toEqual([
      ['reader', false],
      ['reader', true],
    ])
  })

  it('is taken as it came when the recovery lets it go, or nobody was signed in', () => {
    uninstall = installSessionRecovery({
      wait: () => Promise.resolve(false),
      lost: () => false,
      frozen: () => false,
    })
    expect(presentedManifest(reader, nobody)).toBe(nobody)
    expect(presentedManifest(nobody, reader)).toBe(reader)
    expect(presentedManifest(undefined, nobody)).toBe(nobody)
  })

  it('is taken as it came for the same person, and while the page changes identity itself', () => {
    let asked = 0
    uninstall = installSessionRecovery({
      wait: () => Promise.resolve(false),
      frozen: () => false,
      lost: () => {
        asked += 1
        return true
      },
    })
    const renewed = { viewer: 'authenticated', identity: 'reader', pages: [] }
    expect(presentedManifest(reader, renewed)).toBe(renewed)
    const changed = changingIdentity()
    try {
      expect(presentedManifest(reader, nobody)).toBe(nobody)
    } finally {
      changed()
    }
    expect(asked).toBe(0)
  })
})
