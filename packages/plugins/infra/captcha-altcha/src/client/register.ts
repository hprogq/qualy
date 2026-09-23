import type { BrowserPlugin } from '@qualy/plugin-kit/browser'
import { registerCaptchaProvider } from '@qualy/plugin-captcha/client'

// The browser half's announcement, and nothing else.
//
// Every page of a deployment with this provider evaluates this module, so it
// is a name and a function: the widget and its worker are fetched only when
// a request has actually been answered with a challenge. A static import of
// either here would put them on every sign-in page's first load.

const plugin: BrowserPlugin = {
  setup: () =>
    registerCaptchaProvider({
      code: 'altcha',
      start: async (input) => (await import('./driver.ts')).start(input),
    }),
}

export default plugin
