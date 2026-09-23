import { afterEach, describe, expect, it } from 'vitest'
import { createChallenge } from 'altcha-lib'
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2'
import type { CaptchaClientState } from '@qualy/plugin-captcha/client'
import { start } from '../src/client/driver.ts'

// The widget in a real browser, with its real worker, on a challenge made
// here the way the server makes one - only cheap, because what is under test
// is the driver's handling of the widget and not the cost of the work.

const containers: HTMLElement[] = []
afterEach(() => {
  for (const container of containers.splice(0)) container.remove()
})

const container = () => {
  const element = document.createElement('div')
  document.body.append(element)
  containers.push(element)
  return element
}

const challenge = (expiresInMs: number) =>
  createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: 1,
    counter: 10,
    deriveKey,
    expiresAt: new Date(Date.now() + expiresInMs),
    data: { version: 1 },
    hmacSignatureSecret: 'test-signing',
    hmacKeySignatureSecret: 'test-key-signing',
  })

describe('the ALTCHA driver', () => {
  it('works where nobody sees it and hands over the widget payload', async () => {
    const states: CaptchaClientState[] = []
    const host = container()
    const running = await start({
      container: host,
      challenge: { ...(await challenge(60_000)) },
      onStateChange: (state) => states.push(state),
    })
    await expect.poll(() => states.at(-1)?.kind, { timeout: 15_000 }).toBe('solved')
    expect(states[0]).toEqual({ kind: 'working' })
    expect(states.filter((state) => state.kind === 'solved')).toHaveLength(1)
    // the payload is the widget's own: base64 JSON of the challenge and its solution
    const solved = states.at(-1) as { kind: 'solved'; response: string }
    const payload = JSON.parse(atob(solved.response)) as { challenge?: unknown; solution?: unknown }
    expect(payload.challenge).toBeDefined()
    expect(payload.solution).toBeDefined()
    running.dispose()
    expect(host.querySelector('altcha-widget')).toBeNull()
  })

  it('asks for a fresh challenge when the one it was given has expired', async () => {
    const states: CaptchaClientState[] = []
    const running = await start({
      container: container(),
      challenge: { ...(await challenge(-60_000)) },
      onStateChange: (state) => states.push(state),
    })
    await expect.poll(() => states.at(-1)?.kind, { timeout: 15_000 }).toBe('failed')
    expect(states.at(-1)).toEqual({ kind: 'failed', recovery: 'refresh' })
    running.dispose()
  })
})
