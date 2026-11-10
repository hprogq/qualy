import type { BrowserPlugin } from '@qualy/plugin-kit/browser'

// Each draft is isolated under its original account. Identity changes freeze
// the old page; signing in or out must not erase that account's unsent words.
const plugin: BrowserPlugin = {}
export default plugin
