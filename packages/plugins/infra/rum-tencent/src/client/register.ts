import type { BrowserPlugin } from '@qualy/plugin-kit/browser'
import { registerRumProvider } from '@qualy/plugin-rum/client'
import { tencentRumProvider } from './provider.ts'

// The browser half's announcement, and nothing else.
//
// Every page of every deployment with this plugin active evaluates this
// module, so it stays a name and a function: whether anything is reported is
// decided by the capability, after it has asked the server, and the vendor
// sdk is imported only once that answer is yes.
//
// Setup rather than start, because announcing is exactly what setup is for -
// synchronous, cheap, and undone by the disposer it hands back.

const plugin: BrowserPlugin = {
  setup: () => registerRumProvider(tencentRumProvider),
}

export default plugin
