import type { BrowserCaptchaProvider, CaptchaClientState } from '@qualy/plugin-captcha/client'

// The Turnstile widget, rendered explicitly into the container the host gave.
//
// Cloudflare's script is loaded the first time a challenge arrives and never
// again on that page; it has to come from Cloudflare's own host, which the
// shell's policy names while this plugin is selected. Every retry belongs to
// the Qualy gate, never to the widget: automatic retries, refreshes of an
// expired token and the hidden form field are all turned off, so the page and
// the widget can never disagree about whether a check is under way. A widget
// that could not load says so and can be tried again - the server cannot
// tell a browser that failed to load it from one that chose not to, so no
// failure here ever lets a request through.

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/**
 * How long the script may take before the page stops waiting on it. A
 * connection that hangs rather than fails would otherwise leave the button
 * saying it is checking, forever, with nothing to try again.
 */
export const LOAD_TIMEOUT_MS = 10_000

interface TurnstileOptions {
  readonly sitekey: string
  readonly action: string
  readonly cData: string
  readonly appearance: 'interaction-only'
  readonly size: 'flexible'
  readonly retry: 'never'
  readonly 'refresh-expired': 'never'
  readonly 'refresh-timeout': 'never'
  readonly 'response-field': false
  readonly callback: (token: string) => void
  readonly 'before-interactive-callback': () => void
  readonly 'after-interactive-callback': () => void
  readonly 'error-callback': () => void
  readonly 'expired-callback': () => void
  readonly 'timeout-callback': () => void
  readonly 'unsupported-callback': () => void
}

export interface TurnstileApi {
  readonly render: (container: HTMLElement, options: TurnstileOptions) => string | undefined
  readonly remove: (widgetId: string) => void
}

const turnstileOf = () => (globalThis as { turnstile?: TurnstileApi }).turnstile

/** the script, loaded at most once per page, however many challenges come */
let loading: Promise<TurnstileApi> | undefined

const load = (): Promise<TurnstileApi> => {
  const present = turnstileOf()
  if (present !== undefined) return Promise.resolve(present)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    const timer = window.setTimeout(() => {
      // taken out, so a late arrival does not start a second copy beside
      // the next attempt's
      script.remove()
      reject(new Error('turnstile took too long to load'))
    }, LOAD_TIMEOUT_MS)
    script.addEventListener('load', () => {
      window.clearTimeout(timer)
      const api = turnstileOf()
      if (api === undefined) reject(new Error('turnstile did not start'))
      else resolve(api)
    })
    script.addEventListener('error', () => {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error('turnstile could not be loaded'))
    })
    document.head.append(script)
  }).catch((error: unknown) => {
    // a failed load may succeed next time: forget it rather than keep it
    loading = undefined
    throw error
  })
  return loading
}

export const start: BrowserCaptchaProvider['start'] = async ({
  container,
  challenge,
  onStateChange,
}) => {
  let settled = false
  const report = (state: CaptchaClientState) => {
    if (settled) return
    if (state.kind === 'solved' || state.kind === 'failed') settled = true
    onStateChange(state)
  }
  report({ kind: 'working' })
  let api: TurnstileApi
  try {
    api = await load()
  } catch {
    report({ kind: 'failed', recovery: 'restart' })
    return { dispose: () => undefined }
  }
  const failed = () => report({ kind: 'failed', recovery: 'restart' })
  const widgetId = api.render(container, {
    sitekey: String(challenge['siteKey']),
    action: String(challenge['action']),
    cData: String(challenge['cData']),
    appearance: 'interaction-only',
    // as wide as the form it appears in, rather than Cloudflare's fixed 300px
    size: 'flexible',
    retry: 'never',
    'refresh-expired': 'never',
    'refresh-timeout': 'never',
    'response-field': false,
    callback: (token) => report({ kind: 'solved', response: token }),
    'before-interactive-callback': () => report({ kind: 'interaction-required' }),
    'after-interactive-callback': () => report({ kind: 'working' }),
    'error-callback': failed,
    'expired-callback': failed,
    'timeout-callback': failed,
    'unsupported-callback': failed,
  })
  return {
    dispose: () => {
      settled = true
      if (widgetId !== undefined) api.remove(widgetId)
    },
  }
}

/** test seam: the loader's memory is per page in a browser and per file in a suite */
export const forgetTurnstile = () => {
  loading = undefined
}
