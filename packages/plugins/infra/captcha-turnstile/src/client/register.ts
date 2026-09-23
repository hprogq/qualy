import type { BrowserPlugin } from '@qualy/plugin-kit/browser'
import { registerCaptchaProvider } from '@qualy/plugin-captcha/client'

// The browser half's announcement, and nothing else: Cloudflare's script is
// fetched only when a request has been answered with a challenge.

const plugin: BrowserPlugin = {
  setup: () =>
    registerCaptchaProvider({
      code: 'turnstile',
      start: async (input) => (await import('./driver.ts')).start(input),
    }),
}

export default plugin
