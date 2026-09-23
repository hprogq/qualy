import 'altcha/external'
import 'altcha/altcha.css'
import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker'
import type { BrowserCaptchaProvider, CaptchaClientState } from '@qualy/plugin-captcha/client'

// The widget, brought up on a challenge the server issued.
//
// The external build: it carries no worker of its own - the default build
// inlines one and starts it from a blob: url, which the shell's worker-src
// 'self' refuses - so the PBKDF2 worker is imported here and served as a
// file of this origin like any other chunk.
//
// Nobody sees it. It starts computing the moment it is given the challenge
// and reports only that it is working, and then the proof. Every way it can
// stop short - an error, the challenge expiring while it computed - is
// answered with a fresh request rather than a second try on this challenge:
// issuing one costs the server next to nothing, and a challenge that failed
// once may be one that can no longer succeed.

const ALGORITHM = 'PBKDF2/SHA-256'

let workerRegistered = false

/** the registry the widget build puts on the page when it is imported */
const altchaGlobal = () =>
  (globalThis as unknown as { $altcha: { algorithms: Map<string, () => Worker> } }).$altcha

interface AltchaWidget extends HTMLElement {
  configure: (options: Record<string, unknown>) => Promise<void>
}

export const start: BrowserCaptchaProvider['start'] = async ({
  container,
  challenge,
  onStateChange,
}) => {
  if (!workerRegistered) {
    altchaGlobal().algorithms.set(ALGORITHM, () => new Pbkdf2Worker())
    workerRegistered = true
  }
  let settled = false
  const report = (state: CaptchaClientState) => {
    if (settled) return
    if (state.kind === 'solved' || state.kind === 'failed') settled = true
    onStateChange(state)
  }

  const widget = document.createElement('altcha-widget') as AltchaWidget
  const verified = (event: Event) => {
    const payload = (event as CustomEvent<{ payload?: string }>).detail.payload
    if (typeof payload === 'string' && payload !== '') report({ kind: 'solved', response: payload })
    else report({ kind: 'failed', recovery: 'refresh' })
  }
  const changed = (event: Event) => {
    const state = (event as CustomEvent<{ state?: string }>).detail.state
    if (state === 'error' || state === 'expired') report({ kind: 'failed', recovery: 'refresh' })
  }
  widget.addEventListener('verified', verified)
  widget.addEventListener('statechange', changed)
  widget.addEventListener('expired', () => report({ kind: 'failed', recovery: 'refresh' }))
  // its methods exist once it says it has loaded, which it does as it is
  // attached - so the listener goes on first
  const loaded = new Promise<void>((resolve) =>
    widget.addEventListener('load', () => resolve(), { once: true }),
  )
  container.append(widget)
  report({ kind: 'working' })
  if (typeof widget.configure !== 'function') await loaded
  await widget.configure({
    challenge,
    auto: 'onload',
    display: 'invisible',
    workers: 1,
    hideFooter: true,
    hideLogo: true,
  })
  return {
    dispose: () => {
      settled = true
      widget.removeEventListener('verified', verified)
      widget.removeEventListener('statechange', changed)
      widget.remove()
    },
  }
}
