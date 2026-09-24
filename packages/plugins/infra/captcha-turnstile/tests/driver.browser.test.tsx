import { afterEach, describe, expect, it } from 'vitest'
import type { CaptchaClientState } from '@qualy/plugin-captcha/client'
import { forgetTurnstile, start, type TurnstileApi } from '../src/client/driver.ts'

// The driver against a Turnstile the suite stands in for: the page already
// has one, so no script is fetched and nothing reaches Cloudflare. What is
// checked is what the driver asks the widget for, and what it makes of each
// thing the widget says.

type Options = Parameters<TurnstileApi['render']>[1]

const rendered: { container: HTMLElement; options: Options }[] = []
const removed: string[] = []

const install = () => {
  ;(globalThis as { turnstile?: TurnstileApi }).turnstile = {
    render: (container, options) => {
      rendered.push({ container, options })
      return `widget-${String(rendered.length)}`
    },
    remove: (id) => {
      removed.push(id)
    },
  }
}

afterEach(() => {
  delete (globalThis as { turnstile?: TurnstileApi }).turnstile
  forgetTurnstile()
  rendered.length = 0
  removed.length = 0
})

const challenge = { siteKey: 'site-key', action: 'auth_login', cData: 'a'.repeat(64) }

describe('the Turnstile driver', () => {
  it('asks for a widget that never retries or refreshes on its own and fills no form field', async () => {
    install()
    const states: CaptchaClientState[] = []
    const running = await start({
      container: document.body,
      challenge,
      onStateChange: (state) => states.push(state),
    })
    expect(rendered).toHaveLength(1)
    expect(rendered[0]!.options).toMatchObject({
      sitekey: 'site-key',
      action: 'auth_login',
      cData: 'a'.repeat(64),
      appearance: 'interaction-only',
      size: 'flexible',
      retry: 'never',
      'refresh-expired': 'never',
      'refresh-timeout': 'never',
      'response-field': false,
    })
    expect(states).toEqual([{ kind: 'working' }])
    running.dispose()
    expect(removed).toEqual(['widget-1'])
  })

  it('says when the person is needed, when they are done, and hands the token over once', async () => {
    install()
    const states: CaptchaClientState[] = []
    await start({ container: document.body, challenge, onStateChange: (state) => states.push(state) })
    const options = rendered[0]!.options
    options['before-interactive-callback']()
    options['after-interactive-callback']()
    options.callback('the-token')
    options.callback('again')
    expect(states).toEqual([
      { kind: 'working' },
      { kind: 'interaction-required' },
      { kind: 'working' },
      { kind: 'solved', response: 'the-token' },
    ])
  })

  it('asks for the same challenge to be tried again on every way the widget stops short', async () => {
    install()
    for (const callback of [
      'error-callback',
      'expired-callback',
      'timeout-callback',
      'unsupported-callback',
    ] as const) {
      const states: CaptchaClientState[] = []
      await start({ container: document.body, challenge, onStateChange: (state) => states.push(state) })
      rendered.at(-1)!.options[callback]()
      expect(states.at(-1), callback).toEqual({ kind: 'failed', recovery: 'restart' })
    }
  })

  it('says it failed, and lets nothing through, when the widget cannot be loaded', async () => {
    // no turnstile on the page, and the script refused: what a blocked
    // Cloudflare looks like to a browser
    const states: CaptchaClientState[] = []
    const appended = new Promise<HTMLScriptElement>((resolve) => {
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLScriptElement && node.src.includes('turnstile')) {
              observer.disconnect()
              resolve(node)
            }
          }
        }
      })
      observer.observe(document.head, { childList: true })
    })
    const starting = start({ container: document.body, challenge, onStateChange: (state) => states.push(state) })
    const script = await appended
    script.dispatchEvent(new Event('error'))
    await starting
    expect(states).toEqual([{ kind: 'working' }, { kind: 'failed', recovery: 'restart' }])
    script.remove()
  })
})
